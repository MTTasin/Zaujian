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
from django.core.cache import cache

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
        # A courier that failed knows nothing — that is NOT "0 parcels delivered".
        stats["counts_available"] = False
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

        return {"success": success, "cancel": cancel, "total": total,
                "success_ratio": ratio, "counts_available": True}
    except (requests.RequestException, ValueError) as exc:
        logger.warning("Steadfast fraud check failed for %s: %s", phone, exc)
        return _empty_stats("Steadfast request error")
    finally:
        session.close()


# --------------------------------------------------------------------------- #
# Pathao (merchant API)
# --------------------------------------------------------------------------- #

def pathao_stats(phone):
    """
    Pathao's merchant API answers in one of two shapes on the SAME endpoint:

      old:  {"data": {"customer": {"successful_delivery": 9, "total_delivery": 10}}}
      v2:   {"data": {"version": "v2", "show_count": false,
                      "customer_rating": "excellent_customer"}}

    Documented buckets: excellent_customer, good_customer, moderate_customer,
    risky_customer, new_customer — sometimes alongside `risk_level` + `message`.
    Both shapes are parsed; which one arrives is decided by the account, not by
    anything we send.
    """
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

        data = (resp.json() or {}).get("data") or {}
        customer = data.get("customer") or {}

        # Everything Pathao volunteers besides the counts. `risk_level` and
        # `message` are not guaranteed — they are read if present and never
        # required, so a body without them parses exactly as before.
        graded = {"rating": str(data.get("customer_rating") or "").strip()}
        for key in ("risk_level", "message"):
            value = str(data.get(key) or "").strip()
            if value:
                graded[key] = value

        # `show_count: false` is Pathao SAYING the counts are withheld, which is
        # stronger evidence than inferring it from a missing `customer` object —
        # a stub customer full of zeros alongside show_count:false would
        # otherwise parse as a real "0 delivered" history.
        if not customer or data.get("show_count") is False:
            # Reporting this as 0 delivered / 0 cancelled is a LIE of a different
            # kind — it reads as "this customer never received a parcel" — so the
            # counts are marked unavailable and only the grading is passed on.
            return {"success": 0, "cancel": 0, "total": 0, "success_ratio": 0.0,
                    "counts_available": False, **graded}

        success = int(customer.get("successful_delivery", 0) or 0)
        total = int(customer.get("total_delivery", 0) or 0)
        cancel = max(0, total - success)
        ratio = round(success / total * 100, 2) if total else 0.0

        return {"success": success, "cancel": cancel, "total": total,
                "success_ratio": ratio, "counts_available": True, **graded}
    except (requests.RequestException, ValueError) as exc:
        logger.warning("Pathao fraud check failed for %s: %s", phone, exc)
        return _empty_stats("Pathao request error")


# --------------------------------------------------------------------------- #
# Aggregate + policy
# --------------------------------------------------------------------------- #

def check_phone(phone, refresh=False):
    """
    Run all couriers and aggregate. Returns a dict with per-courier stats, an
    aggregate summary, and an `advance_required` policy decision.

    Policy: if there is any delivery history and the aggregate success ratio is
    below MIN_SUCCESS_RATIO, require advance. If there is no history anywhere, or
    all couriers errored, default to requiring advance (safer default, plan §10).

    Cached per phone (`FRAUD_TTL`) because this runs INSIDE checkout: two logins
    and two lookups against couriers we do not control, on the customer's
    critical path. A person's delivery history does not move in ten minutes.
    `refresh=True` bypasses it — that is what the admin's "recheck" button is for.
    """
    from .cache import FRAUD_TTL

    norm = normalize_bd_mobile(phone)
    if not norm:
        return {
            "error": "Invalid BD mobile number",
            "advance_required": True,
            "aggregate": {"total": 0, "success_ratio": 0.0},
        }

    key = f"fraud:{norm}"
    if not refresh:
        try:
            hit = cache.get(key)
            if hit is not None:
                return hit
        except Exception:                  # noqa: BLE001 - cache down, just look it up
            logger.warning("fraud cache read failed", exc_info=True)

    steadfast = steadfast_stats(norm)
    pathao = pathao_stats(norm)

    # Only couriers that actually reported numbers are summed. Pathao v2 returns
    # a rating with NO counts, and folding its zeros in would quietly halve a
    # customer's apparent history.
    counted = [c for c in (steadfast, pathao) if c.get("counts_available", True)]
    total_success = sum(int(c.get("success", 0)) for c in counted)
    total_cancel = sum(int(c.get("cancel", 0)) for c in counted)
    total = total_success + total_cancel
    ratio = round(total_success / total * 100, 2) if total else 0.0

    all_errored = "error" in steadfast and "error" in pathao
    min_ratio = _cfg("MIN_SUCCESS_RATIO", 70)

    if total == 0 or all_errored:
        advance_required = True  # no history or couriers down -> safer default
    else:
        advance_required = ratio < min_ratio

    result = {
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

    # Never cache a transient failure. A courier being down for one request
    # would otherwise pin "advance required" on that customer for ten minutes —
    # the cache would turn a blip into a policy.
    if not ("error" in steadfast or "error" in pathao):
        try:
            cache.set(key, result, FRAUD_TTL)
        except Exception:                  # noqa: BLE001
            logger.warning("fraud cache write failed", exc_info=True)
    return result
