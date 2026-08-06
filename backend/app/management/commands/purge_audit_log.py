"""Trim the admin audit trail. Cron (monthly is plenty).

The log is append-only and one row per admin write, so it grows slowly — but it
grows forever without this. Retention is `settings.AUDIT_RETENTION_DAYS`.
"""

from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone

from app.models import AdminAuditLog


class Command(BaseCommand):
    help = "Delete admin audit entries older than AUDIT_RETENTION_DAYS."

    def add_arguments(self, parser):
        parser.add_argument("--days", type=int, default=None,
                            help="Override the retention window.")
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **opts):
        days = opts["days"] or getattr(settings, "AUDIT_RETENTION_DAYS", 180)
        cutoff = timezone.now() - timezone.timedelta(days=days)
        qs = AdminAuditLog.objects.filter(created_at__lt=cutoff)
        count = qs.count()
        if opts["dry_run"]:
            self.stdout.write(f"[dry-run] would delete {count} audit entr(ies) older than {days} days.")
            return
        qs.delete()
        self.stdout.write(f"Purged {count} audit entr(ies) older than {days} days.")
