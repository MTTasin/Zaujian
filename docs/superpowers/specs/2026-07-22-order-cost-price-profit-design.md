# Order cost price → dashboard profit — Design

**Date:** 2026-07-22
**Status:** Approved, ready for plan

## Goal
Let the admin record the real cost of fulfilling each order, and surface **profit**
(revenue − cost) on the dashboard. Cost is entered per order by the admin as orders
come in — there is **no** per-product or per-configuration cost model.

## Decisions (locked)
- **One lump cost per order** (not per line item).
- **Profit basis = subtotal − cost** (delivery charge is ignored; it is pass-through
  to the courier).
- Uncosted orders must **not** fake a profit number — blanks are excluded from the
  profit total and their count is surfaced.

## Data model
Add one field to `Order` (`backend/app/models.py`):

```python
cost_price = models.DecimalField(
    max_digits=10, decimal_places=2, null=True, blank=True,
    help_text="Total cost to fulfil this order. Blank = not costed yet.",
)
```

- **Decimal**, never float (money rule).
- **Nullable**: `null` = "not costed yet" (distinct from a genuine ৳0 cost). This is
  what lets the dashboard exclude uncosted orders instead of counting them as 100%
  margin.
- No snapshot logic needed — cost is admin-entered after the fact, not derived from
  product/option prices, so it has nothing to snapshot from.

### Derived helper
On `Order`, a read-only property for display:

```python
@property
def profit(self):
    if self.cost_price is None:
        return None
    return self.subtotal - self.cost_price
```

## Backend API
1. **Order detail/update serializer** (`AdminOrderSerializer` area in `admin_api.py`):
   - Expose `cost_price` (writable) and `profit` (read-only).
   - Saving flows through the **existing order-edit PATCH path** — no new endpoint.
     `cost_price` is a plain field write; unlike `subtotal` it is **not** recomputed
     from items, so it survives the edit-time subtotal recompute at
     `admin_api.py:625`.
2. **Dashboard** (`admin_dashboard`, `admin_api.py:820`): add
   - `total_profit` = `Sum(subtotal − cost_price)` over orders where `cost_price`
     is set, **excluding** `cancelled`.
   - `uncosted_count` = orders with `cost_price IS NULL`, excluding `cancelled`.
   - Implementation: annotate/aggregate, or sum in Python over the filtered queryset.
     Keep it a single query where practical.
3. **Analytics chart** (`admin_analytics`, `admin_api.py:779`) — *optional, nice to
   have*: add a `profit` figure per day alongside `revenue`. Not required for v1;
   the metric card is the must-have.

## Frontend (admin, English)
- **Order detail page** (`frontend/src/app/admin/orders/[id]/page.tsx`):
  - A **Cost price** number input in the order edit area, prefilled from
    `cost_price`, saved via the existing order save.
  - Show **Profit = subtotal − cost** near the totals once cost is set; show a muted
    "Not costed yet" when blank.
- **Dashboard** (`frontend/src/app/admin/page.tsx`):
  - New metric card **Profit** (`total_profit`).
  - Small hint under it: "N orders not costed yet" when `uncosted_count > 0`, so the
    number is never mistaken for complete.

## Out of scope
- Per-product / per-configuration / per-option cost.
- Cost snapshots or historical cost versioning.
- Editing cost from the orders **list** (detail page only).

## Testing
- Backend: order with `cost_price` set → `profit` correct; `null` → `profit None` and
  excluded from `total_profit`; cancelled orders excluded; ৳0 cost counted (not
  treated as blank).
- Frontend: cost input saves and round-trips; profit renders; "not costed" state
  shows on blank.
