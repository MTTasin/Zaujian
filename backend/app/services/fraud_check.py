"""
Courier fraud check — Steadfast + Pathao only.

Ported from the PHP package in laravel-fraud-checker/ to native Python.
Called synchronously at checkout. Each courier has a hard timeout. Failures are
isolated per courier; the aggregate still returns. Raw result is stored on the
Order. See plan §10, §15.3.
"""

import logging
import re

import requests
from django.conf import settings

logger = logging.getLogger(__name__)

BD_MOBILE_RE = re.compile(r"^(?:\+?88)?01[3-9]\d{8}$")


def _cfg(key, default=None):
    return settings.COURIER.get(key, default)


def normalize_bd_mobile(phone):
    """Return an 11-digit BD mobile (01XXXXXXXXX) or None if invalid."""
    if not phone:
        return None
    digits = re.sub(r"\D", "", phone)
    if digits.startswith("88"):
        digits = digits[2:]
    if len(digits) == 11 and digits.startswith("01") and digits[2] in "3456789":
        return digits
    return None


def _empty_stats(error=None):
    stats = {"success": 0, "cancel": 0, "total": 0, "success_ratio": 0.0}
    if error:
        stats["error"] = error
    return stats


# --------------------------------------------------------------------------- #
# Steadfast (login scrape)
# --------------------------------------------------------------------------- #

def steadfast_stats(phone):
    email = _cfg("STEADFAST_FRAUD_USER")
    password = _cfg("STEADFAST_FRAUD_PASSWORD")
    timeout = _cfg("TIMEOUT_SECONDS", 3)

    if not email or not password:
        return _empty_stats("Steadfast credentials not configured")

    base = "https://steadfast.com.bd"
    session = requests.Session()
    try:
        # 1. Login page -> CSRF token + cookies
        resp = session.get(f"{base}/login", timeout=timeout)
        m = re.search(r'name="_token"\s+value="(.*?)"', resp.text)
        token = m.group(1) if m else None
        if not token:
            return _empty_stats("Steadfast CSRF token not found")

        # 2. Log in
        login = session.post(
            f"{base}/login",
            data={"_token": token, "email": email, "password": password},
            timeout=timeout,
            allow_redirects=True,
        )
        if login.status_code >= 400:
            return _empty_stats(f"Steadfast login failed ({login.status_code})")

        # 3. Fraud data (JSON)
        data_resp = session.get(
            f"{base}/user/frauds/check/{phone}", timeout=timeout
        )
        if data_resp.status_code >= 400:
            return _empty_stats(f"Steadfast fraud fetch failed ({data_resp.status_code})")

        obj = data_resp.json()
        success = int(obj.get("total_delivered", 0) or 0)
        cancel = int(obj.get("total_cancelled", 0) or 0)
        total = success + cancel
        ratio = round(success / total * 100, 2) if total else 0.0

        # 4. Best-effort logout
        try:
            page = session.get(f"{base}/user/frauds/check", timeout=timeout)
            lm = re.search(r'name="csrf-token"\s+content="(.*?)"', page.text)
            if lm:
                session.post(f"{base}/logout", data={"_token": lm.group(1)}, timeout=timeout)
        except requests.RequestException:
            pass

        return {"success": success, "cancel": cancel, "total": total, "success_ratio": ratio}
    except (requests.RequestException, ValueError) as exc:
        logger.warning("Steadfast fraud check failed for %s: %s", phone, exc)
        return _empty_stats("Steadfast request error")
    finally:
        session.close()


# --------------------------------------------------------------------------- #
# Pathao (merchant API)
# --------------------------------------------------------------------------- #

def pathao_stats(phone):
    username = _cfg("PATHAO_FRAUD_USER")
    password = _cfg("PATHAO_FRAUD_PASSWORD")
    timeout = _cfg("TIMEOUT_SECONDS", 3)

    if not username or not password:
        return _empty_stats("Pathao credentials not configured")

    base = "https://merchant.pathao.com/api/v1"
    try:
        login = requests.post(
            f"{base}/login",
            json={"username": username, "password": password},
            timeout=timeout,
        )
        if login.status_code >= 400:
            return _empty_stats(f"Pathao login failed ({login.status_code})")

        access_token = (login.json().get("access_token") or "").strip()
        if not access_token:
            return _empty_stats("Pathao access token missing")

        resp = requests.post(
            f"{base}/user/success",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {access_token}",
            },
            json={"phone": phone},
            timeout=timeout,
        )
        if resp.status_code >= 400:
            return _empty_stats(f"Pathao data fetch failed ({resp.status_code})")

        customer = (resp.json().get("data", {}) or {}).get("customer", {}) or {}
        success = int(customer.get("successful_delivery", 0) or 0)
        total = int(customer.get("total_delivery", 0) or 0)
        cancel = max(0, total - success)
        ratio = round(success / total * 100, 2) if total else 0.0

        return {"success": success, "cancel": cancel, "total": total, "success_ratio": ratio}
    except (requests.RequestException, ValueError) as exc:
        logger.warning("Pathao fraud check failed for %s: %s", phone, exc)
        return _empty_stats("Pathao request error")


# --------------------------------------------------------------------------- #
# Aggregate + policy
# --------------------------------------------------------------------------- #

def check_phone(phone):
    """
    Run all couriers and aggregate. Returns a dict with per-courier stats, an
    aggregate summary, and an `advance_required` policy decision.

    Policy: if there is any delivery history and the aggregate success ratio is
    below MIN_SUCCESS_RATIO, require advance. If there is no history anywhere, or
    all couriers errored, default to requiring advance (safer default, plan §10).
    """
    norm = normalize_bd_mobile(phone)
    if not norm:
        return {
            "error": "Invalid BD mobile number",
            "advance_required": True,
            "aggregate": {"total": 0, "success_ratio": 0.0},
        }

    steadfast = steadfast_stats(norm)
    pathao = pathao_stats(norm)

    total_success = int(steadfast.get("success", 0)) + int(pathao.get("success", 0))
    total_cancel = int(steadfast.get("cancel", 0)) + int(pathao.get("cancel", 0))
    total = total_success + total_cancel
    ratio = round(total_success / total * 100, 2) if total else 0.0

    all_errored = "error" in steadfast and "error" in pathao
    min_ratio = _cfg("MIN_SUCCESS_RATIO", 70)

    if total == 0 or all_errored:
        advance_required = True  # no history or couriers down -> safer default
    else:
        advance_required = ratio < min_ratio

    return {
        "phone": norm,
        "steadfast": steadfast,
        "pathao": pathao,
        "aggregate": {
            "total_success": total_success,
            "total_cancel": total_cancel,
            "total": total,
            "success_ratio": ratio,
        },
        "advance_required": advance_required,
    }
