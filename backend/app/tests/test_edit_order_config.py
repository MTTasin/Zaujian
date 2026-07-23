from decimal import Decimal

from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from app.models import CartItem, Order, Product


class EditOrderConfigTests(APITestCase):
    def setUp(self):
        self.client.force_authenticate(User.objects.create_user("admin", password="x", is_staff=True))
        self.order = Order.objects.create(
            customer_name="A", phone="017", subtotal=Decimal("1000"),
        )
        self.product = Product.objects.create(name="বই", slug="boi", kind="layered")
        self.item = CartItem.objects.create(
            order=self.order, session_key="s", product=self.product,
            price_snapshot=Decimal("1000"),
            config={
                "color": {"id": 1, "name": "maroon"},
                "fields": [{"label": "বরের নাম", "value": "Rahim"}],
                "note": "old note",
            },
        )

    def _post(self, body):
        return self.client.post(f"/api/admin/orders/{self.order.id}/edit_config/", body, format="json")

    def test_edit_field_value_and_note(self):
        r = self._post({
            "item_id": self.item.id,
            "fields": [{"label": "বরের নাম", "value": "Karim"}],
            "note": "new note",
        })
        self.assertEqual(r.status_code, 200)
        self.item.refresh_from_db()
        self.assertEqual(self.item.config["fields"][0]["value"], "Karim")
        self.assertEqual(self.item.config["fields"][0]["label"], "বরের নাম")  # label preserved
        self.assertEqual(self.item.config["note"], "new note")
        self.assertEqual(self.item.config["color"]["id"], 1)  # option selection untouched
        self.assertEqual(str(self.item.price_snapshot), "1000.00")  # price untouched

    def test_blank_note_clears(self):
        r = self._post({"item_id": self.item.id, "note": ""})
        self.assertEqual(r.status_code, 200)
        self.item.refresh_from_db()
        self.assertNotIn("note", self.item.config)

    def test_value_capped_at_200(self):
        self._post({"item_id": self.item.id, "fields": [{"label": "বরের নাম", "value": "x" * 300}]})
        self.item.refresh_from_db()
        self.assertEqual(len(self.item.config["fields"][0]["value"]), 200)

    def test_item_not_in_order_404(self):
        other = CartItem.objects.create(
            session_key="s2", product=self.product, price_snapshot=Decimal("0"), config={},
        )
        r = self._post({"item_id": other.id})
        self.assertEqual(r.status_code, 404)

    def test_combo_line_values_edited(self):
        combo_item = CartItem.objects.create(
            order=self.order, session_key="s", product=self.product,
            price_snapshot=Decimal("500"),
            config={"combo_items": [{"product": "পেন", "lines": [{"label": "নাম", "value": "old"}]}]},
        )
        r = self._post({
            "item_id": combo_item.id,
            "combo_items": [{"product": "পেন", "lines": [{"label": "নাম", "value": "new"}]}],
        })
        self.assertEqual(r.status_code, 200)
        combo_item.refresh_from_db()
        self.assertEqual(combo_item.config["combo_items"][0]["lines"][0]["value"], "new")
