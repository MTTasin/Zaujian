"""Web Push sender for admin alerts (new orders + chat handoffs).

Synchronous (no job queue on shared hosting): called inline at the event, with
every failure swallowed so a push problem never breaks checkout or the chatbot.
Stale subscriptions (410/404) are deleted automatically.
"""
import json
import logging

from django.conf import settings

logger = logging.getLogger(__name__)


def send_push(title, body, url="/admin", section=None):
    """
    Notify the staff devices that should hear about this. Never raises.

    `section` narrows the audience to people who can actually act: a packing
    moderator with only Orders should not be woken by a chat handoff. A
    subscription with no user predates staff accounts and is treated as the
    owner's, so nothing goes quiet on upgrade.
    """
    try:
        from pywebpush import webpush, WebPushException
        from py_vapid import Vapid01
    except Exception:  # library missing -> silently no-op
        return

    from app.models import PushSubscription

    cfg = settings.WEBPUSH
    priv = cfg.get("VAPID_PRIVATE_KEY")
    if not priv:
        return

    try:
        vapid = Vapid01.from_raw(priv.encode())
    except Exception as e:  # bad key -> don't crash the caller
        logger.warning("bad VAPID private key: %s", e)
        return

    payload = json.dumps({"title": title, "body": body, "url": url})
    subject = cfg.get("VAPID_SUBJECT", "mailto:admin@example.com")

    for sub in _recipients(section):
        info = {
            "endpoint": sub.endpoint,
            "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
        }
        try:
            webpush(
                subscription_info=info,
                data=payload,
                vapid_private_key=vapid,
                vapid_claims={"sub": subject},  # webpush mutates the dict
                timeout=10,
            )
        except WebPushException as e:
            status = getattr(getattr(e, "response", None), "status_code", None)
            if status in (404, 410):
                sub.delete()  # subscription expired — drop it
            else:
                logger.warning("web push failed: %s", e)
        except Exception as e:  # noqa: BLE001 — never let a push break the caller
            logger.warning("web push error: %s", e)


def _recipients(section):
    """Subscriptions whose owner may read `section` (all of them if None)."""
    from app.models import PushSubscription
    from app.permissions import can_read

    subs = PushSubscription.objects.select_related("user")
    if not section:
        return list(subs)
    return [
        sub for sub in subs
        if sub.user is None or sub.user.is_superuser or can_read(sub.user, section)
    ]
