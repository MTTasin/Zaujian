"""Re-lining a placed order: `orders/{id}/edit_items/`.

Customers change their mind after ordering — swap the pen for a mirror, add a
second book, agree a different price on the phone. Until this endpoint only a
fully manual order could be re-lined at all, and a website order could only have
its text and its colour edited.

The two rules worth protecting:
  * an untouched website line keeps its option config, so it keeps its photo and
    stays editable through `edit_item_options`;
  * a price typed here is THIS order's price and never touches the catalogue.
"""

from decimal import Decimal

from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from app.models import CartItem, Order, PrebuiltCombo, Product


class EditItemsTests(APITestCase):
    def setUp(self):
        self.client.force_authenticate(
            User.objects.create_superuser("admin", password="x"))
        self.book = Product.objects.create(
            name="বই", slug="boi", kind="layered", base_price=Decimal("1200"))
        self.pen = Product.objects.create(
            name="পেন", slug="pen", kind="gallery", base_price=Decimal("400"))
        self.combo = PrebuiltCombo.objects.create(
            name="মেরুন কম্বো", slug="maroon", price=Decimal("2500"), category="কম্বো")
        self.order = Order.objects.create(
            customer_name="Rahim", phone="01700000000",
            subtotal=Decimal("1200"), delivery_charge=Decimal("120"))
        # A website line: option config the customer picked in the configurator.
        self.item = CartItem.objects.create(
            order=self.order, session_key="tok", product=self.book,
            price_snapshot=Decimal("1200"),
            config={"color": {"id": 3, "name": "লাল"},
                    "fields": [{"label": "বরের নাম", "value": "Rahim"}]},
        )

    def _edit(self, items):
        return self.client.post(
            f"/api/admin/orders/{self.order.id}/edit_items/", {"items": items},
            format="json",
        )

    # ---- editing in place --------------------------------------------------- #

    def test_editing_text_keeps_the_option_config_and_the_photo(self):
        r = self._edit([{"id": self.item.id,
                         "fields": [{"label": "বরের নাম", "value": "Karim"}]}])
        self.assertEqual(r.status_code, 200)
        self.item.refresh_from_db()
        self.assertEqual(self.item.config["color"]["id"], 3)
        self.assertEqual(self.item.config["fields"][0]["value"], "Karim")
        self.assertEqual(self.item.price_snapshot, Decimal("1200"))

    def test_a_typed_price_is_for_this_order_only(self):
        self._edit([{"id": self.item.id, "price": "999"}])
        self.item.refresh_from_db()
        self.book.refresh_from_db()
        self.assertEqual(self.item.price_snapshot, Decimal("999"))
        self.assertEqual(self.book.base_price, Decimal("1200"))   # catalogue untouched

    def test_the_order_total_follows_the_new_prices(self):
        self._edit([{"id": self.item.id, "price": "999"}])
        self.order.refresh_from_db()
        self.assertEqual(self.order.subtotal, Decimal("999"))
        self.assertEqual(self.order.cod_amount, Decimal("1119"))  # + delivery 120

    def test_details_can_be_added_and_removed(self):
        self._edit([{"id": self.item.id, "fields": [
            {"label": "বরের নাম", "value": "Rahim"},
            {"label": "তারিখ", "value": "14/08/2026"},
        ]}])
        self.item.refresh_from_db()
        self.assertEqual(len(self.item.config["fields"]), 2)

        self._edit([{"id": self.item.id, "fields": []}])
        self.item.refresh_from_db()
        self.assertNotIn("fields", self.item.config)

    def test_an_edit_that_says_nothing_about_the_link_keeps_it(self):
        self._edit([{"id": self.item.id, "note": "urgent"}])
        self.item.refresh_from_db()
        self.assertEqual(self.item.product_id, self.book.id)
        self.assertEqual(self.item.config["note"], "urgent")

    # ---- swapping the item -------------------------------------------------- #

    def test_swapping_the_product_drops_the_old_options_and_reprices(self):
        self._edit([{"id": self.item.id, "product": self.pen.id}])
        self.item.refresh_from_db()
        self.assertEqual(self.item.product_id, self.pen.id)
        self.assertNotIn("color", self.item.config)               # described the book
        self.assertEqual(self.item.price_snapshot, Decimal("400"))
        self.assertEqual(self.item.config["fields"][0]["value"], "Rahim")  # answers stay

    def test_swapping_to_a_listing_moves_the_link_across(self):
        self._edit([{"id": self.item.id, "product": None, "combo": self.combo.id}])
        self.item.refresh_from_db()
        self.assertIsNone(self.item.product_id)
        self.assertEqual(self.item.combo_id, self.combo.id)
        self.assertEqual(self.item.price_snapshot, Decimal("2500"))

    def test_a_typed_price_still_wins_when_swapping(self):
        self._edit([{"id": self.item.id, "combo": self.combo.id, "price": "2200"}])
        self.item.refresh_from_db()
        self.assertEqual(self.item.price_snapshot, Decimal("2200"))

    # ---- adding and removing lines ------------------------------------------ #

    def test_a_line_without_an_id_is_added(self):
        r = self._edit([{"id": self.item.id}, {"product": self.pen.id}])
        self.assertEqual(r.status_code, 200)
        self.order.refresh_from_db()
        self.assertEqual(self.order.items.count(), 2)
        self.assertEqual(self.order.subtotal, Decimal("1600"))

    def test_an_omitted_line_is_deleted(self):
        self._edit([{"id": self.item.id}, {"product": self.pen.id, "price": "400"}])
        keep = self.order.items.exclude(pk=self.item.pk).get()
        self._edit([{"id": keep.id}])
        self.order.refresh_from_db()
        self.assertEqual(self.order.items.count(), 1)
        self.assertFalse(CartItem.objects.filter(pk=self.item.pk).exists())

    def test_a_free_text_line_needs_only_a_title(self):
        self._edit([{"id": self.item.id}, {"title": "কাস্টম ফ্রেম", "price": "800"}])
        line = self.order.items.exclude(pk=self.item.pk).get()
        self.assertEqual(line.config["title"], "কাস্টম ফ্রেম")
        self.assertTrue(line.config["manual"])

    def test_a_line_with_neither_title_nor_link_is_dropped(self):
        self._edit([{"id": self.item.id}, {"note": "just a note"}])
        self.order.refresh_from_db()
        self.assertEqual(self.order.items.count(), 1)

    # ---- refusals ----------------------------------------------------------- #

    def test_an_order_cannot_be_emptied(self):
        r = self._edit([])
        self.assertEqual(r.status_code, 400)
        self.order.refresh_from_db()
        self.assertEqual(self.order.items.count(), 1)             # nothing deleted

    def test_an_item_from_another_order_is_refused(self):
        other = Order.objects.create(customer_name="X", phone="01800000000")
        stray = CartItem.objects.create(order=other, session_key="t",
                                        product=self.pen, price_snapshot=Decimal("400"))
        r = self._edit([{"id": stray.id}])
        self.assertEqual(r.status_code, 404)
        self.assertTrue(CartItem.objects.filter(pk=self.item.pk).exists())

    def test_text_is_capped_like_the_storefront(self):
        self._edit([{"id": self.item.id,
                     "fields": [{"label": "x", "value": "য" * 500}],
                     "note": "n" * 500}])
        self.item.refresh_from_db()
        self.assertEqual(len(self.item.config["fields"][0]["value"]), 200)
        self.assertEqual(len(self.item.config["note"]), 200)


class EditConfigRowTests(APITestCase):
    """`edit_config` grew the ability to add and drop detail rows — details often
    arrive after the order (a nickname for the pen, a corrected date)."""

    def setUp(self):
        self.client.force_authenticate(
            User.objects.create_superuser("admin", password="x"))
        self.order = Order.objects.create(customer_name="R", phone="01700000000")
        self.item = CartItem.objects.create(
            order=self.order, session_key="tok", price_snapshot=Decimal("100"),
            config={"title": "কম্বো",
                    "fields": [{"label": "বরের নাম", "value": "Rahim"}]},
        )

    def _post(self, body):
        return self.client.post(
            f"/api/admin/orders/{self.order.id}/edit_config/",
            {"item_id": self.item.id, **body}, format="json",
        )

    def test_a_value_only_payload_still_keeps_the_snapshotted_label(self):
        # What the panel has always sent — positional values, no labels.
        self._post({"fields": [{"value": "Karim"}]})
        self.item.refresh_from_db()
        self.assertEqual(self.item.config["fields"],
                         [{"label": "বরের নাম", "value": "Karim"}])

    def test_a_new_row_can_be_added(self):
        self._post({"fields": [{"value": "Rahim"},
                               {"label": "ডাকনাম", "value": "Raju"}]})
        self.item.refresh_from_db()
        self.assertEqual(self.item.config["fields"][1],
                         {"label": "ডাকনাম", "value": "Raju"})

    def test_dropping_every_row_removes_the_key(self):
        self._post({"fields": []})
        self.item.refresh_from_db()
        self.assertNotIn("fields", self.item.config)
