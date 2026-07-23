from decimal import Decimal

from django.test import TestCase

from app.models import CartItem, Product
from app.serializers import _config_display


class ConfigDisplayInputsTests(TestCase):
    def setUp(self):
        self.product = Product.objects.create(
            name="Book", slug="book-cd", kind=Product.Kind.LAYERED, category="book",
            base_price=Decimal("1250"), active=True,
        )

    def _item(self, config):
        return CartItem.objects.create(
            session_key="k", product=self.product, config=config,
            price_snapshot=Decimal("1250"),
        )

    def test_shows_customer_field_answers(self):
        item = self._item({"fields": [{"label": "বরের নাম", "value": "Rahim"}]})
        lines = _config_display(item, None)
        self.assertIn({"label": "বরের নাম", "value": "Rahim", "image": None}, lines)

    def test_shows_the_note(self):
        item = self._item({"note": "সোনালি রঙে লিখবেন"})
        lines = _config_display(item, None)
        self.assertIn(
            {"label": "বিশেষ নির্দেশনা", "value": "সোনালি রঙে লিখবেন", "image": None},
            lines,
        )

    def test_no_lines_when_absent(self):
        self.assertEqual(_config_display(self._item({}), None), [])
