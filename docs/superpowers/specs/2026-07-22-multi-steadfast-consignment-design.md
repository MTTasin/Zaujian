# Multiple Steadfast entries per order — Design

**Date:** 2026-07-22
**Status:** Approved, ready for plan

## Goal
Sometimes one order needs **more than one** Steadfast consignment (e.g. split
shipment, a re-send with a different COD amount). Give the admin a way to book
**additional** consignments for an order, editing the fields before each booking.

## Decisions (locked)
- **Primary + extras** model: the existing single booking on `Order`
  (`steadfast_consignment_id` / `steadfast_tracking_code` / `steadfast_status`) is
  **left untouched**. Additional bookings live in a new child model. No migration of
  existing data.
- **"Book another" form fields are all editable, prefilled** from the order:
  recipient name, phone, full address, COD amount, item description.

## Data model
New model in `backend/app/models.py`:

```python
class ExtraConsignment(models.Model):
    """An additional Steadfast booking for an order, beyond the primary one on Order."""
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="extra_consignments")
    invoice = models.CharField(max_length=40)          # unique per Steadfast, e.g. "{uid}-2"
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
```

- `cod_amount` is **Decimal** (money rule).
- The edited recipient/address/item fields are stored on the row so the admin can see
  exactly what each extra booking was sent with (they may differ from the order).

## Service change
Extend `create_consignment` in `backend/app/services/steadfast_order.py`:

```python
def create_consignment(order, invoice=None, overrides=None):
```

- `overrides` = optional dict. When a key is present it **replaces** the value
  otherwise derived from the order:
  `recipient_name`, `recipient_phone`, `recipient_address`, `cod_amount`,
  `item_description`, `alternative_phone`.
- Existing callers (primary confirm, resubmit) pass no `overrides` → behavior
  unchanged.
- Keep the current sync call, per-courier timeout, and `SteadfastError` on failure.

## Backend API
New action on the order viewset (`admin_api.py`):

- `POST orders/{id}/book_extra/`
  - Body: `recipient_name`, `recipient_phone`, `recipient_address`, `cod_amount`,
    `item_description` (all optional; missing → order default).
  - Compute a **unique invoice**: `{uid}-{n}` where `n` = next index
    (`extra_consignments.count() + 2`, so the first extra is `-2`). Guard against a
    collision by bumping `n` until unused.
  - Call `create_consignment(order, invoice=invoice, overrides=<body>)`.
  - **On success**: create an `ExtraConsignment` row with the returned
    `consignment_id` / `tracking_code` / `status` plus the submitted fields; return
    it.
  - **On `SteadfastError`**: return the error, create **no** row (mirrors the primary
    confirm/resubmit behavior).
- **Order detail serializer**: add `extra_consignments` (list) so the page can render
  them.

## Frontend (admin, English)
Order detail page (`frontend/src/app/admin/orders/[id]/page.tsx`), below the existing
Steadfast section:

- **Additional consignments** card:
  - Table of existing extras: invoice, consignment id, tracking code, status, COD.
  - **Book another entry** button → opens a form prefilled from the order:
    - recipient name ← `customer_name`
    - phone ← `phone`
    - address ← `full_address`
    - COD amount ← `compute_cod()` (order's current COD)
    - item description ← same readable item list the primary booking uses
  - All fields editable. Submit → `book_extra/` → on success append the row and
    refresh; on error show the Steadfast error inline, keep the form open.

## Out of scope
- Changing / migrating the primary booking fields on `Order`.
- Per-extra status refresh / cancel via API (v1 stores the status returned at booking
  time; refreshing each extra can come later if needed).
- Editing an extra after it is booked.

## Testing
- Service: `overrides` replaces the right fields; no `overrides` = unchanged payload.
- API: successful `book_extra` creates a row with a unique `{uid}-n` invoice;
  `SteadfastError` creates no row and returns the error; invoice index increments
  across multiple extras.
- Frontend: form prefills from order defaults; edited COD is what gets submitted; row
  appears after success; error stays inline.
