import io

from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image
from rest_framework.test import APITestCase

from app.models import GalleryPhoto, GalleryTag


def _img(name="p.jpg"):
    buf = io.BytesIO()
    Image.new("RGB", (600, 600), (90, 42, 78)).save(buf, format="JPEG")
    buf.seek(0)
    return SimpleUploadedFile(name, buf.read(), content_type="image/jpeg")


class AdminGalleryTests(APITestCase):
    def setUp(self):
        u = User.objects.create_user("admin", password="x", is_staff=True)
        self.client.force_authenticate(u)

    def test_bulk_upload_creates_photos(self):
        r = self.client.post(
            "/api/admin/gallery-photos/",
            {"images": [_img("a.jpg"), _img("b.jpg")]},
            format="multipart",
        )
        self.assertEqual(r.status_code, 201)
        self.assertEqual(len(r.json()["created"]), 2)
        self.assertEqual(GalleryPhoto.objects.count(), 2)

    def test_bulk_upload_reports_bad_file(self):
        bad = SimpleUploadedFile("x.txt", b"nope", content_type="text/plain")
        r = self.client.post(
            "/api/admin/gallery-photos/",
            {"images": [_img("ok.jpg"), bad]},
            format="multipart",
        )
        self.assertEqual(len(r.json()["created"]), 1)
        self.assertEqual(len(r.json()["errors"]), 1)

    def test_set_photos_replaces_membership(self):
        p1 = GalleryPhoto.objects.create(image=_img())
        p2 = GalleryPhoto.objects.create(image=_img())
        tag = GalleryTag.objects.create(title="Box")
        r = self.client.post(
            f"/api/admin/gallery-tags/{tag.id}/set_photos/",
            {"photo_ids": [p1.id, p2.id]}, format="json",
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(tag.photos.count(), 2)
        self.client.post(
            f"/api/admin/gallery-tags/{tag.id}/set_photos/",
            {"photo_ids": [p1.id]}, format="json",
        )
        self.assertEqual(tag.photos.count(), 1)

    def test_requires_admin(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get("/api/admin/gallery-photos/").status_code, 401)
