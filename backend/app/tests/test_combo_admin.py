from decimal import Decimal

from django.test import TestCase

from app.admin import PrebuiltComboForm
from app.models import Product


def _p(slug, group=""):
    return Product.objects.create(
        name=slug, slug=slug, kind=Product.Kind.SIMPLE, category=slug,
        base_price=Decimal("100"), active=True, exclusive_group=group,
    )


class ComboAdminValidationTests(TestCase):
    def test_rejects_two_products_from_one_group(self):
        book = _p("book-c", "nikahnama")
        frame = _p("frame-c", "nikahnama")
        form = PrebuiltComboForm(data={
            "name": "Bad Combo", "slug": "bad-combo", "price": "2500",
            "description": "", "products": [book.pk, frame.pk],
            "featured": False, "active": True,
        })
        self.assertFalse(form.is_valid())
        self.assertIn("nikahnama", str(form.errors))

    def test_allows_one_per_group(self):
        book = _p("book-ok", "nikahnama")
        pen = _p("pen-ok", "")
        form = PrebuiltComboForm(data={
            "name": "Good Combo", "slug": "good-combo", "price": "2500",
            "description": "", "products": [book.pk, pen.pk],
            "featured": False, "active": True,
        })
        self.assertTrue(form.is_valid(), form.errors)
