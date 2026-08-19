"""Self-hosted analytics: collector, presence, rollups, purge.

The collector is public and unauthenticated, so most of these are hostile-input
tests — it must never 400, never store an unknown event name, and never let a
client dictate how much it writes.
"""
from datetime import timedelta
from decimal import Decimal

from django.contrib.auth.models import User
from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APITestCase

from app.models import (
    AnalyticsEvent, CartItem, DailyComboStat, DailyFunnelStat, DailyPageStat,
    DailySourceStat, DailyStat, GalleryTag, Order, PrebuiltCombo, VisitorSession,
)
from app.services import analytics

URL = "/api/t/"


def _batch(**kw):
    body = {"v": "vis1", "s": "sess1", "e": [{"n": "pageview", "p": "/products"}]}
    body.update(kw)
    return body


class CollectorTests(APITestCase):
    def setUp(self):
        cache.clear()

    def post(self, body):
        return self.client.post(URL, body, format="json")

    def test_stores_a_pageview_and_opens_a_session(self):
        self.assertEqual(self.post(_batch()).status_code, 204)
        ev = AnalyticsEvent.objects.get()
        self.assertEqual((ev.name, ev.path), ("pageview", "/products"))
        s = VisitorSession.objects.get(session_id="sess1")
        self.assertEqual((s.pageviews, s.entry_path, s.current_path),
                         (1, "/products", "/products"))

    def test_unknown_event_name_is_dropped_not_rejected(self):
        res = self.post(_batch(e=[{"n": "evil", "p": "/"}, {"n": "pageview", "p": "/"}]))
        self.assertEqual(res.status_code, 204)
        self.assertEqual([e.name for e in AnalyticsEvent.objects.all()], ["pageview"])

    def test_ping_touches_the_session_without_writing_a_row(self):
        self.post(_batch(e=[{"n": "ping", "p": "/cart"}]))
        self.assertEqual(AnalyticsEvent.objects.count(), 0)
        s = VisitorSession.objects.get()
        self.assertEqual(s.current_path, "/cart")

    def test_garbage_body_is_swallowed(self):
        for body in [{}, {"v": "x"}, {"v": "x", "s": "y", "e": "nope"},
                     {"v": "x", "s": "y", "e": [None, 5, "str"]}]:
            self.assertEqual(self.client.post(URL, body, format="json").status_code, 204)
        self.assertEqual(AnalyticsEvent.objects.count(), 0)

    def test_batch_is_capped(self):
        many = [{"n": "pageview", "p": "/"} for _ in range(analytics.MAX_EVENTS_PER_BATCH + 40)]
        self.post(_batch(e=many))
        self.assertEqual(AnalyticsEvent.objects.count(), analytics.MAX_EVENTS_PER_BATCH)

    def test_props_are_trimmed(self):
        self.post(_batch(e=[{"n": "search", "p": "/products",
                             "x": {"q": "x" * 500, **{f"k{i}": i for i in range(20)}}}]))
        props = AnalyticsEvent.objects.get().props
        self.assertLessEqual(len(props), analytics.MAX_PROPS)
        self.assertLessEqual(len(props["q"]), analytics.MAX_PROP_CHARS)

    def test_query_string_is_stripped_and_dynamic_paths_collapse(self):
        self.post(_batch(e=[
            {"n": "pageview", "p": "/products?q=secret&page=2"},
            {"n": "pageview", "p": "/track/AB12CD"},
        ]))
        self.assertEqual(
            sorted(e.path for e in AnalyticsEvent.objects.all()),
            ["/products", "/track/:uid"],
        )

    def test_real_listing_and_gallery_slugs_are_kept(self):
        """The owner needs to know WHICH listing was read, and the catalogue is a
        small admin-made set, so a slug that exists survives normalisation."""
        combo = PrebuiltCombo.objects.create(name="কম্বো", slug="c1", price=1)
        tag = GalleryTag.objects.create(title="ছবি", slug="chobi")
        cache.clear()   # the known-slug set is cached
        self.post(_batch(e=[
            {"n": "pageview", "p": f"/combo/{combo.slug}"},
            {"n": "pageview", "p": f"/gallery/{tag.slug}"},
        ]))
        self.assertEqual(
            sorted(e.path for e in AnalyticsEvent.objects.all()),
            ["/combo/c1", "/gallery/chobi"],
        )

    def test_unknown_slugs_still_collapse(self):
        """A bot walking /combo/<random> must not explode the page-table cardinality."""
        cache.clear()
        self.post(_batch(e=[
            {"n": "pageview", "p": "/combo/does-not-exist"},
            {"n": "pageview", "p": "/gallery/nope"},
        ]))
        self.assertEqual(
            sorted(e.path for e in AnalyticsEvent.objects.all()),
            ["/combo/:slug", "/gallery/:slug"],
        )

    def test_rate_limit_stops_a_flood(self):
        for _ in range(analytics.RATE_LIMIT_PER_MIN + 10):
            self.post(_batch())
        self.assertEqual(AnalyticsEvent.objects.count(), analytics.RATE_LIMIT_PER_MIN)

    def test_source_and_device_are_derived_server_side(self):
        self.post(_batch(r="https://m.facebook.com/x", **{"f": 0}))
        self.assertEqual(VisitorSession.objects.get().source, "facebook")
        self.client.post(URL, _batch(v="v2", s="s2", f=1), format="json",
                         HTTP_USER_AGENT="Mozilla/5.0 (Linux; Android 10)")
        s2 = VisitorSession.objects.get(session_id="s2")
        self.assertEqual((s2.source, s2.device), ("facebook-ad", "mobile"))

    def test_accepts_a_sendbeacon_body(self):
        """navigator.sendBeacon posts JSON as text/plain to dodge a CORS preflight."""
        import json
        res = self.client.post(URL, json.dumps(_batch()),
                               content_type="text/plain;charset=UTF-8")
        self.assertEqual(res.status_code, 204)
        self.assertEqual(AnalyticsEvent.objects.count(), 1)

    def test_purchase_marks_the_session_converted(self):
        self.post(_batch(e=[{"n": "purchase", "p": "/track/XX1234", "v": "1780.50"}]))
        self.assertTrue(VisitorSession.objects.get().converted)
        self.assertEqual(AnalyticsEvent.objects.get().value, Decimal("1780.50"))


class PresenceTests(TestCase):
    def setUp(self):
        cache.clear()

    def test_counts_only_the_recent_window_and_dedupes_visitors(self):
        now = timezone.now()
        VisitorSession.objects.create(session_id="a", visitor_id="v1",
                                      last_seen=now, current_path="/products")
        VisitorSession.objects.create(session_id="b", visitor_id="v1",   # same person
                                      last_seen=now, current_path="/products")
        VisitorSession.objects.create(session_id="c", visitor_id="v2",
                                      last_seen=now, current_path="/products")
        VisitorSession.objects.create(session_id="d", visitor_id="v3",
                                      last_seen=now, current_path="/checkout")
        VisitorSession.objects.create(session_id="e", visitor_id="v4",   # long gone
                                      last_seen=now - timedelta(hours=2))
        data = analytics.presence(use_cache=False)
        self.assertEqual(data["active"], 3)          # v1 counted once despite 2 sessions
        self.assertEqual(data["in_checkout"], 1)
        # 2 distinct people on /products, 1 on /checkout.
        self.assertEqual(data["by_path"][0], {"path": "/products", "count": 2})

    def test_pathless_sessions_merge_into_root(self):
        """A session exists before its first pageview (new-visitor beacon), so a
        blank current_path must not render as a second '/' row."""
        now = timezone.now()
        VisitorSession.objects.create(session_id="a", visitor_id="v1",
                                      last_seen=now, current_path="/")
        VisitorSession.objects.create(session_id="b", visitor_id="v2",
                                      last_seen=now, current_path="")
        data = analytics.presence(use_cache=False)
        self.assertEqual(data["by_path"], [{"path": "/", "count": 2}])


class RollupTests(TestCase):
    def setUp(self):
        self.day = timezone.localdate() - timedelta(days=1)
        self.when = timezone.make_aware(
            timezone.datetime.combine(self.day, timezone.datetime.min.time()).replace(hour=12)
        )
        self.combo = PrebuiltCombo.objects.create(name="Combo A", slug="combo-a",
                                                  price=Decimal("1700"))

    def _session(self, sid, vid, pageviews=2, **kw):
        return VisitorSession.objects.create(
            session_id=sid, visitor_id=vid, started_at=self.when, last_seen=self.when,
            pageviews=pageviews, entry_path=kw.pop("entry", "/"),
            exit_path=kw.pop("exit", "/cart"), source=kw.pop("source", "facebook"), **kw,
        )

    def _event(self, name, **kw):
        return AnalyticsEvent.objects.create(
            ts=self.when, session_id=kw.pop("sid", "s1"), visitor_id=kw.pop("vid", "v1"),
            name=name, path=kw.pop("path", "/"), **kw,
        )

    def test_daily_stat_and_bounce(self):
        self._session("s1", "v1", pageviews=3)
        self._session("s2", "v2", pageviews=1)          # bounce
        self._event("pageview"), self._event("pageview", sid="s2")
        call_command("rollup_analytics", "--date", self.day.isoformat())
        stat = DailyStat.objects.get(date=self.day)
        self.assertEqual((stat.sessions, stat.visitors, stat.pageviews), (2, 2, 2))
        self.assertEqual(stat.bounced_sessions, 1)
        self.assertEqual(stat.bounce_rate, 50)

    def test_page_entries_and_exits(self):
        self._session("s1", "v1", entry="/", exit="/cart")
        self._event("pageview", path="/products")
        self._event("pageview", path="/products", sid="s2")
        call_command("rollup_analytics", "--date", self.day.isoformat())
        page = DailyPageStat.objects.get(date=self.day, path="/products")
        self.assertEqual((page.views, page.sessions), (2, 2))
        self.assertEqual(DailyPageStat.objects.get(date=self.day, path="/cart").exits, 1)

    def test_combo_views_and_real_orders_join(self):
        self._event("view_combo", combo=self.combo)
        self._event("view_combo", combo=self.combo, sid="s2")
        self._event("add_to_cart", combo=self.combo)
        order = Order.objects.create(customer_name="c", phone="017",
                                     subtotal=Decimal("1700"), status=Order.Status.CONFIRMED)
        Order.objects.filter(pk=order.pk).update(created_at=self.when)
        CartItem.objects.create(order=order, session_key="k", combo=self.combo,
                                price_snapshot=Decimal("1700"))
        call_command("rollup_analytics", "--date", self.day.isoformat())
        row = DailyComboStat.objects.get(date=self.day, combo=self.combo)
        self.assertEqual((row.views, row.carts, row.orders), (2, 1, 1))
        self.assertEqual(row.revenue, Decimal("1700"))

    def test_cancelled_orders_do_not_count_as_conversions(self):
        order = Order.objects.create(customer_name="c", phone="017",
                                     subtotal=Decimal("1700"), status=Order.Status.CANCELLED)
        Order.objects.filter(pk=order.pk).update(created_at=self.when)
        CartItem.objects.create(order=order, session_key="k", combo=self.combo,
                                price_snapshot=Decimal("1700"))
        call_command("rollup_analytics", "--date", self.day.isoformat())
        self.assertFalse(DailyComboStat.objects.filter(date=self.day).exists())

    def test_funnel_counts_sessions_not_events(self):
        for _ in range(5):
            self._event("view_combo", combo=self.combo)   # same session, 5 times
        self._event("add_to_cart", sid="s2")
        call_command("rollup_analytics", "--date", self.day.isoformat())
        steps = {f.step: f.sessions for f in DailyFunnelStat.objects.filter(date=self.day)}
        self.assertEqual(steps["view_combo"], 1)
        self.assertEqual(steps["add_to_cart"], 1)
        self.assertEqual(steps["purchase"], 0)

    def test_sources_rolled_up(self):
        self._session("s1", "v1", source="facebook-ad", converted=True)
        self._session("s2", "v2", source="facebook-ad")
        call_command("rollup_analytics", "--date", self.day.isoformat())
        row = DailySourceStat.objects.get(date=self.day, source="facebook-ad")
        self.assertEqual((row.sessions, row.orders), (2, 1))

    def test_rollup_is_idempotent(self):
        self._session("s1", "v1")
        self._event("pageview", path="/products")
        for _ in range(3):
            call_command("rollup_analytics", "--date", self.day.isoformat())
        self.assertEqual(DailyPageStat.objects.filter(date=self.day, path="/products").count(), 1)
        self.assertEqual(DailyStat.objects.filter(date=self.day).count(), 1)


class PurgeTests(TestCase):
    def test_purge_keeps_rollups_and_recent_rows(self):
        old = timezone.now() - timedelta(days=200)
        AnalyticsEvent.objects.create(ts=old, session_id="s", visitor_id="v", name="pageview")
        AnalyticsEvent.objects.create(session_id="s2", visitor_id="v2", name="pageview")
        VisitorSession.objects.create(session_id="s", visitor_id="v", last_seen=old)
        DailyStat.objects.create(date=old.date(), visitors=99)

        call_command("purge_analytics", "--days", "90")
        self.assertEqual(AnalyticsEvent.objects.count(), 1)
        self.assertEqual(VisitorSession.objects.count(), 0)
        self.assertTrue(DailyStat.objects.filter(visitors=99).exists())   # history survives

    def test_dry_run_deletes_nothing(self):
        old = timezone.now() - timedelta(days=200)
        AnalyticsEvent.objects.create(ts=old, session_id="s", visitor_id="v", name="pageview")
        call_command("purge_analytics", "--days", "90", "--dry-run")
        self.assertEqual(AnalyticsEvent.objects.count(), 1)


class AdminAnalyticsApiTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.client.force_authenticate(
            User.objects.create_superuser("admin", password="x")
        )

    def test_endpoints_require_admin(self):
        self.client.force_authenticate(None)
        for url in ["/api/admin/analytics/live/", "/api/admin/analytics/overview/"]:
            self.assertIn(self.client.get(url).status_code, (401, 403))

    def test_live_returns_presence(self):
        VisitorSession.objects.create(session_id="s", visitor_id="v", current_path="/cart")
        data = self.client.get("/api/admin/analytics/live/").data
        self.assertEqual(data["active"], 1)
        self.assertEqual(data["in_cart"], 1)

    def test_overview_shape_on_an_empty_install(self):
        data = self.client.get("/api/admin/analytics/overview/?days=7").data
        self.assertEqual(data["days"], 7)
        self.assertEqual(len(data["trend"]), 7)
        for key in ["today", "live", "top_pages", "top_combos", "sources",
                    "funnel", "empty_searches", "devices"]:
            self.assertIn(key, data)

    def test_overview_clamps_days(self):
        self.assertEqual(self.client.get("/api/admin/analytics/overview/?days=999").data["days"], 90)
        self.assertEqual(self.client.get("/api/admin/analytics/overview/?days=x").data["days"], 7)

    def test_top_pages_are_labelled_with_the_listing_name(self):
        """Bengali names slugify to empty, so combo slugs are auto-generated
        (combo-7) — the path alone tells the owner nothing."""
        combo = PrebuiltCombo.objects.create(name="প্রিমিয়াম কম্বো", slug="combo-7", price=1)
        tag = GalleryTag.objects.create(title="বিয়ের ছবি", slug="biye")
        today = timezone.localdate()
        DailyPageStat.objects.create(date=today, path=f"/combo/{combo.slug}", views=9)
        DailyPageStat.objects.create(date=today, path=f"/gallery/{tag.slug}", views=5)
        DailyPageStat.objects.create(date=today, path="/products", views=3)
        DailyPageStat.objects.create(date=today, path="/combo/:slug", views=2)

        rows = {r["path"]: r["label"] for r in
                self.client.get("/api/admin/analytics/overview/").data["top_pages"]}
        self.assertEqual(rows["/combo/combo-7"], "প্রিমিয়াম কম্বো")
        self.assertEqual(rows["/gallery/biye"], "বিয়ের ছবি")
        self.assertEqual(rows["/products"], "")
        self.assertEqual(rows["/combo/:slug"], "")   # collapsed placeholder, nothing to name

    def test_empty_searches_are_ranked(self):
        for term in ["পাঞ্জাবি", "পাঞ্জাবি", "ঘড়ি"]:
            AnalyticsEvent.objects.create(session_id="s", visitor_id="v",
                                          name="search_empty", props={"q": term})
        data = self.client.get("/api/admin/analytics/overview/").data
        self.assertEqual(data["empty_searches"][0], {"term": "পাঞ্জাবি", "count": 2})


class CacheOutageTests(APITestCase):
    """A dead or full cache must never take the analytics page down with it.

    Redis here is 128MB with eviction and shared with sessions, so a key can
    vanish and the server can refuse a connection outright. Everything cached in
    this app is recomputable, so an outage is a slow page — never a 500. This is
    the same rule services/cache.py already follows; the analytics module used to
    call `cache` directly, which made this one screen the exception.
    """

    def setUp(self):
        self.client.force_authenticate(
            User.objects.create_superuser("admin", password="x"))
        cache.clear()

    @staticmethod
    def _dead_cache():
        from unittest.mock import patch

        def boom(*a, **k):
            raise RuntimeError("redis down")

        return patch.multiple("django.core.cache.cache", get=boom, set=boom)

    def test_the_live_card_still_answers_without_a_cache(self):
        VisitorSession.objects.create(session_id="s1", visitor_id="v1",
                                      last_seen=timezone.now(), current_path="/cart")
        with self._dead_cache():
            resp = self.client.get("/api/admin/analytics/live/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["active"], 1)

    def test_the_overview_still_answers_without_a_cache(self):
        with self._dead_cache():
            resp = self.client.get("/api/admin/analytics/overview/?days=7")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("trend", resp.data)

    def test_collection_still_accepts_events_without_a_cache(self):
        # The rate-limit check reads the cache; failing it open beats refusing
        # real traffic, since the limit only exists to cap a flood.
        self.client.force_authenticate(None)
        with self._dead_cache():
            resp = self.client.post(URL, {
                "v": "v9", "s": "s9", "e": [{"n": "pageview", "p": "/"}],
            }, format="json")
        self.assertEqual(resp.status_code, 204)
        self.assertTrue(AnalyticsEvent.objects.filter(visitor_id="v9").exists())


class TodayTotalsTests(TestCase):
    """Today's headline numbers are computed live on every dashboard load, so
    they must not scale with how busy today was."""

    def setUp(self):
        from django.test.utils import CaptureQueriesContext  # noqa: F401
        self.now = timezone.now()
        for i in range(6):
            VisitorSession.objects.create(
                session_id=f"s{i}", visitor_id=f"v{i}",
                started_at=self.now - timedelta(seconds=100),
                last_seen=self.now, pageviews=3,
            )

    def test_time_on_site_is_summed_by_the_database(self):
        from django.db import connection
        from django.test.utils import CaptureQueriesContext

        with CaptureQueriesContext(connection) as ctx:
            totals = analytics.today_totals()

        self.assertEqual(totals["sessions"], 6)
        self.assertEqual(totals["avg_seconds"], 100)
        # One aggregate + one pageview count. Never one row per session.
        self.assertEqual(len(ctx.captured_queries), 2)

    def test_an_empty_day_reports_zero_rather_than_dividing_by_it(self):
        VisitorSession.objects.all().delete()
        totals = analytics.today_totals()
        self.assertEqual(totals["sessions"], 0)
        self.assertEqual(totals["avg_seconds"], 0)
        self.assertEqual(totals["bounce_rate"], 0)
