# Orphaned Media Auto-Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically delete media files from disk when their DB row is deleted or their image is replaced, and provide a sweep command to clean pre-existing orphans.

**Architecture:** Two parts. (1) `django-cleanup` auto-hooks every model file field to delete old files on replace/delete (deferred to transaction commit). (2) A `purge_orphan_media` management command scans `MEDIA_ROOT`, compares against every file path referenced in the DB, and deletes unreferenced files older than a grace window. Cron runs the sweep; django-cleanup handles the live path.

**Tech Stack:** Django 6 + DRF, Pillow, `django-cleanup`, local `FileSystemStorage`. Tests: Django `TestCase`.

## Global Constraints

- Money = `DecimalField`; this feature never touches DB rows, only disk files.
- No job queue — periodic work is a management command run via cPanel cron.
- Local `FileSystemStorage`; `MEDIA_ROOT = BASE_DIR / "media"`.
- Run backend from `backend/`. On this machine the interpreter is `../env/Scripts/python`.
- `django_cleanup.apps.CleanupConfig` MUST be the **last** entry in `INSTALLED_APPS`.
- No new migrations (no model changes).

---

### Task 1: Wire django-cleanup (live prevention) + integration test

**Files:**
- Modify: `backend/requirements.txt`
- Modify: `backend/backend/settings.py:40-53` (`INSTALLED_APPS`)
- Test: `backend/app/tests/test_orphan_cleanup_signals.py` (create)

**Interfaces:**
- Consumes: nothing (first task).
- Produces: django-cleanup active for all models — later tasks and the app rely on old files being removed on replace/delete. No new Python symbols.

**Note on transactions:** Django `TestCase` wraps each test in a transaction, so
`transaction.on_commit` callbacks (which is how django-cleanup defers deletes) do
NOT fire unless captured. Use `self.captureOnCommitCallbacks(execute=True)`.

- [ ] **Step 1: Write the failing test**

Create `backend/app/tests/test_orphan_cleanup_signals.py`:

```python
import io
import os
import tempfile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from PIL import Image

from app.models import Product, ProductImage

_MEDIA = tempfile.mkdtemp(prefix="test_media_")


def _img(name="p.jpg"):
    buf = io.BytesIO()
    Image.new("RGB", (50, 50), (2, 2, 2)).save(buf, format="JPEG")
    buf.seek(0)
    return SimpleUploadedFile(name, buf.read(), content_type="image/jpeg")


@override_settings(MEDIA_ROOT=_MEDIA)
class CleanupSignalTests(TestCase):
    def _product(self):
        return Product.objects.create(name="X", slug="x")

    def test_old_file_deleted_when_image_replaced(self):
        pi = ProductImage.objects.create(product=self._product(), image=_img("a.jpg"))
        old_path = pi.image.path
        self.assertTrue(os.path.exists(old_path))

        with self.captureOnCommitCallbacks(execute=True):
            pi.image = _img("b.jpg")
            pi.save()

        self.assertFalse(os.path.exists(old_path))   # old file removed
        self.assertTrue(os.path.exists(pi.image.path))  # new file present

    def test_file_deleted_when_row_deleted(self):
        pi = ProductImage.objects.create(product=self._product(), image=_img("c.jpg"))
        path = pi.image.path
        self.assertTrue(os.path.exists(path))

        with self.captureOnCommitCallbacks(execute=True):
            pi.delete()

        self.assertFalse(os.path.exists(path))
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `backend/`): `../env/Scripts/python manage.py test app.tests.test_orphan_cleanup_signals -v 2`
Expected: FAIL — old file still exists (django-cleanup not installed yet), assertion `assertFalse(os.path.exists(old_path))` fails.

- [ ] **Step 3: Add the dependency**

Add to `backend/requirements.txt` (append a line):

```
django-cleanup==9.0.0
```

Then install it into the venv (from `backend/`):

```bash
../env/Scripts/python -m pip install "django-cleanup==9.0.0"
```

If `manage.py check` (Step 5) reports a Django 6 incompatibility, upgrade to the
latest release instead: `../env/Scripts/python -m pip install -U django-cleanup`
and update the pin in `requirements.txt` to the installed version
(`../env/Scripts/python -m pip show django-cleanup` shows it).

- [ ] **Step 4: Register the app (last in INSTALLED_APPS)**

Modify `backend/backend/settings.py` — change the `# Local` block so cleanup is last:

```python
    # Local
    "app",
    # Must be LAST — hooks file fields on all apps above.
    "django_cleanup.apps.CleanupConfig",
]
```

- [ ] **Step 5: Run Django check + the test to verify pass**

Run (from `backend/`):
```bash
../env/Scripts/python manage.py check
../env/Scripts/python manage.py test app.tests.test_orphan_cleanup_signals -v 2
```
Expected: `check` reports no issues; both tests PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/requirements.txt backend/backend/settings.py backend/app/tests/test_orphan_cleanup_signals.py
git commit -m "feat: auto-delete old media on replace/delete via django-cleanup"
```

---

### Task 2: `purge_orphan_media` sweep command + tests

**Files:**
- Create: `backend/app/management/commands/purge_orphan_media.py`
- Test: `backend/app/tests/test_purge_orphan_media.py` (create)

**Interfaces:**
- Consumes: nothing from Task 1 at code level (independent); relies on Django's
  model registry and `MEDIA_ROOT`.
- Produces: management command `purge_orphan_media` with options `--dry-run`
  (bool) and `--grace-hours` (int, default 24). Deletes files under `MEDIA_ROOT`
  whose storage-relative path (forward slashes) is referenced by no model file
  field and whose mtime is older than the grace window.

- [ ] **Step 1: Write the failing test**

Create `backend/app/tests/test_purge_orphan_media.py`:

```python
import io
import os
import tempfile
import time

from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.test import TestCase, override_settings
from PIL import Image

from app.models import Product, ProductImage

_MEDIA = tempfile.mkdtemp(prefix="test_media_sweep_")


def _img(name="p.jpg"):
    buf = io.BytesIO()
    Image.new("RGB", (50, 50), (3, 3, 3)).save(buf, format="JPEG")
    buf.seek(0)
    return SimpleUploadedFile(name, buf.read(), content_type="image/jpeg")


def _write_orphan(relpath, age_hours):
    full = os.path.join(_MEDIA, relpath)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "wb") as f:
        f.write(b"orphan-bytes")
    old = time.time() - age_hours * 3600
    os.utime(full, (old, old))
    return full


@override_settings(MEDIA_ROOT=_MEDIA)
class PurgeOrphanMediaTests(TestCase):
    def _referenced_file(self):
        # A real, DB-referenced image whose file sits under MEDIA_ROOT.
        p = Product.objects.create(name="R", slug="r")
        pi = ProductImage.objects.create(product=p, image=_img("ref.jpg"))
        # Age it past the grace window so only "referenced" (not "recent") keeps it.
        path = pi.image.path
        old = time.time() - 48 * 3600
        os.utime(path, (old, old))
        return path

    def test_keeps_referenced_file(self):
        path = self._referenced_file()
        call_command("purge_orphan_media")
        self.assertTrue(os.path.exists(path))

    def test_deletes_old_orphan(self):
        orphan = _write_orphan("products/ghost.jpg", age_hours=48)
        call_command("purge_orphan_media")
        self.assertFalse(os.path.exists(orphan))

    def test_keeps_recent_orphan_within_grace(self):
        orphan = _write_orphan("products/fresh.jpg", age_hours=1)
        call_command("purge_orphan_media")  # default grace 24h
        self.assertTrue(os.path.exists(orphan))

    def test_dry_run_deletes_nothing(self):
        orphan = _write_orphan("products/ghost2.jpg", age_hours=48)
        call_command("purge_orphan_media", "--dry-run")
        self.assertTrue(os.path.exists(orphan))
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `backend/`): `../env/Scripts/python manage.py test app.tests.test_purge_orphan_media -v 2`
Expected: FAIL — `CommandError: Unknown command: 'purge_orphan_media'`.

- [ ] **Step 3: Write the command**

Create `backend/app/management/commands/purge_orphan_media.py`:

```python
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
```

- [ ] **Step 4: Run tests to verify pass**

Run (from `backend/`): `../env/Scripts/python manage.py test app.tests.test_purge_orphan_media -v 2`
Expected: all 4 tests PASS.

- [ ] **Step 5: Run the full backend test suite (no regressions)**

Run (from `backend/`): `../env/Scripts/python manage.py test -v 1`
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/management/commands/purge_orphan_media.py backend/app/tests/test_purge_orphan_media.py
git commit -m "feat: add purge_orphan_media sweep command"
```

---

### Task 3: Documentation + backlog cleanup note

**Files:**
- Modify: `DEPLOY.md` (cron section)
- Modify: `CLAUDE.md` (Deployment cron line + Notifications/conventions mention)

**Interfaces:**
- Consumes: `purge_orphan_media` command from Task 2.
- Produces: docs only.

- [ ] **Step 1: Document the cron + one-time backlog run in DEPLOY.md**

Find the cron section in `DEPLOY.md` (near `send_pending_capi` / `purge_old_chat_uploads`) and add:

```markdown
- `purge_orphan_media` — monthly. Deletes media files under MEDIA_ROOT that no
  DB row references (safety net for django-cleanup). Run once manually after the
  first deploy to clear the historical backlog; use `--dry-run` first to review:
  `python manage.py purge_orphan_media --dry-run`
  then `python manage.py purge_orphan_media`.
```

- [ ] **Step 2: Update CLAUDE.md**

In `CLAUDE.md`, update the Deployment cron line (currently mentions
`send_pending_capi` + `purge_old_chat_uploads`) to also list `purge_orphan_media`
(monthly, orphaned media). Add one line under Media/conventions noting that
django-cleanup deletes old files on replace/delete automatically.

- [ ] **Step 3: Commit**

```bash
git add DEPLOY.md CLAUDE.md
git commit -m "docs: document orphaned media cleanup (cron + django-cleanup)"
```

---

## Self-Review

**Spec coverage:**
- django-cleanup install + INSTALLED_APPS last → Task 1. ✓
- Live delete-on-replace + delete-on-row-delete verified → Task 1 tests. ✓
- `purge_orphan_media` referenced-set algorithm, mtime grace, dry-run, grace-hours → Task 2. ✓
- Tests for kept-referenced / delete-old-orphan / keep-recent / dry-run → Task 2. ✓
- No emptied-dir pruning (decided out) → command leaves dirs. ✓
- requirements/INSTALLED_APPS/cron/backlog docs → Tasks 1 & 3. ✓
- No migrations → confirmed (no model changes). ✓

**Placeholder scan:** none — all steps have concrete code/commands.

**Type consistency:** command options `--dry-run`/`--grace-hours`, `_referenced_paths()` returns `set[str]` of forward-slash relative paths; tests compare against `os.path.exists`. `FileField` `isinstance` covers `ImageField` (subclass). Consistent across tasks.
