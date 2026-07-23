# Order fidelity, themed emails, and location data — design

Date: 2026-07-21
Status: approved (design), not yet planned

Three independent changes, grouped because all three surface the same thing: what
the customer told us at checkout, shown back to them (or to the admin) accurately.

1. Combo orders show blank grey tiles in the admin instead of the chosen design.
2. Order emails are unstyled plain text.
3. The Division→District→Thana list is missing a district and most metro thanas.

They share no code. Each can ship alone, in any order.

---

## 1. Combo config images

### Problem

Admin → Orders → an order placed from a `PrebuiltCombo` renders a row of grey
boxes labelled `নির্বাচিত` ("selected"). The customer's actual chosen corner /
center / inside design is not visible anywhere in the admin. The business cannot
produce the order without opening the combo record and guessing.

### Cause

Two places, both in `backend/app/serializers.py`:

- `_preset_lines()` (~line 291) snapshots corner / center / inside / static as the
  bare string `"নির্বাচিত"`. It checks the option exists, then discards its id.
  Only `রং` keeps a real name; customer-typed fields keep real answers. That is
  exactly the subset that renders as readable text today.
- `_config_display()`'s combo branch (~line 332) hardcodes `"image": None` on
  every line it emits. The non-combo branch below it (~line 351) does resolve
  images, from `p.colors` / `p.toppings` / `p.inside_designs` / `p.static_designs`.

The frontend is behaving correctly: `frontend/src/app/admin/orders/[id]/page.tsx`
(~line 203) renders the image when present and otherwise falls back to a grey box
showing `c.value`. With `value == "নির্বাচিত"` and `image == None`, a grey box
saying "selected" is the only possible output.

### Change

**`_preset_lines()`** — alongside `label` and `value`, snapshot enough to look up
an image later:

- `product_id` — which product the line belongs to
- `option_id` — the chosen option's pk
- `option_kind` — one of `color` / `corner` / `center` / `inside` / `static`

`label` and `value` remain snapshotted strings. The new ids are *only* ever used
to resolve an image. They are never used to re-derive displayed text, so renaming
an option or a field still cannot rewrite a placed order. The existing price and
label snapshot guarantees are untouched.

**`_config_display()` combo branch** — for each line carrying `option_kind` and
`option_id`, resolve the image the same way the non-combo branch does, via the
same `abs_url()` helper. Lines without ids (dupatta, customer fields, note) keep
`image: None` as today.

### Existing orders

Orders placed before this change have no ids in `config["combo_items"]`.

Fallback: when a combo line lacks `option_id`, re-read the live
`PrebuiltCombo.preset_config` via `item.combo_id` and resolve from there,
positionally by product and option kind. This recovers images for every existing
order whose combo has not been edited since the order was placed.

If the combo row is gone, or its preset no longer contains that product, the line
renders exactly as it does today — grey box, no image, no error. Degradation is
silent and safe; this path must never raise.

Note this fallback reads *current* combo data, so it is best-effort recovery for
historical orders only. New orders never use it — they carry their own ids.

### Tests

- `_preset_lines` emits `product_id`, `option_id`, `option_kind` for each of
  color / corner / center / inside / static.
- `_config_display` on a combo item returns a non-null `image` for a line whose
  option has an image.
- A combo line whose option has no image returns `image: None`, not an error.
- Legacy path: a combo item with no ids in config still resolves images from the
  live `PrebuiltCombo.preset_config`.
- Legacy path with a deleted combo returns the current-behaviour output and does
  not raise.
- Renaming an option after the order does not change the stored `value`.

---

## 2. Themed order emails

### Current state

Email works and is wired correctly. `notify_order_status(order)` in
`backend/app/services/notifications.py` fires on order create
(`views.py:387`) and on every status change (`admin_api.py:595`, `:710`,
`admin.py:278`, `:309`). All six statuses are covered. SMTP is configured; sending
happens in a daemon thread with a timeout and never raises to the caller.

What is missing is only presentation: a single `send_mail()` call producing four
lines of unstyled plain text with no branding.

### Change

Switch to `EmailMultiAlternatives`:

- **Plain-text part** — the current body, unchanged. Remains the fallback for
  text-only clients and keeps the email readable if HTML is stripped.
- **HTML part** — new.

Scope is deliberately minimal, per decision: status message, tracking button,
branding. No item list, no totals, no address, no images.

### HTML constraints

Email clients are not browsers. The template must use:

- Table-based layout. No flexbox, no grid.
- Inline `style` attributes. `<style>` blocks and external CSS are stripped by
  several major clients.
- No remote images at all. Gmail blocks them by default for unknown senders, and
  the audience is on slow connections and unlikely to tap "display images".
- No webfonts. Bengali renders through the device's own font stack.
- Max width ~600px, fluid below that.

### Visual design

Follows the storefront's premium-editorial tokens, hardcoded as hex since email
has no CSS variables:

- Header band: wine `#38182f`, with the wordmark "Zaujain Nikah Point" as **text**
  in a serif stack. No logo image — this is why nothing can fail to render.
- Body: warm ivory `#faf6ee`, deep ink `#2a2028` text, warm hairline `#e7dccc`.
- Tracking button: rose `#c25e8b`, white text, large tap target.
- Gold `#a9822f` used sparingly as a rule above the footer.

Content per email: greeting (with the existing repeat-customer variant), the
status sentence, the order code, the tracking button, a short footer.

### The `pending_payment` exception

`pending_payment` means the fraud check required an advance before production.
Today the customer is told only "we received your order, thanks" — they are not
told money is owed, how much, or where to send it.

This email alone gains an advance block: the amount, and the bKash and Nagad
numbers, all read from `settings.SHOP`.

Hard rule, consistent with the chatbot's existing constraint: never invent a
payment number. If a `SHOP` key is missing or blank, omit that line entirely
rather than rendering a placeholder or an empty value.

The other five emails stay uniform and minimal.

### Unchanged

Threading, `EMAIL_TIMEOUT`, `fail_silently=False` inside the caught block, the
never-raise contract, the repeat-customer greeting, and the tracking link in
every email.

### Tests

- The sent message has an HTML alternative attached.
- The tracking URL appears in **both** the plain-text and HTML parts.
- `pending_payment` HTML contains the advance amount and the bKash number.
- The other five statuses do **not** contain payment numbers.
- A blank or missing `SHOP` payment key omits the line and does not raise.
- A raising SMTP backend still does not propagate out of `notify_order_status`.

---

## 3. Location data

### Problem

`frontend/src/lib/bdLocations/` holds 63 of 64 districts and 544 thanas.

- **Brahmanbaria is absent entirely** — a whole district, 9 upazilas. Customers
  there cannot complete the address step.
- Eight districts are short: Rajshahi has 5 of 9, and Feni, Noakhali, Madaripur,
  Barguna, Patuakhali, Pirojpur each miss one.
- The bigger gap: the file lists **administrative upazilas only**. City customers
  find no entry naming their area — a Sylhet-city customer sees the 12 upazilas
  but not Ambarkhana, Uposhahar, Shahporan, Modina Market, Moglabazar.

### Why not mirror Steadfast's zone list

Considered and rejected after investigation.

- Steadfast's official API (`https://portal.steadfast.com.bd/api/v1`) exposes
  create_order, bulk create, status, and balance. There is no geography endpoint.
- Their merchant dashboard's district/thana dropdowns are a client-side widget
  with no network call and data held in module scope — not reachable from the
  console, and not present in the page HTML or any loaded JS bundle.
- Decisively: **Steadfast never receives a district or thana field from us.**
  `backend/app/services/steadfast_order.py:67-72` sends `recipient_address` as a
  single free-text string. Their own bulk-import template confirms the same shape
  — its columns are Invoice, Name, Address, Phone, Amount, Note, Lot, Delivery
  Type, Contact Name, Contact Phone. No geography columns at all.

So matching their spellings has no operational effect. Thana is purely customer
UX. District is the only field that touches money, via `delivery_charge_for()`.

### Change

Regenerate the eight division files from open administrative datasets:

- Add **Brahmanbaria** with its 9 upazilas (Chattogram division).
- Fill Rajshahi to its full 9 (Bagha, Bagmara, Charghat, Durgapur, Godagari,
  Mohanpur, Paba, Puthia, Tanore) and complete Feni, Noakhali, Madaripur,
  Barguna, Patuakhali, Pirojpur.
- Add **metro thanas** for Dhaka, Chattogram, Khulna, Rajshahi, Sylhet, Gazipur,
  Narayanganj and Cumilla, so city addresses have a matching entry.

Keep the existing `"Others"` entry per district, and wire it to a **free-text
input** that appears when selected. A zone we did not anticipate must never block
checkout. The typed value flows into the address string exactly as a picked thana
does — which is all Steadfast ever sees anyway.

### District naming

No mapping layer is needed, since district is never sent to the courier. The one
constraint is internal: `INSIDE_DISTRICT` (default `Chattogram`) must keep
matching the key used in the data files. It currently does, and the tests below
pin it.

### Cleanup

Delete `steadfast-zones.raw.json` from the repo root. It is a failed capture —
every district holds Bagerhat's list, including Steadfast's own junk rows
(`test thana`, `ishwarganj.`). It has no value and would mislead later readers.

### Tests

- Exactly 64 districts across the eight division files.
- No district has an empty thana list.
- No duplicate thana within a district.
- `Chattogram` exists under that exact key, matching `INSIDE_DISTRICT`.
- Brahmanbaria is present with its upazilas.
- Every division file parses and the merged `BD_LOCATIONS` has no key collisions.

---

## Out of scope

- Order emails containing item lists, prices, or config images (explicitly
  decided against — minimal emails only).
- Any change to how orders are booked with Steadfast.
- Any change to the fraud-check or advance-payment logic itself; only how
  `pending_payment` is *communicated*.
- Per-item order status. Status lives on `Order`, not on line items, and no
  per-product status is being introduced.
