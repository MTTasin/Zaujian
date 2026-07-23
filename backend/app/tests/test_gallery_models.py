import io

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from PIL import Image

from app.models import GalleryPhoto, GalleryTag


def _img():
    buf = io.BytesIO()
    Image.new("RGB", (2000, 2000), (90, 42, 78)).save(buf, format="JPEG")
    buf.seek(0)
    return SimpleUploadedFile("p.jpg", buf.read(), content_type="image/jpeg")


class GalleryModelTests(TestCase):
    def test_photo_generates_derivatives(self):
        p = GalleryPhoto.objects.create(image=_img())
        self.assertTrue(p.display.name)
        self.assertTrue(p.thumbnail.name)
        self.assertEqual(max(Image.open(p.display).size), 1600)
        self.assertEqual(max(Image.open(p.thumbnail).size), 400)

    def test_tag_autoslug(self):
        t = GalleryTag.objects.create(title="Nikah Box")
        self.assertEqual(t.slug, "nikah-box")

    def test_single_bot_default(self):
        a = GalleryTag.objects.create(title="A", is_bot_default=True)
        b = GalleryTag.objects.create(title="B", is_bot_default=True)
        a.refresh_from_db()
        self.assertFalse(a.is_bot_default)
        self.assertTrue(GalleryTag.objects.get(pk=b.pk).is_bot_default)

    def test_photo_in_many_tags(self):
        p = GalleryPhoto.objects.create(image=_img())
        t1 = GalleryTag.objects.create(title="One")
        t2 = GalleryTag.objects.create(title="Two")
        p.tags.set([t1, t2])
        self.assertEqual(p.tags.count(), 2)
        self.assertEqual(t1.photos.count(), 1)
