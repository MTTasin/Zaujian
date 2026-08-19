"""What it costs to render a cart/order line.

`config_display` walks a snapshot, and a snapshot repeats itself: the same
product appears on every one of its lines, the same combo appears on every item
of an order. Each repeat used to be its own query — a single combo line measured
20 — and this is paid on the PUBLIC cart and track pages, over 2G, on a shared
host. These tests pin the cost, not just the output.
"""

from decimal import Decimal

from django.test import TestCase

from app.models import (
    CartItem, ColorOption, InsideDesign, PrebuiltCombo, Product, ToppingDesign,
)
from app.serializers import CartItemSerializer, _config_display, combo_preset_snapshot


class ComboLineQueryTests(TestCase):
    def setUp(self):
        self.book = Product.objects.create(
            name="নিকাহ নামা বুক", slug="book", kind=Product.Kind.LAYERED,
            base_price=Decimal("1100"),
        )
        self.box = Product.objects.create(
            name="বক্স", slug="box", kind=Product.Kind.LAYERED, base_price=Decimal("400"),
        )
        preset = {}
        for product in (self.book, self.box):
            color = ColorOption.objects.create(
                product=product, name="মেরুন", base_image=f"colors/{product.slug}.jpg",
            )
            corner = ToppingDesign.objects.create(
                product=product, placement="corner", image=f"top/{product.slug}-c.png",
            )
            center = ToppingDesign.objects.create(
                product=product, placement="center", image=f"top/{product.slug}-m.png",
            )
            inside = InsideDesign.objects.create(
                product=product, preview_image=f"inside/{product.slug}.png",
            )
            preset[str(product.id)] = {
                "color": {"id": color.id}, "corner": {"id": corner.id},
                "center": {"id": center.id}, "inside": {"id": inside.id},
            }

        self.combo = PrebuiltCombo.objects.create(
            name="রয়্যাল কম্বো", slug="royal", price=Decimal("1500"),
            description="বই, বক্স, বরমালা", preset_config=preset,
        )
        self.combo.products.add(self.book, self.box)
        self.snapshot = combo_preset_snapshot(self.combo)

    def _item(self):
        return CartItem.objects.create(
            session_key="s", combo=self.combo, price_snapshot=self.combo.price,
            config={"combo_items": self.snapshot},
        )

    def test_a_line_does_not_refetch_the_product_it_shares_with_its_neighbours(self):
        """8 lines across 2 products must not cost 8 product lookups."""
        item = self._item()
        with self.assertNumQueries(10):
            data = CartItemSerializer(item, context={}).data
        self.assertEqual(len(data["config_display"]), 8)

    def test_a_second_identical_item_is_nearly_free(self):
        """Three of the same combo cost what one costs — the memo spans the pass,
        so an order does not pay per line AND per item."""
        items = [self._item() for _ in range(3)]
        with self.assertNumQueries(10):
            data = CartItemSerializer(items, many=True, context={}).data
        self.assertEqual(len(data), 3)

    def test_every_line_still_carries_its_own_photo(self):
        """The batching must not blur one option's photo into another's."""
        item = self._item()
        images = {ln["label"]: ln["image"] for ln in _config_display(item, None)}

        self.assertIn("colors/book.jpg", images["নিকাহ নামা বুক — রং"])
        self.assertIn("colors/box.jpg", images["বক্স — রং"])
        self.assertIn("top/book-c.png", images["নিকাহ নামা বুক — কোণার ডিজাইন"])
        self.assertIn("top/box-m.png", images["বক্স — মাঝের ডিজাইন"])
        self.assertIn("inside/book.png", images["নিকাহ নামা বুক — ভেতরের পাতা"])

    def test_a_shared_lookup_answers_exactly_what_a_fresh_one_does(self):
        """Memoized output must be byte-identical to the unmemoized output."""
        item = self._item()
        batched = CartItemSerializer([item, item], many=True, context={}).data
        alone = CartItemSerializer(item, context={}).data

        self.assertEqual(batched[0], alone)
        self.assertEqual(batched[1], alone)


class PresetSnapshotQueryTests(ComboLineQueryTests):
    """Snapshotting runs inside the add-to-cart POST, so it is on the customer's
    critical path — and it used to ask "does this option still exist?" with one
    `.exists()` per option per product."""

    def test_snapshotting_reads_each_option_table_once_per_product(self):
        with self.assertNumQueries(7):      # products + 3 option tables x 2 products
            snapshot = combo_preset_snapshot(self.combo)

        self.assertEqual(len(snapshot), 2)
        self.assertEqual([len(entry["lines"]) for entry in snapshot], [4, 4])

    def test_the_snapshot_is_unchanged(self):
        """Same lines, same ids — this is what a placed order keeps forever."""
        entry = next(e for e in combo_preset_snapshot(self.combo)
                     if e["product"] == "বক্স")
        by_kind = {ln.get("option_kind"): ln for ln in entry["lines"]}

        self.assertEqual(by_kind["color"]["value"], "মেরুন")
        self.assertEqual(set(by_kind), {"color", "corner", "center", "inside"})
        self.assertTrue(all(ln["product_id"] == self.box.id for ln in entry["lines"]))


class ProductLineQueryTests(TestCase):
    """A configured product line — the other half of a real cart."""

    def setUp(self):
        self.product = Product.objects.create(
            name="ওড়না", slug="dupatta", kind=Product.Kind.LAYERED,
            base_price=Decimal("900"),
        )
        self.color = ColorOption.objects.create(
            product=self.product, name="মেরুন", base_image="colors/d.jpg",
        )
        self.corner = ToppingDesign.objects.create(
            product=self.product, placement="corner", image="top/c.png",
        )

    def test_two_lines_of_the_same_product_share_their_lookups(self):
        for _ in range(2):
            CartItem.objects.create(
                session_key="s", product=self.product, price_snapshot=Decimal("900"),
                config={"color": {"id": self.color.id, "name": "মেরুন"},
                        "corner": {"id": self.corner.id}},
            )
        items = list(CartItem.objects.select_related("product", "combo"))

        with self.assertNumQueries(3):
            data = CartItemSerializer(items, many=True, context={}).data

        self.assertEqual(len(data), 2)
        self.assertIn("colors/d.jpg", data[0]["config_display"][0]["image"])
