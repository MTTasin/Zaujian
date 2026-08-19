"""Media is served by Python on this host, so every repeat request is a worker.

A cache header is the difference between a customer's second visit costing
nothing and it costing another full transfer over 2G.
"""

import os
import tempfile

from django.test import RequestFactory, TestCase

from app.media import MEDIA_MAX_AGE, serve_media

_ROOT = tempfile.mkdtemp(prefix="test_media_headers_")


class MediaHeaderTests(TestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        with open(os.path.join(_ROOT, "photo.jpg"), "wb") as fh:
            fh.write(b"\xff\xd8\xff\xe0 not really a jpeg")

    def test_a_photo_is_served_with_a_cache_header(self):
        request = RequestFactory().get("/media/photo.jpg")

        response = serve_media(request, "photo.jpg", document_root=_ROOT)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["Cache-Control"],
                         f"public, max-age={MEDIA_MAX_AGE}")

    def test_the_file_itself_is_unchanged(self):
        request = RequestFactory().get("/media/photo.jpg")

        response = serve_media(request, "photo.jpg", document_root=_ROOT)

        self.assertEqual(b"".join(response.streaming_content),
                         b"\xff\xd8\xff\xe0 not really a jpeg")

    def test_a_missing_file_still_404s(self):
        from django.http import Http404

        request = RequestFactory().get("/media/gone.jpg")

        with self.assertRaises(Http404):
            serve_media(request, "gone.jpg", document_root=_ROOT)
