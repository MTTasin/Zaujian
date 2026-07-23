# Customization Inputs — Implementation Plan (Phase 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the admin define compulsory customer inputs per product (বরের নাম, এখানে কি বসবে?…), let the customer add an optional note per product, and let them step back in the build wizard.

**Architecture:** A new `ProductField` model (admin-managed inline, like `ProductSpec`) declares labelled inputs per product. The build wizard renders them, blocks confirm until required ones are filled, and posts answers + an optional note into the existing `CartItem.config` JSON snapshot — so no migration is needed for the values and they inherit the price-snapshot guarantee. `cart_add` re-validates required fields server-side.

**Tech Stack:** Django 6 + DRF, Next.js 16 (App Router, TS, Tailwind v4), Vitest + RTL.

**Depends on:** Phase 1 (`2026-07-17-customization-picker-rules.md`) — build that first.

## Global Constraints

- **Storefront is Bengali**; **admin panel is English**. Compose from `components/ui/` primitives + design tokens; headings use `font-display`.
- **Mobile-first, low-bandwidth**: big tap targets, inputs comfortable on low-end Android.
- **Money = `DecimalField`, never float.**
- **Never trust the client**: required fields are re-validated in `cart_add`.
- **Snapshot rule**: the answer's `label` is stored **next to its value** in `config`, so renaming a `ProductField` later never rewrites a placed order.
- Field type is **single-line text only** (YAGNI — no date picker/dropdown).
- Limits: each field value **max 200 chars**; `note` **max 200 chars**.
- **No git commits during execution** (user commits manually later): each "Commit" step is a checkpoint.
- Backend from `backend/` as `../env/Scripts/python manage.py …`. Frontend `npm test` / `npm run build` from `frontend/`.

---

### Task 1: `ProductField` model + API

**Files:**
- Modify: `backend/app/models.py` (add `ProductField`)
- Modify: `backend/app/serializers.py` (add `ProductFieldSerializer`; nest on `ProductDetailSerializer`)
- Test: `backend/app/tests/test_product_fields.py`

**Interfaces:**
- Produces: `ProductField(product FK related_name="input_fields", label, placeholder, required, order)`, `Meta.ordering = ["order", "id"]`.
- Produces: `ProductDetailSerializer` gains read-only nested `input_fields`: `[{id, label, placeholder, required, order}]`.

- [ ] **Step 1: Write the failing test**

```python
# backend/app/tests/test_product_fields.py
from decimal import Decimal

from django.test import TestCase

from app.models import Product, ProductField
from app.serializers import ProductDetailSerializer


def _product():
    return Product.objects.create(
        name="Book", slug="book-pf", kind=Product.Kind.LAYERED, category="book",
        base_price=Decimal("1250"), active=True,
    )


class ProductFieldTests(TestCase):
    def test_defaults_to_required(self):
        f = ProductField.objects.create(product=_product(), label="বরের নাম")
        self.assertTrue(f.required)
        self.assertEqual(f.placeholder, "")
        self.assertEqual(f.order, 0)

    def test_ordering(self):
        p = _product()
        ProductField.objects.create(product=p, label="B", order=2)
        ProductField.objects.create(product=p, label="A", order=1)
        self.assertEqual([f.label for f in p.input_fields.all()], ["A", "B"])

    def test_detail_serializer_nests_input_fields(self):
        p = _product()
        ProductField.objects.create(
            product=p, label="বরের নাম", placeholder="পুরো নাম", required=True, order=1,
        )
        data = ProductDetailSerializer(p).data
        self.assertEqual(len(data["input_fields"]), 1)
        self.assertEqual(data["input_fields"][0]["label"], "বরের নাম")
        self.assertEqual(data["input_fields"][0]["placeholder"], "পুরো নাম")
        self.assertTrue(data["input_fields"][0]["required"])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `../env/Scripts/python manage.py test app.tests.test_product_fields -v 2`
Expected: FAIL — `ImportError: cannot import name 'ProductField'`.

- [ ] **Step 3: Add the model**

In `backend/app/models.py`, immediately after the `ProductSpec` class:

```python
class ProductField(models.Model):
    """An admin-defined input the configurator asks the customer to fill in.

    e.g. label="বরের নাম" / "এখানে কি বসবে?". Single-line text only.
    """

    product = models.ForeignKey(
        Product, on_delete=models.CASCADE, related_name="input_fields",
    )
    label = models.CharField(
        max_length=120, help_text="Shown to the customer, e.g. বরের নাম / এখানে কি বসবে?",
    )
    placeholder = models.CharField(max_length=120, blank=True, help_text="Optional hint")
    required = models.BooleanField(
        default=True, help_text="Required fields block the confirm button",
    )
    order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["order", "id"]

    def __str__(self):
        return f"{self.product.name}: {self.label}"
```

- [ ] **Step 4: Add the serializer + nest it**

In `backend/app/serializers.py`, add `ProductField` to the `from .models import (...)`
block, then add above `ProductDetailSerializer`:

```python
class ProductFieldSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProductField
        fields = ["id", "label", "placeholder", "required", "order"]
```

In `ProductDetailSerializer`, add the declared field:
```python
    input_fields = ProductFieldSerializer(many=True, read_only=True)
```
and add `"input_fields"` to its `Meta.fields` list.

- [ ] **Step 5: Migrate and run tests**

Run:
```
../env/Scripts/python manage.py makemigrations app
../env/Scripts/python manage.py migrate
../env/Scripts/python manage.py test app.tests.test_product_fields -v 1
```
Expected: migration creates `ProductField`; 3 tests PASS.

- [ ] **Step 6: Commit (checkpoint).**

---

### Task 2: Admin CRUD for `ProductField`

**Files:**
- Modify: `backend/app/admin_api.py` (serializer + viewset)
- Modify: `backend/app/urls.py` (register route)
- Test: `backend/app/tests/test_admin_product_fields.py`

**Interfaces:**
- Consumes: `ProductField` (Task 1).
- Produces: `AdminProductFieldViewSet` at `/api/admin/product-fields/`, filterable via `?product=<id>` (the existing `_AdminBase.get_queryset` does this automatically because the model has a `product` FK).

- [ ] **Step 1: Write the failing test**

```python
# backend/app/tests/test_admin_product_fields.py
from decimal import Decimal

from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from app.models import Product, ProductField


class AdminProductFieldTests(APITestCase):
    def setUp(self):
        self.client.force_authenticate(User.objects.create_user("a", password="x", is_staff=True))
        self.product = Product.objects.create(
            name="Book", slug="book-apf", kind=Product.Kind.LAYERED, category="book",
            base_price=Decimal("1250"), active=True,
        )

    def test_create(self):
        r = self.client.post("/api/admin/product-fields/", {
            "product": self.product.id, "label": "বরের নাম",
            "placeholder": "পুরো নাম", "required": True, "order": 1,
        }, format="json")
        self.assertEqual(r.status_code, 201)
        self.assertEqual(ProductField.objects.count(), 1)

    def test_filter_by_product(self):
        other = Product.objects.create(
            name="Box", slug="box-apf", kind=Product.Kind.LAYERED, category="box",
            base_price=Decimal("400"), active=True,
        )
        ProductField.objects.create(product=self.product, label="Mine")
        ProductField.objects.create(product=other, label="Theirs")
        r = self.client.get(f"/api/admin/product-fields/?product={self.product.id}")
        self.assertEqual([f["label"] for f in r.json()], ["Mine"])

    def test_requires_admin(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get("/api/admin/product-fields/").status_code, 401)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `../env/Scripts/python manage.py test app.tests.test_admin_product_fields -v 2`
Expected: FAIL — 404, route not registered.

- [ ] **Step 3: Add the serializer + viewset**

In `backend/app/admin_api.py`, add `ProductField` to the `from .models import (...)`
block, then immediately after `AdminProductSpecViewSet`:

```python
class AdminProductFieldSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProductField
        fields = ["id", "product", "label", "placeholder", "required", "order"]


class AdminProductFieldViewSet(_AdminBase):
    """Customer input fields for a product. ?product=<id> to filter."""

    queryset = ProductField.objects.all()
    serializer_class = AdminProductFieldSerializer
```

- [ ] **Step 4: Register the route**

In `backend/app/urls.py`, next to the `product-specs` registration:
```python
admin_router.register(r"product-fields", admin_api.AdminProductFieldViewSet, basename="admin-product-field")
```

- [ ] **Step 5: Run test to verify it passes**

Run: `../env/Scripts/python manage.py test app.tests.test_admin_product_fields -v 1`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit (checkpoint).**

---

### Task 3: `cart_add` stores + validates fields and note

**Files:**
- Modify: `backend/app/views.py` (`cart_add`)
- Test: `backend/app/tests/test_cart_inputs.py`

**Interfaces:**
- Consumes: `ProductField` (Task 1).
- Produces: `cart_add` accepts `fields: [{label, value}]` and `note: str`. Stores them into `CartItem.config` as `config["fields"]` and `config["note"]`. Returns **400** `{"error": "<label> লিখুন"}` when a required `ProductField` has no non-blank value. Values and note are trimmed to 200 chars.

- [ ] **Step 1: Write the failing test**

```python
# backend/app/tests/test_cart_inputs.py
from decimal import Decimal

from rest_framework.test import APITestCase

from app.models import CartItem, Product, ProductField


class CartInputTests(APITestCase):
    def setUp(self):
        self.product = Product.objects.create(
            name="Pen", slug="pen-ci", kind=Product.Kind.SIMPLE, category="pen",
            base_price=Decimal("150"), active=True,
        )

    def _post(self, body):
        return self.client.post("/api/cart/add/", body, format="json", HTTP_X_CART_TOKEN="tok")

    def test_stores_fields_and_note(self):
        ProductField.objects.create(product=self.product, label="বরের নাম", required=True)
        r = self._post({
            "slug": "pen-ci", "selection": {},
            "fields": [{"label": "বরের নাম", "value": "  Rahim  "}],
            "note": "সোনালি রঙে",
        })
        self.assertEqual(r.status_code, 201)
        cfg = CartItem.objects.get().config
        self.assertEqual(cfg["fields"], [{"label": "বরের নাম", "value": "Rahim"}])
        self.assertEqual(cfg["note"], "সোনালি রঙে")

    def test_rejects_missing_required_field(self):
        ProductField.objects.create(product=self.product, label="বরের নাম", required=True)
        r = self._post({"slug": "pen-ci", "selection": {}, "fields": [], "note": ""})
        self.assertEqual(r.status_code, 400)
        self.assertIn("বরের নাম", r.json()["error"])
        self.assertEqual(CartItem.objects.count(), 0)

    def test_rejects_blank_required_value(self):
        ProductField.objects.create(product=self.product, label="বরের নাম", required=True)
        r = self._post({
            "slug": "pen-ci", "selection": {},
            "fields": [{"label": "বরের নাম", "value": "   "}],
        })
        self.assertEqual(r.status_code, 400)

    def test_optional_field_may_be_empty(self):
        ProductField.objects.create(product=self.product, label="ডাকনাম", required=False)
        r = self._post({"slug": "pen-ci", "selection": {}, "fields": []})
        self.assertEqual(r.status_code, 201)

    def test_note_is_trimmed_to_200(self):
        r = self._post({"slug": "pen-ci", "selection": {}, "note": "x" * 500})
        self.assertEqual(r.status_code, 201)
        self.assertEqual(len(CartItem.objects.get().config["note"]), 200)

    def test_no_note_key_when_blank(self):
        r = self._post({"slug": "pen-ci", "selection": {}})
        self.assertEqual(r.status_code, 201)
        self.assertNotIn("note", CartItem.objects.get().config)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `../env/Scripts/python manage.py test app.tests.test_cart_inputs -v 2`
Expected: FAIL — fields/note are ignored; no 400 on a missing required field.

- [ ] **Step 3: Add a shared helper**

In `backend/app/views.py`, add above `cart_add`:

```python
MAX_INPUT_LEN = 200


def _collect_inputs(product, data):
    """Validate + normalize customer inputs. Returns (fields, note).

    Raises ValueError(label) when a required ProductField has no value.
    """
    supplied = {
        str(f.get("label", "")).strip(): str(f.get("value", "")).strip()[:MAX_INPUT_LEN]
        for f in (data.get("fields") or [])
        if isinstance(f, dict)
    }
    fields = []
    for pf in product.input_fields.all():
        value = supplied.get(pf.label, "")
        if pf.required and not value:
            raise ValueError(pf.label)
        if value:
            fields.append({"label": pf.label, "value": value})
    note = str(data.get("note") or "").strip()[:MAX_INPUT_LEN]
    return fields, note
```

- [ ] **Step 4: Use it in `cart_add`**

In `cart_add`, replace the `else:` branch (the non-custom path that currently calls
`price_selection`) with:

```python
    else:
        try:
            price, config = price_selection(product, selection)
        except ValueError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        try:
            fields, note = _collect_inputs(product, request.data)
        except ValueError as missing:
            return Response(
                {"error": f"{missing} লিখুন"}, status=status.HTTP_400_BAD_REQUEST,
            )
        if fields:
            config["fields"] = fields
        if note:
            config["note"] = note
        item = CartItem.objects.create(
            session_key=_cart_key(request), product=product,
            config=config, price_snapshot=price,
        )
```

- [ ] **Step 5: Run test to verify it passes**

Run: `../env/Scripts/python manage.py test app.tests.test_cart_inputs -v 1`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit (checkpoint).**

---

### Task 4: Admin — "Customer input fields" manager

**Files:**
- Modify: `frontend/src/lib/adminApi.ts` (type + client calls)
- Modify: `frontend/src/app/admin/products/[id]/page.tsx` (manager UI)

**Interfaces:**
- Consumes: `/api/admin/product-fields/` (Task 2).

- [ ] **Step 1: Add the type + client calls**

In `frontend/src/lib/adminApi.ts`:

```ts
export interface AdminProductField {
  id: number;
  product: number;
  label: string;
  placeholder: string;
  required: boolean;
  order: number;
}

export const adminProductFields = {
  list: (productId: number) =>
    adminGet<AdminProductField[]>(`product-fields/?product=${productId}`),
  create: (body: Partial<AdminProductField>) =>
    adminPost<AdminProductField>("product-fields/", body),
  update: (id: number, body: Partial<AdminProductField>) =>
    adminPatch<AdminProductField>(`product-fields/${id}/`, body),
  remove: (id: number) => adminDelete(`product-fields/${id}/`),
};
```

- [ ] **Step 2: Build the manager section**

In `frontend/src/app/admin/products/[id]/page.tsx`, add a `<Card>` section titled
**"Customer input fields"** with the hint *"Questions the customer must answer while
customizing this product (e.g. বরের নাম, এখানে কি বসবে?)."* It lists existing rows and
supports add / edit / delete:

```tsx
function InputFieldsManager({ productId }: { productId: number }) {
  const [rows, setRows] = useState<AdminProductField[] | null>(null);
  const [draft, setDraft] = useState<Partial<AdminProductField>>({
    label: "", placeholder: "", required: true, order: 0,
  });

  const load = useCallback(() => {
    adminProductFields.list(productId).then(setRows).catch(() => setRows([]));
  }, [productId]);
  useEffect(load, [load]);

  async function add() {
    if (!draft.label?.trim()) return;
    await adminProductFields.create({ ...draft, product: productId });
    setDraft({ label: "", placeholder: "", required: true, order: 0 });
    load();
  }
  async function remove(id: number) {
    if (!confirm("Delete this field?")) return;
    await adminProductFields.remove(id);
    load();
  }

  return (
    <Card className="p-5">
      <h2 className="font-semibold text-slate-800">Customer input fields</h2>
      <p className="mb-3 text-sm text-slate-500">
        Questions the customer must answer while customizing this product
        (e.g. বরের নাম, এখানে কি বসবে?).
      </p>
      {rows === null ? (
        <Loading />
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.map((f) => (
            <li key={f.id} className="flex items-center gap-3 py-2 text-sm">
              <span className="font-medium text-slate-800">{f.label}</span>
              {f.placeholder && <span className="text-slate-400">{f.placeholder}</span>}
              <span className="text-xs text-slate-500">
                {f.required ? "required" : "optional"} · order {f.order}
              </span>
              <button className="ml-auto text-red-600 underline" onClick={() => remove(f.id)}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <Field label="Label">
          <TextInput
            value={draft.label ?? ""}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            placeholder="বরের নাম"
          />
        </Field>
        <Field label="Placeholder">
          <TextInput
            value={draft.placeholder ?? ""}
            onChange={(e) => setDraft({ ...draft, placeholder: e.target.value })}
          />
        </Field>
        <Field label="Order">
          <TextInput
            type="number"
            value={String(draft.order ?? 0)}
            onChange={(e) => setDraft({ ...draft, order: Number(e.target.value) })}
          />
        </Field>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            checked={draft.required ?? true}
            onChange={(e) => setDraft({ ...draft, required: e.target.checked })}
          />
          Required
        </label>
        <AdminButton onClick={add}>Add field</AdminButton>
      </div>
    </Card>
  );
}
```

Render `<InputFieldsManager productId={product.id} />` below the existing form, and add
`AdminProductField`, `adminProductFields` to the `@/lib/adminApi` import plus
`useCallback` to the React import.

- [ ] **Step 3: Verify build**

Run: `cd frontend && npm run build`
Expected: exit 0.

- [ ] **Step 4: Commit (checkpoint).**

---

### Task 5: Wizard — render fields, block confirm, note, previous button

**Files:**
- Modify: `frontend/src/lib/api.ts` (`ProductDetail` type + `addToCart` signature)
- Create: `frontend/src/components/configurator/CustomerInputs.tsx`
- Create: `frontend/src/components/configurator/CustomerInputs.test.tsx`
- Modify: `frontend/src/app/customize/build/page.tsx` (previous button)

**Interfaces:**
- Consumes: `input_fields` on `ProductDetail` (Task 1); `cart_add` `fields`/`note` (Task 3).
- Produces: `<CustomerInputs fields={ProductInputField[]} values={Record<string,string>} note={string} onChange={(label,value)=>void} onNoteChange={(v)=>void} errors={Record<string,string>} />`
- Produces: `missingRequired(fields, values): string[]` — labels of unfilled required fields.
- Produces: `addToCart(slug, selection, isCustom?, extras?: {fields?: {label,value}[]; note?: string})`.

- [ ] **Step 1: Extend the client types**

In `frontend/src/lib/api.ts`:

```ts
export interface ProductInputField {
  id: number;
  label: string;
  placeholder: string;
  required: boolean;
  order: number;
}
```
Add `input_fields: ProductInputField[];` to the `ProductDetail` interface, and change
`addToCart`:

```ts
export const addToCart = (
  slug: string,
  selection: Record<string, number>,
  isCustom = false,
  extras?: { fields?: { label: string; value: string }[]; note?: string },
) =>
  apiSend<CartState>("cart/add/", "POST", {
    slug,
    selection,
    is_custom_request: isCustom,
    ...(extras?.fields?.length ? { fields: extras.fields } : {}),
    ...(extras?.note ? { note: extras.note } : {}),
  }).then((r) => {
    metaTrack("AddToCart", { currency: "BDT" });
    return r;
  });
```
(Keep the rest of the existing `.then()` body exactly as it is.)

- [ ] **Step 2: Write the failing test**

```tsx
// frontend/src/components/configurator/CustomerInputs.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { CustomerInputs, missingRequired } from "./CustomerInputs";
import type { ProductInputField } from "@/lib/api";

const fields: ProductInputField[] = [
  { id: 1, label: "বরের নাম", placeholder: "পুরো নাম", required: true, order: 1 },
  { id: 2, label: "ডাকনাম", placeholder: "", required: false, order: 2 },
];

describe("missingRequired", () => {
  it("lists unfilled required labels", () => {
    expect(missingRequired(fields, {})).toEqual(["বরের নাম"]);
  });
  it("ignores optional and whitespace-filled required", () => {
    expect(missingRequired(fields, { "বরের নাম": "Rahim" })).toEqual([]);
    expect(missingRequired(fields, { "বরের নাম": "   " })).toEqual(["বরের নাম"]);
  });
});

describe("CustomerInputs", () => {
  it("renders each field and the optional note", () => {
    render(
      <CustomerInputs fields={fields} values={{}} note="" errors={{}}
        onChange={() => {}} onNoteChange={() => {}} />,
    );
    expect(screen.getByLabelText(/বরের নাম/)).toBeInTheDocument();
    expect(screen.getByLabelText(/ডাকনাম/)).toBeInTheDocument();
    expect(screen.getByLabelText(/বিশেষ নির্দেশনা/)).toBeInTheDocument();
  });

  it("reports edits", () => {
    const onChange = vi.fn();
    render(
      <CustomerInputs fields={fields} values={{}} note="" errors={{}}
        onChange={onChange} onNoteChange={() => {}} />,
    );
    fireEvent.change(screen.getByLabelText(/বরের নাম/), { target: { value: "Rahim" } });
    expect(onChange).toHaveBeenCalledWith("বরের নাম", "Rahim");
  });

  it("shows an error under the offending field", () => {
    render(
      <CustomerInputs fields={fields} values={{}} note=""
        errors={{ "বরের নাম": "বরের নাম লিখুন" }}
        onChange={() => {}} onNoteChange={() => {}} />,
    );
    expect(screen.getByText("বরের নাম লিখুন")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/configurator/CustomerInputs.test.tsx`
Expected: FAIL — cannot resolve `./CustomerInputs`.

- [ ] **Step 4: Write the component**

```tsx
// frontend/src/components/configurator/CustomerInputs.tsx
"use client";
import type { ProductInputField } from "@/lib/api";

const MAX = 200;

/** Labels of required fields the customer has not filled in. */
export function missingRequired(
  fields: ProductInputField[],
  values: Record<string, string>,
): string[] {
  return fields
    .filter((f) => f.required && !(values[f.label] ?? "").trim())
    .map((f) => f.label);
}

export function CustomerInputs({
  fields, values, note, errors, onChange, onNoteChange,
}: {
  fields: ProductInputField[];
  values: Record<string, string>;
  note: string;
  errors: Record<string, string>;
  onChange: (label: string, value: string) => void;
  onNoteChange: (value: string) => void;
}) {
  return (
    <div className="mt-6 space-y-4">
      {fields.map((f) => (
        <div key={f.id}>
          <label htmlFor={`pf-${f.id}`} className="mb-1 block text-sm font-semibold text-plum">
            {f.label}
            {f.required && <span className="text-rose"> *</span>}
          </label>
          <input
            id={`pf-${f.id}`}
            value={values[f.label] ?? ""}
            maxLength={MAX}
            placeholder={f.placeholder}
            onChange={(e) => onChange(f.label, e.target.value)}
            className={`w-full rounded-xl border bg-surface px-4 py-3 text-base outline-none focus:border-plum ${
              errors[f.label] ? "border-rose" : "border-border"
            }`}
          />
          {errors[f.label] && <p className="mt-1 text-sm text-rose">{errors[f.label]}</p>}
        </div>
      ))}

      <div>
        <label htmlFor="pf-note" className="mb-1 block text-sm font-semibold text-plum">
          বিশেষ নির্দেশনা (ঐচ্ছিক)
        </label>
        <textarea
          id="pf-note"
          value={note}
          maxLength={MAX}
          rows={2}
          placeholder="কিছু বলার থাকলে লিখুন"
          onChange={(e) => onNoteChange(e.target.value)}
          className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-base outline-none focus:border-plum"
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/configurator/CustomerInputs.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 6: Wire it into each configurator**

In **each** of `frontend/src/components/configurator/GalleryConfigurator.tsx`,
`LayeredConfigurator.tsx`, and `DupattaConfigurator.tsx` (whichever exist), add this state
next to the existing selection state:

```tsx
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [inputErrors, setInputErrors] = useState<Record<string, string>>({});
```
Render `<CustomerInputs fields={product.input_fields ?? []} values={inputs} note={note}
errors={inputErrors} onChange={(l, v) => setInputs((s) => ({ ...s, [l]: v }))}
onNoteChange={setNote} />` directly above the confirm/add button, and gate the existing
add handler — before it calls `addToCart`:

```tsx
    const missing = missingRequired(product.input_fields ?? [], inputs);
    if (missing.length) {
      setInputErrors(Object.fromEntries(missing.map((l) => [l, `${l} লিখুন`])));
      return;
    }
    setInputErrors({});
```
and pass the answers:
```tsx
      await addToCart(product.slug, selection, custom, {
        fields: (product.input_fields ?? [])
          .map((f) => ({ label: f.label, value: (inputs[f.label] ?? "").trim() }))
          .filter((f) => f.value),
        note: note.trim(),
      });
```
Import `{ CustomerInputs, missingRequired }` from `./CustomerInputs`.

- [ ] **Step 7: Add the previous button**

In `frontend/src/app/customize/build/page.tsx`, add next to `handleAdded`:

```tsx
  const goBack = useCallback(() => {
    const prev = index - 1;
    if (prev < 0) return;
    sessionStorage.setItem("wizard_index", String(prev));
    setIndex(prev);
    window.scrollTo(0, 0);
  }, [index]);
```
Render above the configurator (only when not on the first step):
```tsx
      {index > 0 && (
        <button
          onClick={goBack}
          className="mb-3 inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-surface px-4 text-sm font-semibold text-plum active:scale-95"
        >
          ← পূর্ববর্তী
        </button>
      )}
```

- [ ] **Step 8: Verify build + full frontend tests**

Run: `cd frontend && npx vitest run && npm run build`
Expected: all PASS; build exit 0.

- [ ] **Step 9: Commit (checkpoint).**

---

### Task 6: Orders admin shows the answers and note

**Files:**
- Modify: `frontend/src/app/admin/orders/[id]/page.tsx`

**Interfaces:**
- Consumes: `config["fields"]` / `config["note"]` written by `cart_add` (Task 3).

- [ ] **Step 1: Render them in the item's config block**

Find where the order item's readable config is rendered and add, inside that block:

```tsx
{Array.isArray(item.config?.fields) && item.config.fields.length > 0 && (
  <ul className="mt-1 space-y-0.5">
    {item.config.fields.map((f: { label: string; value: string }) => (
      <li key={f.label} className="text-sm">
        <span className="text-slate-500">{f.label}:</span>{" "}
        <span className="font-medium text-slate-800">{f.value}</span>
      </li>
    ))}
  </ul>
)}
{item.config?.note && (
  <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-sm text-amber-900">
    Note: {item.config.note}
  </p>
)}
```
If the item's `config` is typed, widen it to `Record<string, unknown>` or add
`fields?: {label: string; value: string}[]; note?: string`.

- [ ] **Step 2: Verify build**

Run: `cd frontend && npm run build`
Expected: exit 0.

- [ ] **Step 3: Manual smoke + commit (checkpoint)**

Start both apps. In Admin → Products open the book, add a required field "বরের নাম".
Go to `/customize`, pick the book, proceed: the field renders; confirm is blocked with
"বরের নাম লিখুন" until filled; the note is optional; "← পূর্ববর্তী" appears from step 2
and returns to the previous product. Place the order and confirm the Orders admin shows
the answer and the note. Checkpoint.

---

## Self-Review

- **Spec coverage:** `ProductField` model + nested `input_fields` API (T1); admin CRUD endpoint (T2); `cart_add` storing `config["fields"]`/`config["note"]` + server-side required validation + 200-char limits (T3); admin "Customer input fields" manager (T4); wizard rendering + required blocking + optional note + "← পূর্ববর্তী" (T5); Orders admin display (T6). Label-next-to-value snapshot rule honoured in T3's `_collect_inputs`.
- **Placeholder scan:** none — every code step carries complete code. T5 Step 6 names the concrete configurator files and the exact edits; T6 Step 1 names the exact JSX.
- **Type consistency:** `input_fields` used identically across model `related_name` (T1), serializer (T1), `ProductDetail` type (T5), and component props. `missingRequired(fields, values)` and `CustomerInputs` props match between test (T5 Step 2) and implementation (T5 Step 4). `fields: [{label, value}]` + `note` identical between `addToCart` (T5), `cart_add`/`_collect_inputs` (T3), and the Orders admin reader (T6).
