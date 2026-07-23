# Combo Preset Configuration — Design

## Problem
A `PrebuiltCombo` stores price, description, photos and **which** products it bundles —
but not **how those products are configured**. Consequences:

1. Buying a combo as-is records no design on the order; the photo is the only spec.
2. Tapping **"কিছু পরিবর্তন করুন"** opens the wizard **blank**, so a customer who wants
   to change one detail must redesign every item from scratch.

Real customers are picky ("itchy") — they want the pictured design with one small change.

## Goal
Let the admin preset the exact design of each customizable item in a combo, so:
- **Buy as-is** → the order records that exact configuration.
- **Make changes** → the wizard opens **pre-filled** with it; the customer tweaks one thing.

## Locked decisions
- Combo bought as-is stays **one cart line at the fixed combo price**; the design shows as
  sub-details on that line.
- **Make changes** continues to produce **individual configured items at their own prices**
  (existing behaviour, unchanged).
- Preset is **optional per product** — items without a preset fall back to configurator defaults.
- The `PrebuiltCombo.products` M2M is **unchanged** (avoids touching every consumer:
  `_shop_facts`, combo page, `PrebuiltComboForm.clean` exclusive-group check).

## Data model
Add one field:

```python
class PrebuiltCombo(models.Model):
    ...
    preset_config = models.JSONField(default=dict, blank=True)
```

Shape — maps the **product id as a string** to a config in the *same shape the customizer
already produces* (so it round-trips through the existing display + wizard code):

```json
{
  "3": {"color": {"id": 7}, "corner": {"id": 12}, "center": {"id": 19}, "inside": {"id": 4}},
  "5": {"static": {"id": 22}},
  "8": {"dupatta": {"id": 2, "lace_type": "single", "text_lines": 3}}
}
```
Optional `"fields": [{"label": "...", "value": "..."}]` per product is allowed but the admin
UI does not set it (customer-specific answers like bride/groom names stay empty).

Migration: `0024_prebuiltcombo_preset_config`. No data migration (default `{}` = today's behaviour).

## Backend

### Serializers
- `AdminComboSerializer`: add `preset_config` (writable).
- Public `ComboDetailSerializer`: add `preset_config` (read-only) so the storefront can seed
  the wizard.

### Combo add-to-cart (`views.py`, the `combo` branch of cart add)
Today:
```python
CartItem.objects.create(session_key=..., combo=combo, price_snapshot=combo.price)
```
Change: **snapshot the preset into the cart item's config** so the design travels with the
order (same guarantee as price snapshotting — later admin edits don't rewrite placed orders):

```python
CartItem.objects.create(
    session_key=..., combo=combo, price_snapshot=combo.price,
    config={"combo_items": _combo_preset_snapshot(combo)},
)
```
`_combo_preset_snapshot(combo)` resolves `preset_config` into a **display-ready, label-snapshotted**
list (names resolved at add time, so renaming an option later never rewrites a placed order):

```json
[{"product": "নিকাহ নামা বুক",
  "lines": [{"label": "রং", "value": "মেরুন"}, {"label": "কোণার ডিজাইন", "value": "নির্বাচিত"}]}]
```

### `_config_display`
Currently returns `[]` for combo items. Add a combo branch: when
`cfg.get("combo_items")` exists, flatten it into the existing
`{label, value, image}` line format, prefixing each item's lines with its product name — so the
design appears in the cart AND the Orders admin automatically (no admin-side changes needed).

## Admin UI (`/admin/combos`)
For each **ticked** customizable product, render a compact **preset editor** below it:
- Fetch that product's options (`adminGet('products/<id>/')` — colors, toppings by placement,
  inside designs, static designs, dupatta options).
- Thumbnail pickers matching the product's `kind`:
  - `layered` → colour, corner, center, inside
  - `gallery` / `simple` → design (static)
  - `dupatta` → lace + lines (pick a dupatta option)
- Selections write into the combo form's `preset_config[String(productId)]`.
- "Clear preset" per product. Unticking a product drops its preset entry.

## Frontend storefront

### Configurators — new `initialConfig` prop (the core reusable change)
`ConfiguratorSwitch` gains `initialConfig?: ComboPreset` and forwards it. Each configurator
initialises state from it, falling back to today's defaults:

| Configurator | State seeded from preset |
|---|---|
| `LayeredConfigurator` | `colorId`, `cornerId`, `centerId`, `insideId` |
| `GalleryConfigurator` | `staticId` |
| `DupattaConfigurator` | `lace`, `lines` |

Example: `useState<number \| null>(initialConfig?.color?.id ?? product.colors[0]?.id ?? null)`.
An id that no longer exists (option deleted) falls back to the default — never crash.

### Wizard seeding
- Combo page "make changes" already routes to `/customize?combo=<slug>`.
- `/customize` already preselects `product_slugs`; additionally stash the combo's
  `preset_config` keyed **by product slug** into `sessionStorage.wizard_presets`.
- `/customize/build` reads `wizard_presets` and passes the matching preset to
  `ConfiguratorSwitch` for the current product.

## Testing
Backend (`app/tests/`):
- `preset_config` defaults to `{}`; combo add-to-cart with an empty preset behaves exactly as today.
- Combo add-to-cart with a preset writes `config["combo_items"]` with resolved names.
- Renaming a colour after the order does **not** change the stored snapshot (label snapshotting).
- `_config_display` renders combo lines (previously `[]`).

Frontend (Vitest):
- `LayeredConfigurator` initialises from `initialConfig` (colour/corner/center/inside).
- Falls back to defaults when `initialConfig` is absent or references a deleted option id.
- `GalleryConfigurator` / `DupattaConfigurator` seed from preset.

## Out of scope
- Combo price changing when the customer tweaks (make-changes already switches to
  per-item pricing).
- Presetting customer-specific text answers (bride/groom names) — those stay empty.
- Any change to the `products` M2M or exclusive-group validation.
