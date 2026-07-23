"""
Steadfast consignment booking via the official API.

Called ONLY from the Django admin "Confirm order" action, never automatically.
Uses Api-Key / Secret-Key headers. On failure raises SteadfastError so the admin
action can refuse to confirm the order. See plan §15.4.
"""

import logging

import requests
from django.conf import settings

logger = logging.getLogger(__name__)


class SteadfastError(Exception):
    """Raised when consignment creation fails."""


def _cfg(key, default=None):
    return settings.COURIER.get(key, default)


def _headers():
    return {
        "Api-Key": _cfg("STEADFAST_API_KEY"),
        "Secret-Key": _cfg("STEADFAST_SECRET_KEY"),
        "Content-Type": "application/json",
    }


def _item_description(order):
    """Readable list of the order's items for the courier slip."""
    names = []
    for it in order.items.all():
        if it.product_id:
            names.append(it.product.name)
        elif it.combo_id:
            names.append(it.combo.name)
        else:
            names.append((it.config or {}).get("title", "পণ্য"))
    return (", ".join(n for n in names if n)[:250]) or "Nikah items"


def create_consignment(order, invoice=None, overrides=None):
    """
    Submit `order` to Steadfast as a consignment.

    `invoice` overrides the invoice code (Steadfast requires it unique) — used on
    re-submit so a fresh, non-duplicate invoice is sent.

    `overrides` (dict) can contain keys `recipient_name`, `recipient_phone`,
    `recipient_address`, `cod_amount`, `item_description`, `alternative_phone`
    to replace the order-derived values.

    Returns a dict with consignment_id, tracking_code, status on success.
    Raises SteadfastError on any failure (missing creds, network, bad response).
    """
    api_key = _cfg("STEADFAST_API_KEY")
    secret = _cfg("STEADFAST_SECRET_KEY")
    base = _cfg("STEADFAST_API_BASE", "https://portal.packzy.com/api/v1")
    timeout = _cfg("TIMEOUT_SECONDS", 3)

    if not api_key or not secret:
        raise SteadfastError("Steadfast API key/secret not configured")

    cod = order.compute_cod()
    # Full delivery address (street + thana + district + division), not just the
    # street line, so the courier slip matches the customer's real location.
    address = (order.full_address or order.address or "")[:250]
    payload = {
        "invoice": invoice or order.uid,  # public order code, unique + alphanumeric
        "recipient_name": (order.customer_name or "")[:100],
        "recipient_phone": order.phone,
        "recipient_address": address,
        "cod_amount": float(cod),
        "note": f"Zaujain order {order.uid}",
        "item_description": _item_description(order),
    }
    if order.whatsapp:
        payload["alternative_phone"] = order.whatsapp

    # Apply field overrides if provided
    ov = overrides or {}
    if "recipient_name" in ov:
        payload["recipient_name"] = str(ov["recipient_name"])[:100]
    if "recipient_phone" in ov:
        payload["recipient_phone"] = str(ov["recipient_phone"])
    if "recipient_address" in ov:
        payload["recipient_address"] = str(ov["recipient_address"])[:250]
    if "cod_amount" in ov and ov["cod_amount"] is not None:
        payload["cod_amount"] = float(ov["cod_amount"])
    if "item_description" in ov and ov["item_description"]:
        payload["item_description"] = str(ov["item_description"])[:250]
    if ov.get("alternative_phone"):
        payload["alternative_phone"] = str(ov["alternative_phone"])

    try:
        resp = requests.post(
            f"{base}/create_order",
            headers=_headers(),
            json=payload,
            timeout=timeout,
        )
    except requests.RequestException as exc:
        logger.error("Steadfast create_order network error for order %s: %s", order.pk, exc)
        raise SteadfastError(f"Network error: {exc}") from exc

    if resp.status_code >= 400:
        logger.error(
            "Steadfast create_order HTTP %s for order %s: %s",
            resp.status_code, order.pk, resp.text[:500],
        )
        raise SteadfastError(f"Steadfast returned HTTP {resp.status_code}")

    try:
        data = resp.json()
    except ValueError as exc:
        raise SteadfastError("Steadfast returned non-JSON response") from exc

    # Steadfast wraps the consignment under "consignment".
    consignment = data.get("consignment") or {}
    consignment_id = consignment.get("consignment_id") or data.get("consignment_id")
    tracking = consignment.get("tracking_code") or data.get("tracking_code")

    if not consignment_id:
        raise SteadfastError(f"No consignment id in response: {str(data)[:300]}")

    return {
        "consignment_id": str(consignment_id),
        "tracking_code": str(tracking or ""),
        "status": str(consignment.get("status") or "in_review"),
        "cod_amount": cod,
    }


def get_status(order):
    """Fetch the parcel's current delivery status from Steadfast (by consignment id)."""
    base = _cfg("STEADFAST_API_BASE", "https://portal.packzy.com/api/v1")
    timeout = _cfg("TIMEOUT_SECONDS", 3)
    cid = order.steadfast_consignment_id
    if not cid:
        raise SteadfastError("No consignment booked for this order")
    if not _cfg("STEADFAST_API_KEY") or not _cfg("STEADFAST_SECRET_KEY"):
        raise SteadfastError("Steadfast API key/secret not configured")
    try:
        resp = requests.get(f"{base}/status_by_cid/{cid}", headers=_headers(), timeout=timeout)
    except requests.RequestException as exc:
        raise SteadfastError(f"Network error: {exc}") from exc
    if resp.status_code >= 400:
        raise SteadfastError(f"Steadfast returned HTTP {resp.status_code}")
    try:
        data = resp.json()
    except ValueError as exc:
        raise SteadfastError("Steadfast returned non-JSON response") from exc
    return str(data.get("delivery_status") or "")
