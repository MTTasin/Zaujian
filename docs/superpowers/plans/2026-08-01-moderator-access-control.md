# Moderator / staff access control — Implementation plan

Design: `docs/superpowers/specs/2026-08-01-moderator-access-control-design.md`.

Six phases. Each ends green (`manage.py test app` + `npm test`). Phases 1–3 are
backend-only and ship a fully enforced system with no UI; the panel keeps
working for the owner throughout.

---

## Phase 1 — Enforcement core (backend)

**New `backend/app/permissions.py`**
- `NONE/VIEW/FULL`, `SECTIONS` registry (17 entries, `owner_only` flag).
- `access_level(user, section)` — superuser → `FULL`; else read
  `user.staff_profile.access`, missing/unknown → `NONE`.
- `SectionPermission`, `SectionViewSetMixin`, `@section_required(key)`,
  `@owner_required`.

**`models.py`** — `StaffProfile` (OneToOne user, `access` JSONField, `note`).
Migration `00XX_staffprofile`.

**Wire every admin endpoint** (`admin_api.py`, `finance_api.py`): replace
`permission_classes = [IsAdminUser]` with the mixin + `section = "…"`, and each
`@permission_classes([IsAdminUser])` with `@section_required("…")` /
`@owner_required` per the design's endpoint table.
- `VIEW_WRITES = ("mark_seen",)` on `AdminOrderViewSet`; same escape for
  `fraud-check/` and `push-subscribe/`.
- `AdminOrderViewSet.destroy`: add the `is_superuser` gate above the existing
  status guard.
- `admin_dashboard`: omit the finance net card unless `finance:view`.
- `admin_chat_unread`: zero the counters the caller may not see.
- `admin_login` / `admin_me`: return `is_owner` + `access`.

**`app/admin.py`** — `admin.site.has_permission` requires `is_superuser`.

**Tests `app/tests/test_staff_access.py`**
- Matrix: for each section, a moderator at `none` (GET 403), `view`
  (GET 200 / POST 403), `full` (both 200).
- Superuser bypasses everything, including owner-only sections.
- Moderator with `orders: full` → cancel OK, hard-delete 403.
- `bot-config/`, `site-settings/` 403 for any moderator.
- `mark_seen` works at `view`.
- Inactive staff → 401; non-staff → 401 at login.
- **Hole detector**: walk `urls.py`, assert every `/api/admin/` route's view has
  a `section` or the owner marker.

## Phase 2 — Staff management API

- `AdminStaffSerializer` + `AdminStaffViewSet` (`section = "staff"`, owner-only)
  with `set_password` action; registered as `admin/staff/`.
- Guards: no touching superusers, no touching self, `access` keys/values
  validated, `is_staff=True`/`is_superuser=False` forced on create.
- Deactivate or password change → delete that user's `Token`.
- Tests: moderator 403 on the whole viewset; owner CRUD; escalation attempts
  (`is_superuser: true`, `access: {"bot": "full"}`, editing the owner, editing
  self) all rejected; token dropped on deactivate.

## Phase 3 — Audit log

- `AdminAuditLog` model + migration; read-only Django admin registration.
- `AdminAuditMiddleware` (settings `MIDDLEWARE`, after auth): capture body
  pre-view, skip multipart + the noise list, redact secrets, truncate 2000,
  log status code, swallow its own errors.
- `admin/audit-log/` read-only viewset (owner-only) with `?user=&section=&start=&end=`.
- `purge_audit_log` management command (`AUDIT_RETENTION_DAYS`, default 180);
  added to the cron list in `DEPLOY.md` + `CLAUDE.md`.
- Tests: write logged with user/section/status; GET not logged; password
  redacted; multipart skipped; a middleware exception does not fail the request.

## Phase 4 — Frontend auth plumbing

- **`lib/adminAuth.ts`** — `can()`, `sectionForPath()`, `firstAllowedPath()`,
  `SECTION_LABELS`. Pure; **write the tests first** (`adminAuth.test.ts`):
  read/write levels, unknown section → denied, owner short-circuit, path
  matching incl. nested routes (`/admin/orders/12/challan` → `orders`).
- **`AdminAuthProvider`** + `useAdminAuth()`; mounted in `app/admin/layout.tsx`
  after the token gate, `admin/me/` fetched once.
- `NAV` entries gain `section`; sidebar + mobile menu filter on read access.
- Route guard + "No access" fallback screen.
- `lib/adminApi.ts`: type `AdminMe`; a 403 response surfaces
  "You don't have access to this" instead of the generic failure.

## Phase 5 — Read-only UI + the two new pages

- Per-page `canWrite` → disabled write controls + a `View only` pill in the
  header. Pages: orders (list, detail, new, challan), finance, products,
  customization, combos, homepage, gallery, chats, custom, leads.
- **`/admin/staff`** — list + create/edit drawer with the section matrix
  (radio per section), activate/deactivate, reset password. Owner-only nav item.
- **`/admin/audit`** — filterable read-only table. Owner-only nav item.

## Phase 6 — Push targeting + docs

- `PushSubscription.user` FK (nullable) + migration; `push-subscribe/` stamps
  `request.user`.
- `send_push(..., section=)` filters recipients by access (`null` user = owner).
  Order pushes → `orders`, handoff pushes → `chats`.
- `CLAUDE.md`: new "Staff & permissions" section; note the cron addition.

---

## Risks / watch-outs
- **A missed endpoint is a full hole.** The hole-detector test in Phase 1 is the
  mitigation and must land with Phase 1, not later.
- **Body capture in the middleware.** Reading `request.body` after DRF parses is
  a `RawPostDataException`; capture before the view and skip multipart.
- **A view-only moderator hitting a POST the page fires automatically** (e.g.
  `mark_seen`) would look like a broken panel. `VIEW_WRITES` covers the known
  three; watch for more when Phase 5 walks each page.
- **Existing accounts.** Any current non-superuser `is_staff` account silently
  drops to zero access on deploy — intended (fail closed), but check first:
  `User.objects.filter(is_staff=True, is_superuser=False)`.
- **Order money panel.** `finance/order/<id>/` is a finance endpoint reached
  from an orders page; the frontend must skip the call, not swallow a 403.
