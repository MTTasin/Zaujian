"""Admin Orders list sorting (?sort=) — default workflow order + every option."""

from decimal import Decimal

from django.contrib.auth.models import User
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APITestCase

from app.admin_api import AdminOrderViewSet
from app.models import CartItem, Order, Product


def _qs(sort=None):
    """Run get_queryset() with just the query params it reads."""
    vs = AdminOrderViewSet()
    params = {"sort": sort} if sort else {}
    vs.request = type("R", (), {"query_params": params})()
    return vs.get_queryset()


class OrderSortingTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        # One order per status, deliberately created out of workflow order.
        cls.subtotals = {}
        for i, st in enumerate([
            "delivered", "cancelled", "confirmed", "in_review",
            "shipped", "in_production", "pending_payment",
        ]):
            sub = Decimal(100 * (i + 1))
            cls.subtotals[st] = sub
            Order.objects.create(
                customer_name=f"cust{i}", phone=f"0170000000{i}", status=st,
                subtotal=sub, delivery_charge=Decimal("80"),
            )

    def test_default_sort_is_workflow_priority(self):
        self.assertEqual(
            [o.status for o in _qs()],
            ["in_review", "pending_payment", "in_production", "confirmed",
             "shipped", "delivered", "cancelled"],
        )

    def test_reverse_status_sort(self):
        self.assertEqual(
            [o.status for o in _qs("-status")],
            ["cancelled", "delivered", "shipped", "confirmed",
             "in_production", "pending_payment", "in_review"],
        )

    def test_unknown_sort_falls_back_to_default(self):
        self.assertEqual([o.status for o in _qs("bogus; drop table")],
                         [o.status for o in _qs()])

    def test_total_sorts_use_subtotal_plus_delivery(self):
        highs = [o.total for o in _qs("total_high")]
        self.assertEqual(highs, sorted(highs, reverse=True))
        self.assertEqual([o.total for o in _qs("total_low")], sorted(highs))

    def test_date_sorts(self):
        newest = [o.pk for o in _qs("newest")]
        self.assertEqual(newest, list(reversed([o.pk for o in _qs("oldest")])))

    def test_every_declared_sort_executes(self):
        for key in AdminOrderViewSet.SORTS:
            with self.subTest(sort=key):
                self.assertEqual(len(list(_qs(key))), 7)


class OrderListCostTests(APITestCase):
    """The Orders list must not get slower as the shop sells more.

    It was unpaginated AND serialized every item's option config, which cost
    ~10 queries per order: 16 orders = 169 queries, 500 orders = thousands, and
    the page read as "the panel is hanging" on a shared-hosting worker. The list
    renders ten scalar fields, so it takes a light serializer and a plain
    queryset — this pins that the count does not grow with the rows.
    """

    def setUp(self):
        self.client.force_authenticate(
            User.objects.create_superuser("admin", password="x"))
        self.product = Product.objects.create(
            name="বই", slug="boi", kind="layered", base_price=Decimal("1200"))

    def _make(self, n):
        for i in range(n):
            order = Order.objects.create(
                customer_name=f"C{i}", phone="0170000000",
                subtotal=Decimal("1200"), delivery_charge=Decimal("120"))
            CartItem.objects.create(
                order=order, session_key="t", product=self.product,
                price_snapshot=Decimal("1200"),
                config={"color": {"id": 1}, "corner": {"id": 2}, "center": {"id": 3}},
            )

    def _count(self):
        with CaptureQueriesContext(connection) as ctx:
            self.assertEqual(self.client.get("/api/admin/orders/").status_code, 200)
        return len(ctx.captured_queries)

    def test_query_count_does_not_grow_with_the_number_of_orders(self):
        self._make(3)
        self._count()          # warm up: first call also stamps presence, etc.
        few = self._count()
        self._make(12)
        many = self._count()
        self.assertEqual(few, many, f"list went from {few} to {many} queries as orders grew")

    def test_the_list_stays_light_but_keeps_what_the_page_renders(self):
        self._make(1)
        row = self.client.get("/api/admin/orders/").json()[0]
        for field in ("uid", "customer_name", "phone", "total", "status",
                      "status_display", "payment_verified", "courier_submitted",
                      "is_repeat_customer", "created_at"):
            self.assertIn(field, row)
        self.assertNotIn("items", row)          # the expensive part, unread here

    def test_opening_one_order_still_returns_everything(self):
        self._make(1)
        order = Order.objects.first()
        detail = self.client.get(f"/api/admin/orders/{order.id}/").json()
        self.assertIn("items", detail)
        self.assertIn("config_display", detail["items"][0])
