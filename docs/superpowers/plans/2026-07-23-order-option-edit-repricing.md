# Edit Option Selections On Placed Orders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the admin change a placed order item's color/design options and have the item price + order totals recompute from the pricing engine.

**Architecture:** A new `edit_item_options` order action reuses `pricing.price_selection` to validate + price the new selection, merges the option keys into the item config while preserving text answers, then recomputes `order.subtotal`/COD. Frontend adds an option editor per customizable product item.

**Tech Stack:** Django 6 + DRF, Next.js 16 + TS.

## Global Constraints

- Money is `DecimalField` / `Decimal`, **never float**.
- **No git commands / no commits** (user forbids git mutations). Skip every "Commit" step.
- Backend from `backend/`: `../env/Scripts/python manage.py <cmd>`. Test: `../env/Scripts/python manage.py test app.tests.<module>`.
- Preserve `config["fields"]`, `config["note"]`, `config["combo_items"]` — only option keys change.
- Option keys managed: `color`, `corner`, `center`, `inside`, `static`, `dupatta`.
- Admin UI English. Compose from `components/admin/ui`.
- Spec: `docs/superpowers/specs/2026-07-23-order-option-edit-repricing-design.md`.

---

### Task 1: `edit_item_options` order action

**Files:**
- Modify: `backend/app/admin_api.py` (Order viewset, after `edit_config`)
- Test: `backend/app/tests/test_order_option_edit.py` (create)

**Interfaces:**
- Consumes: `app.services.pricing.price_selection(product, selection) -> (Decimal, dict)`; `Order.compute_cod`, `Order.items`, `Product.is_customizable`.
- Produces: `POST orders/{id}/edit_item_options/` `{item_id, selection}` → updated order (AdminOrderSerializer).

- [ ] **Step 1: Write the failing tests**

```python
# backend/app/tests/test_order_option_edit.py
from decimal import Decimal

from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from app.models import CartItem, ColorOption, DupattaOption, Order, Product


class EditItemOptionsTests(APITestCase):
    def setUp(self):
        self.client.force_authenticate(User.objects.create_user("admin", password="x", is_staff=True))
        self.order = Order.objects.create(customer_name="A", phone="017", subtotal=Decimal("1000"))
        self.book = Product.objects.create(name="বই", slug="boi", kind="layered", base_price=Decimal("1000"))
        self.red = ColorOption.objects.create(product=self.book, name="লাল", price_modifier=Decimal("0"))
        self.gold = ColorOption.objects.create(product=self.book, name="সোনালি", price_modifier=Decimal("200"))
        self.item = CartItem.objects.create(
            order=self.order, session_key="s", product=self.book, price_snapshot=Decimal("1000"),
            config={"color": {"id": self.red.id, "name": "লাল"},
                    "fields": [{"label": "বরের নাম", "value": "Rahim"}], "note": "n"},
        )

    def _post(self, body):
        return self.client.post(f"/api/admin/orders/{self.order.id}/edit_item_options/", body, format="json")

    def test_change_color_reprices_and_keeps_text(self):
        r = self._post({"item_id": self.item.id, "selection": {"color": self.gold.id}})
        self.assertEqual(r.status_code, 200)
        self.item.refresh_from_db(); self.order.refresh_from_db()
        self.assertEqual(self.item.price_snapshot, Decimal("1200"))
        self.assertEqual(self.item.config["color"]["id"], self.gold.id)
        self.assertEqual(self.item.config["fields"][0]["value"], "Rahim")   # text preserved
        self.assertEqual(self.item.config["note"], "n")
        self.assertEqual(self.order.subtotal, Decimal("1200"))
        self.assertEqual(r.json()["subtotal"], "1200.00")

    def test_invalid_option_400_and_unchanged(self):
        r = self._post({"item_id": self.item.id, "selection": {"color": 999999}})
        self.assertEqual(r.status_code, 400)
        self.item.refresh_from_db()
        self.assertEqual(self.item.price_snapshot, Decimal("1000"))

    def test_item_not_in_order_404(self):
        other = CartItem.objects.create(session_key="s2", product=self.book, price_snapshot=Decimal("0"), config={})
        r = self._post({"item_id": other.id, "selection": {"color": self.gold.id}})
        self.assertEqual(r.status_code, 404)

    def test_dupatta_absolute_price(self):
        dup = Product.objects.create(name="ওড়না", slug="orna", kind="dupatta", base_price=Decimal("1600"))
        opt = DupattaOption.objects.create(product=dup, lace_type="single", text_lines=2, price=Decimal("1500"))
        it = CartItem.objects.create(order=self.order, session_key="s", product=dup,
                                     price_snapshot=Decimal("0"), config={})
        r = self._post({"item_id": it.id, "selection": {"dupatta": opt.id}})
        self.assertEqual(r.status_code, 200)
        it.refresh_from_db()
        self.assertEqual(it.price_snapshot, Decimal("1500"))
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `../env/Scripts/python manage.py test app.tests.test_order_option_edit`
Expected: FAIL — 404 (action missing).

- [ ] **Step 3: Implement the action**

In `backend/app/admin_api.py`, add to the Order viewset after `edit_config`. Ensure
`from .services.pricing import price_selection` is imported (add near the top imports
if not already present):

```python
    @action(detail=True, methods=["post"])
    def edit_item_options(self, request, pk=None):
        """Change a placed item's color/design selection and reprice from the engine.
        Text answers (fields/note/combo_items) are preserved; only option keys change."""
        from .services.pricing import price_selection
        order = self.get_object()
        item = order.items.filter(pk=request.data.get("item_id")).first()
        if not item:
            return Response({"error": "Item not found in this order"},
                            status=status.HTTP_404_NOT_FOUND)
        if not item.product_id or not item.product.is_customizable:
            return Response({"error": "Not a customizable product item"},
                            status=status.HTTP_400_BAD_REQUEST)
        selection = request.data.get("selection") or {}
        try:
            price, option_cfg = price_selection(item.product, selection)
        except ValueError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        merged = dict(item.config or {})
        for k in ("color", "corner", "center", "inside", "static", "dupatta"):
            merged.pop(k, None)
        merged.update(option_cfg)

        item.config = merged
        item.price_snapshot = price
        item.save(update_fields=["config", "price_snapshot"])

        order.subtotal = sum((i.price_snapshot for i in order.items.all()), Decimal("0"))
        order.cod_amount = order.compute_cod()
        order.save()
        return Response(self.get_serializer(order).data)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `../env/Scripts/python manage.py test app.tests.test_order_option_edit`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the full suite (no regressions)**

Run: `../env/Scripts/python manage.py test app`
Expected: OK.

- [ ] **Step 6: Commit** — SKIP (no git). Leave changes in the working tree.

---

### Task 2: Admin order page — option editor per item

**Files:**
- Modify: `frontend/src/lib/adminApi.ts` (option types + fetch helpers if missing)
- Modify: `frontend/src/app/admin/orders/[id]/page.tsx`

**Interfaces:**
- Consumes: `orders/{id}/edit_item_options/` `{item_id, selection}`; option list endpoints `colors/?product=`, `toppings/?product=`, `inside/?product=`, `static-designs/?product=`, `dupatta-options/?product=` (confirm exact paths in `adminApi.ts` / how the Customization/Products admin already loads them — reuse those helpers).

- [ ] **Step 1: Confirm option endpoint helpers**

Read `frontend/src/lib/adminApi.ts` and the Products admin page to find the existing
functions that load a product's colors/toppings/inside/static/dupatta options (the
customizer admin already uses them). Reuse them. If a helper is missing, add a thin
`adminGet` call following the existing pattern. Do not invent new backend endpoints —
the `?product=` filter already exists.

- [ ] **Step 2: Add the editor UI**

In `page.tsx`, for each order item where `item.product` is set and the product is
customizable (kind !== "simple", or has options), add a **"Change design / color"**
button that reveals an editor. On open, fetch the product's option lists (by
`item.product`), seed the current selection from `item.config` (`color.id`, `corner.id`,
`center.id`, `inside.id`, `static.id`, `dupatta.id`). Show only the dimensions relevant
to the product kind:
- layered → color (required) + corner + center + inside (each optional, allow "none")
- gallery / simple-with-designs → static
- dupatta → dupatta

Render each dimension as a row of selectable thumbnails (use existing image/thumbnail
markup patterns from the Products admin); highlight the current pick. Build a
`selection` object of chosen ids (omit cleared optional dimensions).

- [ ] **Step 3: Wire save**

```tsx
async function saveOptions(itemId: number, selection: Record<string, number>) {
  setBusy(true); setError(""); setMsg("");
  try {
    const updated = await adminPost<AdminOrder>(`orders/${order!.id}/edit_item_options/`,
      { item_id: itemId, selection });
    setOrder(updated); setMsg("Design updated"); /* close editor */
  } catch (e) {
    setError(e instanceof Error ? e.message : "Update failed");
  } finally { setBusy(false); }
}
```

- [ ] **Step 4: Verify build + manual check**

Run: `cd frontend && npm run build`
Expected: build succeeds.
Manual: open an order with a layered item, change color → item preview + order total
update; invalid combos are impossible (only real options are shown).

- [ ] **Step 5: Commit** — SKIP (no git).

---

## Self-Review Notes
- Spec coverage: backend action + repricing + preservation + validation (T1), frontend editor (T2). Covered.
- Reuses `price_selection` (single source of pricing truth) — dupatta absolute + optional dimensions handled by the engine, asserted in T1.
- Order `total` is a computed property; recomputing `subtotal` updates it — no direct `total` write (which would raise).
