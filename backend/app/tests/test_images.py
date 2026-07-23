import io

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from PIL import Image

from app.services.images import make_derivatives, process_image


def _png(w, h, color=(180, 60, 120)):
    buf = io.BytesIO()
    Image.new("RGB", (w, h), color).save(buf, format="PNG")
    buf.seek(0)
    return SimpleUploadedFile("x.png", buf.read(), content_type="image/png")


class ImageHelperTests(TestCase):
    def test_downscales_to_max_edge(self):
        out = process_image(_png(3000, 1500), max_edge=1600)
        img = Image.open(out)
        self.assertEqual(max(img.size), 1600)
        self.assertEqual(img.size, (1600, 800))
        self.assertTrue(out.name.endswith(".jpg"))

    def test_never_upscales(self):
        out = process_image(_png(300, 200), max_edge=1600)
        self.assertEqual(Image.open(out).size, (300, 200))

    def test_make_derivatives_sizes(self):
        disp, thumb = make_derivatives(_png(4000, 4000))
        self.assertEqual(max(Image.open(disp).size), 1600)
        self.assertEqual(max(Image.open(thumb).size), 400)

    def test_rejects_non_image(self):
        bad = SimpleUploadedFile("x.txt", b"not an image", content_type="text/plain")
        with self.assertRaises(ValueError):
            process_image(bad, max_edge=1600)
