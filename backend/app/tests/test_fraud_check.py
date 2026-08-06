"""Courier fraud check parsing.

The Pathao cases exist because their API silently changed shape: v2 answers
`{"version": "v2", "show_count": false, "customer_rating": "excellent_customer"}`
with no `customer` object, and the old parser turned that into "0 delivered,
0 cancelled, 0%" — indistinguishable from a customer who never ordered.
"""

from unittest.mock import patch

from django.core.cache import cache
from django.test import TestCase, override_settings

from app.services import fraud_check

CREDS = {
    "STEADFAST_FRAUD_USER": "u", "STEADFAST_FRAUD_PASSWORD": "p",
    "PATHAO_FRAUD_USER": "u", "PATHAO_FRAUD_PASSWORD": "p",
    "TIMEOUT_SECONDS": 3, "MIN_SUCCESS_RATIO": 70,
}


class _Resp:
    status_code = 200

    def __init__(self, payload):
        self._payload = payload

    def json(self):
        return self._payload


@override_settings(COURIER=CREDS)
class PathaoParsingTests(TestCase):
    def _run(self, data):
        login = _Resp({"access_token": "tok"})
        with patch("app.services.fraud_check.requests.post",
                   side_effect=[login, _Resp({"data": data})]):
            return fraud_check.pathao_stats("01711010782")

    def test_v2_rating_only_is_not_reported_as_zero_deliveries(self):
        stats = self._run({"version": "v2", "show_count": False,
                           "address_book": [], "customer_rating": "excellent_customer"})
        self.assertFalse(stats["counts_available"])
        self.assertEqual(stats["rating"], "excellent_customer")
        self.assertNotIn("error", stats)          # nothing failed — they just don't tell us

    def test_old_shape_with_counts_still_parses(self):
        stats = self._run({"customer": {"successful_delivery": 9, "total_delivery": 10}})
        self.assertTrue(stats["counts_available"])
        self.assertEqual((stats["success"], stats["cancel"], stats["total"]), (9, 1, 10))
        self.assertEqual(stats["success_ratio"], 90.0)

    def test_show_count_false_beats_a_stub_customer_object(self):
        # Pathao saying "counts withheld" outranks a customer object of zeros —
        # otherwise that stub parses as a real "never delivered" history.
        stats = self._run({"show_count": False, "customer_rating": "risky_customer",
                           "customer": {"successful_delivery": 0, "total_delivery": 0}})
        self.assertFalse(stats["counts_available"])
        self.assertEqual(stats["rating"], "risky_customer")

    def test_risk_level_and_message_are_carried_through_when_present(self):
        stats = self._run({"show_count": False, "customer_rating": "good_customer",
                           "risk_level": "low", "message": "Good Customer - High Success Rate"})
        self.assertEqual(stats["risk_level"], "low")
        self.assertEqual(stats["message"], "Good Customer - High Success Rate")

    def test_absent_grading_fields_are_simply_omitted(self):
        stats = self._run({"customer": {"successful_delivery": 5, "total_delivery": 5}})
        self.assertNotIn("risk_level", stats)
        self.assertNotIn("message", stats)
        self.assertEqual(stats["rating"], "")     # key always present, value blank

    def test_counts_and_a_rating_can_arrive_together(self):
        stats = self._run({"customer": {"successful_delivery": 8, "total_delivery": 10},
                           "customer_rating": "good_customer", "risk_level": "low"})
        self.assertTrue(stats["counts_available"])
        self.assertEqual(stats["success_ratio"], 80.0)
        self.assertEqual(stats["rating"], "good_customer")
        self.assertEqual(stats["risk_level"], "low")

    def test_missing_credentials_report_an_error_not_a_clean_zero(self):
        with override_settings(COURIER={**CREDS, "PATHAO_FRAUD_USER": ""}):
            stats = fraud_check.pathao_stats("01711010782")
        self.assertIn("error", stats)
        self.assertFalse(stats["counts_available"])


@override_settings(COURIER=CREDS)
class AggregateTests(TestCase):
    # check_phone caches per phone number, and the cache outlives a test method.
    # Without this, the first case here would answer for all of them.
    def setUp(self):
        cache.clear()

    RATING_ONLY = {"success": 0, "cancel": 0, "total": 0, "success_ratio": 0.0,
                   "counts_available": False, "rating": "excellent_customer"}

    def _check(self, steadfast, pathao):
        with patch("app.services.fraud_check.steadfast_stats", return_value=steadfast), \
             patch("app.services.fraud_check.pathao_stats", return_value=pathao):
            return fraud_check.check_phone("01711010782")

    def test_a_courier_without_counts_does_not_dilute_the_ratio(self):
        steadfast = {"success": 177, "cancel": 1, "total": 178,
                     "success_ratio": 99.44, "counts_available": True}
        result = self._check(steadfast, self.RATING_ONLY)
        self.assertEqual(result["aggregate"]["total_success"], 177)
        self.assertEqual(result["aggregate"]["total"], 178)
        self.assertEqual(result["aggregate"]["success_ratio"], 99.44)
        self.assertFalse(result["advance_required"])

    def test_no_counts_anywhere_still_defaults_to_advance(self):
        result = self._check(fraud_check._empty_stats("down"), self.RATING_ONLY)
        self.assertEqual(result["aggregate"]["total"], 0)
        self.assertTrue(result["advance_required"])

    def test_bad_record_requires_advance(self):
        steadfast = {"success": 2, "cancel": 8, "total": 10,
                     "success_ratio": 20.0, "counts_available": True}
        self.assertTrue(self._check(steadfast, self.RATING_ONLY)["advance_required"])

    def test_invalid_number_short_circuits(self):
        result = fraud_check.check_phone("12345")
        self.assertTrue(result["advance_required"])
        self.assertIn("error", result)
