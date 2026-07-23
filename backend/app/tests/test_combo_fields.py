from decimal import Decimal

from rest_framework.test import APITestCase

from app.models import CartItem, ComboField, PrebuiltCombo
from app.serializers import _config_display


class ComboFieldTests(APITestCase):
    """Combos can ask their own questions; answers are validated server-side and
    snapshotted onto the cart line (and so onto the order)."""

    def setUp(self):
        self.combo = PrebuiltCombo.objects.create(
            name="রয়্যাল কম্বো", slug="royal", price=Decimal("1500"),
        )
        ComboField.objects.create(combo=self.combo, label="বরের নাম", required=True, order=0)
        ComboField.objects.create(combo=self.combo, label="ডাকনাম", required=False, order=1)
        self.headers = {"HTTP_X_CART_TOKEN": "tok-combo-fields"}

    def _add(self, payload):
        return self.client.post(
            "/api/cart/add/", {"combo_slug": "royal", **payload}, format="json", **self.headers
        )

    def test_missing_required_answer_is_rejected(self):
        res = self._add({})
        self.assertEqual(res.status_code, 400)
        self.assertIn("বরের নাম", res.data["error"])
        self.assertEqual(CartItem.objects.count(), 0)

    def test_answers_are_saved_and_displayed(self):
        res = self._add({
            "fields": [{"label": "বরের নাম", "value": "Tasin"}],
            "note": "লাল রঙ চাই",
        })
        self.assertEqual(res.status_code, 201, res.data)

        item = CartItem.objects.get()
        self.assertEqual(item.config["fields"], [{"label": "বরের নাম", "value": "Tasin"}])
        self.assertEqual(item.config["note"], "লাল রঙ চাই")

        lines = {ln["label"]: ln["value"] for ln in _config_display(item, None)}
        self.assertEqual(lines["বরের নাম"], "Tasin")
        self.assertEqual(lines["বিশেষ নির্দেশনা"], "লাল রঙ চাই")

    def test_optional_field_can_be_left_blank(self):
        res = self._add({"fields": [{"label": "বরের নাম", "value": "Tasin"}]})
        self.assertEqual(res.status_code, 201)

    def test_edit_updates_answers_and_keeps_fixed_price(self):
        self._add({"fields": [{"label": "বরের নাম", "value": "Tasin"}]})
        item = CartItem.objects.get()

        res = self.client.patch(
            f"/api/cart/{item.id}/",
            {"fields": [{"label": "বরের নাম", "value": "Rahim"}], "note": "নতুন"},
            format="json", **self.headers,
        )

        self.assertEqual(res.status_code, 200, res.data)
        item.refresh_from_db()
        self.assertEqual(item.config["fields"], [{"label": "বরের নাম", "value": "Rahim"}])
        self.assertEqual(item.config["note"], "নতুন")
        self.assertEqual(item.price_snapshot, Decimal("1500"))  # combo price unchanged

    def test_edit_still_enforces_required(self):
        self._add({"fields": [{"label": "বরের নাম", "value": "Tasin"}]})
        item = CartItem.objects.get()

        res = self.client.patch(
            f"/api/cart/{item.id}/", {"fields": []}, format="json", **self.headers,
        )

        self.assertEqual(res.status_code, 400)
