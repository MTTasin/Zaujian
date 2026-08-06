# Moderator / staff access control — Design

## Goal
Staff (moderators) can log into the admin panel, but the owner decides **which
sections they see** and **whether they can change anything there**. Today every
`is_staff` account is effectively root: `IsAdminUser` is the only check on all
~40 admin endpoints, so anyone who can open the panel can delete orders, read
the cash-book and rewrite the bot persona.

## Locked decisions (owner, 2026-08-01)
1. **Three levels per section**: `none` / `view` / `full`. `view` = every GET
   works, every write is refused. `full` = everything in that section.
2. **Owner = `is_superuser`.** Bypasses every section check, is the only account
   that can manage staff. There is exactly one identity type below it:
   moderator (`is_staff` + not superuser).
3. **Never grantable, owner-only forever**: staff management, order hard-delete,
   Bot Instructions, Site Settings, the audit log.
4. **Finance IS grantable** (`view` or `full`) — an accountant-type moderator is
   a real use case. It is simply `none` by default.
5. **Staff are managed from a new `/admin/staff` page** in the React panel, not
   from Django admin.
6. **Every write by a staff user is logged** (append-only `AdminAuditLog`),
   readable by the owner. Answers "who cancelled this order".
7. **The backend is the enforcement point.** The frontend hides what a moderator
   cannot use; that is UX, never security. Every rule is re-checked server-side.

## Model

```python
class StaffProfile(models.Model):
    """Per-section access for one staff user. Owner (superuser) has no row and
    needs none — superuser bypasses every check."""
    user   = models.OneToOneField(User, on_delete=models.CASCADE, related_name="staff_profile")
    access = models.JSONField(default=dict)   # {"orders": "full", "finance": "view"}
    note   = models.CharField(max_length=200, blank=True)   # "packing desk", "accounts"
    created_at / updated_at
```

`access` is a JSON dict rather than a row per section because the section list
lives in code (it tracks the panel's pages, not data), and the whole map is read
on every request — one column, one query, no joins. Unknown keys are ignored on
read and rejected on write, so deleting a section from the code never breaks a
saved profile.

A moderator with **no** `StaffProfile` has access to nothing — safe default, and
it means a user created directly in Django admin cannot accidentally inherit
power.

```python
class AdminAuditLog(models.Model):
    user       = FK(User, null=True, on_delete=SET_NULL)
    username   = CharField(64)          # snapshot: survives user deletion
    method     = CharField(8)
    path       = CharField(200)
    section    = CharField(32)
    status_code= PositiveSmallIntegerField()
    object_repr= CharField(200, blank=True)
    payload    = JSONField(default=dict) # redacted + truncated request body
    ip         = GenericIPAddressField(null=True)
    created_at = DateTimeField(auto_now_add=True, db_index=True)
```

Append-only. No update path, no delete path in the API. Purged on a schedule
(below) so it cannot grow forever.

`PushSubscription` gains `user = FK(User, null=True)` so alerts can be aimed at
the staff who actually own that section (existing rows keep `null` = owner).

## Section registry — the single source of truth

`app/permissions.py`:

```python
NONE, VIEW, FULL = "none", "view", "full"

SECTIONS = {          # key: (label, owner_only)
  "dashboard": ("Dashboard",        False),
  "orders":    ("Orders",           False),
  "analytics": ("Analytics",        False),
  "finance":   ("Finance",          False),
  "fraud":     ("Fraud Check",      False),
  "leads":     ("Leads",            False),
  "capi":      ("CAPI Events",      False),
  "chats":     ("Live Chats",       False),
  "custom":    ("Custom Requests",  False),
  "products":  ("Products & Customization", False),
  "combos":    ("Listings",         False),
  "homepage":  ("Homepage",         False),
  "gallery":   ("Gallery",          False),
  "bot":       ("Bot Instructions", True),
  "settings":  ("Site Settings",    True),
  "staff":     ("Staff",            True),
  "audit":     ("Audit Log",        True),
}
```

Endpoint → section map (every current `/api/admin/` route is covered):

| section | endpoints |
|---|---|
| dashboard | `admin/dashboard/` |
| orders | `orders/` viewset + all its actions, `orders/manual/`, `orders/catalogue/`, `chat-unread/`†, challan data |
| analytics | `analytics/`, `analytics/live/`, `analytics/overview/` |
| finance | `expenses/ incomes/ suppliers/ buyers/ finance-categories/ credit-payments/`, `finance/summary/ meta/ ledger/ order-search/ order/<id>/` |
| fraud | `fraud-check/` |
| leads | `leads/` |
| capi | `capi-events/` |
| chats | `chats/`, `chat-unread/`† |
| custom | `custom-requests/` |
| products | `products/ product-images/ product-specs/ product-fields/ colors/ toppings/ inside/ static/ dupatta/ config-images/` |
| combos | `combos/ combo-images/ combo-fields/` |
| homepage | `home-categories/` |
| gallery | `gallery-photos/ gallery-tags/` |
| bot *(owner)* | `bot-config/` |
| settings *(owner)* | `site-settings/` |
| staff *(owner)* | `staff/` (new) |
| audit *(owner)* | `audit-log/` (new) |

† `chat-unread/` is the badge poll shared by two sections — it returns only the
counters the caller may see (`waiting`/`unread` need `chats`, `new_orders` needs
`orders`), zeroing the rest instead of 403-ing, because the layout polls it on
every page.

**`/admin/products` and `/admin/customization` are one section** (`products`) —
they are two views of the same endpoints, so splitting them would be a lie.

## Enforcement

```python
class SectionPermission(BasePermission):
    """Staff + section level. Superuser bypasses. Write = FULL, read = VIEW."""
    def has_permission(self, request, view):
        u = request.user
        if not (u and u.is_authenticated and u.is_active and u.is_staff):
            return False
        if u.is_superuser:
            return True
        section = getattr(view, "section", None)
        if section is None or SECTIONS[section][1]:      # unmapped or owner-only
            return False                                  # fail closed
        level = access_level(u, section)
        if level == NONE:
            return False
        if request.method in SAFE_METHODS:
            return True
        return level == FULL or getattr(view, "action", None) in getattr(view, "VIEW_WRITES", ())
```

- Viewsets get a `SectionViewSetMixin` (`section = "orders"`,
  `permission_classes = [SectionPermission]`).
- Function views get `@section_required("analytics")` / `@owner_required`.
- **`VIEW_WRITES`** is the escape hatch for POSTs that are not really edits and
  a view-only moderator must still be able to fire:
  `orders.mark_seen` (called on page open — a 403 would break the list),
  `fraud-check/` (a lookup that happens to POST a phone number),
  `push-subscribe/` (device registration).
- **Owner-only actions inside a granted section**: `AdminOrderViewSet.destroy`
  re-checks `request.user.is_superuser` and returns 403 for anyone else, on top
  of the existing "only in_review/pending_payment/cancelled" status guard. A
  moderator with `orders: full` can cancel an order; only the owner can erase it.
- **Cross-section reads degrade, they don't explode**: `admin/dashboard/` omits
  the "Net this month" card when the caller lacks `finance:view`; the order
  detail page skips the `finance/order/<id>/` call entirely. Nothing 403s in the
  middle of a page the moderator is allowed to open.

### The hole-detector test
The real risk is a *forgotten* endpoint, not a wrong rule. So one test walks the
whole URLconf, collects every route under `/api/admin/`, and asserts each
resolves to a view carrying either a `section` or the owner-only marker. A new
endpoint added without a section fails the suite instead of shipping wide open.

## Django admin (`:8000/admin`)
Moderators are `is_staff`, which is exactly what Django's own admin checks — so
they could log in there and bypass every rule above. `app/admin.py` overrides
`admin.site.has_permission` to require `is_superuser`. The Django admin becomes
owner-only, which matches how it is already used (technical fallback).

## Audit log
`AdminAuditMiddleware` (after `AuthenticationMiddleware`):

- Only paths starting `/api/admin/`, only `POST/PUT/PATCH/DELETE`.
- Captures the body **before** the view runs (DRF's parsers consume it),
  **skips multipart** — image uploads are large and say nothing useful.
- Redacts `password`, `token`, `secret`, `key` (case-insensitive, nested);
  truncates the serialized payload to 2000 chars.
- Skips the noise: `mark_seen`, `push-subscribe`, `login` (logged as an event
  without the body), `t/`.
- Logs failures too, with their status code — a wall of 403s from one account is
  itself the signal.
- Never breaks the request: the whole middleware body is wrapped, a logging
  failure is swallowed.

Retention: `purge_audit_log` management command (default 180 days,
`AUDIT_RETENTION_DAYS` setting), added to the existing cron list.

## Staff API (owner-only)
`admin/staff/` viewset — list / create / patch / delete, plus
`POST admin/staff/<id>/set_password/`.

Guards, all server-side:
- Rejects any action targeting a **superuser** row (the owner is not editable
  through the panel) and any action on **yourself**.
- `access` keys validated against `SECTIONS`; owner-only keys rejected; values
  must be `none|view|full`.
- Create sets `is_staff=True`, `is_superuser=False` unconditionally — the
  request cannot ask for superuser.
- **Deactivating or changing a password deletes that user's `Token`**, so the
  session dies on the next request instead of lingering.
- Permission changes need no token rotation: the level is read from the DB on
  every request, so a revoke takes effect immediately.

`admin/login/` and `admin/me/` gain `is_owner` + `access` in the response.
Login already refuses non-staff; it also refuses `is_active=False`.

## Frontend

- **`lib/adminAuth.ts`** (pure, unit-tested): `Level`, `Access`,
  `can(access, section, "read"|"write")`, `sectionForPath(pathname)`,
  `firstAllowedPath(access)`. Unknown section → `none` (fail closed).
- **`AdminAuthProvider`** in `app/admin/layout.tsx`: fetches `admin/me/` once
  after the token check, holds `{username, isOwner, access}`, exposes `useAdminAuth()`.
- **Nav**: each `NAV` entry gains `section`; the sidebar renders only readable
  ones. Owner-only items (`Staff`, `Audit Log`, `Bot Instructions`) appear for
  the owner only.
- **Route guard**: on pathname change, if `sectionForPath` is not readable →
  `router.replace(firstAllowedPath(access))`, or a plain "No access" screen when
  nothing is granted.
- **Read-only pages**: `const canWrite = can(access, "orders", "write")`. Write
  controls render disabled (not hidden — a moderator should see the action
  exists), and the page header shows a `View only` pill. Applied to Orders,
  Finance, Products, Listings, Homepage, Gallery, Chats, Custom Requests, Leads.
- **`/admin/staff`**: table (username, note, last login, active, section summary)
  + a create/edit drawer whose body is the section matrix — one row per
  grantable section, three radio buttons. Owner-only sections are not listed.
- **`/admin/audit`**: filterable table (user / section / date range), read-only.

## Push notifications
`send_push(title, body, url, section=…)` filters `PushSubscription` to users
whose access includes that section (`null` user = owner = always). A packing
moderator with only `orders` stops getting chat handoff alerts.

## Non-goals
- No roles/groups layer. Access is per user; two moderators with the same job
  are configured twice. (A `Role` table is an easy later addition — the access
  map is already a plain dict.)
- No object-level rules ("only orders you created"). Section + level only.
- No 2FA, no IP allowlist, no session list. Out of scope.
- No per-field masking (a moderator with `orders:view` sees customer phone
  numbers — they need them to do the job).
