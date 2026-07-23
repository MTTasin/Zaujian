from decimal import Decimal

from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from app.models import PrebuiltCombo, Product


class AdminQuerysetFreshnessTests(APITestCase):
    """Admin list endpoints must never serve a cached QuerySet.

    `_AdminBase.get_queryset` used to return the class-level `self.queryset`
    object. Django caches a QuerySet's results once evaluated, and the object is
    shared across requests in a worker process — so rows created after the first
    request never appeared (and each Passenger worker showed a different stale
    snapshot). Regression guard for that.
    """

    def setUp(self):
        self.admin = User.objects.create_superuser("admin", "a@a.com", "pw")
        self.client.force_authenticate(self.admin)

    def test_combo_created_after_first_list_is_returned(self):
        PrebuiltCombo.objects.create(name="প্রথম", slug="one", price=Decimal("100"))

        first = self.client.get("/api/admin/combos/")
        self.assertEqual(len(first.data), 1)

        PrebuiltCombo.objects.create(name="দ্বিতীয়", slug="two", price=Decimal("200"))

        second = self.client.get("/api/admin/combos/")
        self.assertEqual(len(second.data), 2, "new combo missing -> queryset was cached")

    def test_deleted_combo_disappears_from_list(self):
        combo = PrebuiltCombo.objects.create(name="মুছে যাবে", slug="gone", price=Decimal("10"))
        self.assertEqual(len(self.client.get("/api/admin/combos/").data), 1)

        combo.delete()

        self.assertEqual(len(self.client.get("/api/admin/combos/").data), 0)

    def test_product_created_after_first_list_is_returned(self):
        Product.objects.create(name="প্রথম", slug="p1")
        self.assertEqual(len(self.client.get("/api/admin/products/").data), 1)

        Product.objects.create(name="দ্বিতীয়", slug="p2")

        self.assertEqual(len(self.client.get("/api/admin/products/").data), 2)
