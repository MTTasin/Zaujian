"""Admin Orders list sorting (?sort=) — default workflow order + every option."""

from decimal import Decimal

from django.test import TestCase

from app.admin_api import AdminOrderViewSet
from app.models import Order


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
