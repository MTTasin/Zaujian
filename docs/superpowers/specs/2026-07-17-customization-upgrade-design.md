# Customization Upgrade — Design Spec

Date: 2026-07-17
Status: Approved for planning

## Goal

Upgrade the customization flow so the shop can:

1. Sell **frame** and **thumb** as customizable products (same shape as mirror).
2. Enforce that **book / frame / thumb are mutually exclusive** — a customer picks at
   most one of them.
3. Order the picker + wizard **from the admin panel**, not from hardcoded frontend code.
4. Collect **admin-defined customer inputs** per product (bride name, groom name,
   wedding date, "এখানে কি বসবে?" …), some compulsory.
5. Let the customer add an **optional note** on each product they customize.
6. Let the customer go **back** a step in the build wizard.

## Context (verified in the codebase)

- `mirror` is `kind=gallery`, category `mirror`. **frame** and **thumb** are the same
  shape, so the products themselves need **no code** — the admin adds them in
  Admin → Customization. `/customize` already filters to `is_customizable`.
- `/customize/page.tsx` hardcodes `const ORDER = ["book","box","pen","mirror","dupatta"]`
  and sorts with `ORDER.indexOf(category)`. Unknown categories return `-1`, so frame and
  thumb would sort to the **top**. This blocks the feature and must be replaced.
- `/customize/build` reads `wizard_slugs` from `sessionStorage`, written by the picker.
  Fixing the picker's order fixes the wizard's order — one place.
- `CartItem.config` is a `JSONField` snapshot and the cart row **becomes** the order row
  (`order` FK is set). Anything stored in `config` therefore inherits the existing
  price-snapshot guarantee: later admin edits never mutate a placed order.
- `PrebuiltCombo` is managed in **Django admin** (`PrebuiltComboAdmin`) — the frontend
  `/admin/combos` page was removed. Combo validation belongs in the Django admin form.

## Locked decisions

| Decision | Choice |
|---|---|
| Exclusivity mechanism | **Admin `exclusive_group` field** on Product (not hardcoded slugs) |
| Interaction when conflicting | **Auto-swap** (picking Frame deselects Book) — no dead end on mobile |
| Ordering | **Admin `customize_order` field** (replaces hardcoded `ORDER`) |
| Enforcement scope | **Picker + Django-admin combo warning** (no cart/checkout rejection) |
| Optional note | **Production instruction**: saved to config, shown in Orders admin. Not on the challan, does not affect price |
| Admin-defined inputs | **Unlimited per product** (`ProductField`), each with its own label + required flag |

## Data model (`backend/app/models.py`)

### `Product` — two new fields
| Field | Type | Notes |
|---|---|---|
| `exclusive_group` | `CharField(max_length=40, blank=True)` | Products sharing a non-blank group cannot be selected together (e.g. `nikahnama` on book, frame, thumb). Blank = unrestricted. |
| `customize_order` | `PositiveSmallIntegerField(default=0)` | Position in the `/customize` picker and the build wizard. Lower first, then by name. |

### `ProductField` — new model
Admin-defined inputs the configurator asks the customer for.

| Field | Type | Notes |
|---|---|---|
| `product` | FK → `Product`, `related_name="input_fields"`, CASCADE | Named `input_fields`, not `fields`, to avoid colliding with DRF's `Meta.fields` and reading ambiguously. |
| `label` | `CharField(max_length=120)` | Bengali, shown to the customer (e.g. `বরের নাম`, `এখানে কি বসবে?`) |
| `placeholder` | `CharField(max_length=120, blank=True)` | Optional hint inside the input |
| `required` | `BooleanField(default=True)` | Required blocks the confirm button |
| `order` | `PositiveSmallIntegerField(default=0)` | |

`Meta.ordering = ["order", "id"]`.

**Field type is single-line text only** (YAGNI — no date picker or dropdown yet; the
admin labels the field and the customer types).

### Config snapshot (no migration — existing `CartItem.config` JSON)
```json
{
  "color": {"id": 3, "name": "maroon"},
  "fields": [{"label": "বরের নাম", "value": "..."}],
  "note": "সোনালি রঙে নাম লিখবেন"
}
```
- `config["fields"]` — admin-defined answers (label snapshotted alongside the value, so
  renaming a `ProductField` later never rewrites a placed order).
- `config["note"]` — the always-available optional customer note.

## API

- `ProductListSerializer`: add `exclusive_group`, `customize_order`.
- `ProductDetailSerializer`: add both, plus nested `input_fields` (`id`, `label`,
  `placeholder`, `required`, `order`).
- `cart_add`: accept `fields` (list of `{label, value}`) and `note`.
  **Server-side validation (never trust the client):** every `required` ProductField for
  that product must have a non-blank value → else HTTP 400 naming the missing label.
  Trim values; `note` max 200 chars; each field value max 200 chars.

## Frontend

### `/customize` (picker)
- **Delete the `ORDER` constant.** Sort by `customize_order`, then `name`.
- Extract the selection rule into a **pure, testable helper**:
  `applyExclusive(selected: Set<string>, product: ProductListItem, all: ProductListItem[]) → Set<string>`
  Selecting a product with a non-blank `exclusive_group` removes any other selected
  product sharing that group (auto-swap). Deselect behaves as today.
- **Rule note derived from data, not hardcoded**: for each group with 2+ products, render
  the group's product *names* joined — `বই / ফ্রেম / থাম্ব — যেকোনো একটি`. No extra
  label field, and it is Bengali automatically.

### `/customize/build` (wizard)
- Renders each `ProductField` for the current product as a labelled text input
  (`placeholder` as the hint). Required ones show a Bengali required marker.
- Confirm ("নিশ্চিত করে পরবর্তী") is **blocked** until every required field is non-blank;
  show an inline Bengali error on the offending field.
- **Optional note** textarea, label `বিশেষ নির্দেশনা (ঐচ্ছিক)`, max 200 chars.
- **"← পূর্ববর্তী" button**: goes to the previous step; hidden on step 1. Answers already
  entered for a step are preserved when navigating back and forward (kept in the same
  `sessionStorage` the wizard already uses for `wizard_slugs` / `wizard_index`).
- Mobile-first: big tap targets, inputs comfortable on low-end Android.

### Admin — `/admin/products/[id]`
- **Exclusive group** text input. Hint: "Products sharing this group can't be picked
  together (e.g. `nikahnama` on book, frame, thumb). Blank = no restriction."
- **Customize order** number. Hint: "Position in the customize picker. Lower shows first."
- **Customer input fields** manager: list/add/edit/delete `ProductField` rows
  (label, placeholder, required, order) — follows the existing spec/option manager
  pattern. Endpoint: `AdminProductFieldViewSet` at `/api/admin/product-fields/`
  (`?product=<id>` filter), mirroring `AdminProductSpecViewSet`.

### Admin — Orders
- Render `config["fields"]` (label: value) and `config["note"]` in the item's readable
  config block, so production sees the instructions.

## Django admin (`backend/app/admin.py`)

`PrebuiltComboAdmin` gets a custom `ModelForm.clean()`: if the selected `products`
contain 2+ items sharing the same non-blank `exclusive_group`, raise a `ValidationError`
naming the conflicting products, so a combo can never contain book *and* frame.

## Bot (`_shop_facts`)

Add one line per exclusive group with 2+ active products:
`একসাথে শুধু একটি নেওয়া যাবে: বই, ফ্রেম, থাম্ব` — so the bot never suggests book + frame.

## Testing

**Backend**
- Serializers expose `exclusive_group`, `customize_order`, and nested `fields`.
- `cart_add` stores `fields` + `note` into `config`; rejects a missing required field
  (400, names the label); trims/limits lengths.
- `PrebuiltComboAdmin` form rejects a combo containing two products from one group and
  accepts a valid one.
- `_shop_facts` states the exclusive-group rule.
- `ProductField` ordering.

**Frontend (Vitest + RTL)**
- `applyExclusive`: picking a same-group product swaps; different-group products
  coexist; deselect works; blank group never restricts.
- Picker sorts by `customize_order`.
- Wizard: required field blocks confirm and shows the error; filling it unblocks;
  note is optional; "পূর্ববর্তী" hidden on step 1 and returns to the prior step with
  answers preserved.

## Implementation phases

1. **Picker rules** — `exclusive_group` + `customize_order` (model, API, admin fields,
   picker sort + auto-swap + derived note), combo admin validation, bot rule line.
   Frame/thumb are then addable from the panel with no further code.
2. **Configurator inputs** — `ProductField` model + admin manager + API, wizard rendering
   + required validation, optional note, previous button, Orders admin display.

## Out of scope (YAGNI)

- Server-side rejection of conflicting group items at cart/checkout (picker + admin
  warning was chosen).
- Drag-to-reorder UI (number field only).
- Field types beyond single-line text (date picker, dropdown, checkbox).
- Note on the courier challan; note-triggered pricing review.
- Min/max group sizes; groups spanning combos.
