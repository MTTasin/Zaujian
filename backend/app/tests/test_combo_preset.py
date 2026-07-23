from decimal import Decimal

from django.test import TestCase

from app.models import CartItem, ColorOption, PrebuiltCombo, Product, ToppingDesign
from app.serializers import _config_display, combo_preset_snapshot


class ComboPresetTests(TestCase):
    """A combo's pictured design is snapshotted onto the cart item, so the order
    records exactly what was sold and later admin renames never rewrite it."""

    def setUp(self):
        self.product = Product.objects.create(
            name="নিকাহ নামা বুক", slug="book", kind=Product.Kind.LAYERED,
            base_price=Decimal("1100"),
        )
        self.color = ColorOption.objects.create(
            product=self.product, name="মেরুন", base_image="colors/m.jpg",
        )
        self.corner = ToppingDesign.objects.create(
            product=self.product, placement="corner", image="toppings/c.png",
        )
        self.combo = PrebuiltCombo.objects.create(
            name="রয়্যাল কম্বো", slug="royal", price=Decimal("1500"),
        )
        self.combo.products.add(self.product)

    def test_no_preset_snapshots_nothing(self):
        self.assertEqual(combo_preset_snapshot(self.combo), [])

    def test_preset_snapshot_resolves_names(self):
        self.combo.preset_config = {
            str(self.product.id): {"color": {"id": self.color.id}, "corner": {"id": self.corner.id}}
        }
        self.combo.save()

        snap = combo_preset_snapshot(self.combo)

        self.assertEqual(len(snap), 1)
        self.assertEqual(snap[0]["product"], "নিকাহ নামা বুক")
        labels = {ln["label"]: ln["value"] for ln in snap[0]["lines"]}
        self.assertEqual(labels["রং"], "মেরুন")
        self.assertIn("কোণার ডিজাইন", labels)

    def test_snapshot_survives_option_rename(self):
        """Renaming the colour later must NOT change an already-placed order."""
        self.combo.preset_config = {str(self.product.id): {"color": {"id": self.color.id}}}
        self.combo.save()
        item = CartItem.objects.create(
            session_key="s", combo=self.combo, price_snapshot=self.combo.price,
            config={"combo_items": combo_preset_snapshot(self.combo)},
        )

        self.color.name = "নতুন নাম"
        self.color.save()

        lines = _config_display(item, None)
        self.assertEqual(lines[0]["value"], "মেরুন")  # snapshotted, not re-resolved

    def test_config_display_renders_combo_items(self):
        item = CartItem.objects.create(
            session_key="s", combo=self.combo, price_snapshot=self.combo.price,
            config={"combo_items": [
                {"product": "বুক", "lines": [{"label": "রং", "value": "মেরুন"}]},
            ]},
        )

        lines = _config_display(item, None)

        self.assertEqual(len(lines), 1)
        self.assertEqual(lines[0]["label"], "বুক — রং")
        self.assertEqual(lines[0]["value"], "মেরুন")

    def test_preset_lines_carry_ids_for_image_lookup(self):
        """Lines snapshot the option ids so the admin can see the chosen design."""
        self.combo.preset_config = {
            str(self.product.id): {"color": {"id": self.color.id}, "corner": {"id": self.corner.id}}
        }
        self.combo.save()

        lines = combo_preset_snapshot(self.combo)[0]["lines"]
        by_kind = {ln.get("option_kind"): ln for ln in lines}

        self.assertEqual(by_kind["color"]["option_id"], self.color.id)
        self.assertEqual(by_kind["color"]["product_id"], self.product.id)
        self.assertEqual(by_kind["corner"]["option_id"], self.corner.id)
        self.assertEqual(by_kind["corner"]["product_id"], self.product.id)

    def test_config_display_resolves_combo_images(self):
        """The whole point: a combo order shows the design, not a blank tile."""
        self.combo.preset_config = {
            str(self.product.id): {"color": {"id": self.color.id}, "corner": {"id": self.corner.id}}
        }
        self.combo.save()
        item = CartItem.objects.create(
            session_key="s", combo=self.combo, price_snapshot=self.combo.price,
            config={"combo_items": combo_preset_snapshot(self.combo)},
        )

        images = {ln["label"]: ln["image"] for ln in _config_display(item, None)}

        self.assertIn("colors/m.jpg", images["নিকাহ নামা বুক — রং"])
        self.assertIn("toppings/c.png", images["নিকাহ নামা বুক — কোণার ডিজাইন"])

    def test_combo_line_without_image_stays_none(self):
        colorless = ColorOption.objects.create(product=self.product, name="সাদা")
        self.combo.preset_config = {str(self.product.id): {"color": {"id": colorless.id}}}
        self.combo.save()
        item = CartItem.objects.create(
            session_key="s", combo=self.combo, price_snapshot=self.combo.price,
            config={"combo_items": combo_preset_snapshot(self.combo)},
        )

        self.assertIsNone(_config_display(item, None)[0]["image"])

    def test_legacy_combo_order_recovers_image_from_live_preset(self):
        """Orders placed before ids were snapshotted still resolve, via the combo."""
        self.combo.preset_config = {str(self.product.id): {"color": {"id": self.color.id}}}
        self.combo.save()
        item = CartItem.objects.create(
            session_key="s", combo=self.combo, price_snapshot=self.combo.price,
            config={"combo_items": [
                # Old shape: label/value only, no ids.
                {"product": "নিকাহ নামা বুক", "lines": [{"label": "রং", "value": "মেরুন"}]},
            ]},
        )

        line = _config_display(item, None)[0]

        self.assertEqual(line["value"], "মেরুন")
        self.assertIn("colors/m.jpg", line["image"])

    def test_legacy_combo_order_without_matching_preset_does_not_raise(self):
        item = CartItem.objects.create(
            session_key="s", combo=self.combo, price_snapshot=self.combo.price,
            config={"combo_items": [
                {"product": "মুছে ফেলা পণ্য", "lines": [{"label": "রং", "value": "মেরুন"}]},
            ]},
        )

        self.assertIsNone(_config_display(item, None)[0]["image"])

    def test_customer_fields_on_a_combo_have_no_image(self):
        item = CartItem.objects.create(
            session_key="s", combo=self.combo, price_snapshot=self.combo.price,
            config={"fields": [{"label": "বরের নাম", "value": "Rahim"}], "note": "দ্রুত চাই"},
        )

        lines = _config_display(item, None)

        self.assertEqual([ln["image"] for ln in lines], [None, None])

    def test_combo_without_preset_shows_no_lines(self):
        item = CartItem.objects.create(
            session_key="s", combo=self.combo, price_snapshot=self.combo.price, config={},
        )
        self.assertEqual(_config_display(item, None), [])
