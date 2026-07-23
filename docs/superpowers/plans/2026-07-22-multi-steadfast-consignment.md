# Multiple Steadfast Entries Per Order Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the admin book additional Steadfast consignments for one order, editing recipient/COD/item fields per booking, without touching the primary booking on `Order`.

**Architecture:** A new `ExtraConsignment` child model stores each additional booking. `create_consignment` gains an `overrides` param so the edited fields go to Steadfast. A `book_extra` order action books + stores a row. The order page renders the extras and a prefilled "Book another" form.

**Tech Stack:** Django 6 + DRF (backend), Steadfast official API, Next.js 16 + TS (admin frontend).

## Global Constraints

- Money is `DecimalField` / `Decimal`, **never float**.
- Steadfast booking stays **synchronous** with its existing per-courier timeout; `SteadfastError` on failure → no row created.
- Steadfast `invoice` must be **unique**; extras use `{uid}-{n}` starting at `-2`.
- Backend run from `backend/`: `../env/Scripts/python manage.py <cmd>`.
- Backend tests: `../env/Scripts/python manage.py test app.tests.<module>`.
- Admin UI is English. Compose from `components/admin/ui`.
- After model changes: `../env/Scripts/python manage.py check` + makemigrations + migrate.
- Spec: `docs/superpowers/specs/2026-07-22-multi-steadfast-consignment-design.md`.

---

### Task 1: `ExtraConsignment` model

**Files:**
- Modify: `backend/app/models.py` (after the Order model / `compute_cod`)
- Test: `backend/app/tests/test_extra_consignment.py` (create)

**Interfaces:**
- Produces: `ExtraConsignment(order FK related_name="extra_consignments", invoice, consignment_id, tracking_code, status, cod_amount: Decimal, recipient_name, recipient_phone, recipient_address, item_description, created_at)`.

- [ ] **Step 1: Write the failing test**

```python
# backend/app/tests/test_extra_consignment.py
from decimal import Decimal

from django.test import TestCase

from app.models import ExtraConsignment, Order


class ExtraConsignmentModelTests(TestCase):
    def test_row_belongs_to_order(self):
        o = Order.objects.create(customer_name="A", phone="017",
                                 subtotal=Decimal("1000"), total=Decimal("1080"))
        ec = ExtraConsignment.objects.create(
            order=o, invoice=f"{o.uid}-2", cod_amount=Decimal("500"),
            recipient_name="A", recipient_phone="017",
        )
        self.assertEqual(list(o.extra_consignments.all()), [ec])
        self.assertEqual(ec.cod_amount, Decimal("500"))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `../env/Scripts/python manage.py test app.tests.test_extra_consignment`
Expected: FAIL — `ImportError: cannot import name 'ExtraConsignment'`.

- [ ] **Step 3: Add the model**

In `backend/app/models.py`, after the Order model, add (`Decimal` is already imported at the top of the file):

```python
class ExtraConsignment(models.Model):
    """An additional Steadfast booking for an order, beyond the primary one on Order."""

    order = models.ForeignKey(
        Order, on_delete=models.CASCADE, related_name="extra_consignments",
    )
    invoice = models.CharField(max_length=40)
    consignment_id = models.CharField(max_length=64, blank=True)
    tracking_code = models.CharField(max_length=64, blank=True)
    status = models.CharField(max_length=32, blank=True)
    cod_amount = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0"))
    recipient_name = models.CharField(max_length=100, blank=True)
    recipient_phone = models.CharField(max_length=20, blank=True)
    recipient_address = models.CharField(max_length=250, blank=True)
    item_description = models.CharField(max_length=250, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]

    def __str__(self):
        return f"Extra consignment {self.invoice} for order {self.order_id}"
```

- [ ] **Step 4: Make migration and migrate**

Run: `../env/Scripts/python manage.py makemigrations app && ../env/Scripts/python manage.py migrate`
Expected: new migration adding `ExtraConsignment`; migrate applies cleanly.

- [ ] **Step 5: Run test to verify it passes**

Run: `../env/Scripts/python manage.py test app.tests.test_extra_consignment`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/models.py backend/app/migrations backend/app/tests/test_extra_consignment.py
git commit -m "feat: add ExtraConsignment model"
```

---

### Task 2: `create_consignment` `overrides` param

**Files:**
- Modify: `backend/app/services/steadfast_order.py` (`create_consignment`, ~48)
- Test: `backend/app/tests/test_extra_consignment.py` (add service test class)

**Interfaces:**
- Consumes: existing `create_consignment(order, invoice=None)`.
- Produces: `create_consignment(order, invoice=None, overrides=None)` — `overrides` dict keys `recipient_name`, `recipient_phone`, `recipient_address`, `cod_amount`, `item_description`, `alternative_phone` replace the order-derived values when present.

- [ ] **Step 1: Write the failing test**

```python
# append to backend/app/tests/test_extra_consignment.py
from unittest.mock import patch

from django.test import override_settings

from app.services import steadfast_order


class _Resp:
    status_code = 200
    def json(self):
        return {"consignment": {"consignment_id": 99, "tracking_code": "TRK", "status": "in_review"}}


@override_settings(COURIER={"STEADFAST_API_KEY": "k", "STEADFAST_SECRET_KEY": "s", "TIMEOUT_SECONDS": 3})
class CreateConsignmentOverridesTests(TestCase):
    def _order(self):
        return Order.objects.create(customer_name="Real", phone="017111",
                                    subtotal=Decimal("1000"), total=Decimal("1080"))

    def test_overrides_replace_payload_fields(self):
        o = self._order()
        with patch.object(steadfast_order.requests, "post", return_value=_Resp()) as post:
            steadfast_order.create_consignment(
                o, invoice="X-2",
                overrides={"recipient_name": "Other", "cod_amount": Decimal("250"),
                           "recipient_address": "New addr", "item_description": "Book"},
            )
        payload = post.call_args.kwargs["json"]
        self.assertEqual(payload["recipient_name"], "Other")
        self.assertEqual(payload["cod_amount"], 250.0)
        self.assertEqual(payload["recipient_address"], "New addr")
        self.assertEqual(payload["item_description"], "Book")
        self.assertEqual(payload["invoice"], "X-2")

    def test_no_overrides_uses_order(self):
        o = self._order()
        with patch.object(steadfast_order.requests, "post", return_value=_Resp()) as post:
            steadfast_order.create_consignment(o)
        self.assertEqual(post.call_args.kwargs["json"]["recipient_name"], "Real")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `../env/Scripts/python manage.py test app.tests.test_extra_consignment.CreateConsignmentOverridesTests`
Expected: FAIL — `create_consignment() got an unexpected keyword argument 'overrides'`.

- [ ] **Step 3: Add the `overrides` param**

In `backend/app/services/steadfast_order.py`, change the signature to
`def create_consignment(order, invoice=None, overrides=None):` and, right after the
`payload = {...}` dict is built (and after the `alternative_phone` block), apply overrides:

```python
    ov = overrides or {}
    if "recipient_name" in ov:
        payload["recipient_name"] = str(ov["recipient_name"])[:100]
    if "recipient_phone" in ov:
        payload["recipient_phone"] = str(ov["recipient_phone"])
    if "recipient_address" in ov:
        payload["recipient_address"] = str(ov["recipient_address"])[:250]
    if "cod_amount" in ov and ov["cod_amount"] is not None:
        payload["cod_amount"] = float(ov["cod_amount"])
    if "item_description" in ov and ov["item_description"]:
        payload["item_description"] = str(ov["item_description"])[:250]
    if ov.get("alternative_phone"):
        payload["alternative_phone"] = str(ov["alternative_phone"])
```

- [ ] **Step 4: Run test to verify it passes**

Run: `../env/Scripts/python manage.py test app.tests.test_extra_consignment`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/steadfast_order.py backend/app/tests/test_extra_consignment.py
git commit -m "feat: create_consignment supports field overrides"
```

---

### Task 3: `book_extra` order action + serializer field

**Files:**
- Modify: `backend/app/admin_api.py` — Order viewset (add action near `resubmit_steadfast` ~661); `AdminOrderSerializer` (~513)
- Test: `backend/app/tests/test_extra_consignment.py` (add API test class)

**Interfaces:**
- Consumes: `create_consignment(order, invoice=..., overrides=...)` (Task 2), `ExtraConsignment` (Task 1), `Order.compute_cod`, `Order.full_address`.
- Produces: `POST orders/{id}/book_extra/` → 200 with the created row; `AdminOrderSerializer` returns `extra_consignments` (list).

- [ ] **Step 1: Write the failing test**

```python
# append to backend/app/tests/test_extra_consignment.py
from django.contrib.auth.models import User
from rest_framework.test import APITestCase


@override_settings(COURIER={"STEADFAST_API_KEY": "k", "STEADFAST_SECRET_KEY": "s", "TIMEOUT_SECONDS": 3})
class BookExtraApiTests(APITestCase):
    def setUp(self):
        self.client.force_authenticate(User.objects.create_user("admin", password="x", is_staff=True))
        self.order = Order.objects.create(customer_name="Real", phone="017111",
                                          subtotal=Decimal("1000"), total=Decimal("1080"))

    def _ok(self):
        return patch("app.admin_api.create_consignment", return_value={
            "consignment_id": "99", "tracking_code": "TRK", "status": "in_review",
            "cod_amount": Decimal("250"),
        })

    def test_book_extra_creates_row_with_unique_invoice(self):
        with self._ok():
            r1 = self.client.post(f"/api/admin/orders/{self.order.id}/book_extra/",
                                  {"cod_amount": "250", "recipient_name": "Other"}, format="json")
            r2 = self.client.post(f"/api/admin/orders/{self.order.id}/book_extra/",
                                  {"cod_amount": "300"}, format="json")
        self.assertEqual(r1.status_code, 200)
        self.assertEqual(r1.json()["invoice"], f"{self.order.uid}-2")
        self.assertEqual(r2.json()["invoice"], f"{self.order.uid}-3")
        self.assertEqual(self.order.extra_consignments.count(), 2)

    def test_steadfast_error_creates_no_row(self):
        from app.services.steadfast_order import SteadfastError
        with patch("app.admin_api.create_consignment", side_effect=SteadfastError("down")):
            r = self.client.post(f"/api/admin/orders/{self.order.id}/book_extra/",
                                 {"cod_amount": "250"}, format="json")
        self.assertEqual(r.status_code, 502)
        self.assertEqual(self.order.extra_consignments.count(), 0)

    def test_serializer_lists_extras(self):
        with self._ok():
            self.client.post(f"/api/admin/orders/{self.order.id}/book_extra/",
                             {"cod_amount": "250"}, format="json")
        r = self.client.get(f"/api/admin/orders/{self.order.id}/")
        self.assertEqual(len(r.json()["extra_consignments"]), 1)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `../env/Scripts/python manage.py test app.tests.test_extra_consignment.BookExtraApiTests`
Expected: FAIL — 404 (action missing) / `KeyError: 'extra_consignments'`.

- [ ] **Step 3: Add the serializer field**

Near `AdminOrderSerializer` in `backend/app/admin_api.py`, add a small nested serializer:

```python
class ExtraConsignmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = ExtraConsignment
        fields = ["id", "invoice", "consignment_id", "tracking_code", "status",
                  "cod_amount", "recipient_name", "recipient_phone",
                  "recipient_address", "item_description", "created_at"]
```

Import `ExtraConsignment` where the other models are imported. In `AdminOrderSerializer`, add
`extra_consignments = ExtraConsignmentSerializer(many=True, read_only=True)` above `class Meta`
and `"extra_consignments"` to the `fields` list.

- [ ] **Step 4: Add the `book_extra` action**

Add to the Order viewset (near `resubmit_steadfast`). Reuse the module-level
`create_consignment` import already at the top of `admin_api.py`:

```python
    @action(detail=True, methods=["post"])
    def book_extra(self, request, pk=None):
        """Book an ADDITIONAL Steadfast consignment for this order with edited fields."""
        order = self.get_object()
        d = request.data

        def dec(v):
            try:
                return Decimal(str(v)) if v not in (None, "") else None
            except Exception:
                return None

        # Unique invoice: {uid}-2, -3, ... bump past any existing.
        n = order.extra_consignments.count() + 2
        while order.extra_consignments.filter(invoice=f"{order.uid}-{n}").exists():
            n += 1
        invoice = f"{order.uid}-{n}"

        overrides = {}
        for f in ["recipient_name", "recipient_phone", "recipient_address", "item_description"]:
            if d.get(f):
                overrides[f] = d[f]
        cod = dec(d.get("cod_amount"))
        if cod is not None:
            overrides["cod_amount"] = cod
        if order.whatsapp:
            overrides["alternative_phone"] = order.whatsapp

        try:
            res = create_consignment(order, invoice=invoice, overrides=overrides)
        except SteadfastError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)

        ec = ExtraConsignment.objects.create(
            order=order, invoice=invoice,
            consignment_id=res["consignment_id"], tracking_code=res["tracking_code"],
            status=res["status"],
            cod_amount=cod if cod is not None else res.get("cod_amount") or Decimal("0"),
            recipient_name=overrides.get("recipient_name", order.customer_name or ""),
            recipient_phone=overrides.get("recipient_phone", order.phone or ""),
            recipient_address=overrides.get("recipient_address", order.full_address or ""),
            item_description=overrides.get("item_description", ""),
        )
        return Response(ExtraConsignmentSerializer(ec).data)
```

`SteadfastError` and `create_consignment` are already imported at the top of `admin_api.py` (line ~46).

- [ ] **Step 5: Run test to verify it passes**

Run: `../env/Scripts/python manage.py test app.tests.test_extra_consignment`
Expected: PASS (all classes).

- [ ] **Step 6: Commit**

```bash
git add backend/app/admin_api.py backend/app/tests/test_extra_consignment.py
git commit -m "feat: book_extra action and extra_consignments in order API"
```

---

### Task 4: Order page — Additional consignments card + Book-another form

**Files:**
- Modify: `frontend/src/lib/adminApi.ts` (`AdminOrder` type)
- Modify: `frontend/src/app/admin/orders/[id]/page.tsx`

**Interfaces:**
- Consumes: `orders/{id}/book_extra/` → an `ExtraConsignment` row; `AdminOrder.extra_consignments`.

- [ ] **Step 1: Add types to adminApi.ts**

In `frontend/src/lib/adminApi.ts` add:

```typescript
export type ExtraConsignment = {
  id: number; invoice: string; consignment_id: string; tracking_code: string;
  status: string; cod_amount: string; recipient_name: string;
  recipient_phone: string; recipient_address: string; item_description: string;
  created_at: string;
};
```

and add `extra_consignments: ExtraConsignment[];` to the `AdminOrder` type.

- [ ] **Step 2: Add extra-booking state + handlers**

In `page.tsx`, add state:

```tsx
const [extraOpen, setExtraOpen] = useState(false);
const [extra, setExtra] = useState({
  recipient_name: "", recipient_phone: "", recipient_address: "",
  cod_amount: "", item_description: "",
});

function startExtra() {
  if (!order) return;
  setExtra({
    recipient_name: order.customer_name || "",
    recipient_phone: order.phone || "",
    recipient_address: order.full_address || "",
    cod_amount: order.cod_amount || "",
    item_description: order.items.map((it) => it.product_name).filter(Boolean).join(", "),
  });
  setError(""); setMsg(""); setExtraOpen(true);
}

async function bookExtra() {
  if (!order) return;
  setBusy(true); setError(""); setMsg("");
  try {
    await adminPost(`orders/${order.id}/book_extra/`, extra);
    setExtraOpen(false); setMsg("Extra consignment booked"); load();
  } catch (e) {
    setError(e instanceof Error ? e.message : "Booking failed");
  } finally { setBusy(false); }
}
```

- [ ] **Step 3: Render the card**

Below the existing Steadfast section, add:

```tsx
<Card className="mt-4 p-4">
  <div className="mb-3 flex items-center justify-between">
    <h3 className="font-semibold">Additional consignments</h3>
    <AdminButton type="button" onClick={startExtra}>Book another entry</AdminButton>
  </div>

  {order.extra_consignments.length === 0 && (
    <p className="text-sm text-slate-400">No additional consignments.</p>
  )}
  {order.extra_consignments.map((ec) => (
    <div key={ec.id} className="flex flex-wrap gap-x-6 gap-y-1 border-t border-slate-100 py-2 text-sm">
      <span>Invoice: {ec.invoice}</span>
      <span>CID: {ec.consignment_id || "—"}</span>
      <span>Track: {ec.tracking_code || "—"}</span>
      <span>Status: {ec.status || "—"}</span>
      <span>COD: ৳{ec.cod_amount}</span>
    </div>
  ))}

  {extraOpen && (
    <div className="mt-3 grid gap-3 border-t border-slate-100 pt-3">
      <Field label="Recipient name">
        <TextInput value={extra.recipient_name}
          onChange={(e) => setExtra({ ...extra, recipient_name: e.target.value })} />
      </Field>
      <Field label="Phone">
        <TextInput value={extra.recipient_phone}
          onChange={(e) => setExtra({ ...extra, recipient_phone: e.target.value })} />
      </Field>
      <Field label="Address">
        <TextArea value={extra.recipient_address}
          onChange={(e) => setExtra({ ...extra, recipient_address: e.target.value })} />
      </Field>
      <Field label="COD amount (৳)">
        <TextInput type="number" inputMode="decimal" min="0" value={extra.cod_amount}
          onChange={(e) => setExtra({ ...extra, cod_amount: e.target.value })} />
      </Field>
      <Field label="Item description">
        <TextInput value={extra.item_description}
          onChange={(e) => setExtra({ ...extra, item_description: e.target.value })} />
      </Field>
      <div className="flex gap-2">
        <AdminButton type="button" onClick={bookExtra} disabled={busy}>Book on Steadfast</AdminButton>
        <AdminButton type="button" variant="ghost" onClick={() => setExtraOpen(false)}>Cancel</AdminButton>
      </div>
    </div>
  )}
</Card>
```

(Match `AdminButton`'s actual prop names in `components/admin/ui`; drop `variant` if it isn't supported.)

- [ ] **Step 4: Verify the build + manual check**

Run: `cd frontend && npm run build`
Expected: build succeeds.
Manual: on an order, "Book another entry" prefills from the order; editing COD then booking adds a row; a Steadfast failure shows the error inline and the form stays open.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/adminApi.ts "frontend/src/app/admin/orders/[id]/page.tsx"
git commit -m "feat: order page additional Steadfast consignments"
```

---

## Self-Review Notes
- Spec coverage: model (T1), service overrides (T2), API book_extra + serializer (T3), order-page UI (T4). All spec sections covered.
- Unique invoice `{uid}-n` starting `-2`, bump on collision — T3 code + test.
- `SteadfastError` → 502, no row — T3 test asserts count 0.
- Primary Order booking fields untouched (spec decision) — no Order field changes in any task.
- Type consistency: `ExtraConsignment` fields identical across model (T1), serializer (T3), TS type (T4).
