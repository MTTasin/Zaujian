from decimal import Decimal

from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from app.models import CartItem, ColorOption, DupattaOption, Order, Product


class EditItemOptionsTests(APITestCase):
    def setUp(self):
        self.client.force_authenticate(User.objects.create_user("admin", password="x", is_staff=True))
        self.order = Order.objects.create(customer_name="A", phone="017", subtotal=Decimal("1000"))
        self.book = Product.objects.create(name="বই", slug="boi", kind="layered", base_price=Decimal("1000"))
        self.red = ColorOption.objects.create(product=self.book, name="লাল", price_modifier=Decimal("0"))
        self.gold = ColorOption.objects.create(product=self.book, name="সোনালি", price_modifier=Decimal("200"))
        self.item = CartItem.objects.create(
            order=self.order, session_key="s", product=self.book, price_snapshot=Decimal("1000"),
            config={"color": {"id": self.red.id, "name": "লাল"},
                    "fields": [{"label": "বরের নাম", "value": "Rahim"}], "note": "n"},
        )

    def _post(self, body):
        return self.client.post(f"/api/admin/orders/{self.order.id}/edit_item_options/", body, format="json")

    def test_change_color_reprices_and_keeps_text(self):
        r = self._post({"item_id": self.item.id, "selection": {"color": self.gold.id}})
        self.assertEqual(r.status_code, 200)
        self.item.refresh_from_db(); self.order.refresh_from_db()
        self.assertEqual(self.item.price_snapshot, Decimal("1200"))
        self.assertEqual(self.item.config["color"]["id"], self.gold.id)
        self.assertEqual(self.item.config["fields"][0]["value"], "Rahim")   # text preserved
        self.assertEqual(self.item.config["note"], "n")
        self.assertEqual(self.order.subtotal, Decimal("1200"))
        self.assertEqual(r.json()["subtotal"], "1200.00")

    def test_invalid_option_400_and_unchanged(self):
        r = self._post({"item_id": self.item.id, "selection": {"color": 999999}})
        self.assertEqual(r.status_code, 400)
        self.item.refresh_from_db()
        self.assertEqual(self.item.price_snapshot, Decimal("1000"))

    def test_item_not_in_order_404(self):
        other = CartItem.objects.create(session_key="s2", product=self.book, price_snapshot=Decimal("0"), config={})
        r = self._post({"item_id": other.id, "selection": {"color": self.gold.id}})
        self.assertEqual(r.status_code, 404)

    def test_dupatta_absolute_price(self):
        dup = Product.objects.create(name="ওড়না", slug="orna", kind="dupatta", base_price=Decimal("1600"))
        opt = DupattaOption.objects.create(product=dup, lace_type="single", text_lines=2, price=Decimal("1500"))
        it = CartItem.objects.create(order=self.order, session_key="s", product=dup,
                                     price_snapshot=Decimal("0"), config={})
        r = self._post({"item_id": it.id, "selection": {"dupatta": opt.id}})
        self.assertEqual(r.status_code, 200)
        it.refresh_from_db()
        self.assertEqual(it.price_snapshot, Decimal("1500"))
