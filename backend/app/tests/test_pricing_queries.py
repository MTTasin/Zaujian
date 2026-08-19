"""What the price range costs to render.

`min_price` and `max_price` are two fields off ONE calculation. Asking for the
bounds twice per product — which is what two SerializerMethodFields did — made
the catalogue cost 3.9 queries per product for a number that never changes
between the two reads.
"""

from decimal import Decimal

from django.test import TestCase

from app.models import ColorOption, InsideDesign, Product, ProductImage, ToppingDesign
from app.serializers import ProductListSerializer
from app.services.pricing import price_bounds


class PriceBoundsQueryTests(TestCase):
    def setUp(self):
        for i in range(5):
            product = Product.objects.create(
                name=f"বই {i}", slug=f"book-{i}", kind=Product.Kind.LAYERED,
                base_price=Decimal("1000"),
            )
            ColorOption.objects.create(
                product=product, name="মেরুন", price_modifier=Decimal("100"),
            )
            ToppingDesign.objects.create(
                product=product, placement="corner", price_modifier=Decimal("50"),
            )
            ToppingDesign.objects.create(
                product=product, placement="center", price_modifier=Decimal("70"),
            )
            InsideDesign.objects.create(product=product, price_modifier=Decimal("30"))
            ProductImage.objects.create(product=product, image=f"products/{i}.jpg")

    def test_the_bounds_are_computed_once_per_product(self):
        """Catalogue shape: the real viewset prefetches images, so what is left
        is the price range — 3 aggregates per product, not 6."""
        products = list(Product.objects.prefetch_related("images"))
        with self.assertNumQueries(15):     # 3 per product; was 6 (bounds twice)
            data = ProductListSerializer(products, many=True, context={}).data
        self.assertEqual(len(data), 5)

    def test_the_range_itself_is_unchanged(self):
        product = Product.objects.first()
        lo, hi = price_bounds(product)

        # base 1000 + colour 100; max adds corner 50 + center 70 + inside 30.
        self.assertEqual(lo, Decimal("1100"))
        self.assertEqual(hi, Decimal("1250"))

        data = ProductListSerializer(product, context={}).data
        self.assertEqual(data["min_price"], "1100.00")
        self.assertEqual(data["max_price"], "1250.00")

    def test_a_layered_product_reads_each_option_table_once(self):
        """corner and center live in the SAME table — one grouped query, not two."""
        product = Product.objects.first()
        with self.assertNumQueries(3):      # colors, toppings (both placements), inside
            price_bounds(product)
