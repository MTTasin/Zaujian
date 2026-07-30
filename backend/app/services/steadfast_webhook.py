"""
Inbound Steadfast webhook: they push, we stop polling.

Configured in the Steadfast merchant panel (Webhook Integration) with a Callback
Url + a Bearer Auth Token. Two notification types, documented there:

  delivery_status  {notification_type, consignment_id, invoice, cod_amount,
                    status, delivery_charge, tracking_message, updated_at}
  tracking_update  {notification_type, consignment_id, invoice,
                    tracking_message, updated_at}

`delivery_status` is authoritative for the parcel's status; `tracking_update` is
the hub-by-hub narration that no API endpoint exposes, so it is only logged.
Every push is stored as a ConsignmentEvent either way — that log IS the timeline.

Deliberately dumb and synchronous (no job queue on cPanel): match the parcel,
write two rows, maybe promote the order. Nothing here calls out to the network.
"""

import logging
from decimal import Decimal, InvalidOperation

from ..models import ConsignmentEvent, ExtraConsignment, Order
from .consignments import normalise_status, promote_if_all_delivered

log = logging.getLogger(__name__)

KINDS = {ConsignmentEvent.Kind.DELIVERY_STATUS, ConsignmentEvent.Kind.TRACKING_UPDATE}

MAX_MESSAGE_CHARS = 500


def _dec(value):
    if value in (None, ""):
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None


def _find_parcel(consignment_id, invoice):
    """(order, extra) for this parcel, or (None, None).

    Consignment id is the identity; invoice is only a fallback, because a
    re-submitted primary gets a fresh invoice (`{uid}-HHMMSS`) while extras use
    `{uid}-2`, `-3`… — so an invoice can be stale but an id cannot.
    """
    cid = str(consignment_id or "").strip()
    if cid:
        order = Order.objects.filter(steadfast_consignment_id=cid).first()
        if order:
            return order, None
        extra = (ExtraConsignment.objects.filter(consignment_id=cid)
                 .select_related("order").first())
        if extra:
            return extra.order, extra

    inv = str(invoice or "").strip()
    if inv:
        order = Order.objects.filter(uid=inv).first()
        if order:
            return order, None
        extra = ExtraConsignment.objects.filter(invoice=inv).select_related("order").first()
        if extra:
            return extra.order, extra
    return None, None


def handle(payload):
    """Process one push. Returns (ok, message, event).

    `ok=False` means the parcel is not ours — the caller answers with the
    documented {"status": "error"} body. The event row is still written, so a
    mismatch is visible in the admin instead of vanishing.
    """
    if not isinstance(payload, dict):
        return False, "Malformed payload.", None

    kind = str(payload.get("notification_type") or "").strip().lower()
    if kind not in KINDS:
        # Unknown type: log it verbatim rather than guess what it means.
        log.warning("Steadfast webhook: unknown notification_type %r", kind)

    cid = str(payload.get("consignment_id") or "").strip()
    invoice = str(payload.get("invoice") or "").strip()[:64]
    status = normalise_status(payload.get("status"))
    message = str(payload.get("tracking_message") or "").strip()[:MAX_MESSAGE_CHARS]
    order, extra = _find_parcel(cid, invoice)

    event, created = ConsignmentEvent.objects.get_or_create(
        # Retries repeat the same body, so identity is the content itself. Their
        # timestamp is part of it: the same message at a later time is a new event.
        consignment_id=cid,
        notification_type=kind,
        status=status,
        tracking_message=message,
        event_time=str(payload.get("updated_at") or "").strip()[:40],
        defaults={
            "order": order,
            "extra": extra,
            "invoice": invoice,
            "cod_amount": _dec(payload.get("cod_amount")),
            "delivery_charge": _dec(payload.get("delivery_charge")),
            "payload": payload,
        },
    )
    if not created:
        # A duplicate must stay harmless: no status write, no second email.
        return (order is not None), "Duplicate ignored.", event

    if order is None:
        log.warning("Steadfast webhook: no parcel for consignment %r / invoice %r",
                    cid, invoice)
        return False, "Invalid consignment ID.", event

    # Only delivery_status carries a status; a tracking_update must never clear one.
    if kind == ConsignmentEvent.Kind.DELIVERY_STATUS and status:
        if extra is not None:
            if extra.status != status:
                extra.status = status
                extra.save(update_fields=["status"])
        elif order.steadfast_status != status:
            order.steadfast_status = status
            order.save(update_fields=["steadfast_status", "updated_at"])
        promote_if_all_delivered(order)

    return True, "Webhook received successfully.", event
