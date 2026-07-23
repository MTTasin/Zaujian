# Customization Picker Rules — Implementation Plan (Phase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make book/frame/thumb mutually exclusive and let the admin order the customize picker — so frame and thumb can be added from the panel with no further code.

**Architecture:** Two admin-editable fields on `Product` (`exclusive_group`, `customize_order`) drive everything. The `/customize` picker sorts by `customize_order` (deleting the hardcoded `ORDER` array) and auto-swaps same-group selections via a pure, unit-tested helper. Django admin blocks combos that mix a group; `_shop_facts` tells the bot the rule.

**Tech Stack:** Django 6 + DRF, Next.js 16 (App Router, TS, Tailwind v4), Vitest + RTL.

## Global Constraints

- **Storefront is Bengali**; **admin panel is English**. Compose UI from `components/ui/` primitives + design tokens (`plum/rose/gold/surface/surface-2/muted/border`), never raw hex; headings use `font-display`.
- **Mobile-first, low-bandwidth** (2G/3G, low-end Android): big tap targets.
- **Money = `DecimalField`, never float.**
- **No git commits during execution** (user commits manually later): each "Commit" step is a checkpoint — verify green, stage nothing.
- Backend runs from `backend/` as `../env/Scripts/python manage.py …`. Frontend tests `npm test` from `frontend/`; build `npm run build`.
- After model changes: `../env/Scripts/python manage.py check` + makemigrations/migrate.
- Products sharing a **non-blank** `exclusive_group` cannot be selected together. Blank = unrestricted.
- The picker's order is inherited by `/customize/build` via `sessionStorage.wizard_slugs` — fix the picker only.

---

### Task 1: `Product.exclusive_group` + `customize_order` (model + API)

**Files:**
- Modify: `backend/app/models.py` (`Product`)
- Modify: `backend/app/serializers.py` (`ProductListSerializer`, `ProductDetailSerializer`)
- Test: `backend/app/tests/test_customize_fields.py`

**Interfaces:**
- Produces: `Product.exclusive_group: str` (CharField 40, blank), `Product.customize_order: int` (PositiveSmallInt, default 0). Both exposed on the list + detail serializers under the same names.

- [ ] **Step 1: Write the failing test**

```python
# backend/app/tests/test_customize_fields.py
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APITestCase

from app.models import Product
from app.serializers import ProductDetailSerializer, ProductListSerializer


def _product(slug, **kw):
    return Product.objects.create(
        name=kw.pop("name", slug), slug=slug, kind=Product.Kind.GALLERY,
        category=kw.pop("category", slug), base_price=Decimal("100"), active=True, **kw,
    )


class CustomizeFieldTests(TestCase):
    def test_defaults_are_unrestricted(self):
        p = _product("mirror")
        self.assertEqual(p.exclusive_group, "")
        self.assertEqual(p.customize_order, 0)

    def test_fields_persist(self):
        p = _product("frame", exclusive_group="nikahnama", customize_order=2)
        p.refresh_from_db()
        self.assertEqual(p.exclusive_group, "nikahnama")
        self.assertEqual(p.customize_order, 2)


class CustomizeSerializerTests(APITestCase):
    def test_list_serializer_exposes_fields(self):
        p = _product("thumb", exclusive_group="nikahnama", customize_order=3)
        data = ProductListSerializer(p).data
        self.assertEqual(data["exclusive_group"], "nikahnama")
        self.assertEqual(data["customize_order"], 3)

    def test_detail_serializer_exposes_fields(self):
        p = _product("book2", exclusive_group="nikahnama", customize_order=1)
        data = ProductDetailSerializer(p).data
        self.assertEqual(data["exclusive_group"], "nikahnama")
        self.assertEqual(data["customize_order"], 1)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `../env/Scripts/python manage.py test app.tests.test_customize_fields -v 2`
Expected: FAIL — `TypeError: Product() got unexpected keyword arguments: 'exclusive_group'`.

- [ ] **Step 3: Add the model fields**

In `backend/app/models.py`, inside `class Product`, directly after the `category` field:

```python
    exclusive_group = models.CharField(
        max_length=40, blank=True,
        help_text=(
            "Products sharing this group cannot be selected together in the "
            "configurator (e.g. 'nikahnama' on book, frame, thumb). Blank = no restriction."
        ),
    )
    customize_order = models.PositiveSmallIntegerField(
        default=0, help_text="Position in the /customize picker. Lower shows first.",
    )
```

- [ ] **Step 4: Expose on both serializers**

In `backend/app/serializers.py`, add `"exclusive_group"` and `"customize_order"` to the
`fields` list of **both** `ProductListSerializer.Meta` and `ProductDetailSerializer.Meta`.

- [ ] **Step 5: Migrate and run tests**

Run:
```
../env/Scripts/python manage.py makemigrations app
../env/Scripts/python manage.py migrate
../env/Scripts/python manage.py test app.tests.test_customize_fields -v 1
```
Expected: migration adds 2 fields; 4 tests PASS.

- [ ] **Step 6: Commit (checkpoint)** — verify green.

---

### Task 2: Bot states the exclusive-group rule

**Files:**
- Modify: `backend/app/services/chatbot.py` (`_shop_facts`)
- Test: `backend/app/tests/test_bot_facts.py` (add a test)

**Interfaces:**
- Consumes: `Product.exclusive_group` (Task 1).
- Produces: `_shop_facts()` gains one line per group having 2+ active products: `একসাথে শুধু একটি নেওয়া যাবে: <name>, <name>, …`

- [ ] **Step 1: Write the failing test**

Append to `backend/app/tests/test_bot_facts.py`:

```python
class ExclusiveGroupFactsTests(TestCase):
    def test_states_the_only_one_rule(self):
        for slug in ("book-x", "frame-x", "thumb-x"):
            Product.objects.create(
                name=slug, slug=slug, kind=Product.Kind.SIMPLE, category=slug,
                base_price=Decimal("100"), active=True, exclusive_group="nikahnama",
            )
        facts = _shop_facts()
        self.assertIn("একসাথে শুধু একটি নেওয়া যাবে", facts)
        self.assertIn("book-x", facts)
        self.assertIn("thumb-x", facts)

    def test_no_rule_line_for_a_lone_group_member(self):
        Product.objects.create(
            name="only-one", slug="only-one", kind=Product.Kind.SIMPLE, category="x",
            base_price=Decimal("100"), active=True, exclusive_group="solo",
        )
        self.assertNotIn("একসাথে শুধু একটি নেওয়া যাবে", _shop_facts())
```

- [ ] **Step 2: Run test to verify it fails**

Run: `../env/Scripts/python manage.py test app.tests.test_bot_facts -v 1`
Expected: FAIL — the rule line is missing.

- [ ] **Step 3: Add the rule to `_shop_facts`**

In `backend/app/services/chatbot.py`, inside `_shop_facts()`, immediately **after** the
`## PRODUCTS` block and **before** the `## READY-MADE COMBOS` block:

```python
    groups = {}
    for p in products:
        if p.exclusive_group:
            groups.setdefault(p.exclusive_group, []).append(p.name)
    for names in groups.values():
        if len(names) > 1:
            lines.append(f"একসাথে শুধু একটি নেওয়া যাবে: {', '.join(names)}")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `../env/Scripts/python manage.py test app.tests.test_bot_facts -v 1`
Expected: PASS (all tests in the module).

- [ ] **Step 5: Commit (checkpoint).**

---

### Task 3: Django admin blocks combos that mix a group

**Files:**
- Modify: `backend/app/admin.py` (`PrebuiltComboAdmin`)
- Test: `backend/app/tests/test_combo_admin.py`

**Interfaces:**
- Consumes: `Product.exclusive_group` (Task 1).
- Produces: `PrebuiltComboForm` (a `forms.ModelForm` for `PrebuiltCombo`) whose `clean()` raises `ValidationError` when the chosen `products` contain 2+ items sharing a non-blank `exclusive_group`. Wired via `PrebuiltComboAdmin.form`.

- [ ] **Step 1: Write the failing test**

```python
# backend/app/tests/test_combo_admin.py
from decimal import Decimal

from django.test import TestCase

from app.admin import PrebuiltComboForm
from app.models import PrebuiltCombo, Product


def _p(slug, group=""):
    return Product.objects.create(
        name=slug, slug=slug, kind=Product.Kind.SIMPLE, category=slug,
        base_price=Decimal("100"), active=True, exclusive_group=group,
    )


class ComboAdminValidationTests(TestCase):
    def test_rejects_two_products_from_one_group(self):
        book = _p("book-c", "nikahnama")
        frame = _p("frame-c", "nikahnama")
        form = PrebuiltComboForm(data={
            "name": "Bad Combo", "slug": "bad-combo", "price": "2500",
            "description": "", "products": [book.pk, frame.pk],
            "featured": False, "active": True, "order": 0,
        })
        self.assertFalse(form.is_valid())
        self.assertIn("nikahnama", str(form.errors))

    def test_allows_one_per_group(self):
        book = _p("book-ok", "nikahnama")
        pen = _p("pen-ok", "")
        form = PrebuiltComboForm(data={
            "name": "Good Combo", "slug": "good-combo", "price": "2500",
            "description": "", "products": [book.pk, pen.pk],
            "featured": False, "active": True, "order": 0,
        })
        self.assertTrue(form.is_valid(), form.errors)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `../env/Scripts/python manage.py test app.tests.test_combo_admin -v 2`
Expected: FAIL — `ImportError: cannot import name 'PrebuiltComboForm'`.

- [ ] **Step 3: Add the form and wire it**

In `backend/app/admin.py`, add near the top (after the existing imports):

```python
from django import forms
```

Then, immediately **above** the existing `@admin.register(PrebuiltCombo)` block:

```python
class PrebuiltComboForm(forms.ModelForm):
    """A combo must never contain two products from the same exclusive group."""

    class Meta:
        model = PrebuiltCombo
        fields = "__all__"

    def clean(self):
        cleaned = super().clean()
        chosen = cleaned.get("products")
        if not chosen:
            return cleaned
        groups = {}
        for p in chosen:
            if p.exclusive_group:
                groups.setdefault(p.exclusive_group, []).append(p.name)
        for group, names in groups.items():
            if len(names) > 1:
                raise forms.ValidationError(
                    f"A combo can contain only one of the '{group}' group — "
                    f"you picked: {', '.join(names)}."
                )
        return cleaned
```

Add `form = PrebuiltComboForm` inside the existing `PrebuiltComboAdmin` class body.

- [ ] **Step 4: Run test to verify it passes**

Run: `../env/Scripts/python manage.py test app.tests.test_combo_admin -v 1`
Expected: PASS (2 tests).

Note: if the form's required fields differ from the test payload, run
`../env/Scripts/python manage.py shell -c "from app.models import PrebuiltCombo; print([f.name for f in PrebuiltCombo._meta.get_fields()])"`
and adjust the test `data` dict to include every required field.

- [ ] **Step 5: Commit (checkpoint).**

---

### Task 4: Admin product form — group + order inputs

**Files:**
- Modify: `frontend/src/app/admin/products/[id]/page.tsx`
- Modify: `frontend/src/lib/adminApi.ts` (`AdminProduct` type)

**Interfaces:**
- Consumes: `exclusive_group`, `customize_order` from the API (Task 1).

- [ ] **Step 1: Add the fields to the admin type**

In `frontend/src/lib/adminApi.ts`, add to the `AdminProduct` interface:
```ts
  exclusive_group: string;
  customize_order: number;
```

- [ ] **Step 2: Send them on save**

In `frontend/src/app/admin/products/[id]/page.tsx`, inside the object built for the PATCH
(the one that already contains `base_price: fd.get("base_price")`), add:
```ts
        exclusive_group: fd.get("exclusive_group"),
        customize_order: Number(fd.get("customize_order") ?? 0),
```

- [ ] **Step 3: Render the two inputs**

In the same file, immediately after the existing `<Field label="Category label (shown to customers)">` block:

```tsx
            <Field
              label="Exclusive group"
              hint="Products sharing this group can't be picked together (e.g. type nikahnama on book, frame, thumb). Blank = no restriction."
            >
              <TextInput
                name="exclusive_group"
                defaultValue={product.exclusive_group}
                placeholder="e.g. nikahnama"
              />
            </Field>
            <Field label="Customize order" hint="Position in the customize picker. Lower shows first.">
              <TextInput
                name="customize_order"
                type="number"
                defaultValue={product.customize_order}
              />
            </Field>
```

- [ ] **Step 4: Verify build**

Run: `cd frontend && npm run build`
Expected: build succeeds (exit 0).

- [ ] **Step 5: Commit (checkpoint).**

---

### Task 5: Picker — order by `customize_order` + auto-swap + rule note

**Files:**
- Create: `frontend/src/lib/exclusive.ts`
- Create: `frontend/src/lib/exclusive.test.ts`
- Modify: `frontend/src/app/customize/page.tsx` (delete `ORDER`, use the helper, render the note)
- Modify: `frontend/src/lib/api.ts` (`ProductListItem` type)

**Interfaces:**
- Consumes: `exclusive_group`, `customize_order` on `ProductListItem` (Task 1).
- Produces: `applyExclusive(selected: Set<string>, product: ProductListItem, all: ProductListItem[]): Set<string>` — returns a NEW set. If `product.slug` is already selected → deselect it. Otherwise select it and remove any other selected product sharing the same non-blank `exclusive_group`.
- Produces: `exclusiveGroups(all: ProductListItem[]): string[][]` — arrays of product **names** per non-blank group having 2+ members (used for the Bengali rule note).

- [ ] **Step 1: Add the fields to the client type**

In `frontend/src/lib/api.ts`, add to the `ProductListItem` interface:
```ts
  exclusive_group: string;
  customize_order: number;
```

- [ ] **Step 2: Write the failing test**

```ts
// frontend/src/lib/exclusive.test.ts
import { describe, it, expect } from "vitest";
import { applyExclusive, exclusiveGroups } from "./exclusive";
import type { ProductListItem } from "./api";

const p = (slug: string, exclusive_group = "", name = slug) =>
  ({ slug, name, exclusive_group, customize_order: 0 } as unknown as ProductListItem);

const book = p("book", "nikahnama", "বই");
const frame = p("frame", "nikahnama", "ফ্রেম");
const thumb = p("thumb", "nikahnama", "থাম্ব");
const pen = p("pen");
const all = [book, frame, thumb, pen];

describe("applyExclusive", () => {
  it("swaps a same-group selection", () => {
    const out = applyExclusive(new Set(["book"]), frame, all);
    expect(out.has("frame")).toBe(true);
    expect(out.has("book")).toBe(false);
  });

  it("keeps products from other groups", () => {
    const out = applyExclusive(new Set(["pen"]), book, all);
    expect(out.has("pen")).toBe(true);
    expect(out.has("book")).toBe(true);
  });

  it("deselects when tapping an already-selected product", () => {
    const out = applyExclusive(new Set(["book"]), book, all);
    expect(out.has("book")).toBe(false);
  });

  it("never restricts products with a blank group", () => {
    const out = applyExclusive(new Set(["pen"]), p("box"), all);
    expect(out.has("pen")).toBe(true);
    expect(out.has("box")).toBe(true);
  });

  it("does not mutate the input set", () => {
    const input = new Set(["book"]);
    applyExclusive(input, frame, all);
    expect(input.has("book")).toBe(true);
  });
});

describe("exclusiveGroups", () => {
  it("returns names for groups with 2+ members", () => {
    expect(exclusiveGroups(all)).toEqual([["বই", "ফ্রেম", "থাম্ব"]]);
  });

  it("ignores lone members and blank groups", () => {
    expect(exclusiveGroups([pen, p("solo", "alone")])).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/exclusive.test.ts`
Expected: FAIL — cannot resolve `./exclusive`.

- [ ] **Step 4: Write the helper**

```ts
// frontend/src/lib/exclusive.ts
import type { ProductListItem } from "./api";

/**
 * Toggle `product` in `selected`, enforcing "only one per exclusive group".
 * Returns a NEW Set — never mutates the input.
 */
export function applyExclusive(
  selected: Set<string>,
  product: ProductListItem,
  all: ProductListItem[],
): Set<string> {
  const next = new Set(selected);
  if (next.has(product.slug)) {
    next.delete(product.slug);
    return next;
  }
  const group = product.exclusive_group;
  if (group) {
    // Auto-swap: drop any other selected product from the same group.
    for (const other of all) {
      if (other.slug !== product.slug && other.exclusive_group === group) {
        next.delete(other.slug);
      }
    }
  }
  next.add(product.slug);
  return next;
}

/** Product NAMES per exclusive group that has 2+ members — for the Bengali rule note. */
export function exclusiveGroups(all: ProductListItem[]): string[][] {
  const byGroup = new Map<string, string[]>();
  for (const p of all) {
    if (!p.exclusive_group) continue;
    const names = byGroup.get(p.exclusive_group) ?? [];
    names.push(p.name);
    byGroup.set(p.exclusive_group, names);
  }
  return [...byGroup.values()].filter((names) => names.length > 1);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/exclusive.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Use it in the picker**

In `frontend/src/app/customize/page.tsx`:

1. Delete the line `const ORDER = ["book", "box", "pen", "mirror", "dupatta"];` and its comment.
2. Add the import: `import { applyExclusive, exclusiveGroups } from "@/lib/exclusive";`
3. Replace the sort inside the `getProducts()` effect:

```tsx
        const custom = list.filter((p) => p.is_customizable);
        const sorted = [...custom].sort(
          (a, b) => a.customize_order - b.customize_order || a.name.localeCompare(b.name),
        );
        setProducts(sorted);
```

4. Replace `toggle` entirely:

```tsx
  function toggle(slug: string) {
    const product = products.find((p) => p.slug === slug);
    if (!product) return;
    setSelected((prev) => applyExclusive(prev, product, products));
  }
```

5. Render the rule note — directly after the `<p className="mt-1 text-sm text-muted">যা যা চান বেছে নিন, দাম নিচে দেখা যাবে।</p>` line:

```tsx
          {exclusiveGroups(products).map((names) => (
            <p key={names.join()} className="mt-2 text-sm text-gold">
              {names.join(" / ")} — যেকোনো একটি
            </p>
          ))}
```

- [ ] **Step 7: Verify build + full frontend tests**

Run: `cd frontend && npx vitest run && npm run build`
Expected: all tests PASS; build exit 0.

- [ ] **Step 8: Manual smoke + commit (checkpoint)**

Start backend + frontend. In Admin → Customization add **frame** and **thumb**
(kind = Gallery, category `frame` / `thumb`), then in Admin → Products set both plus the
book to `exclusive_group = nikahnama` and give every customizable product a
`customize_order`. Open `/customize`: the order matches; the note "বই / ফ্রেম / থাম্ব —
যেকোনো একটি" shows; picking Frame deselects Book. Checkpoint.

---

## Self-Review

- **Spec coverage:** `exclusive_group` + `customize_order` model/API (T1); bot rule line (T2); Django-admin combo validation (T3); admin product form fields (T4); picker sort + auto-swap + derived note + `ORDER` deletion (T5). Frame/thumb need no code — covered by T5 Step 8 (admin action). Phase-2 items (`ProductField`, note, previous button) are intentionally in the separate Phase 2 plan.
- **Placeholder scan:** none — every code step carries complete code; T3 Step 4 gives a concrete command for the one shape that can vary (combo form required fields).
- **Type consistency:** `exclusive_group` / `customize_order` named identically across model (T1), serializers (T1), admin type (T4), client type (T5), and helper (T5). `applyExclusive` / `exclusiveGroups` signatures match between test and implementation.
