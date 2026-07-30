"""Inbound Steadfast webhook.

The endpoint can change order state, so the token check is as much a test subject
as the payload handling.
"""

from decimal import Decimal
from unittest.mock import patch

from django.test import override_settings
from rest_framework.test import APITestCase

from app.models import ConsignmentEvent, ExtraConsignment, Order


def _patch_notify(test):
    """The real status email goes out on a daemon thread (no job queue), so assert
    on the call instead of racing `mail.outbox`."""
    p = patch("app.services.consignments.notifications.notify_order_status")
    test.addCleanup(p.stop)
    return p.start()

URL = "/api/steadfast/webhook/"
TOKEN = "sf-secret-token"


def _delivery(cid, status="delivered", **kw):
    body = {
        "notification_type": "delivery_status",
        "consignment_id": cid,
        "invoice": "AB12CD",
        "cod_amount": 1500.00,
        "status": status,
        "delivery_charge": 100.00,
        "tracking_message": "Your package has been delivered successfully.",
        "updated_at": "2026-07-30 12:45:30",
    }
    body.update(kw)
    return body


def _tracking(cid, message="Package arrived at the sorting center.", **kw):
    body = {
        "notification_type": "tracking_update",
        "consignment_id": cid,
        "invoice": "AB12CD",
        "tracking_message": message,
        "updated_at": "2026-07-30 13:15:00",
    }
    body.update(kw)
    return body


@override_settings(COURIER={"STEADFAST_WEBHOOK_TOKEN": TOKEN})
class WebhookAuthTests(APITestCase):
    def setUp(self):
        self.order = Order.objects.create(
            customer_name="A", phone="017", subtotal=Decimal("1000"),
            delivery_charge=Decimal("100"), status=Order.Status.SHIPPED,
            steadfast_consignment_id="555", steadfast_status="pending")

    def post(self, body, token=TOKEN):
        headers = {"HTTP_AUTHORIZATION": f"Bearer {token}"} if token else {}
        return self.client.post(URL, body, format="json", **headers)

    def test_no_token_is_rejected_and_nothing_moves(self):
        r = self.post(_delivery("555"), token=None)
        self.assertEqual(r.status_code, 401)
        self.order.refresh_from_db()
        self.assertEqual(self.order.status, Order.Status.SHIPPED)
        self.assertEqual(ConsignmentEvent.objects.count(), 0)

    def test_wrong_token_is_rejected(self):
        self.assertEqual(self.post(_delivery("555"), token="nope").status_code, 401)

    def test_non_bearer_scheme_is_rejected(self):
        r = self.client.post(URL, _delivery("555"), format="json",
                             HTTP_AUTHORIZATION=f"Token {TOKEN}")
        self.assertEqual(r.status_code, 401)

    @override_settings(COURIER={"STEADFAST_WEBHOOK_TOKEN": ""})
    def test_unconfigured_endpoint_refuses_everything(self):
        """Fail closed: no secret configured must not mean 'let everyone in'."""
        r = self.client.post(URL, _delivery("555"), format="json",
                             HTTP_AUTHORIZATION="Bearer ")
        self.assertEqual(r.status_code, 503)
        self.assertEqual(ConsignmentEvent.objects.count(), 0)


@override_settings(COURIER={"STEADFAST_WEBHOOK_TOKEN": TOKEN})
class WebhookDeliveryStatusTests(APITestCase):
    def setUp(self):
        self.notify = _patch_notify(self)
        self.order = Order.objects.create(
            customer_name="A", phone="017", email="a@b.com", subtotal=Decimal("1000"),
            delivery_charge=Decimal("100"), status=Order.Status.SHIPPED,
            steadfast_consignment_id="555", steadfast_status="pending")

    def post(self, body):
        return self.client.post(URL, body, format="json",
                                HTTP_AUTHORIZATION=f"Bearer {TOKEN}")

    def test_status_lands_on_the_order_and_promotes_it(self):
        r = self.post(_delivery("555"))
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["status"], "success")
        self.order.refresh_from_db()
        self.assertEqual(self.order.steadfast_status, "delivered")
        self.assertEqual(self.order.status, Order.Status.DELIVERED)
        self.assertEqual(self.notify.call_count, 1)     # customer told once

    def test_status_is_case_normalised(self):
        """Their doc lists lower-case values but the example payload says 'Delivered'."""
        self.post(_delivery("555", status="Delivered"))
        self.order.refresh_from_db()
        self.assertEqual(self.order.steadfast_status, "delivered")
        self.assertEqual(self.order.status, Order.Status.DELIVERED)

    def test_partial_delivered_does_not_promote(self):
        self.post(_delivery("555", status="partial_delivered"))
        self.order.refresh_from_db()
        self.assertEqual(self.order.steadfast_status, "partial_delivered")
        self.assertEqual(self.order.status, Order.Status.SHIPPED)
        self.assertEqual(self.notify.call_count, 0)

    def test_a_retry_of_the_same_push_changes_nothing_twice(self):
        self.post(_delivery("555"))
        self.post(_delivery("555"))
        self.assertEqual(ConsignmentEvent.objects.count(), 1)
        self.assertEqual(self.notify.call_count, 1)     # not emailed again

    def test_event_row_records_the_money_fields_and_raw_payload(self):
        self.post(_delivery("555"))
        ev = ConsignmentEvent.objects.get()
        self.assertEqual(ev.order_id, self.order.id)
        self.assertIsNone(ev.extra_id)
        self.assertEqual(ev.cod_amount, Decimal("1500.00"))
        self.assertEqual(ev.delivery_charge, Decimal("100.00"))
        self.assertEqual(ev.event_time, "2026-07-30 12:45:30")
        self.assertEqual(ev.payload["notification_type"], "delivery_status")

    def test_unknown_consignment_is_logged_but_reported_as_an_error(self):
        r = self.post(_delivery("999999", invoice="ZZZZZZ"))
        self.assertEqual(r.status_code, 404)
        self.assertEqual(r.data["message"], "Invalid consignment ID.")
        ev = ConsignmentEvent.objects.get()
        self.assertIsNone(ev.order_id)            # kept for debugging, linked to nothing
        self.order.refresh_from_db()
        self.assertEqual(self.order.status, Order.Status.SHIPPED)

    def test_invoice_is_a_fallback_when_the_id_is_unknown(self):
        r = self.post(_delivery("", invoice=self.order.uid))
        self.assertEqual(r.status_code, 200)
        self.order.refresh_from_db()
        self.assertEqual(self.order.status, Order.Status.DELIVERED)


@override_settings(COURIER={"STEADFAST_WEBHOOK_TOKEN": TOKEN})
class WebhookMultiParcelTests(APITestCase):
    """One delivered parcel is not a delivered order."""

    def setUp(self):
        self.notify = _patch_notify(self)
        self.order = Order.objects.create(
            customer_name="A", phone="017", email="a@b.com", subtotal=Decimal("2000"),
            delivery_charge=Decimal("100"), status=Order.Status.SHIPPED,
            steadfast_consignment_id="555", steadfast_status="pending")
        self.extra = ExtraConsignment.objects.create(
            order=self.order, invoice=f"{self.order.uid}-2", consignment_id="777",
            status="pending", cod_amount=Decimal("500"))

    def post(self, body):
        return self.client.post(URL, body, format="json",
                                HTTP_AUTHORIZATION=f"Bearer {TOKEN}")

    def test_primary_alone_does_not_promote(self):
        self.post(_delivery("555"))
        self.order.refresh_from_db()
        self.assertEqual(self.order.status, Order.Status.SHIPPED)

    def test_order_flips_when_the_last_parcel_lands(self):
        self.post(_delivery("555"))
        self.post(_delivery("777", invoice=self.extra.invoice))
        self.extra.refresh_from_db()
        self.order.refresh_from_db()
        self.assertEqual(self.extra.status, "delivered")
        self.assertEqual(self.order.status, Order.Status.DELIVERED)
        self.assertEqual(self.notify.call_count, 1)

    def test_extra_events_hang_off_the_extra_not_the_primary(self):
        self.post(_tracking("777", invoice=self.extra.invoice))
        ev = ConsignmentEvent.objects.get()
        self.assertEqual(ev.extra_id, self.extra.id)
        self.assertEqual(ev.order_id, self.order.id)

    def test_an_unbooked_extra_blocks_promotion(self):
        ExtraConsignment.objects.create(
            order=self.order, invoice=f"{self.order.uid}-3", consignment_id="",
            cod_amount=Decimal("0"))
        self.post(_delivery("555"))
        self.post(_delivery("777", invoice=self.extra.invoice))
        self.order.refresh_from_db()
        self.assertEqual(self.order.status, Order.Status.SHIPPED)


@override_settings(COURIER={"STEADFAST_WEBHOOK_TOKEN": TOKEN})
class WebhookTrackingUpdateTests(APITestCase):
    """The hub-by-hub narration exists in no API endpoint — only here."""

    def setUp(self):
        self.order = Order.objects.create(
            customer_name="A", phone="017", subtotal=Decimal("1000"),
            status=Order.Status.SHIPPED, steadfast_consignment_id="555",
            steadfast_status="pending")

    def post(self, body):
        return self.client.post(URL, body, format="json",
                                HTTP_AUTHORIZATION=f"Bearer {TOKEN}")

    def test_tracking_message_is_stored_without_touching_status(self):
        r = self.post(_tracking("555"))
        self.assertEqual(r.status_code, 200)
        ev = ConsignmentEvent.objects.get()
        self.assertEqual(ev.notification_type, "tracking_update")
        self.assertEqual(ev.tracking_message, "Package arrived at the sorting center.")
        self.assertEqual(ev.status, "")
        self.order.refresh_from_db()
        self.assertEqual(self.order.steadfast_status, "pending")   # untouched

    def test_the_same_message_at_a_new_time_is_a_new_event(self):
        self.post(_tracking("555"))
        self.post(_tracking("555", updated_at="2026-07-30 15:00:00"))
        self.assertEqual(ConsignmentEvent.objects.count(), 2)

    def test_garbage_body_does_not_500(self):
        for body in [{}, {"notification_type": "whatever"}, {"consignment_id": None}]:
            r = self.post(body)
            self.assertIn(r.status_code, (200, 404))

    def test_timeline_is_served_on_the_admin_order(self):
        from django.contrib.auth.models import User
        self.post(_tracking("555"))
        self.client.force_authenticate(
            User.objects.create_user("admin", password="x", is_staff=True))
        data = self.client.get(f"/api/admin/orders/{self.order.id}/").data
        self.assertEqual(len(data["consignment_events"]), 1)
        self.assertEqual(data["consignment_events"][0]["tracking_message"],
                         "Package arrived at the sorting center.")
