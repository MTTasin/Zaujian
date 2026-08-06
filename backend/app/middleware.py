"""
Admin audit trail.

Every write a staff user makes through `/api/admin/` is recorded, so "who
cancelled this order" has an answer. Deliberately a middleware rather than
per-view logging: a view that forgets to log would be exactly the write you
later wish you could see.
"""

import json
import logging

logger = logging.getLogger(__name__)

WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
PREFIX = "/api/admin/"

# Endpoints whose writes are noise, not decisions.
SKIP_SUFFIXES = (
    "mark_seen/",        # clearing a badge, fired on page open
    "push-subscribe/",   # a browser registering a device
    "login/",            # logged as an event below, never with the body
)

# Anything whose key looks like this never reaches the database.
SECRET_KEYS = ("password", "token", "secret", "key", "authorization")
MAX_PAYLOAD_CHARS = 2000


def _redact(value, depth=0):
    """Copy a decoded body with secret-looking values replaced."""
    if depth > 4:
        return "…"
    if isinstance(value, dict):
        out = {}
        for key, inner in value.items():
            if any(marker in str(key).lower() for marker in SECRET_KEYS):
                out[key] = "***"
            else:
                out[key] = _redact(inner, depth + 1)
        return out
    if isinstance(value, list):
        return [_redact(item, depth + 1) for item in value[:20]]
    return value


def _capture_body(request):
    """
    Read the body BEFORE the view runs.

    DRF's parsers consume the stream, after which `request.body` raises
    RawPostDataException — so this has to happen on the way in. Multipart is
    skipped outright: it is image uploads, which are large and say nothing.
    """
    content_type = request.META.get("CONTENT_TYPE", "")
    if "multipart/form-data" in content_type:
        return {"_": "file upload"}
    try:
        raw = request.body
    except Exception:
        return {}
    if not raw:
        return {}
    try:
        decoded = json.loads(raw.decode("utf-8", "replace"))
    except (ValueError, UnicodeDecodeError):
        return {"_raw": raw.decode("utf-8", "replace")[:MAX_PAYLOAD_CHARS]}
    redacted = _redact(decoded)
    if len(json.dumps(redacted, default=str)) > MAX_PAYLOAD_CHARS:
        return {"_truncated": json.dumps(redacted, default=str)[:MAX_PAYLOAD_CHARS]}
    return redacted


def _section_of(request):
    """
    The section the route itself declares — read off the resolved view rather
    than guessed from the URL, so `home-categories/` files under "homepage"
    instead of nothing.
    """
    match = getattr(request, "resolver_match", None)
    if not match:
        return ""
    view = match.func
    cls = getattr(view, "cls", None) or getattr(view, "view_class", None)
    candidates = [cls, *(getattr(cls, "permission_classes", []) or [])]
    for candidate in candidates:
        section = getattr(candidate, "section", None)
        if section:
            return section
    return ""


def _client_ip(request):
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if forwarded:
        return forwarded.split(",")[0].strip()[:45] or None
    return request.META.get("REMOTE_ADDR") or None


class AdminAuditMiddleware:
    """Log admin writes and stamp presence. Never breaks the request it watches."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        watched = (
            request.method in WRITE_METHODS
            and request.path.startswith(PREFIX)
            and not request.path.endswith(SKIP_SUFFIXES)
        )
        payload = _capture_body(request) if watched else None

        response = self.get_response(request)

        if watched:
            try:
                self._record(request, response, payload)
            except Exception:          # noqa: BLE001 - auditing must never 500 a request
                logger.exception("Audit logging failed for %s %s", request.method, request.path)

        # Presence covers reads too — an admin watching the Orders list all day
        # makes no writes at all, and "last seen" would call them offline.
        if request.path.startswith(PREFIX):
            from .services.presence import touch
            touch(getattr(request, "user", None))
        return response

    @staticmethod
    def _record(request, response, payload):
        user = getattr(request, "user", None)
        if not (user and user.is_authenticated):
            return                      # an anonymous 401 is not an admin action

        from .models import AdminAuditLog

        # Failures are logged too, with their status: a wall of 403s from one
        # account is itself the thing you want to see.
        AdminAuditLog.objects.create(
            user=user,
            username=user.username,
            method=request.method,
            path=request.path[:200],
            section=_section_of(request),
            status_code=getattr(response, "status_code", 0),
            payload=payload or {},
            ip=_client_ip(request),
        )
