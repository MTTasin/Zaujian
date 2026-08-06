"""Manual (WhatsApp/Messenger/walk-in) orders: catalogue links + chat details.

The point of these: an order typed in by hand must end up shaped like a website
order — linked to the real listing/product, and carrying the customer's details
in the same config["fields"] snapshot the storefront writes.
"""

from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from app.models import (
    ComboField, DupattaOption, Order, PrebuiltCombo, Product, ProductField,
)


class ManualOrderTests(APITestCase):
    def setUp(self):
        self.client.force_authenticate(
            User.objects.create_superuser("admin", password="x"))
        self.product = Product.objects.create(
            name="বই", slug="boi", kind="layered", base_price=Decimal("1200"))
        ProductField.objects.create(product=self.product, label="বরের নাম", order=1)
        self.combo = PrebuiltCombo.objects.create(
            name="প্রিমিয়াম কম্বো", slug="premium", price=Decimal("2500"),
            category="কম্বো")
        ComboField.objects.create(combo=self.combo, label="তারিখ", order=1)

    def _create(self, items, **extra):
        body = {"customer_name": "Rahim", "phone": "01700000000",
                "delivery_charge": "120", "items": items}
        body.update(extra)
        # The CAPI purchase is fired inline on create; it must never be a network
        # call in tests (and never break order creation either way).
        with patch("app.services.capi.track_purchase", return_value=None):
            return self.client.post("/api/admin/orders/manual/", body, format="json")

    # ---- catalogue links ---------------------------------------------------- #

    def test_listing_line_links_the_combo_and_takes_its_price(self):
        r = self._create([{"combo": self.combo.id}])
        self.assertEqual(r.status_code, 201)
        item = Order.objects.get(pk=r.data["id"]).items.get()
        self.assertEqual(item.combo_id, self.combo.id)
        self.assertIsNone(item.product_id)
        self.assertEqual(item.price_snapshot, Decimal("2500"))
        self.assertEqual(item.config["title"], "প্রিমিয়াম কম্বো")
        self.assertTrue(item.config["manual"])

    def test_product_line_links_the_product(self):
        r = self._create([{"product": self.product.id}])
        item = Order.objects.get(pk=r.data["id"]).items.get()
        self.assertEqual(item.product_id, self.product.id)
        self.assertIsNone(item.combo_id)

    def test_typed_price_beats_the_catalogue_price(self):
        r = self._create([{"combo": self.combo.id, "price": "2200"}])
        item = Order.objects.get(pk=r.data["id"]).items.get()
        self.assertEqual(item.price_snapshot, Decimal("2200"))

    def test_dupatta_price_comes_from_the_option_not_base_price(self):
        """Customization wins: the option price is absolute (see CLAUDE.md)."""
        dup = Product.objects.create(name="ওড়না", slug="orna", kind="dupatta",
                                     base_price=Decimal("1600"))
        DupattaOption.objects.create(product=dup, lace_type="single", text_lines=2,
                                     price=Decimal("1500"))
        r = self._create([{"product": dup.id}])
        item = Order.objects.get(pk=r.data["id"]).items.get()
        self.assertEqual(item.price_snapshot, Decimal("1500"))

    def test_free_text_line_still_works(self):
        r = self._create([{"title": "কাস্টম ফ্রেম", "price": "800"}])
        item = Order.objects.get(pk=r.data["id"]).items.get()
        self.assertIsNone(item.product_id)
        self.assertIsNone(item.combo_id)
        self.assertEqual(item.config["title"], "কাস্টম ফ্রেম")

    def test_typed_title_overrides_the_catalogue_name(self):
        r = self._create([{"combo": self.combo.id, "title": "কম্বো (নীল)"}])
        item = Order.objects.get(pk=r.data["id"]).items.get()
        self.assertEqual(item.config["title"], "কম্বো (নীল)")

    # ---- details typed off the chat ----------------------------------------- #

    def test_details_and_note_snapshot_into_config(self):
        r = self._create([{
            "combo": self.combo.id,
            "fields": [{"label": "বরের নাম", "value": "Rahim"},
                       {"label": "তারিখ", "value": "১২ ফাল্গুন"}],
            "note": "লাল কাগজ",
        }])
        item = Order.objects.get(pk=r.data["id"]).items.get()
        self.assertEqual(item.config["fields"],
                         [{"label": "বরের নাম", "value": "Rahim"},
                          {"label": "তারিখ", "value": "১২ ফাল্গুন"}])
        self.assertEqual(item.config["note"], "লাল কাগজ")

    def test_blank_detail_rows_are_dropped(self):
        r = self._create([{"title": "x", "price": "1",
                           "fields": [{"label": "", "value": ""},
                                      {"label": "ডাকনাম", "value": "Rahi"}]}])
        item = Order.objects.get(pk=r.data["id"]).items.get()
        self.assertEqual(len(item.config["fields"]), 1)

    def test_detail_and_note_capped_at_200(self):
        r = self._create([{"title": "x", "price": "1", "note": "n" * 300,
                           "fields": [{"label": "l" * 300, "value": "v" * 300}]}])
        item = Order.objects.get(pk=r.data["id"]).items.get()
        self.assertEqual(len(item.config["note"]), 200)
        self.assertEqual(len(item.config["fields"][0]["label"]), 200)
        self.assertEqual(len(item.config["fields"][0]["value"]), 200)

    def test_detail_count_capped(self):
        r = self._create([{"title": "x", "price": "1",
                           "fields": [{"label": f"l{i}", "value": "v"} for i in range(50)]}])
        item = Order.objects.get(pk=r.data["id"]).items.get()
        self.assertEqual(len(item.config["fields"]), 20)

    # ---- totals + guards ---------------------------------------------------- #

    def test_subtotal_and_cod_add_up(self):
        r = self._create([{"combo": self.combo.id}, {"title": "পেন", "price": "300"}],
                         advance_received="500")
        order = Order.objects.get(pk=r.data["id"])
        self.assertEqual(order.subtotal, Decimal("2800"))
        self.assertEqual(order.cod_amount, Decimal("2420"))   # 2800 + 120 - 500

    def test_empty_items_rejected(self):
        self.assertEqual(self._create([]).status_code, 400)
        self.assertEqual(self._create([{"price": "100"}]).status_code, 400)

    def test_unknown_ids_fall_back_to_a_free_line(self):
        r = self._create([{"combo": 9999, "title": "hand typed", "price": "50"}])
        item = Order.objects.get(pk=r.data["id"]).items.get()
        self.assertIsNone(item.combo_id)
        self.assertEqual(item.config["title"], "hand typed")


class ManualOrderEditTests(APITestCase):
    """`edit/` REPLACES the lines, so it must not silently drop what it isn't editing."""

    def setUp(self):
        self.client.force_authenticate(
            User.objects.create_superuser("admin2", password="x"))
        self.combo = PrebuiltCombo.objects.create(
            name="কম্বো", slug="c1", price=Decimal("1000"))
        with patch("app.services.capi.track_purchase", return_value=None):
            r = self.client.post("/api/admin/orders/manual/", {
                "customer_name": "A", "phone": "017", "delivery_charge": "100",
                "items": [{"combo": self.combo.id,
                           "fields": [{"label": "তারিখ", "value": "কাল"}],
                           "note": "hurry"}],
            }, format="json")
        self.order = Order.objects.get(pk=r.data["id"])

    def _edit(self, body):
        return self.client.post(f"/api/admin/orders/{self.order.id}/edit/", body, format="json")

    def test_edit_keeps_link_and_details_when_passed_back(self):
        item = self.order.items.get()
        r = self._edit({"items": [{
            "title": "কম্বো", "price": "1100", "combo": item.combo_id,
            "fields": item.config["fields"], "note": item.config["note"],
        }]})
        self.assertEqual(r.status_code, 200)
        item = self.order.items.get()
        self.assertEqual(item.combo_id, self.combo.id)
        self.assertEqual(item.config["fields"][0]["value"], "কাল")
        self.assertEqual(item.price_snapshot, Decimal("1100"))
        self.order.refresh_from_db()
        self.assertEqual(self.order.subtotal, Decimal("1100"))

    def test_empty_items_payload_leaves_the_order_alone(self):
        r = self._edit({"items": []})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.order.items.count(), 1)
        self.order.refresh_from_db()
        self.assertEqual(self.order.subtotal, Decimal("1000"))


class ManualOrderCatalogueTests(APITestCase):
    def setUp(self):
        self.client.force_authenticate(
            User.objects.create_superuser("admin3", password="x"))
        self.combo = PrebuiltCombo.objects.create(
            name="কম্বো", slug="c1", price=Decimal("1000"), category="কম্বো")
        ComboField.objects.create(combo=self.combo, label="তারিখ")
        PrebuiltCombo.objects.create(name="পুরনো", slug="old", price=Decimal("1"),
                                     active=False)
        self.product = Product.objects.create(
            name="বই", slug="boi", kind="layered", base_price=Decimal("1200"))
        ProductField.objects.create(product=self.product, label="বরের নাম")

    def test_catalogue_lists_active_rows_with_prices_and_detail_labels(self):
        data = self.client.get("/api/admin/orders/catalogue/").data
        self.assertEqual([c["name"] for c in data["listings"]], ["কম্বো"])
        self.assertEqual(data["listings"][0]["fields"], ["তারিখ"])
        self.assertEqual(data["listings"][0]["price"], "1000.00")
        book = next(p for p in data["products"] if p["id"] == self.product.id)
        self.assertEqual(book["fields"], ["বরের নাম"])
        self.assertTrue(book["customizable"])

    def test_catalogue_needs_admin(self):
        self.client.force_authenticate(None)
        self.assertIn(self.client.get("/api/admin/orders/catalogue/").status_code,
                      (401, 403))
