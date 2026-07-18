# Orphaned Media Auto-Cleanup — Design

## Problem
Django never deletes files from disk when a model row is deleted or an
`ImageField`/`FileField` value is replaced. Every replaced product photo,
deleted gallery image, removed config photo, etc. leaves its old file in
`MEDIA_ROOT` forever. On shared cPanel hosting with limited disk this grows
without bound. Symptom already seen: replaced product images leaving stale files.

## Goal
1. **Prevent** new orphans automatically as rows are edited/deleted.
2. **Clean** the existing backlog and catch anything the live path misses.

## Constraints
- Shared cPanel + Passenger, **no job queue** — periodic work runs as a Django
  management command via cron (existing pattern: `purge_old_chat_uploads`).
- Local `FileSystemStorage`, `MEDIA_ROOT = BASE_DIR / "media"`.
- Money/orders untouched — this only removes unreferenced *files*, never rows.

## Approach (decided)
Two complementary parts:

### Part 1 — django-cleanup (live prevention)
- Add dependency `django-cleanup` to `backend/requirements.txt`.
- Add `"django_cleanup.apps.CleanupConfig"` to `INSTALLED_APPS` as the **last**
  entry (it must load after all apps whose models it hooks).
- Behaviour (out of the box): for every `FileField`/`ImageField` on every model,
  it deletes the old file when the field is **replaced**, and deletes all files
  when a row is **deleted**. Deletions are deferred to transaction commit, so a
  rolled-back transaction does not lose files.
- No per-model code. Automatically covers: `products/`, `colors/`, `toppings/`,
  `inside/`, `static_designs/`, `config_images/`, `dupatta/`, `combos/`,
  `custom_requests/`, `payments/`, `gallery/orig|display|thumb/`, `chat_uploads/`,
  `site/`, `home_categories/`.

Known gaps (why Part 2 exists): does not remove files already orphaned before
install; does not fire on `QuerySet.update()` (bypasses `save()`); a failed
storage delete is swallowed.

### Part 2 — `purge_orphan_media` sweep command (backlog + safety net)
New management command `backend/app/management/commands/purge_orphan_media.py`.

Algorithm:
1. Build the **referenced set**: iterate `django.apps.apps.get_models()`; for each
   model, find concrete fields that are `models.FileField` (covers `ImageField`);
   for each such field, collect the non-empty `.name` (storage-relative path) from
   every row (`.values_list(field, flat=True)`, skipping blanks). Store in a
   `set[str]`.
2. Walk `MEDIA_ROOT` recursively (`os.walk`). For each file, compute its path
   relative to `MEDIA_ROOT` with forward slashes (matches stored `.name`).
3. Delete a file only if **both**: (a) its relative path is not in the referenced
   set, and (b) its mtime is older than the grace period (default 24h) — the grace
   window protects files uploaded but whose row is still being written.
4. Print summary: files scanned, orphans found, deleted count, bytes freed.

Flags:
- `--dry-run` — report what would be deleted, delete nothing.
- `--grace-hours N` — override the 24h mtime safety window.

Decisions:
- **Do not** prune emptied directories (harmless, keeps the command simple).
- Default run **deletes** (not dry-run); operators run `--dry-run` first by
  convention. Documented.
- Operates strictly inside `MEDIA_ROOT`; never touches static or code paths.

## Data flow
```
Admin edits/deletes a row
   -> model .save()/.delete()
   -> django-cleanup signal
   -> old file removed on transaction commit        (Part 1, live)

Cron (monthly) OR manual run
   -> purge_orphan_media
   -> referenced set from DB  vs  files on disk
   -> unreferenced + past grace  ->  deleted         (Part 2, sweep)
```

## Testing
Backend tests (Django `TestCase`), `settings` override `MEDIA_ROOT` to a temp dir.

Part 1 (integration — confirms wiring, not re-testing the library):
- Replace a `ProductImage.image` with a new file -> the old file no longer exists
  on disk after commit.
- Delete a `ProductImage` row -> its file no longer exists on disk.

Part 2 (`purge_orphan_media`):
- A file on disk referenced by a row and older than grace -> **kept**.
- An unreferenced file older than grace -> **deleted**.
- An unreferenced file **newer** than grace -> **kept** (grace window).
- `--dry-run` -> nothing deleted, orphan still on disk, reported in output.

## Deployment
- `backend/requirements.txt`: add `django-cleanup` (pin a current version).
- `INSTALLED_APPS`: append `"django_cleanup.apps.CleanupConfig"` (last).
- No migrations (no model changes).
- cPanel: install deps in the app env, restart the Python app.
- Cron (optional, monthly), alongside existing crons:
  `python manage.py purge_orphan_media`
- Run once manually after deploy to clear the current backlog (recommend a
  `--dry-run` first to eyeball the list).
- Update `DEPLOY.md` (cron list) and `CLAUDE.md` (Deployment/conventions).

## Out of scope
- Remote/object storage backends (only local `FileSystemStorage` today).
- Deleting orphaned DB *rows* — this is purely about disk files.
