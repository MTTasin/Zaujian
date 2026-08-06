"""
Read-through caches for the hot, rarely-changing reads.

Backed by Django's cache API, so this follows `REDIS_URL`: Redis in production,
LocMemCache when it is unset. That difference matters and shapes the design:

* **LocMem is per worker process.** A save in one Passenger worker cannot clear
  another worker's copy, so invalidation alone is not enough — every entry also
  carries a short TTL, which bounds staleness to the TTL even with no Redis at
  all. With Redis the invalidation is instant and the TTL is just a backstop.
* **A miss must be harmless.** Everything here is recomputable from the DB; the
  cache is a speed-up, never a source of truth. Redis is 128MB with eviction on
  shared hosting, so any key can vanish at any moment.

Invalidation uses a **version counter** rather than key enumeration: the catalogue
keys embed the current version, so one `bump_catalogue()` orphans every variant
at once (per host, per serializer shape) and the orphans age out by TTL. Deleting
them individually would mean knowing every key that was ever written.
"""

import logging

from django.core.cache import cache

logger = logging.getLogger(__name__)

# Short enough that a stale price cannot outlive a phone call, long enough to
# absorb the traffic these endpoints actually get.
CATALOGUE_TTL = 300      # home payload, shop-info, bot shop facts
FRAUD_TTL = 600          # courier history for one phone number

_VERSION_KEY = "catalogue:version"


def catalogue_version():
    """Current catalogue generation. Any write to the catalogue bumps it."""
    version = cache.get(_VERSION_KEY)
    if version is None:
        version = 1
        cache.set(_VERSION_KEY, version, None)   # no expiry: it is the epoch
    return version


def bump_catalogue():
    """Called from the model signals — every cached catalogue read now misses."""
    try:
        cache.incr(_VERSION_KEY)
    except ValueError:
        # Key absent (never set, or evicted): starting over is correct, since
        # every existing key belongs to a generation nothing will read again.
        cache.set(_VERSION_KEY, 1, None)


def catalogue_key(name, *parts):
    """`home:v7:example.com` — the version prefix is what makes a bump work."""
    suffix = ":".join(str(p) for p in parts if p)
    return f"{name}:v{catalogue_version()}" + (f":{suffix}" if suffix else "")


def cached(key, ttl, build):
    """
    Read-through. `build()` runs on a miss and on any cache failure.

    `key` may be a callable, and for versioned keys it SHOULD be: building the
    value can itself write a catalogue row (`SiteSettings.get_solo()` creates the
    singleton on first read), which bumps the version mid-build. Storing under
    the pre-build key would file the result under a generation nothing will ever
    read again — a cache that permanently misses. Re-evaluating the key after
    the build files it under the state the value actually reflects.

    The cache is never allowed to break a page: if the backend is down or the
    value cannot be pickled, this logs and serves the freshly built value.
    """
    resolve = key if callable(key) else (lambda: key)

    try:
        hit = cache.get(resolve())
        if hit is not None:
            return hit
    except Exception:                      # noqa: BLE001 - cache down, not fatal
        logger.warning("cache read failed", exc_info=True)
        return build()

    value = build()
    try:
        cache.set(resolve(), value, ttl)
    except Exception:                      # noqa: BLE001
        logger.warning("cache write failed", exc_info=True)
    return value


def request_host(request):
    """Part of the key: serialized payloads embed absolute media URLs built from
    the incoming host, so dev and prod must not share an entry."""
    try:
        return request.get_host()
    except Exception:                      # noqa: BLE001 - ALLOWED_HOSTS rejection
        return ""
