"""Retry failed Meta CAPI events (run from cron every few minutes)."""

from django.core.management.base import BaseCommand

from app.models import CapiEvent
from app.services.capi import _deliver

MAX_ATTEMPTS = 5


class Command(BaseCommand):
    help = "Retry failed Meta CAPI events (attempts < MAX_ATTEMPTS)."

    def handle(self, *args, **options):
        qs = CapiEvent.objects.filter(
            status=CapiEvent.Status.FAILED, attempts__lt=MAX_ATTEMPTS
        )
        sent = failed = 0
        for ev in qs:
            _deliver(ev)
            if ev.status == CapiEvent.Status.SENT:
                sent += 1
            else:
                failed += 1
        self.stdout.write(self.style.SUCCESS(f"CAPI retry: {sent} sent, {failed} still failed."))
