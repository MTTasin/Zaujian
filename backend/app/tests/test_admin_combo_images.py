import io
from decimal import Decimal

from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image
from rest_framework.test import APITestCase

from app.models import ComboImage, PrebuiltCombo


def _img():
    buf = io.BytesIO()
    Image.new("RGB", (40, 40), (9, 9, 9)).save(buf, format="JPEG")
    buf.seek(0)
    return SimpleUploadedFile("c.jpg", buf.read(), content_type="image/jpeg")


class AdminComboImageTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser("admin", "a@a.com", "pw")
        self.client.force_authenticate(self.admin)
        self.combo = PrebuiltCombo.objects.create(
            name="কম্বো", slug="c1", price=Decimal("1000"),
        )

    def test_upload_then_delete_combo_image(self):
        res = self.client.post(
            "/api/admin/combo-images/",
            {"combo": self.combo.id, "image": _img(), "order": 0},
            format="multipart",
        )
        self.assertEqual(res.status_code, 201, res.content)
        img_id = res.data["id"]
        self.assertTrue(ComboImage.objects.filter(pk=img_id).exists())

        res = self.client.delete(f"/api/admin/combo-images/{img_id}/")

        self.assertEqual(res.status_code, 204, res.content)
        self.assertFalse(ComboImage.objects.filter(pk=img_id).exists())

    def test_delete_missing_image_is_404(self):
        res = self.client.delete("/api/admin/combo-images/999999/")
        self.assertEqual(res.status_code, 404)
