"""How a courier failure reaches the admin's screen.

Two things are pinned here, both learned from a real incident: an admin deleted
a consignment in the Steadfast panel, pressed "Refresh status", and the browser
showed a CORS error next to a 502.

1. Steadfast answers `401 Unauthorized Access` for a consignment id it does not
   recognise — NOT 404. Reported verbatim ("Steadfast returned HTTP 401") that
   reads as "our API keys broke", which sends the admin looking in the wrong
   place. It gets its own error type and its own sentence.

2. No courier action answers 502 any more. 502/504 are what a reverse proxy
   emits when the app itself failed to answer, and this backend sits behind
   Cloudflare -> LiteSpeed -> Passenger. An app-level 502 is indistinguishable
   in the console from the gateway giving up, which is exactly what made that
   incident hard to read. The courier refusing is a conflict, not a gateway
   failure: 409.
"""

from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from rest_framework.test import APITestCase

from app.models import ExtraConsignment, Order
from app.services import steadfast_order
from app.services.steadfast_order import ConsignmentGoneError, SteadfastError


class _Resp:
    def __init__(self, status_code, payload=None, text=""):
        self.status_code = status_code
        self._payload = payload
        self.text = text

    def json(self):
        if self._payload is None:
            raise ValueError("no json")
        return self._payload


@override_settings(COURIER={"STEADFAST_API_KEY": "k", "STEADFAST_SECRET_KEY": "s",
                            "TIMEOUT_SECONDS": 3})
class StatusByCidErrorTests(TestCase):
    def test_401_on_a_known_cid_means_the_parcel_is_gone(self):
        """Steadfast's answer for a consignment that is not in this account."""
        with patch.object(steadfast_order.requests, "get",
                          return_value=_Resp(401, text="Unauthorized Access")):
            with self.assertRaises(ConsignmentGoneError) as ctx:
                steadfast_order.get_status_by_cid("123456")
        msg = str(ctx.exception)
        self.assertIn("123456", msg)
        self.assertIn("no longer", msg.lower())
        # Every caller catches SteadfastError; a new subclass must not slip past.
        self.assertIsInstance(ctx.exception, SteadfastError)

    def test_other_http_errors_stay_generic(self):
        with patch.object(steadfast_order.requests, "get", return_value=_Resp(500)):
            with self.assertRaises(SteadfastError) as ctx:
                steadfast_order.get_status_by_cid("123456")
        self.assertNotIsInstance(ctx.exception, ConsignmentGoneError)

    def test_success_still_returns_the_status(self):
        with patch.object(steadfast_order.requests, "get",
                          return_value=_Resp(200, {"delivery_status": "delivered"})):
            self.assertEqual(steadfast_order.get_status_by_cid("123456"), "delivered")


@override_settings(COURIER={"STEADFAST_API_KEY": "k", "STEADFAST_SECRET_KEY": "s",
                            "TIMEOUT_SECONDS": 3})
class CourierActionStatusCodeTests(APITestCase):
    def setUp(self):
        self.client.force_authenticate(User.objects.create_superuser("owner", "o@x.com", "pw"))
        self.order = Order.objects.create(
            customer_name="A", phone="017", subtotal=Decimal("1000"),
            delivery_charge=Decimal("80"), steadfast_consignment_id="123456",
            steadfast_status="in_review",
            courier_submitted=True, status=Order.Status.SHIPPED,
        )
        self.extra = ExtraConsignment.objects.create(
            order=self.order, invoice=f"{self.order.uid}-2", consignment_id="777",
            status="in_review",
            cod_amount=Decimal("0"), recipient_name="A", recipient_phone="017",
        )

    def _url(self, action):
        return f"/api/admin/orders/{self.order.id}/{action}/"

    # -- the deleted-consignment case ------------------------------------- #

    def test_refresh_status_reports_a_deleted_consignment_as_404(self):
        gone = ConsignmentGoneError("Steadfast no longer recognises consignment 123456")
        with patch("app.services.steadfast_order.get_status", side_effect=gone):
            r = self.client.post(self._url("steadfast_status"))
        self.assertEqual(r.status_code, 404)
        self.assertIn("123456", r.json()["error"])
        self.order.refresh_from_db()
        # The last status Steadfast DID report is kept as-is — it is still the
        # truth about what happened to that parcel. The parcel being gone is a
        # separate fact, recorded separately.
        self.assertEqual(self.order.steadfast_status, "in_review")
        self.assertTrue(self.order.consignment_missing)

    def test_a_found_consignment_clears_the_missing_mark(self):
        """Re-created in the panel, or the 401 was a credentials blip."""
        self.order.consignment_missing = True
        self.order.save(update_fields=["consignment_missing"])
        with patch("app.services.steadfast_order.get_status", return_value="delivered"):
            r = self.client.post(self._url("steadfast_status"))
        self.assertEqual(r.status_code, 200)
        self.order.refresh_from_db()
        self.assertFalse(self.order.consignment_missing)
        self.assertEqual(self.order.steadfast_status, "delivered")

    def test_resubmit_clears_the_missing_mark(self):
        self.order.consignment_missing = True
        self.order.save(update_fields=["consignment_missing"])
        booked = {"consignment_id": "999", "tracking_code": "TRK", "status": "in_review",
                  "cod_amount": Decimal("0")}
        with patch("app.admin_api.create_consignment", return_value=booked):
            r = self.client.post(self._url("resubmit_steadfast"))
        self.assertEqual(r.status_code, 200)
        self.order.refresh_from_db()
        self.assertFalse(self.order.consignment_missing)
        self.assertEqual(self.order.steadfast_consignment_id, "999")

    def test_the_mark_is_exposed_to_the_panel(self):
        """The Re-submit button is gated on it, so both order shapes must carry it."""
        self.order.consignment_missing = True
        self.order.save(update_fields=["consignment_missing"])
        detail = self.client.get(f"/api/admin/orders/{self.order.id}/").json()
        self.assertTrue(detail["consignment_missing"])
        row = next(o for o in self.client.get("/api/admin/orders/").json()
                   if o["id"] == self.order.id)
        self.assertTrue(row["consignment_missing"])

    def test_refresh_extra_status_reports_a_deleted_consignment_as_404(self):
        gone = ConsignmentGoneError("Steadfast no longer recognises consignment 777")
        with patch("app.services.steadfast_order.get_status_by_cid", side_effect=gone):
            r = self.client.post(self._url("extra_status"), {"extra_id": self.extra.id},
                                 format="json")
        self.assertEqual(r.status_code, 404)
        self.assertIn("777", r.json()["error"])
        self.extra.refresh_from_db()
        self.assertTrue(self.extra.missing)

    def test_resubmit_extra_clears_the_missing_mark(self):
        self.extra.missing = True
        self.extra.save(update_fields=["missing"])
        booked = {"consignment_id": "888", "tracking_code": "TRK", "status": "in_review",
                  "cod_amount": Decimal("0")}
        with patch("app.admin_api.create_consignment", return_value=booked):
            r = self.client.post(self._url("resubmit_extra"), {"extra_id": self.extra.id},
                                 format="json")
        self.assertEqual(r.status_code, 200)
        self.extra.refresh_from_db()
        self.assertFalse(self.extra.missing)
        self.assertTrue(any(e["missing"] is False for e in r.json()["extra_consignments"]))

    # -- everything else the courier can refuse ---------------------------- #

    def test_refresh_status_other_failure_is_409_not_502(self):
        with patch("app.services.steadfast_order.get_status",
                   side_effect=SteadfastError("Network error: timed out")):
            r = self.client.post(self._url("steadfast_status"))
        self.assertEqual(r.status_code, 409)
        self.assertIn("timed out", r.json()["error"])

    def test_resubmit_failure_is_409_not_502(self):
        with patch("app.admin_api.create_consignment", side_effect=SteadfastError("down")):
            r = self.client.post(self._url("resubmit_steadfast"))
        self.assertEqual(r.status_code, 409)

    def test_book_extra_failure_is_409_not_502(self):
        with patch("app.admin_api.create_consignment", side_effect=SteadfastError("down")):
            r = self.client.post(self._url("book_extra"), {"cod_amount": "250"}, format="json")
        self.assertEqual(r.status_code, 409)
        self.assertEqual(self.order.extra_consignments.count(), 1)   # no new row

    def test_resubmit_extra_failure_is_409_not_502(self):
        with patch("app.admin_api.create_consignment", side_effect=SteadfastError("down")):
            r = self.client.post(self._url("resubmit_extra"), {"extra_id": self.extra.id},
                                 format="json")
        self.assertEqual(r.status_code, 409)

    def test_confirm_booking_failure_is_409_not_502(self):
        # confirm refuses outright once a parcel is booked, so this order has to
        # be back in the state confirm is actually reached from.
        self.order.status = Order.Status.IN_REVIEW
        self.order.courier_submitted = False
        self.order.save(update_fields=["status", "courier_submitted"])
        with patch("app.admin_api.create_consignment", side_effect=SteadfastError("down")):
            r = self.client.post(self._url("confirm"))
        self.assertEqual(r.status_code, 409)
        self.order.refresh_from_db()
        self.assertEqual(self.order.status, Order.Status.IN_REVIEW)  # not confirmed

    def test_extra_status_answers_with_the_status_it_just_fetched(self):
        """The viewset prefetches `extra_consignments`, and `_get_extra` re-queries
        one — so the row that gets written and the row that gets serialized are
        two different objects. Without dropping the prefetch cache the panel is
        answered with the value from before the refresh."""
        with patch("app.services.steadfast_order.get_status_by_cid", return_value="delivered"):
            r = self.client.post(self._url("extra_status"), {"extra_id": self.extra.id},
                                 format="json")
        self.assertEqual(r.status_code, 200)
        row = next(e for e in r.json()["extra_consignments"] if e["id"] == self.extra.id)
        self.assertEqual(row["status"], "delivered")

    # -- the sweep must survive one dead parcel ---------------------------- #

    def test_bulk_sync_collects_a_gone_consignment_instead_of_dying(self):
        gone = ConsignmentGoneError("Steadfast no longer recognises consignment 123456")
        with patch("app.services.steadfast_order.get_status_by_cid", side_effect=gone):
            r = self.client.post("/api/admin/orders/sync_steadfast/")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()["errors"])
        # The sweep is where a deleted parcel is most likely to be noticed —
        # nobody opens every order by hand. It must mark, not just report.
        self.order.refresh_from_db()
        self.assertTrue(self.order.consignment_missing)
