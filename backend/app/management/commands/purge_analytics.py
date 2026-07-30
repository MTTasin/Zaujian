"""Delete raw analytics rows past their retention window.

The Daily*Stat rollups are permanent; only the raw event/session tables are
purged, so history survives while the fast-growing tables stay bounded.
Run daily from cron, after `rollup_analytics` (otherwise a day could be deleted
before it was ever aggregated).
"""
from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone

from app.models import AnalyticsEvent, VisitorSession

DEFAULT_RETENTION_DAYS = 90


class Command(BaseCommand):
    help = "Delete raw analytics events/sessions older than the retention window."

    def add_arguments(self, parser):
        parser.add_argument(
            "--days", type=int,
            default=getattr(settings, "ANALYTICS_RETENTION_DAYS", DEFAULT_RETENTION_DAYS),
            help=f"Retention window in days (default {DEFAULT_RETENTION_DAYS}).",
        )
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **options):
        days = options["days"]
        cutoff = timezone.now() - timedelta(days=days)
        events = AnalyticsEvent.objects.filter(ts__lt=cutoff)
        sessions = VisitorSession.objects.filter(last_seen__lt=cutoff)

        if options["dry_run"]:
            self.stdout.write(
                f"[dry-run] would delete {events.count()} event(s) and "
                f"{sessions.count()} session(s) older than {days} days."
            )
            return

        # .delete() on a huge queryset loads pks; chunk it so a long-neglected
        # install doesn't blow memory on a shared host.
        deleted_events = self._chunked_delete(events)
        deleted_sessions = self._chunked_delete(sessions)
        self.stdout.write(
            f"Purged {deleted_events} event(s) and {deleted_sessions} session(s) "
            f"older than {days} days."
        )

    @staticmethod
    def _chunked_delete(qs, chunk=5000):
        total = 0
        while True:
            pks = list(qs.values_list("pk", flat=True)[:chunk])
            if not pks:
                return total
            total += qs.model.objects.filter(pk__in=pks).delete()[0]
