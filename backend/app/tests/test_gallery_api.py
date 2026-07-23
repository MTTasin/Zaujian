import io

from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image
from rest_framework.test import APITestCase

from app.models import GalleryPhoto, GalleryTag


def _img():
    buf = io.BytesIO()
    Image.new("RGB", (800, 800), (90, 42, 78)).save(buf, format="JPEG")
    buf.seek(0)
    return SimpleUploadedFile("p.jpg", buf.read(), content_type="image/jpeg")


class GalleryApiTests(APITestCase):
    def setUp(self):
        self.p = GalleryPhoto.objects.create(image=_img())
        self.tag = GalleryTag.objects.create(title="Box", slug="box")
        self.tag.photos.add(self.p)
        GalleryTag.objects.create(title="Hidden", slug="hidden", active=False)

    def test_index_lists_active_only(self):
        r = self.client.get("/api/gallery/")
        self.assertEqual(r.status_code, 200)
        slugs = [t["slug"] for t in r.json()]
        self.assertIn("box", slugs)
        self.assertNotIn("hidden", slugs)
        self.assertEqual(r.json()[0]["count"], 1)

    def test_detail_returns_photos(self):
        r = self.client.get("/api/gallery/box/")
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertEqual(data["title"], "Box")
        self.assertEqual(len(data["photos"]), 1)
        self.assertTrue(data["photos"][0]["thumb"])
        self.assertTrue(data["photos"][0]["full"])

    def test_inactive_detail_404(self):
        self.assertEqual(self.client.get("/api/gallery/hidden/").status_code, 404)
