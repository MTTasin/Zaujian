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
