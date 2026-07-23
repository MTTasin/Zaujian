from decimal import Decimal

from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from app.models import Product, ProductField


class AdminProductFieldTests(APITestCase):
    def setUp(self):
        self.client.force_authenticate(User.objects.create_user("a", password="x", is_staff=True))
        self.product = Product.objects.create(
            name="Book", slug="book-apf", kind=Product.Kind.LAYERED, category="book",
            base_price=Decimal("1250"), active=True,
        )

    def test_create(self):
        r = self.client.post("/api/admin/product-fields/", {
            "product": self.product.id, "label": "বরের নাম",
            "placeholder": "পুরো নাম", "required": True, "order": 1,
        }, format="json")
        self.assertEqual(r.status_code, 201)
        self.assertEqual(ProductField.objects.count(), 1)

    def test_filter_by_product(self):
        other = Product.objects.create(
            name="Box", slug="box-apf", kind=Product.Kind.LAYERED, category="box",
            base_price=Decimal("400"), active=True,
        )
        ProductField.objects.create(product=self.product, label="Mine")
        ProductField.objects.create(product=other, label="Theirs")
        r = self.client.get(f"/api/admin/product-fields/?product={self.product.id}")
        self.assertEqual([f["label"] for f in r.json()], ["Mine"])

    def test_requires_admin(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get("/api/admin/product-fields/").status_code, 401)
