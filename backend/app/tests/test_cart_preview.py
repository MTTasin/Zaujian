from decimal import Decimal

from django.test import TestCase

from app.models import (
    CartItem, ColorOption, ConfigurationImage, Product, ToppingDesign,
)
from app.serializers import _resolve_preview


class CartPreviewTests(TestCase):
    """The cart thumbnail must show the customer's actual configuration when a
    matching ConfigurationImage exists — not the plain base colour."""

    def setUp(self):
        self.product = Product.objects.create(
            name="Book", slug="book-prev", kind=Product.Kind.LAYERED, category="book",
            base_price=Decimal("1250"), active=True,
        )
        self.color = ColorOption.objects.create(
            product=self.product, name="maroon", base_image="colors/base.jpg", active=True,
        )
        self.corner = ToppingDesign.objects.create(
            product=self.product, placement=ToppingDesign.Placement.CORNER,
            image="toppings/corner.png", active=True,
        )
        self.center = ToppingDesign.objects.create(
            product=self.product, placement=ToppingDesign.Placement.CENTER,
            image="toppings/center.png", active=True,
        )

    def _item(self, config):
        return CartItem.objects.create(
            session_key="k", product=self.product, config=config,
            price_snapshot=Decimal("1250"),
        )

    def test_uses_matching_configuration_image(self):
        ConfigurationImage.objects.create(
            product=self.product, color=self.color, corner=self.corner,
            center=self.center, image="config_images/combo.jpg", active=True,
        )
        item = self._item({
            "color": {"id": self.color.id},
            "corner": {"id": self.corner.id},
            "center": {"id": self.center.id},
        })
        self.assertIn("config_images/combo.jpg", _resolve_preview(item))

    def test_falls_back_to_base_colour_when_no_match(self):
        item = self._item({"color": {"id": self.color.id}})
        self.assertIn("colors/base.jpg", _resolve_preview(item))

    def test_ignores_inactive_configuration_image(self):
        ConfigurationImage.objects.create(
            product=self.product, color=self.color, corner=self.corner,
            center=self.center, image="config_images/off.jpg", active=False,
        )
        item = self._item({
            "color": {"id": self.color.id},
            "corner": {"id": self.corner.id},
            "center": {"id": self.center.id},
        })
        self.assertIn("colors/base.jpg", _resolve_preview(item))
