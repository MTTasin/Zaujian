from decimal import Decimal

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APITestCase

from app.models import Order


class OrderProfitTests(TestCase):
    def _order(self, **kw):
        base = dict(customer_name="A", phone="017", subtotal=Decimal("1000"),
                    delivery_charge=Decimal("80"))
        base.update(kw)
        return Order.objects.create(**base)

    def test_profit_none_when_cost_blank(self):
        o = self._order(cost_price=None)
        self.assertIsNone(o.profit)

    def test_profit_is_subtotal_minus_cost(self):
        o = self._order(cost_price=Decimal("600"))
        self.assertEqual(o.profit, Decimal("400"))

    def test_zero_cost_is_not_blank(self):
        o = self._order(cost_price=Decimal("0"))
        self.assertEqual(o.profit, Decimal("1000"))


class OrderCostApiTests(APITestCase):
    def setUp(self):
        self.client.force_authenticate(User.objects.create_user("admin", password="x", is_staff=True))
        self.order = Order.objects.create(
            customer_name="A", phone="017", subtotal=Decimal("1000"),
            delivery_charge=Decimal("80"),
        )

    def test_edit_sets_cost_price_and_returns_profit(self):
        r = self.client.post(f"/api/admin/orders/{self.order.id}/edit/", {"cost_price": "600"}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["cost_price"], "600.00")
        self.assertEqual(r.json()["profit"], "400.00")

    def test_blank_cost_returns_null_profit(self):
        r = self.client.get(f"/api/admin/orders/{self.order.id}/")
        self.assertIsNone(r.json()["cost_price"])
        self.assertIsNone(r.json()["profit"])


class DashboardProfitTests(APITestCase):
    def setUp(self):
        self.client.force_authenticate(User.objects.create_user("admin", password="x", is_staff=True))

    def _order(self, cost, status=Order.Status.CONFIRMED):
        return Order.objects.create(
            customer_name="A", phone="017", subtotal=Decimal("1000"),
            delivery_charge=Decimal("80"),
            cost_price=cost, status=status,
        )

    def test_total_profit_excludes_blank_and_cancelled(self):
        self._order(Decimal("600"))                                   # profit 400
        self._order(Decimal("700"))                                   # profit 300
        self._order(None)                                             # uncosted
        self._order(Decimal("100"), status=Order.Status.CANCELLED)    # excluded
        r = self.client.get("/api/admin/dashboard/")
        self.assertEqual(r.json()["total_profit"], 700.0)
        self.assertEqual(r.json()["uncosted_count"], 1)
