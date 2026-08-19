# Deploy — Zaujain Nikah Point (cPanel)

Two apps + PostgreSQL:

| App | Domain | Type |
|-----|--------|------|
| Backend (Django) | **backzaujain.mttasin.com** | cPanel **Python App** (Passenger) |
| Frontend (Next.js) | **zaujain.mttasin.com** | cPanel **Node.js App** (Passenger) |
| Database | — | cPanel **PostgreSQL** |

The code already includes: `backend/passenger_wsgi.py`, WhiteNoise for static, prod media serving, and `frontend/server.js` for the Node app.

---

## Part A — Backend (backzaujain.mttasin.com)

### 1. Subdomain + Python App
1. cPanel → **Subdomains** → create `backzaujain` (note its document root, e.g. `/home/mttasinc/backzaujain`).
2. cPanel → **Setup Python App** → Python **3.13**, Application root = that folder, Application URL = `backzaujain.mttasin.com`, **Application startup file = `passenger_wsgi.py`**. Create (this makes a virtualenv).

### 2. Upload code + install
Put the **contents of `backend/`** (so `manage.py` + `passenger_wsgi.py` sit in the app root). Then in the app's terminal (activate the venv cPanel shows):
```bash
pip install -r requirements.txt
```

### 3. PostgreSQL
cPanel → **PostgreSQL Databases** → create a database + a user → **add the user to the database** (all privileges). Then build:
```
DATABASE_URL=postgres://DBUSER:DBPASSWORD@127.0.0.1:5432/DBNAME
```

### 4. Environment variables
Set these in the Python App's **Environment variables** section (recommended) — or an app-root `.env`. **cPanel env vars win over `.env`.**

| Key | Value |
|-----|-------|
| `SECRET_KEY` | a long random string (50+ chars) |
| `DEBUG` | `False` |
| `ALLOWED_HOSTS` | `backzaujain.mttasin.com` |
| `CSRF_TRUSTED_ORIGINS` | `https://backzaujain.mttasin.com` |
| `CORS_ALLOWED_ORIGINS` | `https://zaujain.mttasin.com` |
| `DATABASE_URL` | `postgres://…` (from step 3) |
| `FRONTEND_URL` | `https://zaujain.mttasin.com` |
| `DOMAIN` | `zaujain.mttasin.com` |
| `EMAIL_HOST` `EMAIL_HOST_USER` `EMAIL_HOST_PASSWORD` `EMAIL_PORT` `EMAIL_USE_SSL` `DEFAULT_FROM_EMAIL` | your SMTP (as in local `.env`) |
| `STEADFAST_FRAUD_USER` `STEADFAST_FRAUD_PASSWORD` `PATHAO_FRAUD_USER` `PATHAO_FRAUD_PASSWORD` | courier fraud-check logins |
| `STEADFAST_API_KEY` `STEADFAST_SECRET_KEY` | Steadfast consignment API |
| `STEADFAST_WEBHOOK_TOKEN` | secret for the **inbound** Steadfast webhook — invent a long random string, put the same one in their panel (see below). Blank = the endpoint refuses everything. |
| `FRAUD_MIN_SUCCESS_RATIO` | `70` |
| `DELIVERY_CHARGE` `ADVANCE_AMOUNT` `BKASH_NUMBER` `NAGAD_NUMBER` | shop settings |
| `DEEPSEEK_API_KEY` | chatbot |
| `META_DATASET_ID` | `1504590814166492` |
| `META_CAPI_ACCESS_TOKEN` | your CAPI token |
| `META_GRAPH_VERSION` | `v21.0` |
| `META_TEST_EVENT_CODE` | **blank** for live (only set while testing) |

### 5. Migrate + static + admin
In the app terminal (venv active, in app root):
```bash
python manage.py migrate
python manage.py collectstatic --noinput
python manage.py createsuperuser
```

### 6. Restart + verify
```bash
mkdir -p tmp && touch tmp/restart.txt     # or use cPanel "Restart" button
```
Check:
- `https://backzaujain.mttasin.com/api/home/` → returns JSON.
- `https://backzaujain.mttasin.com/admin/` → loads **styled** (WhiteNoise working).
- Uploaded images later resolve at `…/media/...`.

---

## Part B — Frontend (zaujain.mttasin.com)

### 1. Subdomain + Node App
1. cPanel → **Subdomains** → create `zaujain`.
2. cPanel → **Setup Node.js App** → Node **20+**, Application root = the folder, Application URL = `zaujain.mttasin.com`, **Application startup file = `server.js`**.

### 2. Upload code
Put the **contents of `frontend/`** into the app root.

### 3. Environment variables — these bake in at BUILD time
Add in the Node App's **Environment variables**:

| Key | Value |
|-----|-------|
| `NEXT_PUBLIC_API_BASE` | `https://backzaujain.mttasin.com` |
| `NEXT_PUBLIC_META_PIXEL_ID` | `1504590814166492` |
| `NEXT_PUBLIC_SITE_URL` | `https://zaujain.mttasin.com` |

**Also set these two** (runtime vars, no rebuild needed, restart after). They are
worth ~4 threads per instance — real but small; the big one is the config-file
rule below.

| Key | Value | Why |
|-----|-------|-----|
| `NODE_OPTIONS` | `--v8-pool-size=2` | V8's worker pool, default 4. |
| `UV_THREADPOOL_SIZE` | `2` | libuv's fs/DNS pool, default 4. |

`TOKIO_WORKER_THREADS` / `RAYON_NUM_THREADS` are harmless to set but **do
nothing** — Next passes an explicit `worker_threads` to the Tokio builder, and an
explicit value beats the env var. Do not rely on them.

### The config file MUST NOT be `next.config.ts`
This is the single biggest lever on this host, and it is a source rule, not a
setting. `server/config.js` branches on the file name: a `.ts` config goes
through `transpileConfig() -> loadBindings()`, which loads the `next-swc` Rust
module **at every server boot** just to transpile that one small file. That
module starts a Tokio runtime sized to `available_parallelism()` — the **host's**
32 cores, not the account's slice — and the runtime never shuts down. Result: 32
idle `tokio-runtime-w` threads for the life of every Next process.

`next.config.mjs` and `next.config.js` skip that branch: the binding is never
loaded and those 32 threads never exist. The config is kept as **`.mjs`** for
exactly this reason (`.mjs` and not `.js` because `package.json` has no
`"type": "module"`, so `export default` keeps working). Type checking survives
through the JSDoc `@type` annotation at the top of the file.

Measured on this account: 43 threads per instance → **7**.

### cPanel "Number of Processes NNN/200" with almost no visitors
Not real load — CloudLinux LVE counts **threads** against `nproc`, and Entry
Processes is the number actually serving requests. 185/200 nproc alongside 6/120
entry processes and 517 MB / 4 GB is an idle pool, not traffic.

Diagnose by thread count per process, never by process count:
```bash
ps -eo pid,nlwp,etime,rss,args --user $(whoami) | grep lsnode | grep -v grep
ps -o comm= -L -p <PID> | sort | uniq -c | sort -rn   # names the threads
```
The second command is the one that ends the guessing — it says outright whether
they are `tokio-runtime-w`, `V8Worker`, or `libuv-worker`, and therefore which
knob applies. A healthy zaujain instance is ~7; `crm.mttasin.com` (plain Node, no
Next) sits at 11 for comparison.

### The restart button does NOT reap `lsnode` — check after every deploy
cPanel's Restart on the Node app left three `zaujain.xyz` instances running, two
of them **3.5 days old**, each holding 43 threads. Every deploy stacked another
one; that accumulation, not traffic, is what walks the account to 200 over weeks.

So a frontend deploy is not finished until the old instances are gone:
```bash
ps -eo pid,nlwp,etime,args --user $(whoami) | grep '[z]aujain.xyz'
kill <each stale PID>
```
Then load the site once — LiteSpeed spawns on demand, so the count stays at zero
until someone visits, and the fresh instance is the one that picks up any env-var
change. Nothing is lost by killing them; in-flight requests are a rounding error
at this traffic.

### 4. Install + build + start
In the Node app terminal:
```bash
npm install
npm run build          # NEXT_PUBLIC_* must be set in the env here (they compile in)
```
If the terminal doesn't inject the app env into the build, prefix them:
```bash
NEXT_PUBLIC_API_BASE=https://backzaujain.mttasin.com \
NEXT_PUBLIC_META_PIXEL_ID=1504590814166492 \
NEXT_PUBLIC_SITE_URL=https://zaujain.mttasin.com \
npm run build
```
Then **Restart** the Node app. Verify `https://zaujain.mttasin.com` loads, product images come from `backzaujain`, and the Pixel fires (Meta Pixel Helper).

---

## Steadfast delivery webhook (one-time setup)
Turns parcel status from "press Sync and wait" into a live push, and is the **only**
source of the hub-by-hub tracking history.

1. Pick a long random secret. Set `STEADFAST_WEBHOOK_TOKEN` to it in the cPanel
   Python App env vars → **restart** the app.
2. Steadfast panel → **Webhook** (`steadfast.com.bd/user/webhook/add`):
   - **Callback Url**: `https://backzaujain.mttasin.com/api/steadfast/webhook/`
   - **Auth Token(Bearer)**: the same secret
   - Save.
3. Verify with a real parcel: after the next status change, the order-detail
   Steadfast card shows a **Tracking history** entry, and Django admin →
   *Consignment events* has the raw push. Nothing there after a status change →
   check the token first (a wrong one answers 401).

The bulk "Sync Steadfast (shipped)" button stays as the backstop for missed pushes;
don't remove it. Blank token = endpoint answers 503 to everyone, by design.

## Redis (optional, one-time setup)
Everything works **without** Redis — `REDIS_URL` unset falls back to `LocMemCache`
and DB sessions, and every cached read still has a short TTL. Redis buys two things:
one shared cache across all Passenger workers (so an admin edit clears *everyone's*
copy instantly instead of within the TTL), and sessions that survive a restart.

1. cPanel → search **Redis**. Depending on the host it's *"Redis"*, *"Redis Manager"*
   or under **Databases**. If it isn't there, the host doesn't offer it — stop here,
   nothing is broken.
   On this host it is **LiteSpeed Redis Cache Manager** → *Enable Redis Service*.
   It reports its socket as `/tmp/redis.sock` (per-user under CageFS).
2. Copy what it gives you. It will be one of:
   - a **Unix socket** path → `REDIS_URL=unix:///tmp/redis.sock?db=3`
   - a **host/port + password** → `REDIS_URL=redis://:PASSWORD@127.0.0.1:6379/3`

   A password with `@ : / #` in it must be **URL-encoded**, same rule as `DATABASE_URL`.
   Use a **db index other than 0** — LSCache/WordPress default to 0, and we keep
   our keys out of theirs. `KEY_PREFIX` (`zaujain`, overridable with
   `REDIS_KEY_PREFIX`) namespaces them on top of that.
3. Set `REDIS_URL` in the cPanel **Python App env vars** → **restart the app**.
   (It's read at runtime, so a restart is enough — no rebuild.)
4. Verify from the app's virtualenv:
   ```bash
   cd /home/mttasinc/backzaujain.mttasin.com
   /home/mttasinc/virtualenv/backzaujain.mttasin.com/3.13/bin/python -c "
   import django, os; os.environ.setdefault('DJANGO_SETTINGS_MODULE','backend.settings'); django.setup()
   from django.core.cache import cache
   from django.conf import settings
   print('backend:', settings.CACHES['default']['BACKEND'])
   cache.set('ping','pong',10); print('roundtrip:', cache.get('ping'))"
   ```
   Expect `RedisCache` and `pong`. `LocMemCache` = the env var didn't reach the app;
   an exception = the URL or password is wrong.
5. Sanity-check the real thing: open the storefront, change a product price in the
   admin, reload — the new price should appear **immediately**, not after 5 minutes.

**Memory:** the plan is 128MB with eviction. That is plenty here (the whole catalogue
payload is a few hundred KB), and eviction is safe by design — every cached value is
recomputable and a miss just rebuilds it. Do **not** raise the TTLs to "save" memory;
the TTL is the staleness bound, not a cost control.

**Shared instance, two consequences.** The *Flush Cache* button in LiteSpeed's Redis
panel wipes our keys too: harmless for the caches (everything is recomputable) but it
**signs out Django-admin sessions**, since `SESSION_ENGINE` moves to the cache when
Redis is on. The React admin panel authenticates with a localStorage token and is
unaffected; so is the storefront cart (`X-Cart-Token`). If Redis is ever disabled
again, just unset `REDIS_URL` and restart — LocMem takes over.

**Never** point a job queue at this instance. There is no worker process on this host
to consume one.

## Post-deploy checklist
- [ ] **AutoSSL** issued for both subdomains (https works).
- [ ] Frontend → backend API calls succeed (CORS = `https://zaujain.mttasin.com`).
- [ ] Product/hero **images load** (media served).
- [ ] Admin login works at `zaujain.mttasin.com/admin` (token) and `backzaujain.mttasin.com/admin` (Django).
- [ ] Place a **test order** → confirm + book Steadfast → challan prints.
- [ ] Steadfast **webhook** saved in their panel + `STEADFAST_WEBHOOK_TOKEN` set (see above).
- [ ] Meta **Purchase** fires (with `META_TEST_EVENT_CODE` set → Test Events; then blank it for live).
- [ ] *(optional)* **Redis** wired: `REDIS_URL` set, the roundtrip check prints `RedisCache` + `pong` (see above).

## Server paths (current host)
```
App root :  /home/mttasinc/backzaujain.mttasin.com
Venv     :  /home/mttasinc/virtualenv/backzaujain.mttasin.com/3.13
Python   :  /home/mttasinc/virtualenv/backzaujain.mttasin.com/3.13/bin/python
```
Enter the env in cPanel → **Terminal**:
```
source /home/mttasinc/virtualenv/backzaujain.mttasin.com/3.13/bin/activate && cd /home/mttasinc/backzaujain.mttasin.com
```
Restart from Terminal (same effect as the cPanel Restart button):
```
mkdir -p tmp && touch tmp/restart.txt
```
Prefer Terminal over the Python App page's "Execute python script" box — the box
swallows tracebacks. **Never run `makemigrations` on the server**: migrations are
source files, generated locally and uploaded; generating them here forks history.

## Cron jobs (no job queue)
cPanel → **Cron Jobs**. Full paths — cron has no venv and no PATH.

**Timing.** Customers browse this site at 2–3am; ~4am is the quiet gap, so the
batch jobs run then. Each job is a separate process loading all of Django
(~80–150MB), and this account has hit its NPROC ceiling before — so they are
**staggered 15 min apart, never stacked on the same minute**.

**Timezone.** Django is `Asia/Dhaka`, so `rollup_analytics` always aggregates a
Dhaka day. But cPanel cron fires in the **server's** timezone — check the server
time on the cPanel home page and shift the hour if it isn't Dhaka (server on UTC
→ 04:10 Dhaka = `10 22 * * *`). Getting it wrong doesn't corrupt anything, it
just runs the batch during peak traffic.

| Job | Cron | Dhaka time |
|---|---|---|
| `rollup_analytics` | `10 4 * * *` | 04:10 daily |
| `purge_analytics` | `25 4 * * *` | 04:25 daily (**after** rollup) |
| `purge_old_chat_uploads` | `40 4 * * *` | 04:40 daily |
| `send_pending_capi` | `*/15 * * * *` | every 15 min |
| `purge_orphan_media` | `55 4 1 * *` | 04:55, 1st of month |
| `purge_audit_log` | `5 5 1 * *` | 05:05, 1st of month (admin audit trail, 180 days) |

```
# Daily — delete chat images older than 30 days
cd /home/mttasinc/backzaujain.mttasin.com && /home/mttasinc/virtualenv/backzaujain.mttasin.com/3.13/bin/python manage.py purge_old_chat_uploads >> cron.log 2>&1

# Every 15 min (optional) — retry any failed Meta CAPI events
cd /home/mttasinc/backzaujain.mttasin.com && /home/mttasinc/virtualenv/backzaujain.mttasin.com/3.13/bin/python manage.py send_pending_capi >> cron.log 2>&1

# Monthly — delete media files no DB row references (safety net for django-cleanup)
cd /home/mttasinc/backzaujain.mttasin.com && /home/mttasinc/virtualenv/backzaujain.mttasin.com/3.13/bin/python manage.py purge_orphan_media >> cron.log 2>&1
cd /home/mttasinc/backzaujain.mttasin.com && /home/mttasinc/virtualenv/backzaujain.mttasin.com/3.13/bin/python manage.py purge_audit_log >> cron.log 2>&1

# Daily 04:10 Dhaka — aggregate yesterday's analytics into the permanent rollups.
# Only ever reads YESTERDAY, so a visitor browsing at 4am is unaffected.
# MUST run before purge_analytics, or a day could be deleted before it was rolled up.
cd /home/mttasinc/backzaujain.mttasin.com && /home/mttasinc/virtualenv/backzaujain.mttasin.com/3.13/bin/python manage.py rollup_analytics >> cron.log 2>&1

# Daily 04:25 — drop raw analytics events/sessions past the 90-day window (rollups are kept forever)
cd /home/mttasinc/backzaujain.mttasin.com && /home/mttasinc/virtualenv/backzaujain.mttasin.com/3.13/bin/python manage.py purge_analytics >> cron.log 2>&1
```

**If a rollup night is missed** (server down, cron misfired), backfill — it is
idempotent, so re-running a day just overwrites it:
```
python manage.py rollup_analytics --days 7          # last 7 days
python manage.py rollup_analytics --date 2026-07-20 # one specific day
```
(If the host ever moves the account, re-read the venv path off the cPanel Python App page.)

**One-time backlog clean after first deploy:** django-cleanup only prevents
*new* orphans, so clear the historical pile once. Review first with a dry run,
then delete:
```
python manage.py purge_orphan_media --dry-run
python manage.py purge_orphan_media
```

## Redeploy loop
- **Backend** (code change): upload → `python manage.py migrate` (if models changed) → `collectstatic --noinput` → `touch tmp/restart.txt`.
- **Frontend** (code change): upload → `npm run build` → **Restart** Node app.

## Serving `/media` without Python  (biggest remaining speed win)

Every product photo currently goes through **Django → Passenger**. A Python
worker is held for the whole transfer, which on a village 2G line is *seconds
per image, per visitor* — and a page with ten photos holds ten of them. Nothing
in the app can fix that; the file has to be served by the web server.

Django now sends `Cache-Control: public, max-age=86400` on media (see
`backend/app/media.py`), so a repeat visitor and the Cloudflare edge stop
re-asking. That reduces the traffic; it does not remove Python from the first
hit. To remove it entirely, on cPanel:

1. **File Manager** → the backend app root (`backzaujain.mttasin.com`) → confirm
   the `media/` folder is there and world-readable.
2. Add to the domain's `.htaccess` (LiteSpeed reads it), **above** the Passenger
   rules so it wins before the app is consulted:

   ```apache
   # Serve uploaded media straight off disk — never wake Python for a photo.
   RewriteEngine On
   RewriteRule ^media/(.*)$ - [L]

   <IfModule mod_headers.c>
     <FilesMatch "\.(jpe?g|png|webp|gif|svg|ico)$">
       Header set Cache-Control "public, max-age=2592000"
     </FilesMatch>
   </IfModule>
   ```
3. Reload the site and open any product photo URL directly. It must still load,
   and the response must NOT carry Passenger/Django headers.
4. In Cloudflare, a **Cache Rule** on `/media/*` with "Cache Eligibility: Eligible
   for cache" makes the edge answer most requests without touching the origin.

If the alias ever breaks, Django still serves media as a fallback — the URL does
not change, so nothing else needs touching.

## Gotchas
- **`NEXT_PUBLIC_*` are compiled into the build** — change one → **rebuild** the frontend.
- Change a **backend** env var → **restart** the Python app.
- **Media** lives in `media/` under the backend app root — make sure it's **writable** and **not wiped** on redeploy (don't delete it when uploading).
- Switching to Postgres = **fresh DB** (SQLite data doesn't carry over) — re-create products via the admin.
- Keep **`META_TEST_EVENT_CODE` blank in production** so real sales count for ad optimization.
