"""Bulk Steadfast sweep: POST /api/admin/orders/sync_steadfast/.

Checks ONLY `shipped` orders that have a consignment, and flips an order to
`delivered` when every one of its parcels (primary + extras) is delivered.
Network is fully mocked — get_status_by_cid is patched at the module it lives in,
which is where the helper imports it from at call time.
"""

from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from app.models import ExtraConsignment, Order
from app.services.steadfast_order import SteadfastError

URL = "/api/admin/orders/sync_steadfast/"


def _order(status, cid="", **kw):
    return Order.objects.create(
        customer_name="c", phone="017", subtotal=Decimal("500"),
        delivery_charge=Decimal("80"), status=status,
        steadfast_consignment_id=cid, courier_submitted=bool(cid), **kw,
    )


class SteadfastSyncTests(APITestCase):
    def setUp(self):
        self.client.force_authenticate(
            User.objects.create_superuser("admin", password="x")
        )

    def _sync(self, statuses):
        """`statuses` maps consignment id -> delivery_status (or a SteadfastError)."""
        def fake(cid):
            v = statuses[cid]
            if isinstance(v, Exception):
                raise v
            return v
        with patch("app.services.steadfast_order.get_status_by_cid", side_effect=fake):
            return self.client.post(URL, {}, format="json")

    def test_requires_admin(self):
        self.client.force_authenticate(None)
        self.assertIn(self.client.post(URL, {}, format="json").status_code, (401, 403))

    def test_delivered_parcel_marks_order_delivered(self):
        o = _order(Order.Status.SHIPPED, "111")
        res = self._sync({"111": "delivered"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["delivered"], [o.uid])
        o.refresh_from_db()
        self.assertEqual(o.status, Order.Status.DELIVERED)
        self.assertEqual(o.steadfast_status, "delivered")

    def test_undelivered_parcel_only_refreshes_courier_status(self):
        o = _order(Order.Status.SHIPPED, "222")
        res = self._sync({"222": "in_transit"})
        self.assertEqual(res.data["delivered_count"], 0)
        o.refresh_from_db()
        self.assertEqual(o.status, Order.Status.SHIPPED)
        self.assertEqual(o.steadfast_status, "in_transit")

    def test_partial_delivered_is_not_delivered(self):
        o = _order(Order.Status.SHIPPED, "333")
        self._sync({"333": "partial_delivered"})
        o.refresh_from_db()
        self.assertEqual(o.status, Order.Status.SHIPPED)

    def test_only_shipped_orders_are_checked(self):
        others = [_order(s, f"c{i}") for i, s in enumerate([
            Order.Status.IN_REVIEW, Order.Status.CONFIRMED,
            Order.Status.IN_PRODUCTION, Order.Status.CANCELLED,
        ])]
        # Every cid would report delivered — none may be touched.
        res = self._sync({f"c{i}": "delivered" for i in range(len(others))})
        self.assertEqual(res.data["checked"], 0)
        for o in others:
            before = o.status
            o.refresh_from_db()
            self.assertEqual(o.status, before)

    def test_shipped_without_consignment_is_skipped(self):
        o = _order(Order.Status.SHIPPED)          # never booked
        res = self._sync({})
        self.assertEqual(res.data["checked"], 0)
        o.refresh_from_db()
        self.assertEqual(o.status, Order.Status.SHIPPED)

    def test_all_extra_consignments_must_be_delivered(self):
        o = _order(Order.Status.SHIPPED, "p1")
        ExtraConsignment.objects.create(order=o, invoice=f"{o.uid}-2", consignment_id="e1")
        self._sync({"p1": "delivered", "e1": "in_transit"})
        o.refresh_from_db()
        self.assertEqual(o.status, Order.Status.SHIPPED)   # one parcel still out

        self._sync({"p1": "delivered", "e1": "delivered"})
        o.refresh_from_db()
        self.assertEqual(o.status, Order.Status.DELIVERED)

    def test_unbooked_extra_blocks_delivery(self):
        o = _order(Order.Status.SHIPPED, "p2")
        ExtraConsignment.objects.create(order=o, invoice=f"{o.uid}-2")  # no cid
        self._sync({"p2": "delivered"})
        o.refresh_from_db()
        self.assertEqual(o.status, Order.Status.SHIPPED)

    def test_one_failure_does_not_stop_the_sweep(self):
        bad = _order(Order.Status.SHIPPED, "bad")
        good = _order(Order.Status.SHIPPED, "good")
        res = self._sync({"bad": SteadfastError("HTTP 500"), "good": "delivered"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["delivered"], [good.uid])
        self.assertEqual([e["uid"] for e in res.data["errors"]], [bad.uid])
        bad.refresh_from_db()
        self.assertEqual(bad.status, Order.Status.SHIPPED)

    def test_batch_cap_reports_remaining(self):
        from app.admin_api import AdminOrderViewSet
        n = AdminOrderViewSet.SYNC_BATCH + 3
        for i in range(n):
            _order(Order.Status.SHIPPED, f"b{i}")
        res = self._sync({f"b{i}": "in_transit" for i in range(n)})
        self.assertEqual(res.data["checked"], AdminOrderViewSet.SYNC_BATCH)
        self.assertEqual(res.data["remaining"], 3)
