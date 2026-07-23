from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APITestCase

from app.models import Product
from app.serializers import ProductDetailSerializer, ProductListSerializer


def _product(slug, **kw):
    return Product.objects.create(
        name=kw.pop("name", slug), slug=slug, kind=Product.Kind.GALLERY,
        category=kw.pop("category", slug), base_price=Decimal("100"), active=True, **kw,
    )


class CustomizeFieldTests(TestCase):
    def test_defaults_are_unrestricted(self):
        p = _product("mirror")
        self.assertEqual(p.exclusive_group, "")
        self.assertEqual(p.customize_order, 0)

    def test_fields_persist(self):
        p = _product("frame", exclusive_group="nikahnama", customize_order=2)
        p.refresh_from_db()
        self.assertEqual(p.exclusive_group, "nikahnama")
        self.assertEqual(p.customize_order, 2)


class CustomizeSerializerTests(APITestCase):
    def test_list_serializer_exposes_fields(self):
        p = _product("thumb", exclusive_group="nikahnama", customize_order=3)
        data = ProductListSerializer(p).data
        self.assertEqual(data["exclusive_group"], "nikahnama")
        self.assertEqual(data["customize_order"], 3)

    def test_detail_serializer_exposes_fields(self):
        p = _product("book2", exclusive_group="nikahnama", customize_order=1)
        data = ProductDetailSerializer(p).data
        self.assertEqual(data["exclusive_group"], "nikahnama")
        self.assertEqual(data["customize_order"], 1)
