from django.test import TestCase

from app.models import GalleryTag
from app.services.chatbot import _BEHAVIOR, _parse_tags, extract_gallery_path


class BotReplyStyleTests(TestCase):
    def test_strips_markdown_emphasis(self):
        """The widget renders plain text — ** would show as literal asterisks."""
        clean, _ = _parse_tags("**একক প্রোডাক্ট:**\n- বই – ৳১২৫০")
        self.assertNotIn("**", clean)
        self.assertIn("একক প্রোডাক্ট:", clean)
        self.assertIn("বই", clean)

    def test_strips_markdown_headings(self):
        clean, _ = _parse_tags("### দাম\nবই ৳১২৫০")
        self.assertNotIn("#", clean)
        self.assertIn("দাম", clean)

    def test_behaviour_requires_asking_which_product(self):
        self.assertIn("ask which product", _BEHAVIOR)

    def test_behaviour_forbids_reciting_catalogue(self):
        self.assertIn("never recite", _BEHAVIOR.lower())


class BotGalleryTagTests(TestCase):
    def setUp(self):
        GalleryTag.objects.create(title="Box", slug="box")
        GalleryTag.objects.create(title="Default", slug="all", is_bot_default=True)

    def test_known_slug_becomes_path(self):
        self.assertEqual(extract_gallery_path("দেখুন [GALLERY: box]"), "/gallery/box")

    def test_unknown_slug_uses_default(self):
        self.assertEqual(extract_gallery_path("[GALLERY: nope]"), "/gallery/all")

    def test_bare_tag_uses_default(self):
        self.assertEqual(extract_gallery_path("[GALLERY]"), "/gallery/all")

    def test_raw_url_also_extracted(self):
        out = extract_gallery_path("http://localhost:3000/gallery/box here")
        self.assertEqual(out, "/gallery/box")

    def test_no_default_returns_empty(self):
        GalleryTag.objects.filter(is_bot_default=True).update(is_bot_default=False)
        self.assertEqual(extract_gallery_path("[GALLERY: nope]"), "")

    def test_parse_strips_tag_and_raw_url(self):
        clean, handoff = _parse_tags("দেখুন [GALLERY: box] http://x/gallery/box শেষ")
        self.assertNotIn("[GALLERY", clean)
        self.assertNotIn("/gallery/", clean)
        self.assertFalse(handoff)
