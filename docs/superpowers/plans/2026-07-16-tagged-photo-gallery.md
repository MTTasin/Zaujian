# Tagged Photo Gallery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A self-hosted, tag-organized photo gallery (bulk upload + many-to-many tags) with a public index, per-tag lightbox pages, admin management, and bot deep-links — replacing the old ChatMedia/Google-Photos approach.

**Architecture:** Django adds `GalleryPhoto` + `GalleryTag` (M2M) with Pillow-generated display/thumbnail derivatives; DRF exposes cached public endpoints and admin CRUD + bulk-upload + assignment endpoints. Next.js adds `/gallery` (index) and `/gallery/[slug]` (grid + lightbox) plus an `/admin/gallery` manager. The bot emits `[GALLERY: slug]` which `chatbot.py` rewrites to a `/gallery/<slug>` link.

**Tech Stack:** Django 6 + DRF, Pillow, Redis cache (existing `CACHES`), Next.js 16 (App Router, TS, Tailwind v4), Vitest + RTL.

## Global Constraints

- Money is not involved here; the dominant rule is **mobile-first, low-bandwidth** (2G/3G, low-end Android): grids serve thumbnails only, full images load on demand.
- **Storefront is Bengali**; **admin panel is English**. Headings use `font-display`; compose from `components/ui/` primitives + design tokens (`plum/rose/gold/surface/surface-2/muted/border`), never raw hex.
- **No git commits during execution** (user commits manually later): each "Commit" step is a checkpoint marker — stage nothing, just verify the task is green.
- Backend runs from `backend/` as `../env/Scripts/python manage.py …`. Frontend tests: `npm test` from `frontend/`. Build check: `npm run build`.
- `next/image` stays `unoptimized: true` (already global).
- Keep original uploads; also store a 1600px display copy + 400px thumbnail.
- After model changes: `../env/Scripts/python manage.py check` + makemigrations/migrate.

---

### Task 1: Shared image-processing helper

**Files:**
- Create: `backend/app/services/images.py`
- Test: `backend/app/tests/test_images.py`

**Interfaces:**
- Produces: `process_image(src, *, max_edge: int, quality: int = 82, fmt: str = "JPEG") -> django.core.files.base.ContentFile` — opens an uploaded image, fixes EXIF orientation, converts to RGB, downscales so the longest edge ≤ `max_edge` (never upscales), returns a `ContentFile` (JPEG) with a `.name` ending `.jpg`. Raises `ValueError` on a non-image.
- Produces: `make_derivatives(src) -> tuple[ContentFile, ContentFile]` → `(display_1600, thumb_400)`.

- [ ] **Step 1: Write the failing test**

```python
# backend/app/tests/test_images.py
import io
from PIL import Image
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from app.services.images import process_image, make_derivatives


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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `../env/Scripts/python manage.py test app.tests.test_images -v 2`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.images'`.

- [ ] **Step 3: Write minimal implementation**

```python
# backend/app/services/images.py
"""Shared Pillow helpers: normalize + downscale uploaded images (no upscaling)."""
import io

from django.core.files.base import ContentFile
from PIL import Image, ImageOps


def process_image(src, *, max_edge, quality=82, fmt="JPEG"):
    """Return a JPEG ContentFile: EXIF-normalized, RGB, longest edge <= max_edge."""
    try:
        img = Image.open(src)
        img.load()
    except Exception as exc:  # noqa: BLE001 - any Pillow failure = not a usable image
        raise ValueError("Uploaded file is not a valid image") from exc

    img = ImageOps.exif_transpose(img)
    if img.mode != "RGB":
        img = img.convert("RGB")

    longest = max(img.size)
    if longest > max_edge:
        scale = max_edge / longest
        img = img.resize(
            (round(img.width * scale), round(img.height * scale)),
            Image.LANCZOS,
        )

    buf = io.BytesIO()
    img.save(buf, format=fmt, quality=quality, optimize=True)
    buf.seek(0)
    name = getattr(src, "name", "image")
    base = name.rsplit(".", 1)[0] if "." in name else name
    return ContentFile(buf.read(), name=f"{base}.jpg")


def make_derivatives(src):
    """Return (display ~1600px, thumbnail ~400px) ContentFiles from one source."""
    display = process_image(src, max_edge=1600, quality=82)
    if hasattr(src, "seek"):
        src.seek(0)
    thumb = process_image(src, max_edge=400, quality=80)
    return display, thumb
```

- [ ] **Step 4: Run test to verify it passes**

Run: `../env/Scripts/python manage.py test app.tests.test_images -v 2`
Expected: PASS (4 tests). If `app/tests/` lacks `__init__.py`, create an empty one first.

- [ ] **Step 5: Commit (checkpoint)**

Verify green; no git action (see Global Constraints).

---

### Task 2: Gallery models + migration (removes ChatMedia)

**Files:**
- Modify: `backend/app/models.py` (add `GalleryPhoto`, `GalleryTag`; delete `ChatMedia`, `ChatMediaImage` at lines 466-505)
- Create: migration via makemigrations
- Test: `backend/app/tests/test_gallery_models.py`

**Interfaces:**
- Produces: `GalleryPhoto(image, display, thumbnail, caption, alt, order, created_at, tags M2M)`; on `save()` of a new instance (or when `image` changes) it fills `display` + `thumbnail` via `make_derivatives`.
- Produces: `GalleryTag(title, slug, description, cover FK→GalleryPhoto, order, active, is_bot_default)`; `save()` auto-slugifies blank slug and clears `is_bot_default` on all others when set true.

- [ ] **Step 1: Write the failing test**

```python
# backend/app/tests/test_gallery_models.py
import io
from PIL import Image
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `../env/Scripts/python manage.py test app.tests.test_gallery_models -v 2`
Expected: FAIL — `ImportError: cannot import name 'GalleryPhoto'`.

- [ ] **Step 3: Write the models and delete ChatMedia**

Delete `ChatMedia` and `ChatMediaImage` (models.py lines 466-505). Add near the other content models:

```python
# backend/app/models.py
class GalleryPhoto(models.Model):
    """A photo in the self-hosted gallery. Keeps the original + web derivatives."""

    image = models.ImageField(upload_to="gallery/orig/")
    display = models.ImageField(upload_to="gallery/display/", blank=True)
    thumbnail = models.ImageField(upload_to="gallery/thumb/", blank=True)
    caption = models.CharField(max_length=160, blank=True)
    alt = models.CharField(max_length=160, blank=True)
    order = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["order", "-created_at"]

    def __str__(self):
        return self.caption or f"Photo #{self.pk}"

    def save(self, *args, **kwargs):
        from .services.images import make_derivatives

        # (Re)generate derivatives when a new original is present and unprocessed.
        if self.image and not self.display:
            self.image.seek(0)
            display, thumb = make_derivatives(self.image)
            self.display.save(display.name, display, save=False)
            self.thumbnail.save(thumb.name, thumb, save=False)
        super().save(*args, **kwargs)


class GalleryTag(models.Model):
    """A named group of gallery photos. slug is the URL segment + bot reference."""

    title = models.CharField(max_length=80, help_text="Bengali label shown to customers")
    slug = models.SlugField(max_length=60, unique=True, blank=True)
    description = models.CharField(max_length=300, blank=True)
    cover = models.ForeignKey(
        GalleryPhoto, null=True, blank=True, on_delete=models.SET_NULL, related_name="+",
    )
    order = models.PositiveSmallIntegerField(default=0)
    active = models.BooleanField(default=True)
    is_bot_default = models.BooleanField(
        default=False, help_text="Bot links here when a customer asks for a photo without specifying",
    )
    photos = models.ManyToManyField(GalleryPhoto, related_name="tags", blank=True)

    class Meta:
        ordering = ["order", "id"]

    def __str__(self):
        return self.title

    def save(self, *args, **kwargs):
        from django.utils.text import slugify

        if not self.slug:
            self.slug = slugify(self.title)[:60]
        super().save(*args, **kwargs)
        if self.is_bot_default:
            GalleryTag.objects.exclude(pk=self.pk).filter(is_bot_default=True).update(
                is_bot_default=False
            )
```

- [ ] **Step 4: Make + run migration, then tests**

Run:
```
../env/Scripts/python manage.py makemigrations app
../env/Scripts/python manage.py migrate
../env/Scripts/python manage.py test app.tests.test_gallery_models -v 2
```
Expected: migration created (adds Gallery* , deletes ChatMedia*), migrate OK, 4 tests PASS.
Note: this will break imports of `ChatMedia` in `admin_api.py`, `views.py`, `serializers.py`, `chatbot.py` — fixed in Tasks 3–5. Run only this test module here.

- [ ] **Step 5: Commit (checkpoint)** — verify the 4 model tests pass.

---

### Task 3: Public gallery API (cached)

**Files:**
- Modify: `backend/app/serializers.py` (add gallery serializers; remove ChatMedia serializers)
- Modify: `backend/app/views.py` (add `gallery_index`, `gallery_detail`; remove `album_view` + ChatMedia import)
- Modify: `backend/app/urls.py` (add gallery paths; remove `album/<slug:key>/`)
- Create: `backend/app/services/gallery_cache.py`
- Test: `backend/app/tests/test_gallery_api.py`

**Interfaces:**
- Produces: `GET /api/gallery/` → `[{slug,title,cover,count}]` (active only). `GET /api/gallery/<slug>/` → `{title,description,photos:[{id,thumb,full,caption,alt}]}` or 404.
- Produces: `gallery_cache.invalidate(slugs=None)` — clears `gallery:index` and given/all `gallery:tag:<slug>` keys.

- [ ] **Step 1: Write the failing test**

```python
# backend/app/tests/test_gallery_api.py
import io
from PIL import Image
from django.core.files.uploadedfile import SimpleUploadedFile
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `../env/Scripts/python manage.py test app.tests.test_gallery_api -v 2`
Expected: FAIL — 404 / URL not found.

- [ ] **Step 3: Implement cache helper, serializers, views, urls**

```python
# backend/app/services/gallery_cache.py
from django.core.cache import cache

INDEX_KEY = "gallery:index"


def tag_key(slug):
    return f"gallery:tag:{slug}"


def invalidate(slugs=None):
    keys = [INDEX_KEY]
    if slugs:
        keys += [tag_key(s) for s in slugs]
        cache.delete_many(keys)
    else:
        # Unknown scope: clear index; tag keys expire via TTL.
        cache.delete(INDEX_KEY)
```

Add to `serializers.py` (and remove `ChatMediaSerializer`/`ChatMediaImageSerializer` if present):

```python
# backend/app/serializers.py
class GalleryPhotoSerializer(serializers.ModelSerializer):
    thumb = serializers.SerializerMethodField()
    full = serializers.SerializerMethodField()

    class Meta:
        model = GalleryPhoto
        fields = ["id", "thumb", "full", "caption", "alt"]

    def _url(self, f):
        if not f:
            return ""
        request = self.context.get("request")
        return request.build_absolute_uri(f.url) if request else f.url

    def get_thumb(self, obj):
        return self._url(obj.thumbnail or obj.display or obj.image)

    def get_full(self, obj):
        return self._url(obj.display or obj.image)
```

Add gallery views (import `GalleryPhoto`, `GalleryTag`, `GalleryPhotoSerializer`, `gallery_cache`, `cache`), and **remove `album_view`** and its `ChatMedia` import:

```python
# backend/app/views.py
from django.core.cache import cache
from .services import gallery_cache

@api_view(["GET"])
def gallery_index(request):
    data = cache.get(gallery_cache.INDEX_KEY)
    if data is None:
        tags = GalleryTag.objects.filter(active=True).prefetch_related("photos")
        data = []
        for t in tags:
            cover = t.cover or t.photos.first()
            data.append({
                "slug": t.slug,
                "title": t.title,
                "cover": request.build_absolute_uri(cover.thumbnail.url) if cover and cover.thumbnail else "",
                "count": t.photos.count(),
            })
        cache.set(gallery_cache.INDEX_KEY, data, 3600)
    return Response(data)


@api_view(["GET"])
def gallery_detail(request, slug):
    key = gallery_cache.tag_key(slug)
    data = cache.get(key)
    if data is None:
        tag = get_object_or_404(GalleryTag, slug=slug, active=True)
        photos = GalleryPhotoSerializer(
            tag.photos.all(), many=True, context={"request": request}
        ).data
        data = {"title": tag.title, "description": tag.description, "photos": photos}
        cache.set(key, data, 3600)
    return Response(data)
```

`urls.py`: remove the `album/<slug:key>/` line; add:
```python
    path("gallery/", views.gallery_index, name="gallery-index"),
    path("gallery/<slug:slug>/", views.gallery_detail, name="gallery-detail"),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `../env/Scripts/python manage.py test app.tests.test_gallery_api -v 2`
Expected: PASS (3 tests). (`album_view` removal will surface in Task 5 for `chatbot.py`; that's expected.)

- [ ] **Step 5: Commit (checkpoint)** — verify 3 API tests pass.

---

### Task 4: Admin gallery API (bulk upload, tags, assignment)

**Files:**
- Modify: `backend/app/admin_api.py` (add gallery serializers + viewsets + assignment action; remove `AdminChatMedia*` classes + their `ChatMedia` imports)
- Modify: `backend/app/urls.py` (register `gallery-photos`, `gallery-tags`; remove `chat-media`, `chat-media-images` registrations)
- Test: `backend/app/tests/test_admin_gallery.py`

**Interfaces:**
- Produces: `AdminGalleryPhotoViewSet` at `/api/admin/gallery-photos/` — `POST` accepts multipart `images` (multiple) → creates N photos, returns per-file results `{created:[...], errors:[...]}`.
- Produces: `AdminGalleryTagViewSet` at `/api/admin/gallery-tags/` (CRUD) with `@action(detail=True, methods=["post"]) set_photos` at `/api/admin/gallery-tags/<id>/set_photos/` body `{photo_ids:[...]}`.

- [ ] **Step 1: Write the failing test**

```python
# backend/app/tests/test_admin_gallery.py
import io
from PIL import Image
from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `../env/Scripts/python manage.py test app.tests.test_admin_gallery -v 2`
Expected: FAIL — URL not found / 404.

- [ ] **Step 3: Implement admin serializers, viewsets, urls**

Remove `AdminChatMediaViewSet`, `AdminChatMediaImageViewSet`, `AdminChatMediaSerializer`, `AdminChatMediaImageSerializer` and their `ChatMedia`/`ChatMediaImage` imports from `admin_api.py`. Add:

```python
# backend/app/admin_api.py
from .models import GalleryPhoto, GalleryTag  # add to existing import block
from .services.images import make_derivatives  # noqa (used indirectly via model.save)
from .services import gallery_cache


class AdminGalleryPhotoSerializer(serializers.ModelSerializer):
    tag_count = serializers.IntegerField(source="tags.count", read_only=True)

    class Meta:
        model = GalleryPhoto
        fields = ["id", "image", "display", "thumbnail", "caption", "alt", "order", "tag_count"]
        read_only_fields = ["display", "thumbnail"]


class AdminGalleryPhotoViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAdminUser]
    queryset = GalleryPhoto.objects.all()
    serializer_class = AdminGalleryPhotoSerializer

    def create(self, request, *args, **kwargs):
        files = request.FILES.getlist("images") or request.FILES.getlist("image")
        if not files:
            return Response({"error": "no images"}, status=status.HTTP_400_BAD_REQUEST)
        created, errors = [], []
        for f in files:
            try:
                photo = GalleryPhoto(image=f)
                photo.save()
                created.append(AdminGalleryPhotoSerializer(photo, context={"request": request}).data)
            except Exception as exc:  # noqa: BLE001
                errors.append({"file": f.name, "error": str(exc)})
        gallery_cache.invalidate()
        return Response({"created": created, "errors": errors}, status=status.HTTP_201_CREATED)

    def perform_destroy(self, instance):
        super().perform_destroy(instance)
        gallery_cache.invalidate()


class AdminGalleryTagSerializer(serializers.ModelSerializer):
    photo_ids = serializers.PrimaryKeyRelatedField(
        source="photos", many=True, queryset=GalleryPhoto.objects.all(), required=False,
    )
    count = serializers.IntegerField(source="photos.count", read_only=True)

    class Meta:
        model = GalleryTag
        fields = ["id", "title", "slug", "description", "cover", "order",
                  "active", "is_bot_default", "photo_ids", "count"]
        read_only_fields = ["slug"]


class AdminGalleryTagViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAdminUser]
    queryset = GalleryTag.objects.all()
    serializer_class = AdminGalleryTagSerializer

    def perform_create(self, serializer):
        serializer.save()
        gallery_cache.invalidate()

    def perform_update(self, serializer):
        serializer.save()
        gallery_cache.invalidate()

    def perform_destroy(self, instance):
        super().perform_destroy(instance)
        gallery_cache.invalidate()

    @action(detail=True, methods=["post"])
    def set_photos(self, request, pk=None):
        tag = self.get_object()
        ids = request.data.get("photo_ids", [])
        tag.photos.set(GalleryPhoto.objects.filter(id__in=ids))
        gallery_cache.invalidate([tag.slug])
        return Response({"count": tag.photos.count()})
```

`urls.py` admin_router: remove the two `chat-media*` registrations; add:
```python
admin_router.register(r"gallery-photos", admin_api.AdminGalleryPhotoViewSet, basename="admin-gallery-photo")
admin_router.register(r"gallery-tags", admin_api.AdminGalleryTagViewSet, basename="admin-gallery-tag")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `../env/Scripts/python manage.py test app.tests.test_admin_gallery -v 2`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit (checkpoint)** — verify 4 admin tests pass.

---

### Task 5: Bot `[GALLERY: slug]` + remove ChatMedia references

**Files:**
- Modify: `backend/app/services/chatbot.py` (parse `[GALLERY: slug]`; remove `[IMAGE]`/`[ALBUM]`/`ChatMedia` handling)
- Modify: `bot_instructions.md` (document `[GALLERY: slug]`; remove `[IMAGE]`/`[ALBUM]` docs)
- Test: `backend/app/tests/test_bot_gallery.py`

**Interfaces:**
- Consumes: `GalleryTag` (active + `is_bot_default`), `settings.FRONTEND_URL`.
- Produces: `resolve_gallery_tags(text: str) -> str` — replaces every `[GALLERY: slug]` (and bare `[GALLERY]`) with `{FRONTEND_URL}/gallery/<slug>`; unknown/blank slug → the `is_bot_default` tag; no default → tag removed. Called on the bot's final text before returning it.

- [ ] **Step 1: Write the failing test**

```python
# backend/app/tests/test_bot_gallery.py
from django.test import TestCase, override_settings
from app.models import GalleryTag
from app.services.chatbot import resolve_gallery_tags


@override_settings(FRONTEND_URL="https://zaujain.mttasin.com")
class BotGalleryTagTests(TestCase):
    def setUp(self):
        GalleryTag.objects.create(title="Box", slug="box")
        GalleryTag.objects.create(title="Default", slug="all", is_bot_default=True)

    def test_known_slug_becomes_link(self):
        out = resolve_gallery_tags("দেখুন [GALLERY: box] এখানে")
        self.assertIn("https://zaujain.mttasin.com/gallery/box", out)
        self.assertNotIn("[GALLERY", out)

    def test_unknown_slug_uses_default(self):
        out = resolve_gallery_tags("[GALLERY: nope]")
        self.assertIn("/gallery/all", out)

    def test_bare_tag_uses_default(self):
        out = resolve_gallery_tags("[GALLERY]")
        self.assertIn("/gallery/all", out)

    def test_no_default_drops_tag(self):
        GalleryTag.objects.filter(is_bot_default=True).update(is_bot_default=False)
        out = resolve_gallery_tags("x [GALLERY: nope] y")
        self.assertNotIn("[GALLERY", out)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `../env/Scripts/python manage.py test app.tests.test_bot_gallery -v 2`
Expected: FAIL — `ImportError: cannot import name 'resolve_gallery_tags'` (and/or `ChatMedia` import error from Task 2 deletions — fix both here).

- [ ] **Step 3: Implement resolver; strip ChatMedia usage**

In `chatbot.py`, remove any `from ..models import ChatMedia` (and `[IMAGE]`/`[ALBUM]` parsing). Add:

```python
# backend/app/services/chatbot.py
import re
from django.conf import settings

_GALLERY_RE = re.compile(r"\[GALLERY(?::\s*([a-z0-9\-]+))?\]", re.IGNORECASE)


def resolve_gallery_tags(text):
    """Replace [GALLERY: slug] tokens with public /gallery/<slug> links."""
    from ..models import GalleryTag

    base = settings.FRONTEND_URL.rstrip("/")

    def _sub(m):
        slug = (m.group(1) or "").lower()
        tag = None
        if slug:
            tag = GalleryTag.objects.filter(slug=slug, active=True).first()
        if tag is None:
            tag = GalleryTag.objects.filter(is_bot_default=True, active=True).first()
        return f"{base}/gallery/{tag.slug}" if tag else ""

    return _GALLERY_RE.sub(_sub, text).strip()
```

**Full ChatMedia excision (the file leans on it heavily — remove all of it):**
- Delete the import `ChatMedia` from the `from ..models import (...)` line (keep `BotConfig, ChatMessage, ChatSession, Order`).
- Delete `_resolve_media`, `_first_image`, `_auto_media`, `PREVIEW_MAX`, `_SYN`, `_REQUEST_WORDS` (all only serve ChatMedia).
- Rewrite `_shop_facts()` to advertise **gallery tags** instead of media keys:
  ```python
  def _shop_facts():
      from ..models import GalleryTag
      lines = ["## PRICING RULE: use ONLY the prices in the instructions above. "
               "Never quote any other number."]
      tags = list(GalleryTag.objects.filter(active=True))
      if tags:
          lines.append("## PHOTO GALLERIES YOU CAN LINK (use the EXACT tag shown)")
          for t in tags:
              lines.append(f"- {t.title}: [GALLERY: {t.slug}]")
          default = next((t for t in tags if t.is_bot_default), None)
          if default:
              lines.append(
                  f"If the customer asks for a photo/pic/ছবি without saying which, "
                  f"send [GALLERY: {default.slug}]."
              )
      return "\n".join(lines)
  ```
- Rewrite the media clause in `_BEHAVIOR`: replace the `[IMAGE: key]`/`[ALBUM: key]` sentence with:
  `"- To show photos, put the matching [GALLERY: slug] tag on its own line (from the list above). It becomes a gallery link. Never describe a photo in words without the tag."`
- Change `_TAG_RE` to `re.compile(r"\[(HANDOFF|GALLERY)(?::\s*([\w-]+))?\]", re.IGNORECASE)`.
- Rewrite `_parse_tags(text)` to return just `(clean_text, handoff)` — detect `[HANDOFF]`; strip all tags with `_TAG_RE.sub("", text)`. Gallery links are produced by `resolve_gallery_tags`, not here.
- In `bot_reply`, after getting `content`: `content = resolve_gallery_tags(content)` **then** `clean, handoff = _parse_tags(content)`. Remove the `images/more/album_url`, `_auto_media`, and `abs_url` logic. The final create becomes:
  ```python
  msg = ChatMessage.objects.create(session=session, role=ChatMessage.Role.BOT, text=clean)
  ```
  (Leave `image`/`images`/`album_url` fields at their model defaults — untouched.)

**Instruction file consolidation** (settles the two-file question): the code reads `settings.CHATBOT["INSTRUCTIONS_PATH"]` = `bot_instructions.md`. Make **that** file hold the authoritative rich persona currently in `bot_instra.md`, with every `[ALBUM: x]` / `[IMAGE: x]` rewritten to `[GALLERY: x]` and every `[VIDEO: ...]` line **removed** (gallery is images-only). Then delete `bot_instra.md`. Note: on an existing DB the live persona is in `BotConfig` (admin-edited) — the file only re-seeds a fresh install, so the admin must paste the updated text via Admin → Bot Instructions after deploy.

- [ ] **Step 4: Run tests (module + full check)**

Run:
```
../env/Scripts/python manage.py test app.tests.test_bot_gallery -v 2
../env/Scripts/python manage.py check
```
Expected: 4 tests PASS; `check` → "System check identified no issues". If `check` still errors on a stray `ChatMedia`/`album_view` reference, remove it.

- [ ] **Step 5: Commit (checkpoint)** — verify bot tests + `check` green.

---

### Task 6: Frontend public gallery (index + tag lightbox)

**Files:**
- Create: `frontend/src/lib/gallery.ts` (fetch helpers + types)
- Create: `frontend/src/components/Lightbox.tsx` (reused by chat plan)
- Create: `frontend/src/app/gallery/page.tsx` (index)
- Create: `frontend/src/app/gallery/[slug]/page.tsx` (server) + `frontend/src/app/gallery/[slug]/TagGallery.tsx` (client grid+lightbox)
- Modify: site shell nav (`frontend/src/components/shell/SiteHeader.tsx`, `SiteFooter.tsx`, `MobileTabBar.tsx`) — add "গ্যালারি" → `/gallery`
- Modify: `frontend/src/app/sitemap.ts` (add `/gallery`)
- Test: `frontend/src/components/Lightbox.test.tsx`

**Interfaces:**
- Consumes: `GET /api/gallery/`, `GET /api/gallery/<slug>/` (from Task 3).
- Produces: `<Lightbox images={[{full,caption}]} index startIndex onClose />` — full-screen overlay, next/prev (buttons + swipe + arrow keys), Esc/close.

- [ ] **Step 1: Write the failing Lightbox test**

```tsx
// frontend/src/components/Lightbox.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Lightbox } from "./Lightbox";

const imgs = [
  { full: "/a.jpg", caption: "A" },
  { full: "/b.jpg", caption: "B" },
];

describe("Lightbox", () => {
  it("shows the starting image and advances", () => {
    render(<Lightbox images={imgs} startIndex={0} onClose={() => {}} />);
    expect(screen.getByRole("img")).toHaveAttribute("src", "/a.jpg");
    fireEvent.click(screen.getByLabelText("Next"));
    expect(screen.getByRole("img")).toHaveAttribute("src", "/b.jpg");
  });

  it("calls onClose on the close button", () => {
    const onClose = vi.fn();
    render(<Lightbox images={imgs} startIndex={0} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- Lightbox`
Expected: FAIL — cannot find `./Lightbox`.

- [ ] **Step 3: Implement Lightbox**

```tsx
// frontend/src/components/Lightbox.tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type LightboxImage = { full: string; caption?: string };

export function Lightbox({
  images, startIndex, onClose,
}: { images: LightboxImage[]; startIndex: number; onClose: () => void }) {
  const [i, setI] = useState(startIndex);
  const [mounted, setMounted] = useState(false);
  const touchX = useRef<number | null>(null);

  useEffect(() => setMounted(true), []);
  const prev = () => setI((n) => (n - 1 + images.length) % images.length);
  const next = () => setI((n) => (n + 1) % images.length);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [images.length, onClose]);

  if (!mounted) return null;
  const cur = images[i];

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/90"
      onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touchX.current == null) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        if (dx > 50) prev();
        else if (dx < -50) next();
        touchX.current = null;
      }}
    >
      <button aria-label="Close" onClick={onClose}
        className="absolute right-4 top-4 h-11 w-11 rounded-full bg-white/15 text-2xl text-white">×</button>
      {images.length > 1 && (
        <>
          <button aria-label="Previous" onClick={prev}
            className="absolute left-2 h-12 w-12 rounded-full bg-white/15 text-3xl text-white">‹</button>
          <button aria-label="Next" onClick={next}
            className="absolute right-2 h-12 w-12 rounded-full bg-white/15 text-3xl text-white">›</button>
        </>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={cur.full} alt={cur.caption || ""} className="max-h-[85vh] max-w-[92vw] object-contain" />
      {cur.caption && <p className="mt-3 px-4 text-center text-sm text-white/80">{cur.caption}</p>}
    </div>,
    document.body,
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- Lightbox`
Expected: PASS (2 tests).

- [ ] **Step 5: Add fetch helpers, pages, nav, sitemap**

```ts
// frontend/src/lib/gallery.ts
import { API_BASE } from "./api"; // reuse existing base export

export type GalleryTagTile = { slug: string; title: string; cover: string; count: number };
export type GalleryPhoto = { id: number; thumb: string; full: string; caption: string; alt: string };
export type GalleryDetail = { title: string; description: string; photos: GalleryPhoto[] };

export async function fetchGalleryIndex(): Promise<GalleryTagTile[]> {
  const r = await fetch(`${API_BASE}/api/gallery/`, { next: { revalidate: 300 } });
  if (!r.ok) return [];
  return r.json();
}

export async function fetchGalleryTag(slug: string): Promise<GalleryDetail | null> {
  const r = await fetch(`${API_BASE}/api/gallery/${slug}/`, { next: { revalidate: 300 } });
  if (!r.ok) return null;
  return r.json();
}
```

(If `api.ts` does not export `API_BASE`, use `process.env.NEXT_PUBLIC_API_BASE` directly — match whatever the existing lib exports.)

```tsx
// frontend/src/app/gallery/page.tsx
import Link from "next/link";
import type { Metadata } from "next";
import { Container, Section } from "@/components/ui";
import { Eyebrow } from "@/components/ui";
import { fetchGalleryIndex } from "@/lib/gallery";

export const metadata: Metadata = {
  title: "গ্যালারি — জাউজাইন নিকাহ পয়েন্ট",
  description: "আমাদের কাস্টম নিকাহনামা, বক্স, ফ্রেম ও কম্বোর ছবি দেখুন।",
};

export default async function GalleryIndexPage() {
  const tags = await fetchGalleryIndex();
  return (
    <Section>
      <Container>
        <Eyebrow>গ্যালারি</Eyebrow>
        <h1 className="font-display text-3xl md:text-4xl text-plum">আমাদের কাজের ছবি</h1>
        {tags.length === 0 ? (
          <p className="mt-8 text-muted">কোনো ছবি এখনো যোগ করা হয়নি।</p>
        ) : (
          <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {tags.map((t) => (
              <Link key={t.slug} href={`/gallery/${t.slug}`}
                className="group overflow-hidden rounded-2xl border border-border bg-surface">
                <div className="aspect-square overflow-hidden bg-surface-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {t.cover && <img src={t.cover} alt={t.title} loading="lazy"
                    className="h-full w-full object-cover transition group-hover:scale-105" />}
                </div>
                <div className="p-3">
                  <p className="font-display text-plum">{t.title}</p>
                  <p className="text-xs text-muted">{t.count} ছবি</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Container>
    </Section>
  );
}
```

```tsx
// frontend/src/app/gallery/[slug]/page.tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Container, Section, Eyebrow } from "@/components/ui";
import { fetchGalleryTag } from "@/lib/gallery";
import { TagGallery } from "./TagGallery";

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params;
  const data = await fetchGalleryTag(slug);
  if (!data) return { title: "গ্যালারি" };
  return { title: `${data.title} — গ্যালারি`, description: data.description || undefined };
}

export default async function TagPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await fetchGalleryTag(slug);
  if (!data) notFound();
  return (
    <Section>
      <Container>
        <Eyebrow>গ্যালারি</Eyebrow>
        <h1 className="font-display text-3xl md:text-4xl text-plum">{data.title}</h1>
        {data.description && <p className="mt-2 text-muted">{data.description}</p>}
        <TagGallery photos={data.photos} />
      </Container>
    </Section>
  );
}
```

```tsx
// frontend/src/app/gallery/[slug]/TagGallery.tsx
"use client";
import { useState } from "react";
import { Lightbox } from "@/components/Lightbox";
import type { GalleryPhoto } from "@/lib/gallery";

export function TagGallery({ photos }: { photos: GalleryPhoto[] }) {
  const [open, setOpen] = useState<number | null>(null);
  if (photos.length === 0) return <p className="mt-8 text-muted">এই বিভাগে কোনো ছবি নেই।</p>;
  return (
    <>
      <div className="mt-6 grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
        {photos.map((p, idx) => (
          <button key={p.id} onClick={() => setOpen(idx)}
            className="aspect-square overflow-hidden rounded-xl bg-surface-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.thumb} alt={p.alt || p.caption || ""} loading="lazy"
              className="h-full w-full object-cover" />
          </button>
        ))}
      </div>
      {open !== null && (
        <Lightbox images={photos.map((p) => ({ full: p.full, caption: p.caption }))}
          startIndex={open} onClose={() => setOpen(null)} />
      )}
    </>
  );
}
```

Add a "গ্যালারি" → `/gallery` link to `SiteHeader` menu, `SiteFooter`, and `MobileTabBar` (match each file's existing link markup). Add `{ url: `${SITE_URL}/gallery`, ... }` to `sitemap.ts`.

- [ ] **Step 6: Verify build**

Run: `cd frontend && npm run build`
Expected: build succeeds; `/gallery` and `/gallery/[slug]` appear in the route list.

- [ ] **Step 7: Commit (checkpoint)** — Lightbox test green + build green.

---

### Task 7: Frontend admin gallery manager (replaces Chat Media)

**Files:**
- Create: `frontend/src/app/admin/gallery/page.tsx`
- Modify: `frontend/src/app/admin/layout.tsx` (nav: replace "Chat Media" with "Gallery" → `/admin/gallery`)
- Delete: `frontend/src/app/admin/chat-media/` (old page)
- Modify: admin API client (`frontend/src/lib/adminApi.ts` or equivalent) — add gallery calls

**Interfaces:**
- Consumes: `/api/admin/gallery-photos/` (GET list, POST bulk `images`, DELETE), `/api/admin/gallery-tags/` (CRUD), `/api/admin/gallery-tags/<id>/set_photos/`.

- [ ] **Step 1: Add admin API client functions**

In the existing admin API helper module, add (match the file's fetch/token pattern):
```ts
export const adminGallery = {
  photos: () => adminGet("/api/admin/gallery-photos/"),
  upload: (files: File[]) => {
    const fd = new FormData();
    files.forEach((f) => fd.append("images", f));
    return adminPostForm("/api/admin/gallery-photos/", fd);
  },
  deletePhoto: (id: number) => adminDelete(`/api/admin/gallery-photos/${id}/`),
  tags: () => adminGet("/api/admin/gallery-tags/"),
  saveTag: (body: unknown, id?: number) =>
    id ? adminPatch(`/api/admin/gallery-tags/${id}/`, body)
       : adminPost("/api/admin/gallery-tags/", body),
  deleteTag: (id: number) => adminDelete(`/api/admin/gallery-tags/${id}/`),
  setPhotos: (id: number, photo_ids: number[]) =>
    adminPost(`/api/admin/gallery-tags/${id}/set_photos/`, { photo_ids }),
};
```
(Use whatever helper names the existing admin client exports; if it uses raw `fetch` with a token header, mirror that.)

- [ ] **Step 2: Build the admin page (Library + Tags)**

Create `frontend/src/app/admin/gallery/page.tsx` — a client component with two sections:
1. **Photo Library**: a drag-and-drop / file-input zone (`<input type="file" multiple accept="image/*">`) that calls `adminGallery.upload` in batches of 5 with progress, then a grid of all photos (thumbnail + tag-count badge + delete button).
2. **Tags**: list (title, slug, count, active, bot-default) with create/edit form (title, description, active toggle, bot-default toggle) and a "Manage photos" panel — grid of all library photos with a selected-overlay checkbox; Save calls `adminGallery.setPhotos`.

Batch upload helper:
```ts
async function uploadInBatches(files: File[], onProgress: (done: number) => void) {
  const BATCH = 5;
  for (let i = 0; i < files.length; i += BATCH) {
    await adminGallery.upload(files.slice(i, i + BATCH));
    onProgress(Math.min(i + BATCH, files.length));
  }
}
```
Follow the existing Products admin page's drag-drop multi-image upload markup/styling for consistency. English labels throughout.

- [ ] **Step 3: Swap nav + delete old page**

In `admin/layout.tsx` nav array, replace the Chat Media entry with `{ href: "/admin/gallery", label: "Gallery" }`. Delete `frontend/src/app/admin/chat-media/`.

- [ ] **Step 4: Verify build**

Run: `cd frontend && npm run build`
Expected: build succeeds; `/admin/gallery` present; no references to the deleted `/admin/chat-media`.

- [ ] **Step 5: Manual smoke + commit (checkpoint)**

Start backend + frontend; log into admin; upload a few photos; create a tag "box"; assign photos; open `/gallery` then `/gallery/box`; tap a photo → lightbox. Verify. Checkpoint.

---

## Self-Review

- **Spec coverage:** models (T2), thumbnails/derivatives (T1), keep-original + display + thumb (T1/T2), public index + tag API + cache (T3), admin bulk upload + tags + assignment + cache invalidation (T4), bot `[GALLERY]` + ChatMedia removal + persona-adjacent instructions (T5), public index/tag pages + lightbox + nav + sitemap (T6), admin manager + nav swap + delete chat-media (T7), mobile-first grids/lightbox (T6), Redis caching (T3). All spec sections covered.
- **Placeholder scan:** none — every code step carries complete code; UI-heavy T7 steps reference the concrete existing pattern (Products drag-drop) rather than a vague "handle it".
- **Type consistency:** `make_derivatives`/`process_image` names consistent T1↔T2; serializer `thumb`/`full` (T3) matches `GalleryPhoto` type + `TagGallery` usage (T6); `set_photos`/`photo_ids` consistent T4↔T7; `gallery_cache.invalidate` signature consistent T3↔T4.
