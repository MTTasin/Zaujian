from decimal import Decimal

from django.test import TestCase

from app.models import Product, ProductField
from app.serializers import ProductDetailSerializer


def _product():
    return Product.objects.create(
        name="Book", slug="book-pf", kind=Product.Kind.LAYERED, category="book",
        base_price=Decimal("1250"), active=True,
    )


class ProductFieldTests(TestCase):
    def test_defaults_to_required(self):
        f = ProductField.objects.create(product=_product(), label="বরের নাম")
        self.assertTrue(f.required)
        self.assertEqual(f.placeholder, "")
        self.assertEqual(f.order, 0)

    def test_ordering(self):
        p = _product()
        ProductField.objects.create(product=p, label="B", order=2)
        ProductField.objects.create(product=p, label="A", order=1)
        self.assertEqual([f.label for f in p.input_fields.all()], ["A", "B"])

    def test_detail_serializer_nests_input_fields(self):
        p = _product()
        ProductField.objects.create(
            product=p, label="বরের নাম", placeholder="পুরো নাম", required=True, order=1,
        )
        data = ProductDetailSerializer(p).data
        self.assertEqual(len(data["input_fields"]), 1)
        self.assertEqual(data["input_fields"][0]["label"], "বরের নাম")
        self.assertEqual(data["input_fields"][0]["placeholder"], "পুরো নাম")
        self.assertTrue(data["input_fields"][0]["required"])
