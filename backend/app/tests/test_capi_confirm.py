"""Option A: the website Purchase fires on CONFIRM, not at checkout.

A COD order sits in `in_review` until an admin phone-verifies it. Cancelling
from review must never report a conversion; confirming must fire exactly one
Purchase (deduped by event_id). META creds are unset in tests, so send_event
still creates the CapiEvent row but _deliver marks it failed without any network.
"""
from decimal import Decimal

from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from app.models import CapiEvent, Order


class CapiConfirmTimingTests(APITestCase):
    def setUp(self):
        self.client.force_authenticate(
            User.objects.create_user("admin", password="x", is_staff=True)
        )
        self.order = Order.objects.create(
            customer_name="Real", phone="017111", email="a@b.com",
            subtotal=Decimal("1000"), delivery_charge=Decimal("80"),
            status=Order.Status.IN_REVIEW,
            meta_fbp="fb.1.1.abc", meta_source_url="https://zaujain.xyz/checkout",
        )

    def _set_status(self, status):
        return self.client.post(
            f"/api/admin/orders/{self.order.id}/set_status/",
            {"status": status}, format="json",
        )

    def test_review_order_has_no_capi_event_yet(self):
        self.assertFalse(CapiEvent.objects.filter(event_id=f"purchase.{self.order.uid}").exists())

    def test_cancel_from_review_fires_nothing(self):
        self.assertEqual(self._set_status("cancelled").status_code, 200)
        self.assertFalse(CapiEvent.objects.filter(event_id=f"purchase.{self.order.uid}").exists())

    def test_confirm_via_set_status_fires_purchase(self):
        self.assertEqual(self._set_status("confirmed").status_code, 200)
        ev = CapiEvent.objects.get(event_id=f"purchase.{self.order.uid}")
        self.assertEqual(ev.event_name, "Purchase")
        # Attribution stashed at checkout is replayed on the payload.
        self.assertEqual(ev.payload["user_data"]["fbp"], "fb.1.1.abc")
        self.assertEqual(ev.payload["action_source"], "website")

    def test_confirm_is_idempotent(self):
        self._set_status("confirmed")
        self._set_status("in_production")
        self._set_status("confirmed")  # would double-fire if not deduped
        self.assertEqual(
            CapiEvent.objects.filter(event_id=f"purchase.{self.order.uid}").count(), 1
        )
