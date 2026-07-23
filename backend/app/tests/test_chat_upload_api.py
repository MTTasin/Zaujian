import io

from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image
from rest_framework.test import APITestCase

from app.models import ChatSession


def _img():
    buf = io.BytesIO()
    Image.new("RGB", (800, 800), (90, 42, 78)).save(buf, format="JPEG")
    buf.seek(0)
    return SimpleUploadedFile("c.jpg", buf.read(), content_type="image/jpeg")


class ChatUploadApiTests(APITestCase):
    def test_customer_sends_image_only(self):
        r = self.client.post(
            "/api/chat/send/", {"image": _img()},
            format="multipart", HTTP_X_CART_TOKEN="tok",
        )
        self.assertEqual(r.status_code, 200)
        msgs = r.json()["messages"]
        self.assertTrue(any(m["upload"] for m in msgs))

    def test_admin_reply_with_image_sets_admin_status(self):
        s = ChatSession.objects.create(token="tok")
        u = User.objects.create_user("a", password="x", is_staff=True)
        self.client.force_authenticate(u)
        r = self.client.post(
            f"/api/admin/chats/{s.id}/reply/", {"image": _img()}, format="multipart",
        )
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()["upload"])
        s.refresh_from_db()
        self.assertEqual(s.status, ChatSession.Status.ADMIN)

    def test_empty_message_and_no_image_rejected(self):
        r = self.client.post(
            "/api/chat/send/", {"message": ""},
            format="multipart", HTTP_X_CART_TOKEN="tok",
        )
        self.assertEqual(r.status_code, 400)
