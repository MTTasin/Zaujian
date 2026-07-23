# Tagged Photo Gallery — Design Spec

Date: 2026-07-16
Status: Approved for planning

## Goal

A self-hosted photo gallery for Zaujain Nikah Point. Admin bulk-uploads photos
into a central library, creates tags, and assigns photos to tags (one photo may
belong to many tags). The public site shows a gallery index (all tags) and a
page per tag. The AI salesbot links customers to `/gallery/<tag>` instead of
sending Google Photos album links or inline images.

This **replaces** the existing `ChatMedia` / `ChatMediaImage` bot-media system.
All photos are served from the Django media folder (no Google Photos API — it
has no public-shared-album read access since March 2025).

## Audience / constraints (from CLAUDE.md)

- Storefront is Bengali, **mobile-first**, low-bandwidth (2G/3G, low-end Android).
  Most visitors are on phones — the gallery must be excellent on small screens.
- Money is not involved here, but the low-bandwidth rule dominates the design:
  grids load small thumbnails; full images load only on demand.
- Admin panel is English, technical.
- No job queue. Image processing runs **synchronously** inside the upload
  request using Pillow (already installed). Bulk upload of many large photos is
  the one slow path — see "Performance notes".

## Data model (`backend/app/models.py`)

Three new models; `ChatMedia` and `ChatMediaImage` are removed.

### `GalleryPhoto`
| Field | Type | Notes |
|-------|------|-------|
| `image` | ImageField `upload_to="gallery/orig/"` | Original upload, kept untouched (archive). |
| `display` | ImageField `upload_to="gallery/display/"` | Auto: max 1600px longest edge, JPEG q82. Used by the lightbox. |
| `thumbnail` | ImageField `upload_to="gallery/thumb/"` | Auto: max 400px longest edge, JPEG q80. Used by grids. |
| `caption` | CharField(160) blank | Optional Bengali caption shown in lightbox. |
| `alt` | CharField(160) blank | Optional alt text for SEO/accessibility; falls back to caption or a generic Bengali label. |
| `order` | PositiveSmallIntegerField default 0 | Global sort within a tag (lower first). |
| `created_at` | DateTimeField auto_now_add | |

`tags` = `ManyToManyField(GalleryTag, related_name="photos", blank=True)`.

**Image processing** (in `save()` or a helper called by the create view):
open `image` with Pillow, correct EXIF orientation, produce `display` and
`thumbnail` (preserve aspect ratio, no upscaling). If the source is not a valid
image, reject with a 400. Convert to RGB before JPEG save (handles PNG/HEIC-as-
uploaded edge cases; HEIC only if the host Pillow supports it — otherwise the
upload errors and the admin is told to upload JPEG/PNG).

Ordering: `Meta.ordering = ["order", "-created_at"]`.

### `GalleryTag`
| Field | Type | Notes |
|-------|------|-------|
| `title` | CharField(80) | Bengali label shown to customers. |
| `slug` | SlugField(60) unique | URL segment + the token the bot references. Auto-slugified from title on save if blank. |
| `description` | CharField(300) blank | Optional SEO/intro copy on the tag page. |
| `cover` | ForeignKey(`GalleryPhoto`, null, blank, `on_delete=SET_NULL`) | Tile image on the index; falls back to the first assigned photo's thumbnail. |
| `order` | PositiveSmallIntegerField default 0 | Sort on the index. |
| `active` | BooleanField default True | Inactive tags are hidden from public API + index. |
| `is_bot_default` | BooleanField default False | The tag the bot links to when a customer asks for a photo without specifying which. At most one should be true (enforced softly: setting one true clears others). |

`Meta.ordering = ["order", "id"]`.

## Backend API (`backend/app/urls.py`, views)

### Public (AllowAny, cached)
- `GET /api/gallery/` → `[{ "slug", "title", "cover": <thumb url>, "count" }]`
  for `active=True` tags, ordered. Cache key `gallery:index`.
- `GET /api/gallery/<slug>/` → `{ "title", "description",
  "photos": [{ "id", "thumb", "full" (display url), "caption", "alt" }] }`.
  404 if tag missing or inactive. Cache key `gallery:tag:<slug>`.

Both cached in Redis (existing `CACHES` when `REDIS_URL` set; LocMem fallback in
dev). TTL 3600s as a safety net; primary invalidation is explicit (below).

### Admin (`IsAdminUser`, token auth — matches existing admin_api pattern)
- `AdminGalleryPhotoViewSet`
  - `GET /api/admin/gallery/photos/` — list (id, thumb, display, caption, alt,
    order, tag ids, tag count).
  - `POST /api/admin/gallery/photos/` — **bulk multipart upload**: accepts
    multiple files under `images`; creates one `GalleryPhoto` per file; returns
    the created rows. Partial success reported per-file (which succeeded / which
    failed and why).
  - `PATCH /api/admin/gallery/photos/<id>/` — edit caption/alt/order.
  - `DELETE /api/admin/gallery/photos/<id>/` — delete (removes files + M2M rows).
- `AdminGalleryTagViewSet` — full CRUD for tags. Setting `is_bot_default=True`
  clears the flag on all other tags.
- `POST /api/admin/gallery/tags/<id>/photos/` `{ "photo_ids": [...] }` — sets the
  tag's assigned photos (replaces the set). Used by the "Manage photos" screen.

### Cache invalidation
Any write to a photo, tag, or assignment clears `gallery:index` and the affected
`gallery:tag:<slug>` key(s). Simplest robust approach: a small helper
`invalidate_gallery_cache(slugs=None)` called from the viewsets' create/update/
delete and the assignment endpoint; when slugs are unknown (e.g. a photo edit
that touches several tags) clear index + all of the photo's tag keys.

## Frontend (Next.js, `frontend/src/app`)

### Public — mobile-first
- **`/gallery`** (index) — server component. Fetches `/api/gallery/`. Tag tiles:
  **2 columns on phone**, 3 on tablet, 4 on desktop. Each tile = cover image +
  Bengali title + count, large tap target, lazy-loaded. Heritage-Atelier styling
  (Container/Section, plum/gold tokens, `font-display` heading, Eyebrow). Empty
  state if no tags. `generateMetadata` (title/desc/OG) + `ImageGallery` JSON-LD.
  Linked from **header menu + footer**.
- **`/gallery/[slug]`** — server component fetches `/api/gallery/<slug>/`.
  Thumbnail grid (2-col phone → 4 desktop), `loading="lazy"`, skeleton
  placeholders. Tapping a thumbnail opens a **client lightbox**: full-screen,
  shows the `display` image, **swipe left/right on touch**, prev/next arrow
  buttons + close button on desktop, caption overlay, keyboard arrows/Esc.
  `generateMetadata` per tag. `next/image` stays `unoptimized` (already global).
- Add `/gallery` to `sitemap.ts`; optionally add each tag page.

### Admin — English (`/admin/gallery`, replaces the "Chat Media" nav item)
Two panels on one page (tabs or stacked sections):
1. **Photo Library** — drag-and-drop bulk upload zone (multi-file), progress per
   file, then a grid of all photos: thumbnail, caption/alt inline edit, tag-count
   badge, delete. Reuse the existing admin multi-image upload pattern from
   Products where practical.
2. **Tags** — list of tags (title, slug, count, active, bot-default, order) with
   create/edit/delete. "Manage photos" on a tag opens a grid of all library
   photos with a checkbox/selected-overlay; toggling selects membership; Save
   posts `photo_ids` to the assignment endpoint. Create/edit form: title (auto
   slug preview), description, active, order, bot-default toggle, cover picker.

Remove the old `/admin/chat-media` page and its nav entry; update
`admin/layout.tsx` nav to "Gallery".

## Bot integration (`backend/app/services/chatbot.py`)

- New control tag **`[GALLERY: slug]`** parsed out of the model output before the
  customer sees it, replaced with a link: `{FRONTEND_URL}/gallery/{slug}`
  (Bengali sentence around it stays as the model wrote it). Validate the slug is
  an active tag; if unknown or the model emits a bare `[GALLERY]`, use the
  `is_bot_default` tag. If no default exists, drop the tag silently and log.
- Remove `[IMAGE: key]` / `[ALBUM: key]` handling and all `ChatMedia` reads.
- Update `bot_instructions.md` (the seed file) to document `[GALLERY: slug]` and
  list the current tag slugs as examples. The live persona lives in `BotConfig`
  in the DB and is admin-edited — note in the release that the admin must update
  that text to reference the new gallery slugs (a one-time manual edit; the seed
  only applies on a fresh install).

## Migration

- One migration: drop `ChatMedia`, `ChatMediaImage`; add `GalleryPhoto`,
  `GalleryTag`, and the M2M through table. Current media data is disposable
  (confirmed), so no data migration is needed.
- After model changes: `manage.py check`, `makemigrations`, `migrate`.

## Performance notes

- **Bulk upload is the slow synchronous path.** Each file = 1 original write + 2
  Pillow resizes. To stay within request limits on shared cPanel, the frontend
  uploads in **small batches** (e.g. 4–6 files per request) and shows progress,
  rather than one giant multipart request. The backend processes each file and
  returns per-file results so a single bad file doesn't fail the batch.
- Grids serve only `thumbnail` (≈tens of KB); the `display` image loads only when
  a photo is opened in the lightbox. Original is never served to the storefront.
- Redis caches the two public JSON responses; other parts of the app can use the
  same cache freely (the gallery uses a tiny fraction of 128 MB — only JSON, not
  images).

## Testing

- Frontend (Vitest + RTL): lightbox open/close/next/prev, index tile rendering,
  empty states. Follow the existing `components/ui` TDD pattern.
- Backend: image-processing helper produces display+thumbnail within size caps;
  bulk-upload endpoint reports per-file success/failure; assignment endpoint
  replaces membership; cache invalidation clears the right keys; public API hides
  inactive tags; `is_bot_default` uniqueness on save.
- Bot: `[GALLERY: slug]` → correct link; unknown slug → default tag; no default →
  tag dropped.

## Out of scope (YAGNI)

- Per-tag manual photo ordering (global `order` only for now).
- Pinch-to-zoom in the lightbox (swipe + buttons only).
- Google Photos import/sync (self-hosted only).
- Public photo detail pages / individual photo URLs.
