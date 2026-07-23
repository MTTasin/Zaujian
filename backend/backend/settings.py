"""
Django settings for Zaujain Nikah Point backend.

Environment-driven. Copy .env.example to .env and fill values.
SQLite in dev (empty DATABASE_URL), PostgreSQL in prod (set DATABASE_URL).
"""

import os
from pathlib import Path

import dj_database_url
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent

load_dotenv(BASE_DIR / ".env")


def env_bool(name, default=False):
    return os.getenv(name, str(default)).lower() in ("1", "true", "yes", "on")


def env_list(name, default=""):
    raw = os.getenv(name, default)
    return [item.strip() for item in raw.split(",") if item.strip()]


SECRET_KEY = os.getenv("SECRET_KEY", "django-insecure-dev-only-change-me")

DEBUG = env_bool("DEBUG", True)

ALLOWED_HOSTS = env_list("ALLOWED_HOSTS", "localhost,127.0.0.1")

# Needed for the Django admin (session + CSRF) over HTTPS in production.
CSRF_TRUSTED_ORIGINS = env_list("CSRF_TRUSTED_ORIGINS", "")

# Production security hardening — on automatically whenever DEBUG is off.
# Behind cPanel/Passenger the app sees plain HTTP; trust the proxy's header so
# Django knows the original request was HTTPS.
if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SECURE_SSL_REDIRECT = env_bool("SECURE_SSL_REDIRECT", True)
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = int(os.getenv("SECURE_HSTS_SECONDS", "31536000"))
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = True
    SECURE_CONTENT_TYPE_NOSNIFF = True


# Application definition

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # Third party
    "rest_framework",
    "rest_framework.authtoken",
    "corsheaders",
    # Local
    "app",
    # Must be LAST — hooks file fields on all apps above to delete old
    # files on replace/delete.
    "django_cleanup.apps.CleanupConfig",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "backend.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "backend.wsgi.application"


# Database
# Empty DATABASE_URL -> SQLite (dev). Set it to a Postgres URL in prod.
DATABASE_URL = os.getenv("DATABASE_URL", "").strip()

if DATABASE_URL:
    DATABASES = {
        "default": dj_database_url.parse(DATABASE_URL, conn_max_age=600)
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
        }
    }


AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]


# Internationalization
LANGUAGE_CODE = "en-us"
TIME_ZONE = "Asia/Dhaka"
USE_I18N = True
USE_TZ = True


# Static & media files
STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

# WhiteNoise serves the collected static files in production (admin/DRF assets).
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedStaticFilesStorage",
    },
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"


# Django REST Framework
REST_FRAMEWORK = {
    "DEFAULT_RENDERER_CLASSES": [
        "rest_framework.renderers.JSONRenderer",
    ],
    # Storefront is public; admin endpoints enforce IsAdminUser explicitly.
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.AllowAny",
    ],
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework.authentication.TokenAuthentication",
        "rest_framework.authentication.SessionAuthentication",
    ],
}


# CORS (Next.js frontend)
CORS_ALLOWED_ORIGINS = env_list(
    "CORS_ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
)
CORS_ALLOW_HEADERS = (
    "accept", "authorization", "content-type", "origin",
    "user-agent", "x-cart-token", "x-requested-with",
)


# Cache & sessions -> Redis (128MB cap: caching + sessions only, no job queue)
REDIS_URL = os.getenv("REDIS_URL", "").strip()

if REDIS_URL:
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.redis.RedisCache",
            "LOCATION": REDIS_URL,
        }
    }
    SESSION_ENGINE = "django.contrib.sessions.backends.cache"
else:
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        }
    }


# Email (SMTP) for customer notifications
if os.getenv("EMAIL_HOST"):
    EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
else:
    EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"

EMAIL_HOST = os.getenv("EMAIL_HOST", "")
EMAIL_PORT = int(os.getenv("EMAIL_PORT", "587"))
EMAIL_HOST_USER = os.getenv("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = os.getenv("EMAIL_HOST_PASSWORD", "")
# Port 465 = implicit SSL; 587 = STARTTLS. Never enable both (SSL+TLS hangs).
EMAIL_USE_SSL = env_bool("EMAIL_USE_SSL", False)
EMAIL_USE_TLS = False if EMAIL_USE_SSL else env_bool("EMAIL_USE_TLS", True)
# Never let a slow/unreachable SMTP server block checkout forever.
EMAIL_TIMEOUT = int(os.getenv("EMAIL_TIMEOUT", "10"))
DEFAULT_FROM_EMAIL = os.getenv(
    "DEFAULT_FROM_EMAIL", "Zaujain Nikah Point <no-reply@example.com>"
)


# Public site URL for building customer links (tracking) in emails.
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000").rstrip("/")


# Shop configuration (checkout defaults, manual payment numbers)
SHOP = {
    "DELIVERY_CHARGE": os.getenv("DELIVERY_CHARGE", "120"),
    # Reduced charge for the home district (delivered locally). Blank inside
    # district = same charge everywhere.
    "DELIVERY_CHARGE_INSIDE": os.getenv("DELIVERY_CHARGE_INSIDE", "80"),
    "INSIDE_DISTRICT": os.getenv("INSIDE_DISTRICT", "Chattogram"),
    "ADVANCE_AMOUNT": os.getenv("ADVANCE_AMOUNT", "200"),
    "BKASH_NUMBER": os.getenv("BKASH_NUMBER", ""),
    "NAGAD_NUMBER": os.getenv("NAGAD_NUMBER", ""),
    # WhatsApp number shown to the customer after an order is submitted.
    "WHATSAPP_NUMBER": os.getenv("WHATSAPP_NUMBER", "01959976683"),
    # Public contact/order numbers the salesbot may share (comma-separated).
    "CONTACT_PHONE": os.getenv("CONTACT_PHONE", "01959976683, 01974283081"),
    # Business info the salesbot may quote (kept in sync with the storefront footer).
    "ADDRESS": os.getenv(
        "SHOP_ADDRESS",
        "জি.এ. ভবন (ইউনিট-১), আন্দরকিল্লা শাহি জামে মসজিদের সামনে, "
        "আন্দরকিল্লা, থানাঃ কোতোয়ালী, জেলাঃ চট্টগ্রাম।",
    ),
    "DELIVERY_TIME": os.getenv("DELIVERY_TIME", "৩–৭ কর্মদিবস"),
    "SUPPORT_HOURS": os.getenv("SUPPORT_HOURS", "সকাল ৫টা – রাত ১১টা"),
    "FACEBOOK_URL": os.getenv("FACEBOOK_URL", "https://www.facebook.com/ZaujainNikahPoint"),
    "INSTAGRAM_URL": os.getenv("INSTAGRAM_URL", "https://www.instagram.com/zaujainnikahpoint/"),
}


# Web Push (browser push notifications for admin — new orders + chat handoffs).
# Dev defaults let it work out of the box; GENERATE A FRESH PAIR for production
# and set them as env vars. Regenerate: py-vapid keypair (raw base64url).
WEBPUSH = {
    "VAPID_PUBLIC_KEY": os.getenv(
        "VAPID_PUBLIC_KEY",
        "BANLcvFSVZbziR8j6p0JenCvtDPCPuPU6Ep0y0fEzpk_LiZ-lNmDxnnoN5B2GW00JWhlYOQALa7cy6pO-xXbQ8A",
    ),
    "VAPID_PRIVATE_KEY": os.getenv(
        "VAPID_PRIVATE_KEY",
        "8E3ducTdmFtG7o9TBxgG_x-4DJullRQ5CUYj1ANmygs",
    ),
    "VAPID_SUBJECT": os.getenv("VAPID_SUBJECT", "mailto:admin@zaujain.com"),
}


# AI chatbot (DeepSeek)
CHATBOT = {
    "API_KEY": os.getenv("DEEPSEEK_API_KEY", ""),
    "API_BASE": os.getenv("DEEPSEEK_API_BASE", "https://api.deepseek.com"),
    "MODEL": os.getenv("DEEPSEEK_MODEL", "deepseek-chat"),
    "TIMEOUT": int(os.getenv("DEEPSEEK_TIMEOUT", "30")),
    # Path to the bot persona/instructions file (repo root by default).
    "INSTRUCTIONS_PATH": os.getenv(
        "BOT_INSTRUCTIONS_PATH", str(BASE_DIR.parent / "bot_instructions.md")
    ),
    "HISTORY_LIMIT": int(os.getenv("CHAT_HISTORY_LIMIT", "8")),
    "MAX_TOKENS": int(os.getenv("CHAT_MAX_TOKENS", "260")),
}


# Courier configuration
COURIER = {
    "STEADFAST_FRAUD_USER": os.getenv("STEADFAST_FRAUD_USER", ""),
    "STEADFAST_FRAUD_PASSWORD": os.getenv("STEADFAST_FRAUD_PASSWORD", ""),
    "PATHAO_FRAUD_USER": os.getenv("PATHAO_FRAUD_USER", ""),
    "PATHAO_FRAUD_PASSWORD": os.getenv("PATHAO_FRAUD_PASSWORD", ""),
    "STEADFAST_API_KEY": os.getenv("STEADFAST_API_KEY", ""),
    "STEADFAST_SECRET_KEY": os.getenv("STEADFAST_SECRET_KEY", ""),
    "STEADFAST_API_BASE": os.getenv(
        "STEADFAST_API_BASE", "https://portal.packzy.com/api/v1"
    ),
    "TIMEOUT_SECONDS": int(os.getenv("COURIER_TIMEOUT_SECONDS", "3")),
    "MIN_SUCCESS_RATIO": float(os.getenv("FRAUD_MIN_SUCCESS_RATIO", "70")),
}


# Meta Conversions API (CAPI) — website conversion tracking. Same dataset as ads.
META = {
    "DATASET_ID": os.getenv("META_DATASET_ID", ""),
    "ACCESS_TOKEN": os.getenv("META_CAPI_ACCESS_TOKEN", ""),
    "GRAPH_VERSION": os.getenv("META_GRAPH_VERSION", "v21.0"),
    "TEST_EVENT_CODE": os.getenv("META_TEST_EVENT_CODE", ""),
    "DEFAULT_COUNTRY": os.getenv("META_DEFAULT_COUNTRY", "bd"),
    "TIMEOUT_SECONDS": int(os.getenv("META_TIMEOUT_SECONDS", "3")),
}
