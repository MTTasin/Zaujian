# Messenger-Lite Chat — Design Spec

Date: 2026-07-16
Status: Approved for planning

## Goal

Upgrade the existing AI salesbot + human-handoff chat into a lightweight
Messenger-style channel: **text + images only**. Customers can send images so an
admin can see what they mean; admins can send images back. The AI answers by
default; when an admin takes over a specific conversation, the bot stops for that
conversation only. Chat images auto-expire after 30 days to save disk.

This builds on the current system (`ChatSession`, `ChatMessage`, Live Chats
polling, unread badge/sound). It does **not** add presence/heartbeat.

## Chat-handling model (decided)

**Per-chat takeover.** Bot answers every chat by default. When an admin sends a
message in a chat, that chat's `status` becomes `admin` and the bot stops
replying **there only**; other chats keep getting bot replies. "Hand back to
bot" resets `status` to `bot`. The existing `[HANDOFF]` control tag still moves a
session to `waiting_admin`. No global presence switch — "AI replies unless a
human jumps into that chat" already satisfies "AI when no admin is active".

Bot reply suppression rule: when an incoming customer message belongs to a
session whose `status` is `admin` or `waiting_admin`, the bot is **not** called.
Otherwise the bot replies as it does today.

## Bot persona (helper, not salesman)

The bot's job is to **guide and help**, never to push a sale. Warm, patient,
plain Bengali; explains products, answers questions, points to the right gallery
tag or page, and offers to connect a human when unsure. No pressure tactics, no
"buy now" nudging, no upselling. When it can't help, it hands off (`[HANDOFF]`)
rather than guessing.

The persona text lives in `BotConfig` (DB, admin-edited live). This spec updates
the seed file `bot_instructions.md` tone accordingly and removes any salesy
framing from code-side system prompt scaffolding in `chatbot.py`. On existing
installs the admin re-points/edits the live `BotConfig` text; the seed only
applies on a fresh install.

## Data model (`backend/app/models.py`)

Extend `ChatMessage` (no new models):

| Field | Type | Notes |
|-------|------|-------|
| `upload` | ImageField `upload_to="chat_uploads/"` null, blank | A real image sent by a customer or admin. Pillow-capped to 1600px longest edge, JPEG q82, on save (reuses the gallery image helper). |

Existing fields kept for compatibility: `image` (URLField), `images` (JSON),
`more_count`, `album_url` — the bot now mostly sends `[GALLERY: slug]` text links
(see gallery spec), so these are rarely populated going forward but not removed.

`role` already distinguishes `customer` / `bot` / `admin` / `system`, so the
sender of an `upload` is known from `role`.

## Image handling

- Accepted types: JPEG, PNG, WebP. Max 5 MB per file. One image per message.
- Processing: the shared image helper (from the gallery work) opens with Pillow,
  fixes EXIF orientation, converts to RGB, caps to 1600px, saves JPEG q82. Non-
  images or oversize → HTTP 400 with a clear message; the widget/admin surfaces
  it. Runs synchronously in the request (single small image = fast; no queue).
- Storage: Django media folder `chat_uploads/`. Served via the existing prod
  media route.

## Endpoints (`backend/app/urls.py`, views)

Extend the existing chat send + admin reply endpoints rather than adding new
ones.

- **Customer send** (`POST /api/chat/send/`, existing): also accept an optional
  multipart `image` file. Creates `ChatMessage(role="customer", text?, upload?)`.
  At least one of text/image required. Bot is called only if session status is
  `bot` (unchanged suppression logic, now also covers image-only messages).
  Response includes the new message with `upload` URL.
- **Admin reply** (existing admin live-chat send): also accept an optional
  `image` file. Creates `ChatMessage(role="admin", text?, upload?)` and sets
  session `status="admin"`. Response includes the message with `upload` URL.
- Message serialization everywhere (customer poll, admin poll, history) includes
  `upload` (absolute/media URL) so both sides render images.

## Frontend (mobile-first)

### ChatWidget (`frontend/src/components/…` storefront)
- Add an **image attach button** (from `components/ui/Icon`, no emoji) next to the
  input. Pick file → show a small preview thumb with a remove (x) → send (text
  optional when an image is attached).
- Render image messages as inline bubbles (customer's own on the right, admin's
  on the left), responsive `max-width`, `loading="lazy"`. Tapping an image opens
  a **full-screen view** — reuse the gallery lightbox component.
- Big tap targets; works on low-end Android. Client-side guard: reject >5 MB /
  wrong type before upload with a Bengali message.

### Admin Live Chats (`frontend/src/app/admin/chats`)
- Add an image attach + send control to the reply box (English UI).
- Render customer-sent images inline; click to enlarge (lightbox). Keep the
  existing polling (~4s), unread badge, sound, back-to-bot / close controls.

## Auto-expiry of chat images (30 days)

No job queue → a management command run by cPanel cron.

- `backend/app/management/commands/purge_old_chat_uploads.py`: find
  `ChatMessage` rows where `upload` is set and `created_at < now - 30 days`;
  delete the file from storage and clear the `upload` field. The text of the
  message is preserved. The UI renders a cleared-image bubble as an "image
  expired" placeholder (Bengali: "ছবির মেয়াদ শেষ" on the widget; English on
  admin).
- Idempotent and safe to run daily. Logs how many it purged.
- **Only chat uploads expire.** Gallery photos, product images, etc. are never
  touched.
- DEPLOY.md gets a cron line, e.g. daily:
  `cd <backend> && <venv>/bin/python manage.py purge_old_chat_uploads`.

## Testing

- Backend: customer send with image creates a customer `upload`; admin send with
  image sets `status="admin"` and stores the `upload`; bot is not called when
  status is `admin`/`waiting_admin`; oversized/wrong-type rejected (400); image
  helper caps dimensions; `purge_old_chat_uploads` deletes only uploads older
  than 30 days and clears the field while keeping text.
- Frontend (Vitest + RTL): attach → preview → send flow; image bubble renders;
  lightbox open/close; client-side size/type rejection; expired-image
  placeholder.

## Out of scope (YAGNI)

- Presence / heartbeat / online indicators.
- Typing indicators, read receipts beyond the existing `read_by_admin`.
- Multiple images per message; video, audio, or file attachments.
- Editing/deleting sent messages.
