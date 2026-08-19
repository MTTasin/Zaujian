"""
Read-through caches (`app/services/cache.py`).

The rules that matter: a cached page must never outlive the edit that changed
it, and the cache must never be able to make things worse than having no cache —
not on a backend failure, and not by pinning a transient courier outage onto a
customer.
"""

from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth.models import User
from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from app.models import HomeCategory, Product
from app.services import cache as cache_service
from app.services.fraud_check import check_phone


class CatalogueInvalidationTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()

    def test_the_home_payload_is_served_from_cache_on_the_second_call(self):
        Product.objects.create(name="A", kind=Product.Kind.SIMPLE, active=True,
                               is_featured=True, base_price="100")
        first = self.client.get("/api/home/").json()

        # A DB row the cached payload would have to re-read to notice.
        with patch("app.views._home_payload", side_effect=AssertionError("rebuilt")):
            second = self.client.get("/api/home/").json()
        self.assertEqual(first, second)

    def test_saving_a_product_invalidates_the_home_payload(self):
        self.client.get("/api/home/")
        before = cache_service.catalogue_version()

        Product.objects.create(name="New", kind=Product.Kind.SIMPLE, active=True,
                               is_featured=True, base_price="150")
        self.assertGreater(cache_service.catalogue_version(), before)

        body = self.client.get("/api/home/").json()
        self.assertIn("New", [p["name"] for p in body["featured"]])

    def test_deleting_a_row_invalidates_too(self):
        cat = HomeCategory.objects.create(title="T", active=True)
        self.client.get("/api/home/")
        before = cache_service.catalogue_version()
        cat.delete()
        self.assertGreater(cache_service.catalogue_version(), before)

    def test_an_unrelated_model_does_not_bump_the_version(self):
        self.client.get("/api/home/")
        before = cache_service.catalogue_version()
        User.objects.create_user("someone", password="x")
        self.assertEqual(cache_service.catalogue_version(), before)

    def test_the_key_separates_hosts_so_media_urls_never_leak_across_them(self):
        a = cache_service.catalogue_key("home", "one.example")
        b = cache_service.catalogue_key("home", "two.example")
        self.assertNotEqual(a, b)


class ShopInfoCacheTests(TestCase):
    def setUp(self):
        cache.clear()

    def test_shop_info_still_answers_correctly_when_cached(self):
        api = APIClient()
        first = api.get("/api/shop-info/").json()
        second = api.get("/api/shop-info/").json()
        self.assertEqual(first, second)
        self.assertIn("delivery_charge", first)


class BotFactsCacheTests(TestCase):
    def setUp(self):
        cache.clear()

    def test_facts_are_rebuilt_when_the_catalogue_changes(self):
        from app.services.chatbot import _shop_facts

        # Bengali names slugify to empty, so the slugs are explicit here.
        Product.objects.create(name="ওয়ানটাইম", slug="one", kind=Product.Kind.SIMPLE,
                               active=True, base_price="500")
        self.assertIn("ওয়ানটাইম", _shop_facts())

        Product.objects.create(name="দ্বিতীয়", slug="two", kind=Product.Kind.SIMPLE,
                               active=True, base_price="600")
        self.assertIn("দ্বিতীয়", _shop_facts())

    @override_settings(SHOP={"DELIVERY_CHARGE": "999", "ADVANCE_AMOUNT": "200",
                             "BKASH_NUMBER": "", "NAGAD_NUMBER": ""})
    def test_a_settings_change_is_a_different_entry_not_a_stale_one(self):
        from app.services.chatbot import _shop_facts
        self.assertIn("999", _shop_facts())


class CacheFailureTests(TestCase):
    def test_a_broken_cache_backend_still_serves_the_page(self):
        with patch("app.services.cache.cache.get", side_effect=RuntimeError("redis down")), \
             patch("app.services.cache.cache.set", side_effect=RuntimeError("redis down")):
            resp = APIClient().get("/api/shop-info/")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("delivery_charge", resp.json())

    def test_a_missing_version_key_restarts_the_generation_instead_of_crashing(self):
        cache.clear()                      # evicts the version key, as Redis may
        self.assertEqual(cache_service.catalogue_version(), 1)
        cache_service.bump_catalogue()
        self.assertGreaterEqual(cache_service.catalogue_version(), 1)


COURIER = {
    "STEADFAST_FRAUD_USER": "u", "STEADFAST_FRAUD_PASSWORD": "p",
    "PATHAO_FRAUD_USER": "u", "PATHAO_FRAUD_PASSWORD": "p",
    "TIMEOUT_SECONDS": 3, "MIN_SUCCESS_RATIO": 70,
}
GOOD = {"success": 9, "cancel": 1, "total": 10, "success_ratio": 90.0,
        "counts_available": True}
DOWN = {"success": 0, "cancel": 0, "total": 0, "success_ratio": 0.0,
        "counts_available": False, "error": "Steadfast request error"}
RATING_ONLY = {"success": 0, "cancel": 0, "total": 0, "success_ratio": 0.0,
               "counts_available": False, "rating": "excellent_customer"}


@override_settings(COURIER=COURIER)
class FraudCacheTests(TestCase):
    def setUp(self):
        cache.clear()

    def test_a_second_lookup_does_not_hit_the_couriers_again(self):
        with patch("app.services.fraud_check.steadfast_stats", return_value=GOOD) as sf, \
             patch("app.services.fraud_check.pathao_stats", return_value=GOOD):
            check_phone("01711010782")
            check_phone("01711010782")
        self.assertEqual(sf.call_count, 1)

    def test_refresh_bypasses_the_cache(self):
        with patch("app.services.fraud_check.steadfast_stats", return_value=GOOD) as sf, \
             patch("app.services.fraud_check.pathao_stats", return_value=GOOD):
            check_phone("01711010782")
            check_phone("01711010782", refresh=True)
        self.assertEqual(sf.call_count, 2)

    def test_a_courier_outage_is_never_cached(self):
        # Otherwise one blip pins "advance required" on this customer for the
        # whole TTL — the cache would turn a transient failure into a policy.
        # Steadfast down + Pathao rating-only = no counts anywhere = advance.
        with patch("app.services.fraud_check.steadfast_stats", return_value=DOWN), \
             patch("app.services.fraud_check.pathao_stats", return_value=RATING_ONLY):
            first = check_phone("01711010782")
        self.assertTrue(first["advance_required"])

        with patch("app.services.fraud_check.steadfast_stats", return_value=GOOD) as sf, \
             patch("app.services.fraud_check.pathao_stats", return_value=GOOD):
            second = check_phone("01711010782")
        self.assertEqual(sf.call_count, 1)          # it really did look again
        self.assertFalse(second["advance_required"])

    def test_different_numbers_do_not_share_an_entry(self):
        with patch("app.services.fraud_check.steadfast_stats", return_value=GOOD), \
             patch("app.services.fraud_check.pathao_stats", return_value=GOOD):
            a = check_phone("01711010782")
            b = check_phone("01812345678")
        self.assertNotEqual(a["phone"], b["phone"])

    def test_an_invalid_number_short_circuits_before_the_cache(self):
        self.assertIn("error", check_phone("12345"))


class SignalScopeTests(TestCase):
    """The catalogue version is bumped by catalogue writes — and by nothing else.

    A senderless receiver ran on every write in the project (chat messages,
    analytics sessions, audit rows) to discover it had nothing to do.
    """

    def test_a_catalogue_write_bumps_the_version(self):
        before = cache_service.catalogue_version()
        Product.objects.create(name="বই", slug="sig-book", base_price=Decimal("100"))
        self.assertNotEqual(cache_service.catalogue_version(), before)

    def test_a_non_catalogue_write_does_not(self):
        from app.models import VisitorSession

        before = cache_service.catalogue_version()
        VisitorSession.objects.create(session_id="sig1", visitor_id="v1")
        self.assertEqual(cache_service.catalogue_version(), before)
