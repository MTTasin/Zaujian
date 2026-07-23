# Order Cost Price → Dashboard Profit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the admin record a per-order cost price and surface profit (subtotal − cost) on the dashboard.

**Architecture:** One nullable `Decimal` field on `Order`, edited through the existing order `edit` action, read back through `AdminOrderSerializer`, aggregated on the dashboard. No per-product/config cost, no snapshots.

**Tech Stack:** Django 6 + DRF (backend), Next.js 16 + TS (admin frontend).

## Global Constraints

- Money is `DecimalField` / `Decimal`, **never float**.
- Backend run from `backend/`: `../env/Scripts/python manage.py <cmd>`.
- Backend tests: `../env/Scripts/python manage.py test app.tests.<module>`.
- Admin UI is English. Compose from `components/admin/ui`.
- After model changes: `../env/Scripts/python manage.py check` + makemigrations + migrate.
- Spec: `docs/superpowers/specs/2026-07-22-order-cost-price-profit-design.md`.

---

### Task 1: `Order.cost_price` field + `profit` property

**Files:**
- Modify: `backend/app/models.py` (Order model, near `compute_cod` at ~531)
- Test: `backend/app/tests/test_order_profit.py` (create)

**Interfaces:**
- Produces: `Order.cost_price` (Decimal|None), `Order.profit` (property → Decimal|None).

- [ ] **Step 1: Write the failing test**

```python
# backend/app/tests/test_order_profit.py
from decimal import Decimal

from django.test import TestCase

from app.models import Order


class OrderProfitTests(TestCase):
    def _order(self, **kw):
        base = dict(customer_name="A", phone="017", subtotal=Decimal("1000"),
                    delivery_charge=Decimal("80"), total=Decimal("1080"))
        base.update(kw)
        return Order.objects.create(**base)

    def test_profit_none_when_cost_blank(self):
        o = self._order(cost_price=None)
        self.assertIsNone(o.profit)

    def test_profit_is_subtotal_minus_cost(self):
        o = self._order(cost_price=Decimal("600"))
        self.assertEqual(o.profit, Decimal("400"))

    def test_zero_cost_is_not_blank(self):
        o = self._order(cost_price=Decimal("0"))
        self.assertEqual(o.profit, Decimal("1000"))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `../env/Scripts/python manage.py test app.tests.test_order_profit`
Expected: FAIL — `TypeError: 'cost_price' is an invalid keyword argument` (field missing).

- [ ] **Step 3: Add the field and property**

In `backend/app/models.py`, add the field alongside the other Order money fields (near `advance_received`):

```python
    cost_price = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True,
        help_text="Total cost to fulfil this order. Blank = not costed yet.",
    )
```

Add the property near `compute_cod`:

```python
    @property
    def profit(self):
        """Subtotal minus cost. None until a cost has been entered."""
        if self.cost_price is None:
            return None
        return self.subtotal - self.cost_price
```

- [ ] **Step 4: Make migration and migrate**

Run: `../env/Scripts/python manage.py makemigrations app && ../env/Scripts/python manage.py migrate`
Expected: a new migration adding `cost_price`; migrate applies cleanly.

- [ ] **Step 5: Run test to verify it passes**

Run: `../env/Scripts/python manage.py test app.tests.test_order_profit`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/app/models.py backend/app/migrations backend/app/tests/test_order_profit.py
git commit -m "feat: add Order.cost_price and profit property"
```

---

### Task 2: Expose + save `cost_price` through the order API

**Files:**
- Modify: `backend/app/admin_api.py` — `AdminOrderSerializer` (~513) and the `edit` action (~598)
- Test: `backend/app/tests/test_order_profit.py` (add API test class)

**Interfaces:**
- Consumes: `Order.cost_price`, `Order.profit` (Task 1).
- Produces: `AdminOrderSerializer` now returns `cost_price` + `profit`; `POST orders/{id}/edit/` accepts `cost_price`.

- [ ] **Step 1: Write the failing test**

```python
# append to backend/app/tests/test_order_profit.py
from django.contrib.auth.models import User
from rest_framework.test import APITestCase


class OrderCostApiTests(APITestCase):
    def setUp(self):
        self.client.force_authenticate(User.objects.create_user("admin", password="x", is_staff=True))
        self.order = Order.objects.create(
            customer_name="A", phone="017", subtotal=Decimal("1000"),
            delivery_charge=Decimal("80"), total=Decimal("1080"),
        )

    def test_edit_sets_cost_price_and_returns_profit(self):
        r = self.client.post(f"/api/admin/orders/{self.order.id}/edit/", {"cost_price": "600"}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["cost_price"], "600.00")
        self.assertEqual(r.json()["profit"], "400.00")

    def test_blank_cost_returns_null_profit(self):
        r = self.client.get(f"/api/admin/orders/{self.order.id}/")
        self.assertIsNone(r.json()["cost_price"])
        self.assertIsNone(r.json()["profit"])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `../env/Scripts/python manage.py test app.tests.test_order_profit.OrderCostApiTests`
Expected: FAIL — `KeyError: 'cost_price'` / profit not in response.

- [ ] **Step 3: Add fields to the serializer**

In `AdminOrderSerializer` (`backend/app/admin_api.py`), add a profit field declaration above `class Meta`:

```python
    profit = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)
```

Then add `"cost_price"` and `"profit"` into the `fields` list (e.g. right after `"cod_amount"`). **Leave `read_only_fields = fields`** — writing happens through the custom `edit` action, not the serializer.

- [ ] **Step 4: Handle `cost_price` in the edit action**

In the `edit` action, inside the block that reads charge fields (near `advance_received` handling, ~617), add:

```python
        if "cost_price" in d:
            v = d.get("cost_price")
            order.cost_price = dec(v) if v not in (None, "") else None
```

(`dec` already exists in the action; blank/None clears the cost back to "not costed".)

- [ ] **Step 5: Run test to verify it passes**

Run: `../env/Scripts/python manage.py test app.tests.test_order_profit`
Expected: PASS (all tests).

- [ ] **Step 6: Commit**

```bash
git add backend/app/admin_api.py backend/app/tests/test_order_profit.py
git commit -m "feat: read/write order cost_price via admin API"
```

---

### Task 3: Dashboard profit total + uncosted count

**Files:**
- Modify: `backend/app/admin_api.py` — `admin_dashboard` (~820)
- Test: `backend/app/tests/test_order_profit.py` (add dashboard test class)

**Interfaces:**
- Consumes: `Order.cost_price`, `Order.subtotal`, `Order.Status.CANCELLED`.
- Produces: `admin_dashboard` response gains `total_profit` (number) and `uncosted_count` (int).

- [ ] **Step 1: Write the failing test**

```python
# append to backend/app/tests/test_order_profit.py
class DashboardProfitTests(APITestCase):
    def setUp(self):
        self.client.force_authenticate(User.objects.create_user("admin", password="x", is_staff=True))

    def _order(self, cost, status=Order.Status.CONFIRMED):
        return Order.objects.create(
            customer_name="A", phone="017", subtotal=Decimal("1000"),
            delivery_charge=Decimal("80"), total=Decimal("1080"),
            cost_price=cost, status=status,
        )

    def test_total_profit_excludes_blank_and_cancelled(self):
        self._order(Decimal("600"))                                   # profit 400
        self._order(Decimal("700"))                                   # profit 300
        self._order(None)                                             # uncosted
        self._order(Decimal("100"), status=Order.Status.CANCELLED)    # excluded
        r = self.client.get("/api/admin/dashboard/")
        self.assertEqual(r.json()["total_profit"], 700.0)
        self.assertEqual(r.json()["uncosted_count"], 1)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `../env/Scripts/python manage.py test app.tests.test_order_profit.DashboardProfitTests`
Expected: FAIL — `KeyError: 'total_profit'`.

- [ ] **Step 3: Implement the aggregation**

In `admin_dashboard` (`backend/app/admin_api.py`), before the `return Response({...})`, add:

```python
    from django.db.models import F, Sum  # local import, mirrors admin_analytics style

    live = Order.objects.exclude(status=Order.Status.CANCELLED)
    profit_agg = live.exclude(cost_price__isnull=True).aggregate(
        p=Sum(F("subtotal") - F("cost_price"))
    )
    total_profit = float(profit_agg["p"] or 0)
    uncosted_count = live.filter(cost_price__isnull=True).count()
```

Add these two keys to the returned dict:

```python
        "total_profit": total_profit,
        "uncosted_count": uncosted_count,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `../env/Scripts/python manage.py test app.tests.test_order_profit`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/admin_api.py backend/app/tests/test_order_profit.py
git commit -m "feat: dashboard total_profit and uncosted_count"
```

---

### Task 4: Admin order page — cost input + profit display

**Files:**
- Modify: `frontend/src/lib/adminApi.ts` (`AdminOrder` type)
- Modify: `frontend/src/app/admin/orders/[id]/page.tsx`

**Interfaces:**
- Consumes: `orders/{id}/edit/` accepting `cost_price`; `AdminOrder.cost_price`, `AdminOrder.profit`.

- [ ] **Step 1: Add the fields to the AdminOrder type**

In `frontend/src/lib/adminApi.ts`, find `type AdminOrder` and add:

```typescript
  cost_price: string | null;
  profit: string | null;
```

- [ ] **Step 2: Add cost_price to the edit form state**

In `page.tsx`, add `cost_price: ""` to the `form` initial state object and to the `setForm({...})` call inside `startEdit` (use `order.cost_price || ""`).

- [ ] **Step 3: Render the cost input + profit**

Inside the edit form (near the delivery_charge / advance_received fields), add:

```tsx
<Field label="Cost price (৳) — your total cost">
  <TextInput
    type="number" inputMode="decimal" min="0" placeholder="Not costed yet"
    value={form.cost_price}
    onChange={(e) => setForm({ ...form, cost_price: e.target.value })}
  />
</Field>
```

In the read-only totals area (where subtotal/total show), add a profit line:

```tsx
{order.cost_price != null && (
  <div className="flex justify-between">
    <span>Profit (subtotal − cost)</span>
    <span>৳{order.profit}</span>
  </div>
)}
{order.cost_price == null && (
  <p className="text-sm text-slate-400">Not costed yet</p>
)}
```

- [ ] **Step 4: Verify the build + manual check**

Run: `cd frontend && npm run build`
Expected: build succeeds.
Manual: open an order, edit, enter a cost, save → profit line shows `subtotal − cost`; clear it → "Not costed yet".

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/adminApi.ts "frontend/src/app/admin/orders/[id]/page.tsx"
git commit -m "feat: order page cost price input and profit display"
```

---

### Task 5: Dashboard profit card

**Files:**
- Modify: `frontend/src/app/admin/page.tsx`
- Modify: `frontend/src/lib/adminApi.ts` (dashboard response type, if typed)

**Interfaces:**
- Consumes: `dashboard/` response `total_profit`, `uncosted_count`.

- [ ] **Step 1: Add the fields to the dashboard type (if one exists)**

If `page.tsx` types the dashboard response, add `total_profit: number` and `uncosted_count: number`; otherwise read them from the untyped response.

- [ ] **Step 2: Add the metric card**

Alongside the existing metric cards (orders_today, total_orders, etc.), add:

```tsx
<Card className="p-4">
  <div className="text-sm text-slate-500">Profit</div>
  <div className="text-2xl font-semibold">৳{Math.round(data.total_profit).toLocaleString()}</div>
  {data.uncosted_count > 0 && (
    <div className="mt-1 text-xs text-amber-600">{data.uncosted_count} orders not costed yet</div>
  )}
</Card>
```

(Match the existing card markup in this file — reuse whatever wrapper the other metrics use.)

- [ ] **Step 3: Verify the build + manual check**

Run: `cd frontend && npm run build`
Expected: build succeeds.
Manual: dashboard shows a Profit card; the amber hint appears when some orders lack a cost.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/admin/page.tsx frontend/src/lib/adminApi.ts
git commit -m "feat: dashboard profit metric card"
```

---

## Self-Review Notes
- Spec coverage: cost field (T1), order API read/write (T2), dashboard profit + uncosted (T3), order-page UI (T4), dashboard UI (T5). All spec sections covered.
- Profit basis = subtotal − cost (T1/T3), delivery ignored — matches spec.
- Uncosted (null) excluded from total, ৳0 counted — enforced in T1 test + T3 aggregation.
- Cancelled excluded from dashboard totals (T3) — a deliberate refinement over the all-status revenue chart; noted in spec.
