"""
Meta Conversions API (CAPI) — the single conversion-tracking hub.

Ports the proven PII hashing/matching from the standalone tracking project into
the storefront. ALL PII is SHA-256 hashed before it leaves the server (never send
raw email/phone/name/etc). Sync send with a short timeout + a CapiEvent audit row
for dedup/retry; failures stay 'failed' and are retried by `send_pending_capi`.

- Website events (browser + this server): action_source="website", with fbp/fbc.
- Manual/offline leads (later): action_source="system_generated".
Event names with these sources: `Purchase`, `Lead`, `ViewContent`, `AddToCart`,
`InitiateCheckout`. `event_id` dedups against the Pixel (same id) and Meta side.
"""

import hashlib
import logging
import re
import time

import requests
from django.conf import settings
from django.utils import timezone

from ..models import CapiEvent

logger = logging.getLogger(__name__)

GRAPH = "https://graph.facebook.com"


def _cfg(key, default=None):
    return settings.META.get(key, default)


def _sha(value):
    v = (value or "").strip().lower()
    return hashlib.sha256(v.encode("utf-8")).hexdigest() if v else None


def normalize_phone(phone):
    """Any BD format -> 8801XXXXXXXXX (digits, with country code)."""
    digits = re.sub(r"\D", "", phone or "")
    if not digits:
        return None
    if digits.startswith("00"):
        digits = digits[2:]
    if digits.startswith("880"):
        return digits
    if digits.startswith("0"):
        return "880" + digits[1:]
    if len(digits) == 10 and digits.startswith("1"):
        return "880" + digits
    return digits


def build_user_data(*, email=None, phone=None, first_name=None, last_name=None,
                    city=None, state=None, zip_code=None, gender=None, country=None,
                    date_of_birth=None, external_id=None,
                    fbp=None, fbc=None, client_ip=None, user_agent=None):
    """Hashed Advanced-Matching payload. fbp/fbc/ip/ua are sent RAW (per Meta)."""
    ud = {}
    if email:
        ud["em"] = [_sha(email)]
    ph = normalize_phone(phone)
    if ph:
        ud["ph"] = [_sha(ph)]
    if first_name:
        ud["fn"] = [_sha(first_name)]
    if last_name:
        ud["ln"] = [_sha(last_name)]
    if city:
        ud["ct"] = [_sha(re.sub(r"\s+", "", city))]
    if state:
        ud["st"] = [_sha(re.sub(r"\s+", "", state))]
    if zip_code:
        ud["zp"] = [_sha(re.sub(r"\s+", "", zip_code))]
    if gender:
        ud["ge"] = [_sha(gender)]
    if date_of_birth:
        # Meta expects db as YYYYMMDD (hashed). Accept a date/datetime or string.
        dob = date_of_birth.strftime("%Y%m%d") if hasattr(date_of_birth, "strftime") \
            else re.sub(r"\D", "", str(date_of_birth))
        if dob:
            ud["db"] = [_sha(dob)]
    co = (country or _cfg("DEFAULT_COUNTRY", "bd"))
    if co:
        ud["country"] = [_sha(co)]
    if external_id:
        ud["external_id"] = [_sha(str(external_id))]
    if fbp:
        ud["fbp"] = fbp
    if fbc:
        ud["fbc"] = fbc
    if client_ip:
        ud["client_ip_address"] = client_ip
    if user_agent:
        ud["client_user_agent"] = user_agent
    return {k: v for k, v in ud.items() if v}


def _deliver(ev):
    """POST a CapiEvent's stored payload to Meta; update status. Used by send + retry."""
    dataset = _cfg("DATASET_ID")
    token = _cfg("ACCESS_TOKEN")
    if not dataset or not token:
        ev.status = CapiEvent.Status.FAILED
        ev.response = {"error": "META dataset/token not configured"}
        ev.save()
        return ev

    body = {"data": [ev.payload]}
    test_code = _cfg("TEST_EVENT_CODE")
    if test_code:
        body["test_event_code"] = test_code

    ev.attempts += 1
    ev.last_attempt_at = timezone.now()
    ver = _cfg("GRAPH_VERSION", "v21.0")
    try:
        resp = requests.post(
            f"{GRAPH}/{ver}/{dataset}/events",
            params={"access_token": token},
            json=body,
            timeout=_cfg("TIMEOUT_SECONDS", 3),
        )
        ev.response = resp.json() if resp.content else {}
        ok = resp.status_code < 400 and int(ev.response.get("events_received", 0)) >= 1
        ev.status = CapiEvent.Status.SENT if ok else CapiEvent.Status.FAILED
    except (requests.RequestException, ValueError) as exc:
        ev.status = CapiEvent.Status.FAILED
        ev.response = {"error": str(exc)}
        logger.warning("CAPI %s deliver failed: %s", ev.event_name, exc)
    ev.save()
    return ev


def send_event(event_name, event_id, *, user_data, custom_data=None,
               action_source="website", event_source_url=None):
    """Create/reuse a CapiEvent (dedup on event_id) and deliver it to Meta.
    A row already 'sent' is never re-fired. Returns the CapiEvent."""
    ev, _ = CapiEvent.objects.get_or_create(
        event_id=event_id,
        defaults={
            "event_name": event_name,
            "action_source": action_source,
            "value": (custom_data or {}).get("value"),
            "currency": (custom_data or {}).get("currency", "BDT"),
        },
    )
    if ev.status == CapiEvent.Status.SENT:
        return ev  # already delivered — dedup

    data = {
        "event_name": event_name,
        "event_time": int(time.time()),
        "event_id": event_id,
        "action_source": action_source,
        "user_data": user_data,
    }
    if event_source_url:
        data["event_source_url"] = event_source_url
    if custom_data:
        data["custom_data"] = custom_data
    ev.payload = data
    return _deliver(ev)


# --------------------------------------------------------------------------- #
# High-level helpers
# --------------------------------------------------------------------------- #

def _client(request):
    if request is None:
        return None, None
    fwd = request.META.get("HTTP_X_FORWARDED_FOR", "")
    ip = fwd.split(",")[0].strip() if fwd else request.META.get("REMOTE_ADDR")
    return ip, request.META.get("HTTP_USER_AGENT", "")


def _split_name(full):
    parts = (full or "").split()
    if not parts:
        return None, None
    return parts[0], (" ".join(parts[1:]) or None)


def track_purchase(order, *, fbp=None, fbc=None, event_source_url=None, request=None,
                   action_source="website"):
    """Fire a Purchase for a placed order. event_id dedups with the Pixel.

    Admin-created (phone/WhatsApp/walk-in) orders pass
    action_source="system_generated" so offline sales still feed Meta.
    """
    ip, ua = _client(request)
    fn, ln = _split_name(order.customer_name)
    ud = build_user_data(
        email=order.email, phone=order.phone, first_name=fn, last_name=ln,
        city=(order.district or order.thana), state=order.division,
        external_id=order.uid, fbp=fbp, fbc=fbc, client_ip=ip, user_agent=ua,
    )
    custom = {"currency": "BDT", "value": float(order.total)}
    return send_event("Purchase", f"purchase.{order.uid}", user_data=ud,
                      custom_data=custom, action_source=action_source,
                      event_source_url=event_source_url)


def track_lead(*, name=None, phone=None, email=None, event_id, fbp=None, fbc=None,
               event_source_url=None, request=None):
    """Fire a website Lead (e.g. custom-design request)."""
    ip, ua = _client(request)
    fn, ln = _split_name(name)
    ud = build_user_data(
        email=email, phone=phone, first_name=fn, last_name=ln,
        external_id=phone or email, fbp=fbp, fbc=fbc, client_ip=ip, user_agent=ua,
    )
    return send_event("Lead", event_id, user_data=ud, action_source="website",
                      event_source_url=event_source_url)


def _lead_user_data(lead):
    return build_user_data(
        email=lead.email, phone=lead.phone,
        first_name=lead.first_name, last_name=lead.last_name,
        city=lead.city, state=lead.state, zip_code=lead.zip_code,
        gender=lead.gender or None,
        date_of_birth=lead.date_of_birth or None,
        country=lead.country or None,
        external_id=lead.external_id or lead.phone or lead.email or str(lead.pk),
    )


def track_manual_lead(lead):
    """Fire a `Lead` for a manually-entered lead (offline / messaging)."""
    return send_event("Lead", f"lead.manual.{lead.pk}", user_data=_lead_user_data(lead),
                      action_source="system_generated")


def track_manual_purchase(lead):
    """Fire a `Purchase` for a converted manual lead."""
    custom = {"currency": "BDT", "value": float(lead.conversion_value or 0)}
    return send_event("Purchase", f"purchase.manual.{lead.pk}", user_data=_lead_user_data(lead),
                      custom_data=custom, action_source="system_generated")
