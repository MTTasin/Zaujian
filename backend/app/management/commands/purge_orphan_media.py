"""Delete files in MEDIA_ROOT that no model row references.

Complements django-cleanup (which handles live replace/delete). This sweep
catches the pre-existing backlog and anything the live path misses
(e.g. bulk QuerySet.update()). No job queue on shared hosting -> run via cron.
"""
import os
from datetime import timedelta

from django.apps import apps
from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import models
from django.utils import timezone


class Command(BaseCommand):
    help = "Delete media files under MEDIA_ROOT that no DB row references."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run", action="store_true",
            help="List orphans without deleting anything.",
        )
        parser.add_argument(
            "--grace-hours", type=int, default=24,
            help="Skip files modified within this many hours (default 24).",
        )

    def _referenced_paths(self):
        """Every storage-relative file path referenced by any model file field."""
        referenced = set()
        for model in apps.get_models():
            file_fields = [
                f.name for f in model._meta.get_fields()
                if isinstance(f, models.FileField)
            ]
            if not file_fields:
                continue
            for values in model.objects.values_list(*file_fields):
                # values_list returns a tuple even for a single field.
                for name in values:
                    if name:
                        referenced.add(name.replace("\\", "/"))
        return referenced

    def handle(self, *args, **options):
        dry = options["dry_run"]
        cutoff = timezone.now() - timedelta(hours=options["grace_hours"])
        cutoff_ts = cutoff.timestamp()

        media_root = str(settings.MEDIA_ROOT)
        if not os.path.isdir(media_root):
            self.stdout.write("MEDIA_ROOT does not exist; nothing to do.")
            return

        referenced = self._referenced_paths()

        scanned = deleted = freed = 0
        for dirpath, _dirs, files in os.walk(media_root):
            for fname in files:
                full = os.path.join(dirpath, fname)
                scanned += 1
                rel = os.path.relpath(full, media_root).replace(os.sep, "/")
                if rel in referenced:
                    continue
                if os.path.getmtime(full) >= cutoff_ts:
                    continue  # within grace window
                size = os.path.getsize(full)
                if dry:
                    self.stdout.write(f"[dry-run] would delete {rel} ({size} bytes)")
                else:
                    os.remove(full)
                deleted += 1
                freed += size

        verb = "Would delete" if dry else "Deleted"
        self.stdout.write(
            f"Scanned {scanned} file(s). {verb} {deleted} orphan(s), "
            f"{freed} bytes."
        )
