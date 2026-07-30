"""Aggregate one day of raw analytics into the permanent Daily*Stat rollups.

There is no job queue on shared hosting, so this runs from a nightly cPanel cron
(just after midnight Asia/Dhaka). It is fully idempotent — re-running a day
overwrites that day's rows — so a missed night is fixed by:

    manage.py rollup_analytics --days 7

The rollups are what the dashboard reads for anything older than today, which is
why the raw AnalyticsEvent table can be purged aggressively.
"""
from datetime import timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db.models import Count, Q, Sum
from django.utils import timezone

from app.models import (
    AnalyticsEvent, CartItem, DailyComboStat, DailyFunnelStat, DailyPageStat,
    DailySourceStat, DailyStat, Order, VisitorSession,
)


class Command(BaseCommand):
    help = "Roll raw analytics events up into the permanent daily stat tables."

    def add_arguments(self, parser):
        parser.add_argument("--date", help="YYYY-MM-DD (default: yesterday)")
        parser.add_argument("--days", type=int, default=1,
                            help="How many days back to (re)build, ending at --date")

    def handle(self, *args, **options):
        if options.get("date"):
            from datetime import date as _date
            end = _date.fromisoformat(options["date"])
        else:
            end = timezone.localdate() - timedelta(days=1)

        for offset in range(options["days"]):
            day = end - timedelta(days=offset)
            self.rollup(day)
            self.stdout.write(f"Rolled up {day}.")

    # ------------------------------------------------------------------ #

    def rollup(self, day):
        self._sessions(day)
        self._pages(day)
        self._combos(day)
        self._sources(day)
        self._funnel(day)

    def _sessions(self, day):
        sessions = VisitorSession.objects.filter(started_at__date=day)
        agg = sessions.aggregate(
            total=Count("id"),
            new=Count("id", filter=Q(is_new_visitor=True)),
            bounced=Count("id", filter=Q(pageviews__lte=1)),
        )
        seconds = sum(s.seconds for s in sessions.only("started_at", "last_seen"))
        pageviews = AnalyticsEvent.objects.filter(ts__date=day, name="pageview").count()
        visitors = sessions.values("visitor_id").distinct().count()

        stat, _ = DailyStat.objects.get_or_create(date=day)
        stat.sessions = agg["total"] or 0
        stat.new_visitors = agg["new"] or 0
        stat.bounced_sessions = agg["bounced"] or 0
        stat.total_seconds = seconds
        stat.pageviews = pageviews
        # The nudge endpoint bumps `visitors` live for legacy reasons; once real
        # sessions exist they are the better number, so prefer them.
        if visitors:
            stat.visitors = visitors
        stat.save()

    def _pages(self, day):
        DailyPageStat.objects.filter(date=day).delete()
        views = (
            AnalyticsEvent.objects.filter(ts__date=day, name="pageview")
            .values("path")
            .annotate(views=Count("id"), sessions=Count("session_id", distinct=True))
        )
        rows = {
            r["path"]: DailyPageStat(
                date=day, path=r["path"], views=r["views"], sessions=r["sessions"],
            )
            for r in views if r["path"]
        }

        sessions = VisitorSession.objects.filter(started_at__date=day)
        for field, attr in (("entry_path", "entries"), ("exit_path", "exits")):
            counts = (sessions.exclude(**{field: ""})
                      .values(field).annotate(n=Count("id")))
            for row in counts:
                path = row[field]
                if path not in rows:
                    rows[path] = DailyPageStat(date=day, path=path)
                setattr(rows[path], attr, row["n"])

        DailyPageStat.objects.bulk_create(rows.values())

    def _combos(self, day):
        """Views/carts from events; orders + revenue joined from real Orders, so
        the conversion column can't be inflated by a client."""
        DailyComboStat.objects.filter(date=day).delete()
        rows = {}

        events = (
            AnalyticsEvent.objects.filter(ts__date=day, combo__isnull=False)
            .values("combo_id")
            .annotate(
                views=Count("id", filter=Q(name__in=["view_combo", "view_product"])),
                carts=Count("id", filter=Q(name="add_to_cart")),
            )
        )
        for r in events:
            rows[r["combo_id"]] = DailyComboStat(
                date=day, combo_id=r["combo_id"], views=r["views"], carts=r["carts"],
            )

        sold = (
            CartItem.objects
            .filter(order__created_at__date=day, combo__isnull=False)
            .exclude(order__status=Order.Status.CANCELLED)
            .values("combo_id")
            .annotate(orders=Count("order_id", distinct=True), revenue=Sum("price_snapshot"))
        )
        for r in sold:
            row = rows.get(r["combo_id"]) or DailyComboStat(date=day, combo_id=r["combo_id"])
            row.orders = r["orders"]
            row.revenue = r["revenue"] or Decimal("0")
            rows[r["combo_id"]] = row

        DailyComboStat.objects.bulk_create(rows.values())

    def _sources(self, day):
        DailySourceStat.objects.filter(date=day).delete()
        counts = (
            VisitorSession.objects.filter(started_at__date=day)
            .values("source")
            .annotate(sessions=Count("id"), orders=Count("id", filter=Q(converted=True)))
        )
        DailySourceStat.objects.bulk_create([
            DailySourceStat(date=day, source=r["source"] or "direct",
                            sessions=r["sessions"], orders=r["orders"])
            for r in counts
        ])

    def _funnel(self, day):
        """Sessions (not events) reaching each step — one person viewing a listing
        ten times is still one session in the funnel."""
        DailyFunnelStat.objects.filter(date=day).delete()
        rows = []
        for step in DailyFunnelStat.STEPS:
            n = (AnalyticsEvent.objects
                 .filter(ts__date=day, name=step)
                 .values("session_id").distinct().count())
            rows.append(DailyFunnelStat(date=day, step=step, sessions=n))
        DailyFunnelStat.objects.bulk_create(rows)
