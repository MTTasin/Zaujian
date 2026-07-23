# Edit option selections on placed orders (with re-pricing) — Design

**Date:** 2026-07-23
**Status:** Approved, ready for plan

## Goal
Let the admin change the customer's chosen **color / corner / center / inside / static
design / dupatta** on an item in a **placed order**, recomputing that item's price and
the order totals. Complements `edit_config` (which edits only text answers/notes).

## Decisions (locked)
- **Recompute + update order total.** Changing an option recalculates the item's
  `price_snapshot` from the pricing engine, then the order `subtotal` / `total` / COD.
- Applies to **customizable product items only** (`CartItem.product_id` set, product is
  customizable). Combo-as-is items (`combo_id`) keep text-only editing via `edit_config`.
- The item's **text answers stay**: `config["fields"]`, `config["note"]`,
  `config["combo_items"]` are preserved; only the option keys are replaced.

## Why the pricing engine is safe to reuse
`app/services/pricing.py::price_selection(product, selection)` already returns
`(Decimal price, config)` with exactly the option keys the storefront produces
(`color`, `corner`, `center`, `inside`, `static`, `dupatta`). It validates selections
(raises `ValueError` on an invalid/foreign/inactive option id) and applies the same
rules as checkout — including dupatta's absolute lookup. Reusing it guarantees the
edited order prices identically to a fresh order.

## Backend
New action on the Order viewset (`admin_api.py`, near `edit_config`):

- `POST orders/{id}/edit_item_options/`
  - Body: `{ "item_id": <int>, "selection": { "color": <id>, "corner": <id>,
    "center": <id>, "inside": <id>, "static": <id>, "dupatta": <id> } }`
    (only the keys relevant to the product's kind; same shape checkout sends).
  - Lookup: `item = order.items.filter(pk=item_id).first()`; 404 if not in this order.
  - Guard: item must have `product_id` and the product must be customizable
    (`product.is_customizable`); else 400 `"Not a customizable product item"`.
  - Compute: `price, option_cfg = price_selection(item.product, selection)`.
    Wrap in `try/except ValueError` → 400 with the message.
  - **Merge config**: start from a copy of `item.config`, drop the known option keys
    (`color/corner/center/inside/static/dupatta`), then apply `option_cfg`. Preserve
    `fields`, `note`, `combo_items` untouched.
  - `item.price_snapshot = price`; `item.config = merged`; save.
  - **Recompute order**: `order.subtotal = Σ item.price_snapshot` over `order.items`;
    `order.cod_amount = order.compute_cod()`; save. (`total` is a computed property =
    `subtotal + delivery_charge`, so it follows automatically.)
  - Return the updated order via `AdminOrderSerializer` (so the page re-renders items,
    `config_display`, preview, and totals).

## Frontend (admin, English)
Order detail page (`frontend/src/app/admin/orders/[id]/page.tsx`), per customizable
product item:

- A **"Change design / color"** button reveals an editor.
- On open, fetch the product's options with the existing admin endpoints, filtered by
  product id (all already exist): `colors/?product=`, `toppings/?product=` (split by
  `placement` into corner/center), `inside/?product=`, `static-designs/?product=`,
  `dupatta-options/?product=`. Only show the dimensions relevant to the product's
  `kind` (layered → color+corner+center+inside; gallery/simple → static; dupatta →
  dupatta).
- Each dimension is a selectable list showing the option's **thumbnail** + current
  selection highlighted (seed from `item.config`). Optional dimensions (corner, center,
  inside) allow "none".
- **Save** posts `{ item_id, selection }` to `edit_item_options/`; on success replace
  order state from the response (updated preview + total), close editor, success msg.
  Errors (400 from invalid selection) show inline.

## Out of scope
- Editing options on combo-as-is items (kept text-only).
- Changing which product an item is (swap product) — only its options.
- Adding/removing items (that already exists for manual orders via `edit`).

## Testing
- Backend (`test_order_option_edit.py`):
  - Layered item: change color to one with a different `price_modifier` → item
    `price_snapshot` and order `subtotal`/`total` update to the engine's number.
  - Text answers (`fields`, `note`) survive the option change.
  - Optional dimension cleared (corner omitted) → key removed, price drops accordingly.
  - Dupatta item: switching option sets the absolute price (not additive).
  - Invalid/foreign option id → 400, order unchanged.
  - Non-customizable / combo item → 400.
  - Item not in this order → 404.
- Frontend: build clean; manual — change a color, order total updates and preview
  matches the new pick.
