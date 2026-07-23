"""
Customer email notifications on order placed / confirm / status change.

Uses Django SMTP (console backend in dev). Never raises to the caller — a failed
email must not break an order action. Every email includes a tracking link so the
customer can check status with their short order code (uid). See plan §15.5.
"""

import logging
import threading

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string

logger = logging.getLogger(__name__)

# Customer-facing subject/body are Bengali (audience is Bengali-only).
_STATUS_MESSAGES = {
    "pending_payment": (
        "আপনার অর্ডার পেয়েছি",
        "আপনার অর্ডার (কোড: {uid}) পেয়েছি। ধন্যবাদ।",
    ),
    "confirmed": (
        "আপনার অর্ডার নিশ্চিত হয়েছে",
        "আপনার অর্ডার (কোড: {uid}) নিশ্চিত হয়েছে।",
    ),
    "in_production": (
        "আপনার অর্ডার তৈরি হচ্ছে",
        "আপনার অর্ডার (কোড: {uid}) এখন তৈরি হচ্ছে।",
    ),
    "shipped": (
        "আপনার অর্ডার পাঠানো হয়েছে",
        "আপনার অর্ডার (কোড: {uid}) কুরিয়ারে পাঠানো হয়েছে। ট্র্যাকিং: {tracking}",
    ),
    "delivered": (
        "আপনার অর্ডার পৌঁছেছে",
        "আপনার অর্ডার (কোড: {uid}) পৌঁছে দেওয়া হয়েছে। ধন্যবাদ।",
    ),
    "cancelled": (
        "আপনার অর্ডার বাতিল হয়েছে",
        "আপনার অর্ডার (কোড: {uid}) বাতিল করা হয়েছে।",
    ),
}


def _tracking_url(order):
    return f"{settings.FRONTEND_URL}/track/{order.uid}"


def _advance_context(order):
    """Payment details for the one email that asks for money, else None.

    Never invents a number: a blank setting drops the line entirely rather than
    rendering an empty one — same hard rule the salesbot follows.
    """
    if order.status != "pending_payment":
        return None
    shop = getattr(settings, "SHOP", {}) or {}
    return {
        "amount": shop.get("ADVANCE_AMOUNT", ""),
        "bkash": (shop.get("BKASH_NUMBER") or "").strip(),
        "nagad": (shop.get("NAGAD_NUMBER") or "").strip(),
    }


def build_order_email(order):
    """The status email as a ready-to-send message, or None for unknown statuses.

    Pure builder — no I/O — so the content is testable without a mail backend.
    """
    template = _STATUS_MESSAGES.get(order.status)
    if not template:
        return None

    subject, body = template
    body = body.format(uid=order.uid, tracking=order.steadfast_tracking_code or "")
    greeting = "আসসালামু আলাইকুম।"
    if order.is_repeat_customer:
        greeting = "আসসালামু আলাইকুম! আবার অর্ডার করার জন্য ধন্যবাদ 🎉"

    tracking_url = _tracking_url(order)
    advance = _advance_context(order)

    text = f"{greeting}\n\n{body}\n\n"
    if advance:
        text += f"অগ্রিম ৳{advance['amount']} পাঠাতে হবে।\n"
        if advance["bkash"]:
            text += f"বিকাশ: {advance['bkash']}\n"
        if advance["nagad"]:
            text += f"নগদ: {advance['nagad']}\n"
        text += "\n"
    text += f"অর্ডার ট্র্যাক করুন: {tracking_url}\n\n— Zaujain Nikah Point"

    html = render_to_string("email/order_status.html", {
        "order": order,
        "greeting": greeting,
        "message": body,
        "tracking_url": tracking_url,
        "advance": advance,
        "contact": (getattr(settings, "SHOP", {}) or {}).get("CONTACT_PHONE", ""),
    })

    msg = EmailMultiAlternatives(
        subject, text, settings.DEFAULT_FROM_EMAIL, [order.email],
    )
    msg.attach_alternative(html, "text/html")
    return msg


def notify_order_status(order):
    """Send a status email to the customer with a tracking link. Logs on failure."""
    if not order.email:
        return False

    msg = build_order_email(order)
    if msg is None:
        return False

    # Send in a daemon thread so a slow/unreachable SMTP server never blocks the
    # checkout/admin request (no job queue available on cPanel).
    uid = order.uid

    def _send():
        try:
            msg.send(fail_silently=False)
        except Exception as exc:  # noqa: BLE001 - email must never break an order action
            logger.error("Failed to email order %s: %s", uid, exc)

    threading.Thread(target=_send, daemon=True).start()
    return True
