"""
Who is using the admin panel right now.

One row per staff account (`AdminPresence`), stamped on any authenticated
`/api/admin/` request. The panel polls `chat-unread/` every 6 seconds from every
page, so an open tab is a heartbeat we already pay for — this just records it.

The write is throttled through the cache so those polls cost one UPDATE a minute
per person instead of ten a minute. With no Redis the cache is per worker
process, so a few extra writes slip through; that is a handful of rows, not a
problem, and the stamp is never *late*, only occasionally early.
"""

import logging

from django.core.cache import cache
from django.utils import timezone

logger = logging.getLogger(__name__)

# How long a stamp is treated as fresh enough to skip re-writing. Must stay well
# under the "active now" window the panel draws, or someone at their desk would
# flicker offline between writes.
THROTTLE_SECONDS = 45


def touch(user, force=False):
    """Record that `user` is using the panel. Never raises — presence is a nicety."""
    if not (user and getattr(user, "is_authenticated", False) and user.is_staff):
        return
    key = f"admin:presence:{user.pk}"
    try:
        if not force and cache.get(key):
            return
        cache.set(key, 1, THROTTLE_SECONDS)
    except Exception:                     # noqa: BLE001 - a dead cache must not stop the stamp
        logger.debug("Presence throttle unavailable", exc_info=True)

    from ..models import AdminPresence

    try:
        AdminPresence.objects.update_or_create(
            user=user, defaults={"last_seen": timezone.now()},
        )
    except Exception:                     # noqa: BLE001 - never break the request being served
        logger.exception("Could not record presence for %s", user.pk)
