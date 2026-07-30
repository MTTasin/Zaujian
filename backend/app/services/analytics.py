"""
Self-hosted storefront analytics: collection, presence, and the read helpers.

Design constraints that shaped this (see CLAUDE.md):
  * No job queue — the collector must be dumb and fast (validate + bulk insert),
    and every aggregation over old data happens in a nightly cron command.
  * Audience on 2G — the client batches and uses sendBeacon, so this endpoint
    receives few, small requests rather than one per interaction.
  * No cookies, no PII — identity is a random id minted in the browser. We never
    store IP or user-agent, only a coarse device class derived from the UA.
"""

import re
from datetime import timedelta
from urllib.parse import urlsplit

from django.core.cache import cache
from django.db.models import Count, Q
from django.utils import timezone

from ..models import AnalyticsEvent, VisitorSession

# "Right now" window. 5 min matches how a shop owner thinks about it (Google's
# realtime card uses 30 min, which feels wrong at this scale).
PRESENCE_WINDOW = 300
PRESENCE_CACHE_KEY = "analytics:presence"
PRESENCE_CACHE_SECONDS = 8      # under the dashboard's 10s poll, so each poll is fresh

MAX_EVENTS_PER_BATCH = 50
MAX_PATH = 200
MAX_PROP_CHARS = 120
MAX_PROPS = 6

# Per-visitor flood guard. Generous — a real session on a slow phone fires far
# fewer batches than this — but it caps what a script can insert.
RATE_LIMIT_PER_MIN = 60


# --------------------------------------------------------------------------- #
# Normalisation
# --------------------------------------------------------------------------- #

# UNBOUNDED dynamic segments collapse to a placeholder: /track/<uid> is one value
# per order, so keeping it would put a DailyPageStat row per order in the "top
# pages" table and drown everything worth reading.
_DYNAMIC = [
    (re.compile(r"^/track/[^/]+$"), "/track/:uid"),
    (re.compile(r"^/album/[^/]+$"), "/album/:key"),
]

# BOUNDED ones keep their real slug — "which listing did they read" is the whole
# point of the table, and the catalogue is a small admin-made set. The slug is
# kept only when it names a row that exists, else a bot walking /combo/<random>
# would blow up exactly the cardinality this guard exists to protect.
_NAMED = [
    (re.compile(r"^/combo/([^/]+)$"), "combo", "/combo/:slug"),
    (re.compile(r"^/gallery/([^/]+)$"), "gallery", "/gallery/:slug"),
]

KNOWN_SLUG_SECONDS = 300    # a listing published now shows by name within 5 min


def _known_slugs(kind):
    """Slugs that really exist, cached — this runs on every pageview event."""
    key = f"analytics:slugs:{kind}"
    slugs = cache.get(key)
    if slugs is None:
        if kind == "combo":
            from ..models import PrebuiltCombo
            slugs = set(PrebuiltCombo.objects.values_list("slug", flat=True))
        else:
            from ..models import GalleryTag
            slugs = set(GalleryTag.objects.values_list("slug", flat=True))
        cache.set(key, slugs, KNOWN_SLUG_SECONDS)
    return slugs


def clean_path(raw):
    """Path only — query and fragment dropped (a search term belongs in props)."""
    if not raw:
        return ""
    path = urlsplit(str(raw)).path or "/"
    if len(path) > 1:
        path = path.rstrip("/") or "/"
    for pattern, placeholder in _DYNAMIC:
        if pattern.match(path):
            return placeholder
    for pattern, kind, placeholder in _NAMED:
        m = pattern.match(path)
        if m:
            return path[:MAX_PATH] if m.group(1) in _known_slugs(kind) else placeholder
    return path[:MAX_PATH]


_MOBILE_RE = re.compile(r"android|iphone|ipod|blackberry|iemobile|opera mini", re.I)
_TABLET_RE = re.compile(r"ipad|tablet|silk", re.I)


def device_of(user_agent):
    """Coarse device class. The UA itself is never stored."""
    ua = user_agent or ""
    if _TABLET_RE.search(ua):
        return "tablet"
    if _MOBILE_RE.search(ua):
        return "mobile"
    return "desktop"


def source_of(referrer, utm_source="", has_fbclid=False):
    """Coarse acquisition source. Only the host is kept, never the full URL."""
    if has_fbclid:
        return "facebook-ad"
    if utm_source:
        return str(utm_source)[:40].lower()
    host = (urlsplit(referrer or "").hostname or "").lower()
    if not host:
        return "direct"
    host = host.removeprefix("www.")
    if "facebook" in host or host in {"m.facebook.com", "l.facebook.com", "fb.me"}:
        return "facebook"
    if "instagram" in host:
        return "instagram"
    if "google" in host:
        return "google"
    if "youtube" in host:
        return "youtube"
    if "tiktok" in host:
        return "tiktok"
    return host[:40]


def _clean_props(raw):
    """Small, flat, string-capped. Never trust the client with our disk."""
    if not isinstance(raw, dict):
        return {}
    out = {}
    for key, value in list(raw.items())[:MAX_PROPS]:
        if isinstance(value, (int, float, bool)) or value is None:
            out[str(key)[:20]] = value
        else:
            out[str(key)[:20]] = str(value)[:MAX_PROP_CHARS]
    return out


# --------------------------------------------------------------------------- #
# Collection
# --------------------------------------------------------------------------- #

def rate_limited(visitor_id):
    """True when this visitor has already burned its per-minute allowance."""
    key = f"analytics:rl:{visitor_id}"
    hits = cache.get(key) or 0
    if hits >= RATE_LIMIT_PER_MIN:
        return True
    # Not atomic across workers; that's fine for a flood guard, and it avoids
    # depending on a specific cache backend's incr semantics.
    cache.set(key, hits + 1, 60)
    return False


def record_batch(*, visitor_id, session_id, events, referrer="", utm_source="",
                 has_fbclid=False, user_agent="", is_new_visitor=False):
    """Validate + persist one beacon batch. Returns the number of rows stored.

    Unknown event names are dropped silently — a client that is one deploy behind
    must not 400 and lose the rest of its batch.
    """
    now = timezone.now()
    events = list(events)[:MAX_EVENTS_PER_BATCH]

    session, created = VisitorSession.objects.get_or_create(
        session_id=session_id,
        defaults={
            "visitor_id": visitor_id,
            "started_at": now,
            "last_seen": now,
            "source": source_of(referrer, utm_source, has_fbclid),
            "device": device_of(user_agent),
            "is_new_visitor": bool(is_new_visitor),
        },
    )

    rows, pageviews, last_path, converted = [], 0, "", False
    for raw in events:
        if not isinstance(raw, dict):
            continue
        name = str(raw.get("n", ""))[:32]
        path = clean_path(raw.get("p"))
        if path:
            last_path = path
        if name in AnalyticsEvent.SESSION_ONLY:
            continue                       # heartbeat: touches the session only
        if name not in AnalyticsEvent.NAMES:
            continue
        if name == "pageview":
            pageviews += 1
        if name == "purchase":
            converted = True

        value = raw.get("v")
        try:
            value = None if value in (None, "") else round(float(value), 2)
        except (TypeError, ValueError):
            value = None

        rows.append(AnalyticsEvent(
            ts=now, session_id=session_id, visitor_id=visitor_id,
            name=name, path=path,
            combo_id=_int_or_none(raw.get("c")),
            product_id=_int_or_none(raw.get("pr")),
            value=value,
            props=_clean_props(raw.get("x")),
        ))

    if rows:
        AnalyticsEvent.objects.bulk_create(rows, ignore_conflicts=True)

    session.last_seen = now
    session.events += len(rows)
    session.pageviews += pageviews
    if last_path:
        session.current_path = last_path
        session.exit_path = last_path
        if created and not session.entry_path:
            session.entry_path = last_path
    if converted:
        session.converted = True
    session.save(update_fields=[
        "last_seen", "events", "pageviews", "current_path",
        "entry_path", "exit_path", "converted",
    ])
    return len(rows)


def _int_or_none(value):
    try:
        return int(value) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None


# --------------------------------------------------------------------------- #
# Presence — "visitors right now"
# --------------------------------------------------------------------------- #

def presence(window=PRESENCE_WINDOW, use_cache=True):
    """Who is on the site this minute, and where.

    Reads VisitorSession rather than a Redis structure on purpose: the heartbeat
    already updates `last_seen`, the window covers a handful of indexed rows, and
    it works identically on locmem in dev and Redis in prod. Cached briefly so a
    10s dashboard poll costs one query, not one per admin.
    """
    if use_cache:
        hit = cache.get(PRESENCE_CACHE_KEY)
        if hit is not None:
            return hit

    cutoff = timezone.now() - timedelta(seconds=window)
    live = VisitorSession.objects.filter(last_seen__gte=cutoff)

    # A session can exist before its first pageview (the new-visitor announcement
    # beacon carries no path), so blank paths are merged into "/" here rather than
    # showing up as a second, confusing "/" row next to the real one.
    merged = {}
    for row in live.values("current_path").annotate(count=Count("visitor_id", distinct=True)):
        path = row["current_path"] or "/"
        merged[path] = merged.get(path, 0) + row["count"]
    by_path = sorted(merged.items(), key=lambda kv: (-kv[1], kv[0]))[:12]

    data = {
        "active": live.values("visitor_id").distinct().count(),
        "window_seconds": window,
        "by_path": [{"path": path, "count": count} for path, count in by_path],
        "by_device": list(
            live.values("device").annotate(count=Count("visitor_id", distinct=True))
                .order_by("-count")
        ),
        # The two that are worth interrupting for — someone mid-purchase.
        "in_checkout": live.filter(current_path__startswith="/checkout").count(),
        "in_cart": live.filter(current_path__startswith="/cart").count(),
        "in_wizard": live.filter(current_path__startswith="/customize").count(),
    }
    if use_cache:
        cache.set(PRESENCE_CACHE_KEY, data, PRESENCE_CACHE_SECONDS)
    return data


# --------------------------------------------------------------------------- #
# Today (live, uncached-by-rollup) — everything older comes from Daily*Stat
# --------------------------------------------------------------------------- #

def today_totals(date=None):
    """Today's headline numbers, computed straight from the raw tables.

    Only ever spans one day of rows, so it stays cheap; the nightly rollup writes
    the same numbers into DailyStat once the day is closed.
    """
    day = date or timezone.localdate()
    sessions = VisitorSession.objects.filter(started_at__date=day)
    agg = sessions.aggregate(
        total=Count("id"),
        visitors=Count("visitor_id", distinct=True),
        new=Count("id", filter=Q(is_new_visitor=True)),
        bounced=Count("id", filter=Q(pageviews__lte=1)),
        converted=Count("id", filter=Q(converted=True)),
    )
    pageviews = AnalyticsEvent.objects.filter(ts__date=day, name="pageview").count()
    seconds = sum(s.seconds for s in sessions.only("started_at", "last_seen"))
    total = agg["total"] or 0
    return {
        "date": day.isoformat(),
        "sessions": total,
        "visitors": agg["visitors"] or 0,
        "new_visitors": agg["new"] or 0,
        "pageviews": pageviews,
        "bounced_sessions": agg["bounced"] or 0,
        "converted_sessions": agg["converted"] or 0,
        "bounce_rate": round((agg["bounced"] or 0) / total * 100, 1) if total else 0,
        "avg_seconds": round(seconds / total) if total else 0,
    }
