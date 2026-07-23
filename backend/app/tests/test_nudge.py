from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APITestCase

from app.models import DailyStat


class DailyStatModelTests(TestCase):
    def test_defaults_and_uniqueness(self):
        d = timezone.localdate()
        s = DailyStat.objects.create(date=d)
        self.assertEqual((s.visitors, s.popups_shown, s.popups_clicked), (0, 0, 0))
        from django.db import IntegrityError, transaction
        with self.assertRaises(IntegrityError), transaction.atomic():
            DailyStat.objects.create(date=d)


class NudgeEventApiTests(APITestCase):
    def _post(self, t):
        return self.client.post("/api/nudge-event/", {"type": t}, format="json")

    def test_each_type_increments_one_counter(self):
        for t in ["visit", "shown", "clicked", "visit"]:
            self.assertEqual(self._post(t).status_code, 200)
        d = DailyStat.objects.get()          # single row for today
        self.assertEqual(d.visitors, 2)
        self.assertEqual(d.popups_shown, 1)
        self.assertEqual(d.popups_clicked, 1)

    def test_unknown_type_400(self):
        self.assertEqual(self._post("wat").status_code, 400)
        self.assertFalse(DailyStat.objects.exists())


class DashboardStatsTests(APITestCase):
    def setUp(self):
        self.client.force_authenticate(User.objects.create_user("admin", password="x", is_staff=True))

    def test_dashboard_returns_today_counters(self):
        DailyStat.objects.create(date=timezone.localdate(), visitors=5, popups_shown=2, popups_clicked=1)
        r = self.client.get("/api/admin/dashboard/")
        self.assertEqual(r.json()["visitors_today"], 5)
        self.assertEqual(r.json()["popups_shown_today"], 2)
        self.assertEqual(r.json()["popups_clicked_today"], 1)

    def test_dashboard_zeros_when_no_row(self):
        r = self.client.get("/api/admin/dashboard/")
        self.assertEqual(r.json()["visitors_today"], 0)
