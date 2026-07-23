import io
from datetime import timedelta

from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone
from PIL import Image

from app.models import ChatMessage, ChatSession


def _img():
    buf = io.BytesIO()
    Image.new("RGB", (400, 400), (1, 1, 1)).save(buf, format="JPEG")
    buf.seek(0)
    return SimpleUploadedFile("c.jpg", buf.read(), content_type="image/jpeg")


class PurgeTests(TestCase):
    def test_purges_only_old(self):
        s = ChatSession.objects.create(token="t")
        old = ChatMessage.objects.create(session=s, role="customer", text="old", upload=_img())
        new = ChatMessage.objects.create(session=s, role="customer", text="new", upload=_img())
        ChatMessage.objects.filter(pk=old.pk).update(created_at=timezone.now() - timedelta(days=40))

        call_command("purge_old_chat_uploads")

        old.refresh_from_db()
        new.refresh_from_db()
        self.assertFalse(old.upload)       # cleared
        self.assertEqual(old.text, "old")  # text kept
        self.assertTrue(new.upload)        # recent kept
