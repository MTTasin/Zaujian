# Visitor tracking + "need help?" WhatsApp nudge — Design

**Date:** 2026-07-23
**Status:** Approved, ready for plan

## Goal
Detect when a storefront visitor appears **stuck**, and show a gentle popup inviting
them to contact us on WhatsApp. Keep **minimal** server storage (daily counters only,
no per-visitor rows) suited to shared cPanel with no job queue.

## Decisions (locked)
- Triggers: **idle**, **long dwell without progress**, **looping**, **repeat visit with
  empty cart** — fire on ANY. ("Do the best" — all four, with a single show-once gate.)
- Storage: **minimal** — one `DailyStat` row per day with three counters. No per-visit
  rows, no cleanup cron needed.
- Popup uses the existing WhatsApp number from `shop-info` (`whatsapp_number`).

## Confusion heuristic (client-side, `HelpNudge` component)
Runs on the storefront only (not `/admin`). All thresholds are constants at the top of
the component so they are trivially tunable. Shows the popup at most **once per browser
session** (`sessionStorage` gate), and never while the chat widget is open.

Signals (popup fires when any is met):
1. **Idle** — no `pointerdown` / `keydown` / `scroll` / `touchstart` for `IDLE_MS`
   (default 30000). Timer resets on any of those events.
2. **Long dwell, no progress** — `DWELL_MS` (default 60000) elapsed since first load
   without a "progress action". A progress action = tapping a product/combo card, a
   primary CTA (customize / add-to-cart), or an add-to-cart success. Progress is marked
   by a shared helper `markProgress()` (called from those click handlers) that sets a
   module flag + `sessionStorage`.
3. **Looping** — `LOOP_LIMIT` (default 5) route changes while visiting `≤ 2` distinct
   paths. Tracked from Next's `usePathname` across navigations (counts kept in
   `sessionStorage`).
4. **Repeat visit, empty cart** — a prior visit is recorded in `localStorage`
   (`hn_visited`), the current cart is empty (cart token has no items), and no progress
   yet this session. Checked shortly after load.

On fire: set the session gate, POST a `shown` event, render the popup.

### Popup UI
- Centered, dismissible card (Bengali): heading "সাহায্য দরকার?", line "কোনো প্রশ্ন
  থাকলে সরাসরি হোয়াটসঅ্যাপে আমাদের জানান।", a large `wa.me` button with the number, and
  a "না, ধন্যবাদ" dismiss. Big tap targets, image-light (audience = low literacy, slow
  net).
- Tapping the WhatsApp button POSTs a `clicked` event, then opens
  `https://wa.me/88<digits>`.
- Respects `prefers-reduced-motion`; traps nothing (simple overlay, Escape/backdrop
  closes).

## Minimal server storage
New model `DailyStat` (`app/models.py`):
```python
class DailyStat(models.Model):
    date = models.DateField(unique=True)
    visitors = models.PositiveIntegerField(default=0)
    popups_shown = models.PositiveIntegerField(default=0)
    popups_clicked = models.PositiveIntegerField(default=0)
```

Public endpoint `POST /api/nudge-event/` body `{ "type": "visit" | "shown" | "clicked" }`:
- `get_or_create(date=today)` then atomic `F()`-increment the matching counter:
  `visit → visitors`, `shown → popups_shown`, `clicked → popups_clicked`.
- Unknown type → 400. No auth (public), no PII stored. Rate-note: the client fires
  `visit` at most once per session (localStorage `hn_counted_<date>`), `shown`/`clicked`
  at most once per session each.

Dashboard: `admin_dashboard` gains today's `visitors`, `popups_shown`,
`popups_clicked` (from today's `DailyStat`, zeros if none). A small "Today" card group
on the admin dashboard shows them.

## Chat-widget coordination
`ChatWidget` sets `document.body.dataset.chatOpen = "true"|"false"` from its `open`
state (one-line effect). `HelpNudge` checks that flag and suppresses/aborts the popup
while chat is open — avoids competing overlays.

## Files
- Backend: `app/models.py` (+`DailyStat`, migration), `app/views.py`
  (`nudge_event` view), `app/urls.py` (route), `app/admin_api.py` (dashboard fields),
  `app/tests/test_nudge.py`.
- Frontend: `src/components/HelpNudge.tsx` (new), mount in `src/app/layout.tsx`
  (next to `ChatWidget`), `src/lib/api.ts` (`postNudgeEvent`, `whatsapp_number`
  already added), `src/lib/progress.ts` (new — `markProgress` shared helper),
  wire `markProgress()` into product/combo card + primary CTA click handlers,
  `src/components/ChatWidget.tsx` (set `body.dataset.chatOpen`),
  `src/app/admin/page.tsx` (Today stats card).

## Out of scope
- Per-visitor analytics, funnels, geographic/referrer breakdowns.
- A/B testing thresholds or server-driven config (constants live in the component).
- Showing the popup more than once per session or across sessions on a schedule.

## Testing
- Backend (`test_nudge.py`): each `type` increments the right counter; second call same
  day increments (not duplicate rows); unknown type → 400; dashboard returns today's
  counters.
- Frontend (Vitest + RTL): `HelpNudge` fires the popup after the idle threshold (fake
  timers); does not fire while `body.dataset.chatOpen === "true"`; WhatsApp button
  builds the correct `wa.me` link; dismiss + session gate prevents re-show. `markProgress`
  suppresses the dwell trigger.
