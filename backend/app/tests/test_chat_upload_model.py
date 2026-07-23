import io

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from PIL import Image

from app.models import ChatMessage, ChatSession


def _img():
    buf = io.BytesIO()
    Image.new("RGB", (3000, 2000), (90, 42, 78)).save(buf, format="JPEG")
    buf.seek(0)
    return SimpleUploadedFile("c.jpg", buf.read(), content_type="image/jpeg")


class ChatUploadModelTests(TestCase):
    def test_upload_is_capped(self):
        s = ChatSession.objects.create(token="t")
        m = ChatMessage.objects.create(session=s, role=ChatMessage.Role.CUSTOMER, upload=_img())
        self.assertTrue(m.upload.name)
        self.assertEqual(max(Image.open(m.upload).size), 1600)
