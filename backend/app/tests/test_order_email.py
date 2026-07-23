from decimal import Decimal
from unittest.mock import patch

from django.test import TestCase, override_settings

from app.models import Order
from app.services.notifications import build_order_email, notify_order_status


def _shop(**overrides):
    base = {
        "ADVANCE_AMOUNT": "200",
        "BKASH_NUMBER": "01818974731",
        "NAGAD_NUMBER": "01974283081",
    }
    base.update(overrides)
    return base


class OrderEmailTests(TestCase):
    def setUp(self):
        self.order = Order.objects.create(
            customer_name="রহিম", phone="01700000000", email="a@b.com",
            address="ঢাকা", subtotal=Decimal("1500"), delivery_charge=Decimal("120"),
            status="confirmed",
        )

    def _parts(self, msg):
        html = next(c for c, t in msg.alternatives if t == "text/html")
        return msg.body, html

    def test_message_has_html_alternative(self):
        msg = build_order_email(self.order)
        self.assertTrue(any(t == "text/html" for _, t in msg.alternatives))

    def test_tracking_link_in_both_parts(self):
        text, html = self._parts(build_order_email(self.order))
        self.assertIn(self.order.uid, text)
        self.assertIn(self.order.uid, html)
        self.assertIn(f"/track/{self.order.uid}", text)
        self.assertIn(f"/track/{self.order.uid}", html)

    def test_html_carries_no_remote_images(self):
        """Gmail blocks remote images by default; the design must not need them."""
        _, html = self._parts(build_order_email(self.order))
        self.assertNotIn("<img", html.lower())
        self.assertIn("Zaujain Nikah Point", html)

    @override_settings(SHOP=_shop())
    def test_pending_payment_shows_advance_and_numbers(self):
        self.order.status = "pending_payment"
        _, html = self._parts(build_order_email(self.order))
        self.assertIn("200", html)
        self.assertIn("01818974731", html)
        self.assertIn("01974283081", html)

    @override_settings(SHOP=_shop())
    def test_other_statuses_carry_no_payment_numbers(self):
        for status in ["confirmed", "in_production", "shipped", "delivered", "cancelled"]:
            self.order.status = status
            _, html = self._parts(build_order_email(self.order))
            self.assertNotIn("01818974731", html, f"{status} leaked a payment number")

    @override_settings(SHOP=_shop(BKASH_NUMBER="", NAGAD_NUMBER=""))
    def test_blank_payment_numbers_are_omitted_not_rendered_empty(self):
        """Never invent or render a hollow contact line — same rule as the bot."""
        self.order.status = "pending_payment"
        _, html = self._parts(build_order_email(self.order))
        self.assertNotIn("বিকাশ", html)
        self.assertNotIn("নগদ", html)

    def test_repeat_customer_greeting_survives_in_html(self):
        self.order.is_repeat_customer = True
        _, html = self._parts(build_order_email(self.order))
        self.assertIn("🎉", html)

    def test_unknown_status_builds_nothing(self):
        self.order.status = "some_new_status"
        self.assertIsNone(build_order_email(self.order))

    def test_send_failure_never_propagates(self):
        with patch("app.services.notifications.EmailMultiAlternatives.send",
                   side_effect=RuntimeError("smtp down")):
            self.assertTrue(notify_order_status(self.order))

    def test_no_email_address_sends_nothing(self):
        self.order.email = ""
        self.assertFalse(notify_order_status(self.order))
