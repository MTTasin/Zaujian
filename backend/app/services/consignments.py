"""
Parcel-level rules shared by everything that learns a Steadfast status: the
manual "Refresh status" action, the bulk sweep, and the webhook.

An order can ship as several consignments (the primary one on `Order` plus each
`ExtraConsignment`), so ONE delivered parcel is not a delivered order. That rule
lives here once — two copies would eventually disagree and mark orders delivered
that aren't.
"""

from ..models import Order
from . import notifications

DELIVERED = "delivered"


def normalise_status(value):
    """Steadfast's polled status is lower-case, the webhook sends 'Delivered'."""
    return str(value or "").strip().lower()


def parcel_statuses(order):
    """Stored status of every booked parcel. An extra that was never booked
    contributes "" — it can't be delivered, so it blocks promotion."""
    statuses = [normalise_status(order.steadfast_status)]
    for ec in order.extra_consignments.all():
        statuses.append(normalise_status(ec.status) if ec.consignment_id else "")
    return statuses


def promote_if_all_delivered(order):
    """Mark the order delivered (+ status email) once EVERY parcel says delivered.

    Only the exact `delivered` string counts: `partial_delivered` is not delivered.
    Returns whether this call changed the order.
    """
    if order.status == Order.Status.DELIVERED:
        return False
    statuses = parcel_statuses(order)
    if not all(s == DELIVERED for s in statuses):
        return False
    order.status = Order.Status.DELIVERED
    order.save(update_fields=["status", "updated_at"])
    notifications.notify_order_status(order)
    return True
