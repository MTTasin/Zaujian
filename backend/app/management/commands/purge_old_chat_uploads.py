"""Delete chat image uploads older than 30 days (keeps message text).

No job queue on shared hosting -> run this daily via a cPanel cron job.
"""
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from app.models import ChatMessage

MAX_AGE_DAYS = 30


class Command(BaseCommand):
    help = "Delete chat image uploads older than 30 days (keeps message text)."

    def handle(self, *args, **options):
        cutoff = timezone.now() - timedelta(days=MAX_AGE_DAYS)
        stale = ChatMessage.objects.filter(created_at__lt=cutoff).exclude(upload="")
        count = 0
        for m in stale:
            if not m.upload:
                continue
            m.upload.delete(save=False)  # remove file from storage
            m.upload = None
            m.save(update_fields=["upload"])
            count += 1
        self.stdout.write(f"Purged {count} chat upload(s) older than {MAX_AGE_DAYS} days.")
