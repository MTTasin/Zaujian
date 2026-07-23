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

## Post-deploy checklist
- [ ] **AutoSSL** issued for both subdomains (https works).
- [ ] Frontend → backend API calls succeed (CORS = `https://zaujain.mttasin.com`).
- [ ] Product/hero **images load** (media served).
- [ ] Admin login works at `zaujain.mttasin.com/admin` (token) and `backzaujain.mttasin.com/admin` (Django).
- [ ] Place a **test order** → confirm + book Steadfast → challan prints.
- [ ] Meta **Purchase** fires (with `META_TEST_EVENT_CODE` set → Test Events; then blank it for live).

## Cron jobs (no job queue)
cPanel → **Cron Jobs**. Use the venv Python + the backend app root.
```
# Daily — delete chat images older than 30 days
cd /home/<user>/backzaujain && /home/<user>/virtualenv/backzaujain/3.13/bin/python manage.py purge_old_chat_uploads >> cron.log 2>&1

# Every 15 min (optional) — retry any failed Meta CAPI events
cd /home/<user>/backzaujain && /home/<user>/virtualenv/backzaujain/3.13/bin/python manage.py send_pending_capi >> cron.log 2>&1

# Monthly — delete media files no DB row references (safety net for django-cleanup)
cd /home/<user>/backzaujain && /home/<user>/virtualenv/backzaujain/3.13/bin/python manage.py purge_orphan_media >> cron.log 2>&1
```
(Adjust the venv path to the one cPanel shows for the Python App.)

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

## Gotchas
- **`NEXT_PUBLIC_*` are compiled into the build** — change one → **rebuild** the frontend.
- Change a **backend** env var → **restart** the Python app.
- **Media** lives in `media/` under the backend app root — make sure it's **writable** and **not wiped** on redeploy (don't delete it when uploading).
- Switching to Postgres = **fresh DB** (SQLite data doesn't carry over) — re-create products via the admin.
- Keep **`META_TEST_EVENT_CODE` blank in production** so real sales count for ad optimization.
