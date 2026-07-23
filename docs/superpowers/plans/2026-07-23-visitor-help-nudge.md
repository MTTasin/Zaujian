# Visitor Tracking + Help Nudge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect a stuck storefront visitor and show a "contact us on WhatsApp" popup, while recording minimal daily counters (visitors / popups shown / popups clicked).

**Architecture:** A client `HelpNudge` component watches four behavior signals and shows a once-per-session popup; a public `nudge-event` endpoint atomically bumps a single `DailyStat` row; the admin dashboard surfaces today's counters.

**Tech Stack:** Django 6 + DRF, Next.js 16 + TS, Vitest + RTL.

## Global Constraints

- **No git commands / no commits** (user forbids git mutations). Skip every "Commit" step.
- Backend from `backend/`: `../env/Scripts/python manage.py <cmd>`. Test: `../env/Scripts/python manage.py test app.tests.<module>`.
- Frontend tests: `cd frontend && npm test`. Build: `npm run build`.
- No per-visitor rows, no PII. Only the three daily counters.
- Storefront audience: mobile, low literacy, slow net — big tap targets, image-light, Bengali copy.
- Popup shows at most once per browser session; never while chat is open (`body.dataset.chatOpen === "true"`).
- Spec: `docs/superpowers/specs/2026-07-23-visitor-help-nudge-design.md`.

---

### Task 1: `DailyStat` model

**Files:**
- Modify: `backend/app/models.py`
- Test: `backend/app/tests/test_nudge.py` (create)

**Interfaces:**
- Produces: `DailyStat(date unique, visitors, popups_shown, popups_clicked)`.

- [ ] **Step 1: Write the failing test**

```python
# backend/app/tests/test_nudge.py
from django.test import TestCase
from django.utils import timezone

from app.models import DailyStat


class DailyStatModelTests(TestCase):
    def test_defaults_and_uniqueness(self):
        d = timezone.localdate()
        s = DailyStat.objects.create(date=d)
        self.assertEqual((s.visitors, s.popups_shown, s.popups_clicked), (0, 0, 0))
        from django.db import IntegrityError, transaction
        with self.assertRaises(IntegrityError), transaction.atomic():
            DailyStat.objects.create(date=d)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `../env/Scripts/python manage.py test app.tests.test_nudge`
Expected: FAIL — `ImportError: cannot import name 'DailyStat'`.

- [ ] **Step 3: Add the model**

In `backend/app/models.py` (near the end):

```python
class DailyStat(models.Model):
    """One row per day of lightweight storefront counters (no per-visitor rows)."""
    date = models.DateField(unique=True)
    visitors = models.PositiveIntegerField(default=0)
    popups_shown = models.PositiveIntegerField(default=0)
    popups_clicked = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["-date"]

    def __str__(self):
        return f"Stats {self.date}: {self.visitors} visitors"
```

- [ ] **Step 4: Migrate**

Run: `../env/Scripts/python manage.py makemigrations app && ../env/Scripts/python manage.py migrate`
Expected: new migration; applies cleanly.

- [ ] **Step 5: Run test to verify it passes**

Run: `../env/Scripts/python manage.py test app.tests.test_nudge`
Expected: PASS.

- [ ] **Step 6: Commit** — SKIP (no git).

---

### Task 2: `nudge-event` public endpoint

**Files:**
- Modify: `backend/app/views.py` (new `nudge_event` view)
- Modify: `backend/app/urls.py` (route)
- Test: `backend/app/tests/test_nudge.py` (add API test class)

**Interfaces:**
- Consumes: `DailyStat` (Task 1).
- Produces: `POST /api/nudge-event/` `{type: "visit"|"shown"|"clicked"}` → 200; bad type → 400.

- [ ] **Step 1: Write the failing test**

```python
# append to backend/app/tests/test_nudge.py
from rest_framework.test import APITestCase


class NudgeEventApiTests(APITestCase):
    def _post(self, t):
        return self.client.post("/api/nudge-event/", {"type": t}, format="json")

    def test_each_type_increments_one_counter(self):
        for t in ["visit", "shown", "clicked", "visit"]:
            self.assertEqual(self._post(t).status_code, 200)
        d = DailyStat.objects.get()          # single row for today
        self.assertEqual(d.visitors, 2)
        self.assertEqual(d.popups_shown, 1)
        self.assertEqual(d.popups_clicked, 1)

    def test_unknown_type_400(self):
        self.assertEqual(self._post("wat").status_code, 400)
        self.assertFalse(DailyStat.objects.exists())
```

Add `from django.utils import timezone` already imported at top of the test file from Task 1 — reuse.

- [ ] **Step 2: Run test to verify it fails**

Run: `../env/Scripts/python manage.py test app.tests.test_nudge.NudgeEventApiTests`
Expected: FAIL — 404 (no route).

- [ ] **Step 3: Implement the view**

In `backend/app/views.py` (follow the existing `@api_view` style, e.g. near `shop_info`):

```python
_NUDGE_FIELDS = {"visit": "visitors", "shown": "popups_shown", "clicked": "popups_clicked"}


@api_view(["POST"])
@permission_classes([AllowAny])
def nudge_event(request):
    """Public: bump one of today's DailyStat counters. No PII, no per-visitor rows."""
    from django.db.models import F
    from django.utils import timezone
    from .models import DailyStat

    field = _NUDGE_FIELDS.get(str(request.data.get("type", "")))
    if not field:
        return Response({"error": "invalid type"}, status=status.HTTP_400_BAD_REQUEST)
    today = timezone.localdate()
    DailyStat.objects.get_or_create(date=today)
    DailyStat.objects.filter(date=today).update(**{field: F(field) + 1})
    return Response({"ok": True})
```

Confirm `AllowAny`, `api_view`, `permission_classes`, `Response`, `status` are imported
in `views.py` (they are used by other public views — reuse existing imports).

- [ ] **Step 4: Add the route**

In `backend/app/urls.py`, alongside the other public paths (e.g. after `shop-info/`):

```python
    path("nudge-event/", views.nudge_event, name="nudge-event"),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `../env/Scripts/python manage.py test app.tests.test_nudge`
Expected: PASS (all).

- [ ] **Step 6: Commit** — SKIP (no git).

---

### Task 3: Dashboard counters

**Files:**
- Modify: `backend/app/admin_api.py` (`admin_dashboard`)
- Test: `backend/app/tests/test_nudge.py` (add dashboard test)

**Interfaces:**
- Produces: `admin_dashboard` response gains `visitors_today`, `popups_shown_today`, `popups_clicked_today`.

- [ ] **Step 1: Write the failing test**

```python
# append to backend/app/tests/test_nudge.py
from django.contrib.auth.models import User


class DashboardStatsTests(APITestCase):
    def setUp(self):
        self.client.force_authenticate(User.objects.create_user("admin", password="x", is_staff=True))

    def test_dashboard_returns_today_counters(self):
        DailyStat.objects.create(date=timezone.localdate(), visitors=5, popups_shown=2, popups_clicked=1)
        r = self.client.get("/api/admin/dashboard/")
        self.assertEqual(r.json()["visitors_today"], 5)
        self.assertEqual(r.json()["popups_shown_today"], 2)
        self.assertEqual(r.json()["popups_clicked_today"], 1)

    def test_dashboard_zeros_when_no_row(self):
        r = self.client.get("/api/admin/dashboard/")
        self.assertEqual(r.json()["visitors_today"], 0)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `../env/Scripts/python manage.py test app.tests.test_nudge.DashboardStatsTests`
Expected: FAIL — `KeyError: 'visitors_today'`.

- [ ] **Step 3: Implement**

In `admin_dashboard` (`backend/app/admin_api.py`), before the `return Response({...})`:

```python
    from .models import DailyStat
    stat = DailyStat.objects.filter(date=today).first()
```

Add to the returned dict:

```python
        "visitors_today": stat.visitors if stat else 0,
        "popups_shown_today": stat.popups_shown if stat else 0,
        "popups_clicked_today": stat.popups_clicked if stat else 0,
```

(`today = timezone.localdate()` already exists at the top of `admin_dashboard`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `../env/Scripts/python manage.py test app.tests.test_nudge`
Expected: PASS. Then `../env/Scripts/python manage.py test app` → OK (no regressions).

- [ ] **Step 5: Commit** — SKIP (no git).

---

### Task 4: `markProgress` helper + ChatWidget open flag

**Files:**
- Create: `frontend/src/lib/progress.ts`
- Modify: `frontend/src/components/ChatWidget.tsx`
- Modify: `frontend/src/lib/api.ts` (add `postNudgeEvent`)
- Test: `frontend/src/lib/progress.test.ts` (create)

**Interfaces:**
- Produces: `markProgress()`, `hasProgress()` (module + sessionStorage flag); `postNudgeEvent(type)`; `ChatWidget` sets `document.body.dataset.chatOpen`.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/lib/progress.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { markProgress, hasProgress } from "./progress";

describe("progress", () => {
  beforeEach(() => sessionStorage.clear());
  it("starts false, true after markProgress", () => {
    expect(hasProgress()).toBe(false);
    markProgress();
    expect(hasProgress()).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- progress`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

```ts
// frontend/src/lib/progress.ts
const KEY = "hn_progress";

export function markProgress(): void {
  try { sessionStorage.setItem(KEY, "1"); } catch {}
}

export function hasProgress(): boolean {
  try { return sessionStorage.getItem(KEY) === "1"; } catch { return false; }
}
```

- [ ] **Step 4: Add `postNudgeEvent`**

In `frontend/src/lib/api.ts`, add (use the existing POST helper — `apiSend`/`apiPost` —
matching how other public posts are written):

```ts
export const postNudgeEvent = (type: "visit" | "shown" | "clicked") =>
  apiSend<{ ok: boolean }>("nudge-event/", "POST", { type }).catch(() => null);
```

(Adjust to the actual exported helper name in this file. It must swallow errors — a
failed counter must never break the page.)

- [ ] **Step 5: ChatWidget open flag**

In `frontend/src/components/ChatWidget.tsx`, add an effect that reflects `open` onto the
body dataset (so `HelpNudge` can detect it):

```tsx
useEffect(() => {
  document.body.dataset.chatOpen = open ? "true" : "false";
}, [open]);
```

- [ ] **Step 6: Run test to verify it passes + build**

Run: `cd frontend && npm test -- progress` → PASS. Then `npm run build` → succeeds.

- [ ] **Step 7: Commit** — SKIP (no git).

---

### Task 5: `HelpNudge` component + mount

**Files:**
- Create: `frontend/src/components/HelpNudge.tsx`
- Modify: `frontend/src/app/layout.tsx` (mount next to `ChatWidget`)
- Test: `frontend/src/components/HelpNudge.test.tsx` (create)

**Interfaces:**
- Consumes: `getShopInfo().whatsapp_number`, `postNudgeEvent`, `hasProgress`, `body.dataset.chatOpen`.

- [ ] **Step 1: Write the failing tests**

```tsx
// frontend/src/components/HelpNudge.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import HelpNudge from "./HelpNudge";

vi.mock("@/lib/api", () => ({
  getShopInfo: () => Promise.resolve({ whatsapp_number: "01959976683" }),
  postNudgeEvent: () => Promise.resolve(null),
}));

describe("HelpNudge", () => {
  beforeEach(() => { vi.useFakeTimers(); sessionStorage.clear(); localStorage.clear();
    document.body.dataset.chatOpen = "false"; });
  afterEach(() => vi.useRealTimers());

  it("shows the WhatsApp popup after the idle threshold", async () => {
    render(<HelpNudge />);
    await act(async () => { await Promise.resolve(); });     // resolve shop-info
    await act(async () => { vi.advanceTimersByTime(31000); });
    expect(screen.getByText(/সাহায্য/)).toBeTruthy();
    const link = screen.getByRole("link") as HTMLAnchorElement;
    expect(link.href).toContain("wa.me/8801959976683");
  });

  it("does not show while chat is open", async () => {
    document.body.dataset.chatOpen = "true";
    render(<HelpNudge />);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(31000); });
    expect(screen.queryByText(/সাহায্য/)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm test -- HelpNudge`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `HelpNudge`**

Create `frontend/src/components/HelpNudge.tsx` — a `"use client"` component. Behavior:
- Return null on `/admin` (usePathname) and after dismissal/shown gate this session
  (`sessionStorage hn_shown`).
- Fetch `getShopInfo()` once for `whatsapp_number`.
- Fire `postNudgeEvent("visit")` once per day (guard `localStorage hn_counted_<date>`).
- Constants at top: `IDLE_MS = 30000`, `DWELL_MS = 60000`, `LOOP_LIMIT = 5`.
- **Idle** timer: reset on `pointerdown/keydown/scroll/touchstart`; on expiry → `trigger()`.
- **Dwell** timer: `DWELL_MS` after mount → if `!hasProgress()` → `trigger()`.
- **Loop**: on `usePathname` change, push to a `sessionStorage` list; if
  `changes >= LOOP_LIMIT && distinctPaths <= 2 && !hasProgress()` → `trigger()`.
- **Repeat + empty cart**: on mount, if `localStorage hn_visited` set and cart empty and
  `!hasProgress()` → `trigger()`; always set `hn_visited`. (Empty cart: call `getCart()`
  and check `items.length === 0`, swallow errors.)
- `trigger()`: if `body.dataset.chatOpen === "true"` or already shown this session →
  abort; else set `hn_shown`, `postNudgeEvent("shown")`, `setVisible(true)`.
- Popup markup (Bengali): heading "সাহায্য দরকার?", body line, a `wa.me` **link**
  (`https://wa.me/88${digits}`) that calls `postNudgeEvent("clicked")` on click, and a
  dismiss button. Big tap targets; `role="dialog"`, backdrop + Escape close.

Write the component so the two tests above pass (idle path shows the popup with the
correct link; chat-open suppresses it).

- [ ] **Step 4: Mount in layout**

In `frontend/src/app/layout.tsx`, add `<HelpNudge />` inside `ToastProvider`, next to
`<ChatWidget />`.

- [ ] **Step 5: Run tests to verify they pass + build**

Run: `cd frontend && npm test -- HelpNudge` → PASS. Then `npm run build` → succeeds.

- [ ] **Step 6: Commit** — SKIP (no git).

---

### Task 6: Wire `markProgress` + admin Today card

**Files:**
- Modify: product/combo card + primary CTA click handlers (storefront) to call `markProgress()`
- Modify: `frontend/src/lib/adminApi.ts` (dashboard type), `frontend/src/app/admin/page.tsx`

**Interfaces:**
- Consumes: `markProgress` (Task 4); dashboard `visitors_today`/`popups_shown_today`/`popups_clicked_today` (Task 3).

- [ ] **Step 1: Call `markProgress()` on real engagement**

Find the storefront product/combo card components and the primary CTAs (customize
button, add-to-cart). In their click/success handlers, call `markProgress()` (import
from `@/lib/progress`). Keep it minimal — a single call each; do not alter their other
behavior. Grep for the add-to-cart handler and the product/combo `Link`/card onClick.

- [ ] **Step 2: Admin Today card**

In `frontend/src/lib/adminApi.ts` add `visitors_today: number; popups_shown_today: number;
popups_clicked_today: number;` to the dashboard type. In `frontend/src/app/admin/page.tsx`,
add a small "Today" group (reuse the existing `StatCard`) showing Visitors,
Popups shown, Popups clicked.

- [ ] **Step 3: Verify build**

Run: `cd frontend && npm run build`
Expected: succeeds.
Manual: tapping a product marks progress (dwell popup then suppressed); dashboard shows
today's three numbers.

- [ ] **Step 4: Commit** — SKIP (no git).

---

## Self-Review Notes
- Spec coverage: model (T1), endpoint (T2), dashboard API (T3), helper+chat flag (T4), popup+mount (T5), progress wiring + admin card (T6). All covered.
- Minimal storage honored: single `DailyStat` row/day, atomic `F()` bumps, no PII.
- Once-per-session + chat-open suppression enforced in `HelpNudge` and asserted in T5.
- Counter failures swallowed (`postNudgeEvent().catch`) so tracking never breaks the page.
- Type consistency: `DailyStat` fields identical across model (T1), endpoint map (T2), dashboard (T3), TS dashboard type (T6).
