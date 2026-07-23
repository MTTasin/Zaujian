from decimal import Decimal

from rest_framework.test import APITestCase

from app.models import CartItem, ColorOption, Product, ProductField


class CartInputTests(APITestCase):
    def setUp(self):
        self.product = Product.objects.create(
            name="Pen", slug="pen-ci", kind=Product.Kind.SIMPLE, category="pen",
            base_price=Decimal("150"), active=True,
        )

    def _post(self, body):
        return self.client.post("/api/cart/add/", body, format="json", HTTP_X_CART_TOKEN="tok")

    def test_stores_fields_and_note(self):
        ProductField.objects.create(product=self.product, label="বরের নাম", required=True)
        r = self._post({
            "slug": "pen-ci", "selection": {},
            "fields": [{"label": "বরের নাম", "value": "  Rahim  "}],
            "note": "সোনালি রঙে",
        })
        self.assertEqual(r.status_code, 201)
        cfg = CartItem.objects.get().config
        self.assertEqual(cfg["fields"], [{"label": "বরের নাম", "value": "Rahim"}])
        self.assertEqual(cfg["note"], "সোনালি রঙে")

    def test_rejects_missing_required_field(self):
        ProductField.objects.create(product=self.product, label="বরের নাম", required=True)
        r = self._post({"slug": "pen-ci", "selection": {}, "fields": [], "note": ""})
        self.assertEqual(r.status_code, 400)
        self.assertIn("বরের নাম", r.json()["error"])
        self.assertEqual(CartItem.objects.count(), 0)

    def test_rejects_blank_required_value(self):
        ProductField.objects.create(product=self.product, label="বরের নাম", required=True)
        r = self._post({
            "slug": "pen-ci", "selection": {},
            "fields": [{"label": "বরের নাম", "value": "   "}],
        })
        self.assertEqual(r.status_code, 400)

    def test_optional_field_may_be_empty(self):
        ProductField.objects.create(product=self.product, label="ডাকনাম", required=False)
        r = self._post({"slug": "pen-ci", "selection": {}, "fields": []})
        self.assertEqual(r.status_code, 201)

    def test_note_is_trimmed_to_200(self):
        r = self._post({"slug": "pen-ci", "selection": {}, "note": "x" * 500})
        self.assertEqual(r.status_code, 201)
        self.assertEqual(len(CartItem.objects.get().config["note"]), 200)

    def test_layered_product_accepts_its_answers(self):
        """Regression: LayeredConfigurator once validated client-side but never sent
        `fields`, so a filled-in book was rejected with '<label> লিখুন'."""
        book = Product.objects.create(
            name="Book", slug="book-layered-ci", kind=Product.Kind.LAYERED,
            category="book", base_price=Decimal("1250"), active=True,
        )
        color = ColorOption.objects.create(
            product=book, name="maroon", base_image="colors/x.jpg", active=True,
        )
        ProductField.objects.create(product=book, label="বরের নাম", required=True)
        ProductField.objects.create(product=book, label="বরের ডাকনাম", required=True)

        r = self.client.post("/api/cart/add/", {
            "slug": "book-layered-ci", "selection": {"color": color.id},
            "fields": [
                {"label": "বরের নাম", "value": "Faysal"},
                {"label": "বরের ডাকনাম", "value": "Fay"},
            ],
        }, format="json", HTTP_X_CART_TOKEN="tok")

        self.assertEqual(r.status_code, 201, r.json())
        cfg = CartItem.objects.get().config
        self.assertEqual(
            cfg["fields"],
            [{"label": "বরের নাম", "value": "Faysal"},
             {"label": "বরের ডাকনাম", "value": "Fay"}],
        )

    def test_edit_keeps_answers_and_does_not_duplicate(self):
        """Editing a cart line must UPDATE it (not add a second row) and must not
        wipe the customer's answers/note."""
        ProductField.objects.create(product=self.product, label="বরের নাম", required=True)
        self._post({
            "slug": "pen-ci", "selection": {},
            "fields": [{"label": "বরের নাম", "value": "Rahim"}],
            "note": "সোনালি",
        })
        item = CartItem.objects.get()

        r = self.client.patch(
            f"/api/cart/{item.id}/",
            {"selection": {},
             "fields": [{"label": "বরের নাম", "value": "Karim"}],
             "note": "রুপালি"},
            format="json", HTTP_X_CART_TOKEN="tok",
        )
        self.assertEqual(r.status_code, 200, r.json())
        self.assertEqual(CartItem.objects.count(), 1)  # updated, not duplicated
        cfg = CartItem.objects.get().config
        self.assertEqual(cfg["fields"], [{"label": "বরের নাম", "value": "Karim"}])
        self.assertEqual(cfg["note"], "রুপালি")

    def test_edit_rejects_missing_required_field(self):
        ProductField.objects.create(product=self.product, label="বরের নাম", required=True)
        self._post({
            "slug": "pen-ci", "selection": {},
            "fields": [{"label": "বরের নাম", "value": "Rahim"}],
        })
        item = CartItem.objects.get()
        r = self.client.patch(
            f"/api/cart/{item.id}/", {"selection": {}, "fields": []},
            format="json", HTTP_X_CART_TOKEN="tok",
        )
        self.assertEqual(r.status_code, 400)
        self.assertIn("বরের নাম", r.json()["error"])

    def test_no_note_key_when_blank(self):
        r = self._post({"slug": "pen-ci", "selection": {}})
        self.assertEqual(r.status_code, 201)
        self.assertNotIn("note", CartItem.objects.get().config)
