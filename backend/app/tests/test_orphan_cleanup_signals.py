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
