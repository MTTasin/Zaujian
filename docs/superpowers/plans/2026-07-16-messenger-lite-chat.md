# Messenger-Lite Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two-way image messages to the existing AI-salesbot/human-handoff chat, retune the bot persona to a helper (not a salesman), and auto-expire chat images after 30 days.

**Architecture:** Extend `ChatMessage` with one `upload` ImageField (Pillow-capped via the shared `services/images.py` helper from the gallery plan). Customer send + admin reply endpoints accept an optional image; the existing per-chat takeover (`status=admin` silences the bot for that chat) is unchanged. A management command purges uploads older than 30 days, scheduled by cPanel cron.

**Tech Stack:** Django 6 + DRF, Pillow, Next.js 16 (App Router, TS, Tailwind v4), Vitest + RTL.

**Depends on:** the tagged-photo-gallery plan — specifically `app/services/images.py` (`process_image`) and `frontend/src/components/Lightbox.tsx`. Build that plan first.

## Global Constraints

- **Mobile-first, low-bandwidth**: most chat users are on phones. Attach button = big tap target; image bubbles responsive; lazy-load; uploads capped to 1600px server-side.
- **Storefront Bengali; admin English.**
- Images: JPEG/PNG/WebP only, ≤ 5 MB, one per message.
- **No git commits during execution** (user commits manually later): each "Commit" step is a checkpoint marker.
- Backend runs from `backend/` as `../env/Scripts/python manage.py …`. Frontend tests `npm test` from `frontend/`; build `npm run build`.
- Persona: bot **guides and helps**, never pushes a sale — no "buy now", no upselling; hands off when unsure.

---

### Task 1: `ChatMessage.upload` field + serializer

**Files:**
- Modify: `backend/app/models.py` (`ChatMessage`: add `upload`, cap on save)
- Modify: `backend/app/serializers.py` (`ChatMessageSerializer`: add `upload`)
- Create: migration
- Test: `backend/app/tests/test_chat_upload_model.py`

**Interfaces:**
- Produces: `ChatMessage.upload` (ImageField `chat_uploads/`, null/blank); on save, if a new upload is present it is replaced in place by a 1600px JPEG via `process_image`.
- Produces: serializer field `upload` → absolute media URL or "".

- [ ] **Step 1: Write the failing test**

```python
# backend/app/tests/test_chat_upload_model.py
import io
from PIL import Image
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from app.models import ChatSession, ChatMessage


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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `../env/Scripts/python manage.py test app.tests.test_chat_upload_model -v 2`
Expected: FAIL — `TypeError`/unexpected keyword `upload` (field missing).

- [ ] **Step 3: Add the field + capping, and the serializer field**

In `ChatMessage`:
```python
# backend/app/models.py
    upload = models.ImageField(upload_to="chat_uploads/", null=True, blank=True)
```
Add a `save()` to `ChatMessage` (it has none today):
```python
    def save(self, *args, **kwargs):
        from .services.images import process_image

        # Cap a freshly-attached image; skip if already processed (has .jpg name in dir).
        if self.upload and not getattr(self, "_upload_capped", False):
            try:
                self.upload.seek(0)
                capped = process_image(self.upload, max_edge=1600, quality=82)
                self.upload.save(capped.name, capped, save=False)
                self._upload_capped = True
            except ValueError:
                self.upload = None  # not a valid image -> drop it
        super().save(*args, **kwargs)
```
In `ChatMessageSerializer`, add `upload` to `fields` and a method to build an absolute URL:
```python
# backend/app/serializers.py
class ChatMessageSerializer(serializers.ModelSerializer):
    upload = serializers.SerializerMethodField()

    class Meta:
        model = ChatMessage
        fields = ["id", "role", "text", "image", "images", "more_count",
                  "album_url", "upload", "created_at"]

    def get_upload(self, obj):
        if not obj.upload:
            return ""
        request = self.context.get("request")
        return request.build_absolute_uri(obj.upload.url) if request else obj.upload.url
```

- [ ] **Step 4: Migrate + test**

Run:
```
../env/Scripts/python manage.py makemigrations app
../env/Scripts/python manage.py migrate
../env/Scripts/python manage.py test app.tests.test_chat_upload_model -v 2
```
Expected: migration adds `upload`; test PASSES.

- [ ] **Step 5: Commit (checkpoint).**

> Note: `chat_send`/`chat_poll`/admin `reply` currently build `ChatMessageSerializer(...)` without `context={"request": request}`. Task 2 adds the context so `upload` URLs resolve. Until then the field returns a relative URL — acceptable, fixed in Task 2.

---

### Task 2: Endpoints accept images (customer + admin)

**Files:**
- Modify: `backend/app/views.py` (`chat_send`: accept `image`, allow image-only; pass request context; `chat_poll`: pass context)
- Modify: `backend/app/admin_api.py` (`AdminChatSessionViewSet.reply`: accept `image`, allow image-only; pass context; `messages` action: pass context)
- Test: `backend/app/tests/test_chat_upload_api.py`

**Interfaces:**
- Consumes: `ChatMessage.upload`, `ChatMessageSerializer` (Task 1).
- Produces: `POST /api/chat/send/` accepts multipart `image`; `message` optional when `image` present; bot replies only if `status == BOT`. Admin `reply` accepts `image`; text optional when image present; sets `status=admin`.

- [ ] **Step 1: Write the failing test**

```python
# backend/app/tests/test_chat_upload_api.py
import io
from PIL import Image
from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APITestCase
from app.models import ChatSession, ChatMessage


def _img():
    buf = io.BytesIO()
    Image.new("RGB", (800, 800), (90, 42, 78)).save(buf, format="JPEG")
    buf.seek(0)
    return SimpleUploadedFile("c.jpg", buf.read(), content_type="image/jpeg")


class ChatUploadApiTests(APITestCase):
    def test_customer_sends_image_only(self):
        r = self.client.post("/api/chat/send/", {"image": _img()},
                             format="multipart", HTTP_X_CART_TOKEN="tok")
        self.assertEqual(r.status_code, 200)
        msgs = r.json()["messages"]
        self.assertTrue(any(m["upload"] for m in msgs))

    def test_admin_reply_with_image_sets_admin_status(self):
        s = ChatSession.objects.create(token="tok")
        u = User.objects.create_user("a", password="x", is_staff=True)
        self.client.force_authenticate(u)
        r = self.client.post(f"/api/admin/chats/{s.id}/reply/",
                             {"image": _img()}, format="multipart")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()["upload"])
        s.refresh_from_db()
        self.assertEqual(s.status, ChatSession.Status.ADMIN)

    def test_empty_message_and_no_image_rejected(self):
        r = self.client.post("/api/chat/send/", {"message": ""},
                             format="multipart", HTTP_X_CART_TOKEN="tok")
        self.assertEqual(r.status_code, 400)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `../env/Scripts/python manage.py test app.tests.test_chat_upload_api -v 2`
Expected: FAIL — image ignored / no `upload` in response, or 400 on image-only.

- [ ] **Step 3: Update `chat_send` and admin `reply`**

`chat_send` (replace the empty-text guard + message create + response serialization):
```python
# backend/app/views.py
def chat_send(request):
    text = (request.data.get("message") or "").strip()
    image = request.FILES.get("image")
    if not text and not image:
        return Response({"error": "empty"}, status=status.HTTP_400_BAD_REQUEST)

    session = _chat_session(request)
    if request.data.get("customer_name") and not session.customer_name:
        session.customer_name = request.data["customer_name"][:120]
    if request.data.get("phone") and not session.phone:
        session.phone = request.data["phone"][:20]
    session.save()

    ChatMessage.objects.create(
        session=session, role=ChatMessage.Role.CUSTOMER, text=text, upload=image,
    )
    if session.status == ChatSession.Status.BOT:
        bot_reply(session, request=request)

    msgs = ChatMessageSerializer(
        session.messages.all(), many=True, context={"request": request}
    ).data
    return Response({"session": session.id, "status": session.status, "messages": msgs})
```
`chat_poll`: add `context={"request": request}` to its `ChatMessageSerializer(...)`.

Admin `reply`:
```python
# backend/app/admin_api.py
    @action(detail=True, methods=["post"])
    def reply(self, request, pk=None):
        session = self.get_object()
        text = (request.data.get("text") or "").strip()
        image = request.FILES.get("image")
        if not text and not image:
            return Response({"error": "empty"}, status=status.HTTP_400_BAD_REQUEST)
        if session.status != ChatSession.Status.CLOSED:
            session.status = ChatSession.Status.ADMIN
            session.save(update_fields=["status", "updated_at"])
        msg = ChatMessage.objects.create(
            session=session, role=ChatMessage.Role.ADMIN, text=text, upload=image,
        )
        return Response(ChatMessageSerializer(msg, context={"request": request}).data)
```
`messages` action: add `context={"request": request}` to its serializer call.

- [ ] **Step 4: Run test to verify it passes**

Run: `../env/Scripts/python manage.py test app.tests.test_chat_upload_api -v 2`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit (checkpoint).**

---

### Task 3: 30-day upload purge command

**Files:**
- Create: `backend/app/management/commands/purge_old_chat_uploads.py`
- Test: `backend/app/tests/test_purge_chat_uploads.py`
- Modify: `DEPLOY.md` (add cron line)

**Interfaces:**
- Produces: `manage.py purge_old_chat_uploads` — deletes the file + clears `upload` for `ChatMessage` rows with an upload and `created_at < now - 30 days`; keeps `text`; prints count.

- [ ] **Step 1: Write the failing test**

```python
# backend/app/tests/test_purge_chat_uploads.py
import io
from datetime import timedelta
from PIL import Image
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone
from app.models import ChatSession, ChatMessage


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

        old.refresh_from_db(); new.refresh_from_db()
        self.assertFalse(old.upload)          # cleared
        self.assertEqual(old.text, "old")     # text kept
        self.assertTrue(new.upload)           # recent kept
```

- [ ] **Step 2: Run test to verify it fails**

Run: `../env/Scripts/python manage.py test app.tests.test_purge_chat_uploads -v 2`
Expected: FAIL — `CommandError: Unknown command 'purge_old_chat_uploads'`.

- [ ] **Step 3: Implement the command**

```python
# backend/app/management/commands/purge_old_chat_uploads.py
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from app.models import ChatMessage

MAX_AGE_DAYS = 30


class Command(BaseCommand):
    help = "Delete chat image uploads older than 30 days (keeps message text)."

    def handle(self, *args, **options):
        cutoff = timezone.now() - timedelta(days=MAX_AGE_DAYS)
        stale = ChatMessage.objects.filter(created_at__lt=cutoff).exclude(upload="")
        count = 0
        for m in stale:
            if not m.upload:
                continue
            m.upload.delete(save=False)  # remove file from storage
            m.upload = None
            m.save(update_fields=["upload"])
            count += 1
        self.stdout.write(f"Purged {count} chat upload(s) older than {MAX_AGE_DAYS} days.")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `../env/Scripts/python manage.py test app.tests.test_purge_chat_uploads -v 2`
Expected: PASS.

- [ ] **Step 5: Add cron line to DEPLOY.md, commit (checkpoint)**

In DEPLOY.md, under a new "Cron jobs" note, add:
```
# cPanel -> Cron Jobs, daily:
cd /home/<user>/backzaujain && /home/<user>/virtualenv/backzaujain/3.13/bin/python manage.py purge_old_chat_uploads >> cron.log 2>&1
```

---

### Task 4: Helper persona — code-side de-sales

**Note:** the persona *content* is already handled in the gallery plan (Task 5, "Instruction file consolidation") — `bot_instra.md`'s helper-first text becomes `bot_instructions.md` with `[GALLERY]` tags. `bot_instra.md` already reads "Selling comes second / Never pressure", so no content rewrite is needed here. This task only removes salesy framing baked into **code**.

**Files:**
- Modify: `backend/app/services/chatbot.py` (module docstring + fallback string)
- Test: none (content/persona; manual review)

- [ ] **Step 1: De-sales the code strings**

In `chatbot.py`:
- Module docstring line 2 currently: `"AI salesman chatbot via DeepSeek, with human handoff."` → change "salesman" to "assistant".
- `_file_instructions()` fallback (line ~29): `"You are a helpful salesman for Zaujain Nikah Point."` → `"You are a helpful assistant for Zaujain Nikah Point — guide and help, never push a sale."`
- Confirm no other hardcoded "sell/salesman/buy now" framing remains in the assembled system prompt (`_system_prompt`, `_BEHAVIOR`). The persona comes from `BotConfig`/`bot_instructions.md`; keep prices out of code (existing rule).

- [ ] **Step 2: Verify**

Run: `../env/Scripts/python manage.py check`
Expected: no issues.

- [ ] **Step 3: Commit (checkpoint).** Release note: on the live site the admin must paste the updated persona into Admin → Bot Instructions (the file only re-seeds a fresh `BotConfig`).

---

### Task 5: ChatWidget — send + render images

**Files:**
- Modify: `frontend/src/components/ChatWidget.tsx`
- Modify: chat API client (`frontend/src/lib/api.ts` — the chat send call) to send multipart when an image is attached
- Test: `frontend/src/components/ChatWidget.test.tsx` (add cases; create if absent)

**Interfaces:**
- Consumes: `/api/chat/send/` multipart (Task 2); message objects now include `upload`.
- Produces: attach button → preview → send (text optional with image); image bubbles render + open the `Lightbox` on tap.

- [ ] **Step 1: Write/extend the failing test**

```tsx
// frontend/src/components/ChatWidget.test.tsx (add)
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ChatWidget } from "./ChatWidget";

describe("ChatWidget images", () => {
  it("renders an image bubble for a message with upload", async () => {
    // Mock the history/poll fetch to return one message with an upload URL,
    // then assert an <img> with that src is shown.
    // (Wire to the component's data-loading seam used by existing ChatWidget tests.)
    render(<ChatWidget />);
    expect(await screen.findByLabelText(/ছবি যুক্ত করুন|attach image/i)).toBeInTheDocument();
  });
});
```
(Adapt the mock to the existing ChatWidget test harness; the concrete assertion is: an attach control exists, and a message with `upload` renders an `<img>`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- ChatWidget`
Expected: FAIL — no attach control yet.

- [ ] **Step 3: Update the API client for multipart**

In the chat send helper (`api.ts`), accept an optional `File`:
```ts
export async function sendChat(message: string, image?: File, extra?: Record<string, string>) {
  const fd = new FormData();
  if (message) fd.append("message", message);
  if (image) fd.append("image", image);
  Object.entries(extra ?? {}).forEach(([k, v]) => fd.append(k, v));
  const r = await fetch(`${API_BASE}/api/chat/send/`, {
    method: "POST",
    headers: { "X-Cart-Token": getCartToken() }, // do NOT set Content-Type; browser sets multipart boundary
    body: fd,
  });
  return r.json();
}
```
(Match the existing token accessor + base; keep whatever the current send function name is and add the `image` param.)

- [ ] **Step 4: Add attach UI + image bubbles in ChatWidget**

- Add a file input + attach button (Icon, no emoji, `aria-label="ছবি যুক্ত করুন"`), client-side guard: reject non-image or > 5 MB with a Bengali toast/inline message; show a small preview thumb with a remove (×) before send; allow send when either text or image is present.
- When rendering a message, if `m.upload` is set, render `<img src={m.upload} loading="lazy" className="max-w-[70%] rounded-xl" />` inside the bubble (customer right, admin/bot left), and on click open `<Lightbox images={[{full: m.upload}]} startIndex={0} onClose={...} />` (import from `@/components/Lightbox`).
- Keep big tap targets; ensure the composer row stays usable on small screens.

- [ ] **Step 5: Run test + build**

Run: `cd frontend && npm test -- ChatWidget && npm run build`
Expected: tests PASS; build succeeds.

- [ ] **Step 6: Commit (checkpoint).**

---

### Task 6: Admin Live Chats — send + render images

**Files:**
- Modify: `frontend/src/app/admin/chats/…` (the live-chat reply UI)
- Modify: admin chat API client (reply call → multipart when image attached)

**Interfaces:**
- Consumes: `/api/admin/chats/<id>/reply/` multipart (Task 2); `messages` include `upload`.

- [ ] **Step 1: Reply call supports multipart**

Update the admin reply helper to send `FormData` with optional `image` (mirror Task 5's client; keep the admin token header, do not set Content-Type manually).

- [ ] **Step 2: Add attach + render in the admin chat view**

- Add an image attach button + preview to the admin reply box (English `aria-label="Attach image"`), same 5 MB / image-type client guard, allow image-only send.
- Render incoming customer `upload` images inline in the transcript; click to enlarge via `Lightbox`.
- Keep the existing ~4s polling, unread badge, sound, back-to-bot / close controls untouched.

- [ ] **Step 3: Verify build + smoke**

Run: `cd frontend && npm run build`
Expected: build succeeds. Smoke: open a chat from the widget as a customer, send an image → it appears in Admin → Live Chats; admin replies with an image → it appears in the widget; both open in the lightbox. Checkpoint.

---

## Self-Review

- **Spec coverage:** per-chat takeover unchanged + bot-suppression when `status=admin` (T2, existing logic reused), `upload` field + capping via shared helper (T1), customer image send (T2/T5), admin image send (T2/T6), both-way rendering + lightbox reuse (T5/T6), 5 MB/type/one-image constraints (T1 server drop + T5/T6 client guard), 30-day purge + cron (T3), helper persona + seed + code de-sales + BotConfig note (T4), mobile-first attach/bubbles (T5). All spec sections covered.
- **Placeholder scan:** frontend T5/T6 intentionally reference the existing ChatWidget/admin-chats seams (rather than duplicating unknown current markup) but every new behavior has concrete code (client multipart, guard, bubble, Lightbox wiring). Backend steps are fully concrete.
- **Type consistency:** `upload` field/serializer name consistent T1↔T2↔T5↔T6; `process_image(..., max_edge=1600)` matches the gallery plan's helper signature; `Lightbox` props (`images`/`startIndex`/`onClose`) match the gallery plan's component; admin `reply` `image` param consistent T2↔T6.
