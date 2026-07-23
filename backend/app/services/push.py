"""Web Push sender for admin alerts (new orders + chat handoffs).

Synchronous (no job queue on shared hosting): called inline at the event, with
every failure swallowed so a push problem never breaks checkout or the chatbot.
Stale subscriptions (410/404) are deleted automatically.
"""
import json
import logging

from django.conf import settings

logger = logging.getLogger(__name__)


def send_push(title, body, url="/admin"):
    """Send a notification to every saved admin subscription. Never raises."""
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

    for sub in PushSubscription.objects.all():
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
