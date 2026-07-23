"""
AI assistant chatbot via DeepSeek, with human handoff.

Persona/rules come from bot_instructions.md. We inject live shop facts (which
photo galleries the bot may link) so it never invents things. The bot may emit
control tags which we parse out before the customer sees them:
  [HANDOFF]         -> flip session to waiting_admin, bot stops replying
  [GALLERY: slug]   -> replaced with a /gallery/<slug> link (self-hosted photos)
"""

import json
import logging
import re

import requests
from django.conf import settings

from ..models import BotConfig, ChatMessage, ChatSession, Order

logger = logging.getLogger(__name__)


def _file_instructions():
    try:
        with open(settings.CHATBOT["INSTRUCTIONS_PATH"], encoding="utf-8") as fh:
            return fh.read()
    except OSError:
        return "You are a helpful assistant for Zaujain Nikah Point — guide and help, never push a sale."


def _instructions():
    """
    Editable instructions from the admin panel (BotConfig). Falls back to the
    bot_instructions.md file and seeds the DB from it on first use.
    """
    cfg = BotConfig.get_solo()
    if not cfg.instructions.strip():
        cfg.instructions = _file_instructions()
        cfg.save(update_fields=["instructions"])
    return cfg.instructions


def _money(value):
    """1600.00 -> '1600', 1599.50 -> '1599.50'. Readable, exact — never rounded."""
    from decimal import Decimal

    d = Decimal(value)
    return str(int(d)) if d == d.to_integral_value() else f"{d:.2f}"


def _clip(text, limit=240):
    """Keep descriptions in the system prompt bounded (whole catalogue is injected)."""
    text = " ".join((text or "").split())
    return text if len(text) <= limit else text[:limit].rstrip() + "…"


def _shop_facts():
    # The storefront DB is the single source of truth for products and prices.
    # Without this the model has no numbers to ground on and invents them.
    from decimal import Decimal

    from django.conf import settings

    from ..models import GalleryTag, PrebuiltCombo, Product
    from .pricing import price_bounds

    lines = [
        "## LIVE SHOP DATA — the ONLY source of truth for prices and products.",
        "Quote prices ONLY from the list below, exactly as written. "
        "Never invent, guess, estimate or round a price. "
        "If a product or price is not listed here, do NOT make one up — say you will "
        "check and end your reply with [HANDOFF].",
    ]

    products = list(Product.objects.filter(active=True).prefetch_related("specs"))
    if products:
        lines.append("## PRODUCTS (all prices in BDT/৳) — this is the COMPLETE catalogue")
        for p in products:
            lo = hi = Decimal(p.base_price)
            if p.is_customizable:
                b_lo, b_hi = price_bounds(p)
                # price_bounds() returns (0,0) for e.g. a dupatta with no active
                # options. Never let that become a "free" quote — fall back to base.
                if b_hi:
                    lo, hi = b_lo or b_hi, b_hi

            flags = []
            if p.track_stock and not p.in_stock:
                flags.append("OUT OF STOCK — do not take an order")
            if p.is_customizable:
                flags.append("customizable")
            label = f"{p.name} ({p.category})" if p.category else p.name

            if not hi:  # no usable price anywhere
                flags.insert(0, "PRICE NOT SET — never quote a price, use [HANDOFF]")
                lines.append(f"- {label} [{'; '.join(flags)}]")
                continue

            price = (
                _money(lo) if lo == hi
                else f"{_money(lo)} - {_money(hi)} (depends on chosen options)"
            )
            suffix = f" [{'; '.join(flags)}]" if flags else ""
            lines.append(f"- {label}: ৳{price}{suffix}")
            if p.description:
                lines.append(f"    বিবরণ: {_clip(p.description)}")
            for s in p.specs.all():
                lines.append(f"    {s.label}: {s.value}")

    # Some products are alternatives to each other (e.g. book / frame / thumb).
    groups = {}
    for p in products:
        if p.exclusive_group:
            groups.setdefault(p.exclusive_group, []).append(p.name)
    for names in groups.values():
        if len(names) > 1:
            lines.append(f"একসাথে শুধু একটি নেওয়া যাবে: {', '.join(names)}")

    combos = list(PrebuiltCombo.objects.filter(active=True).prefetch_related("products"))
    if combos:
        # These are the storefront listings — bundles AND single items (a listing
        # with one linked product is a single product, not a bundle). Never call
        # one a "combo" unless its own name or description says so.
        lines.append("## READY-MADE LISTINGS (fixed price) — bundles and single items")
        for c in combos:
            label = f"{c.name} ({c.category})" if c.category else c.name
            lines.append(f"- {label}: ৳{_money(c.price)}")
            # The description is the authoritative contents list. Do NOT state a
            # count — the linked products below can be a partial mapping.
            if c.description:
                lines.append(f"    যা যা থাকছে: {_clip(c.description)}")
            items = [pr.name for pr in c.products.all()]
            if items:
                lines.append(f"    কাস্টমাইজযোগ্য আইটেম: {', '.join(items)}")

    shop = settings.SHOP
    lines.append("## DELIVERY, PAYMENT & CONTACT")
    inside_charge = shop.get("DELIVERY_CHARGE_INSIDE")
    inside_district = shop.get("INSIDE_DISTRICT")
    if inside_charge and inside_district:
        lines.append(
            f"- Delivery charge: ৳{shop['DELIVERY_CHARGE']} "
            f"(৳{inside_charge} inside {inside_district})"
        )
    else:
        lines.append(f"- Delivery charge: ৳{shop['DELIVERY_CHARGE']}")
    lines.append(f"- Advance (only when the system requires it): ৳{shop['ADVANCE_AMOUNT']}")
    lines.append("- Cash on Delivery is the default.")
    if shop.get("BKASH_NUMBER"):
        lines.append(f"- bKash number: {shop['BKASH_NUMBER']}")
    if shop.get("NAGAD_NUMBER"):
        lines.append(f"- Nagad number: {shop['NAGAD_NUMBER']}")
    if shop.get("CONTACT_PHONE"):
        lines.append(f"- Contact / order phone: {shop['CONTACT_PHONE']}")

    lines.append("## BUSINESS INFO")
    if shop.get("ADDRESS"):
        lines.append(f"- ঠিকানা / Address: {shop['ADDRESS']}")
    if shop.get("DELIVERY_TIME"):
        lines.append(f"- Delivery time: সারা বাংলাদেশে {shop['DELIVERY_TIME']}")
    lines.append("- Area served: all of Bangladesh.")
    if shop.get("SUPPORT_HOURS"):
        lines.append(
            f"- Human support hours: {shop['SUPPORT_HOURS']}. Outside these hours "
            f"(late night) you (the bot) still reply, but a human confirms the order "
            f"in the morning — tell the customer this if they ask to talk to a person late at night."
        )
    if shop.get("FACEBOOK_URL"):
        lines.append(f"- Facebook: {shop['FACEBOOK_URL']}")
    if shop.get("INSTAGRAM_URL"):
        lines.append(f"- Instagram: {shop['INSTAGRAM_URL']}")
    frontend = getattr(settings, "FRONTEND_URL", "").rstrip("/") if hasattr(settings, "FRONTEND_URL") else ""
    if frontend:
        lines.append(f"- Privacy policy: {frontend}/privacy · Terms: {frontend}/terms")
    lines.append(
        "- How to order: pick a ready product or customize one, add to cart, give "
        "name/phone/address; we then call to confirm and deliver Cash on Delivery."
    )
    lines.append(
        "- Custom order: the customer can send their own design/photo via the Custom "
        "Order page and we quote a price."
    )

    tags = list(GalleryTag.objects.filter(active=True))
    if tags:
        lines.append("## PHOTO GALLERIES YOU CAN LINK (use the EXACT tag shown)")
        for t in tags:
            lines.append(f"- {t.title}: [GALLERY: {t.slug}]")
        default = next((t for t in tags if t.is_bot_default), None)
        if default:
            lines.append(
                f"If the customer asks for a photo/pic/ছবি without saying which, "
                f"send [GALLERY: {default.slug}]."
            )
    return "\n".join(lines)


_BEHAVIOR = (
    "## BEHAVIOR RULES\n"
    "- The examples in the instructions use ৳{price} / {delivery_charge} as PLACEHOLDERS. "
    "Never output them literally — always use the real number from LIVE SHOP DATA.\n"
    "- Every product, combo, price, item-list and detail you state MUST come from LIVE "
    "SHOP DATA above. It is the complete catalogue. If it is not listed there, it does "
    "not exist — never invent it.\n"
    "- LIVE SHOP DATA is a lookup table for YOU — never recite it wholesale. "
    "Mention only the ONE product the customer is actually asking about.\n"
    "- If they ask a price without naming a product (e.g. 'দাম কত?', 'price please'), "
    "ask which product they mean in ONE short line — do NOT list everything.\n"
    "- Only if they explicitly ask what you sell (e.g. 'কি কি আছে?'), reply with a short "
    "list of product NAMES only — no prices, no item breakdowns — then ask which one "
    "they want to know about.\n"
    "- Do NOT repeat information you already gave earlier in this chat.\n"
    "- Keep replies to 2-3 short lines. One point per message. Never send a long list.\n"
    "- Write PLAIN TEXT only. No markdown, no **bold**, no #headings, no tables.\n"
    "- To show photos, put the matching [GALLERY: slug] tag on its own line (from the "
    "list above). It becomes a gallery link the customer can tap. Never describe a "
    "photo in words without attaching the tag.\n"
    "- NEVER invent or guess a phone number, contact number, bKash/Nagad number or "
    "address. Use ONLY the exact numbers in LIVE SHOP DATA. If the number asked for is "
    "not there, say you'll connect them to a person and end with [HANDOFF].\n"
    "- If the customer keeps asking for something you cannot do (e.g. delivery "
    "outside Bangladesh), state it clearly ONCE, then end your reply with [HANDOFF].\n"
    "- Vary your wording; never send the same sentence twice."
)


def _system_prompt():
    return _instructions() + "\n\n" + _shop_facts() + "\n\n" + _BEHAVIOR


_STATUS_BN = {
    "pending_payment": "পেমেন্টের অপেক্ষায়",
    "confirmed": "নিশ্চিত হয়েছে",
    "in_production": "তৈরি হচ্ছে",
    "shipped": "কুরিয়ারে পাঠানো হয়েছে",
    "delivered": "পৌঁছে দেওয়া হয়েছে",
    "cancelled": "বাতিল",
}
_UID_RE = re.compile(r"\b[A-HJ-NP-Z2-9]{6}\b")


def _order_context(session, user_text):
    """
    Look up order status the bot can answer with: any 6-char code in the message,
    plus recent orders tied to the session's phone. Returns a facts string or "".
    """
    orders = {}
    for uid in set(_UID_RE.findall((user_text or "").upper())):
        o = Order.objects.filter(uid=uid).first()
        if o:
            orders[o.uid] = o
    if session.phone:
        for o in Order.objects.filter(phone=session.phone)[:3]:
            orders.setdefault(o.uid, o)
    if not orders:
        return ""

    lines = ["## CUSTOMER ORDER STATUS (report these accurately in Bengali)"]
    for o in orders.values():
        bn = _STATUS_BN.get(o.status, o.status)
        track = f", ট্র্যাকিং {o.steadfast_tracking_code}" if o.steadfast_tracking_code else ""
        lines.append(f"Order {o.uid}: {bn} (৳{o.total}){track}")
    return "\n".join(lines)


def _history_messages(session):
    limit = settings.CHATBOT["HISTORY_LIMIT"]
    msgs = list(session.messages.exclude(role=ChatMessage.Role.SYSTEM).order_by("-id")[:limit])
    msgs.reverse()
    role_map = {"customer": "user", "bot": "assistant", "admin": "assistant"}
    return [{"role": role_map.get(m.role, "user"), "content": m.text} for m in msgs if m.text]


def _call_deepseek(messages):
    cfg = settings.CHATBOT
    if not cfg["API_KEY"]:
        return None, "no_api_key"
    # Stream the completion: chunks arrive continuously, so the read timeout is
    # per-chunk and never trips on a long reply (unlike waiting for the whole body).
    try:
        resp = requests.post(
            f"{cfg['API_BASE']}/chat/completions",
            headers={"Authorization": f"Bearer {cfg['API_KEY']}", "Content-Type": "application/json"},
            json={"model": cfg["MODEL"], "messages": messages, "temperature": 0.7,
                  "max_tokens": cfg["MAX_TOKENS"], "stream": True},
            timeout=(10, cfg["TIMEOUT"]),
            stream=True,
        )
        if resp.status_code >= 400:
            logger.error("DeepSeek HTTP %s: %s", resp.status_code, resp.text[:300])
            return None, "http_error"

        content = ""
        for line in resp.iter_lines(decode_unicode=True):
            if not line:
                continue
            if line.startswith("data: "):
                line = line[6:]
            if line.strip() == "[DONE]":
                break
            try:
                delta = json.loads(line)["choices"][0]["delta"].get("content")
            except (json.JSONDecodeError, KeyError, IndexError):
                continue
            if delta:
                content += delta
        return (content, None) if content.strip() else (None, "empty")
    except (requests.RequestException, ValueError) as exc:
        logger.warning("DeepSeek call failed: %s", exc)
        return None, "network_error"


_TAG_RE = re.compile(r"\[(HANDOFF|GALLERY)(?::\s*([\w-]+))?\]", re.IGNORECASE)
_GALLERY_RE = re.compile(r"\[GALLERY(?::\s*([\w\- ]+))?\]", re.IGNORECASE)
# Also catch a raw gallery URL the model might type instead of the tag.
_GALLERY_URL_RE = re.compile(r"https?://\S*/gallery/([\w\-]*)", re.IGNORECASE)


def extract_gallery_path(text):
    """Return the first gallery destination as a relative /gallery/<slug> path.

    Reads a [GALLERY: slug] tag (preferred) or a raw .../gallery/<slug> URL the
    model may have typed. Unknown/blank slug falls back to the bot-default tag.
    Returns "" if nothing matches and no default exists.
    """
    from django.utils.text import slugify

    from ..models import GalleryTag

    m = _GALLERY_RE.search(text)
    if m:
        raw_slug = m.group(1) or ""
    else:
        url = _GALLERY_URL_RE.search(text)
        if not url:
            return ""
        raw_slug = url.group(1) or ""

    slug = slugify(raw_slug)
    tag = GalleryTag.objects.filter(slug=slug, active=True).first() if slug else None
    if tag is None:
        tag = GalleryTag.objects.filter(is_bot_default=True, active=True).first()
    return f"/gallery/{tag.slug}" if tag else ""


def _strip_markdown(text):
    """The widget renders plain text, so markdown would show as literal characters."""
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text, flags=re.DOTALL)  # **bold**
    text = re.sub(r"__(.+?)__", r"\1", text, flags=re.DOTALL)      # __bold__
    text = re.sub(r"(?m)^\s{0,3}#{1,6}\s*", "", text)              # ### heading
    text = re.sub(r"(?m)^\s*\*\s+", "- ", text)                    # * bullet -> -
    return text.replace("**", "")                                   # any stragglers


def _parse_tags(text):
    """Return (clean_text, handoff). Strips tags, raw gallery URLs and markdown."""
    handoff = bool(re.search(r"\[HANDOFF\]", text, re.IGNORECASE))
    clean = _TAG_RE.sub("", text)
    clean = _GALLERY_URL_RE.sub("", clean)  # never show a raw link to the customer
    clean = _strip_markdown(clean)
    return clean.strip(), handoff


def bot_reply(session, request=None):
    """Generate + persist a bot reply for the latest customer message."""
    last_customer = (
        session.messages.filter(role=ChatMessage.Role.CUSTOMER).values_list("text", flat=True).last()
    )
    system = _system_prompt()
    order_ctx = _order_context(session, last_customer or "")
    if order_ctx:
        system += "\n\n" + order_ctx
    else:
        system += (
            "\n\nIf the customer asks about their order status and no order data is "
            "provided above, politely ask them for their 6-character order code."
        )

    messages = [{"role": "system", "content": system}] + _history_messages(session)
    content, err = _call_deepseek(messages)

    if err:
        # Transient failure: keep the bot in charge so it recovers on the next
        # message. Only a real [HANDOFF] (below) passes the chat to a human.
        fallback = "একটু সমস্যা হলো 🙏 আবার একটু লিখুন।"
        return ChatMessage.objects.create(session=session, role=ChatMessage.Role.BOT, text=fallback)

    gallery_path = extract_gallery_path(content)
    clean, handoff = _parse_tags(content)

    msg = ChatMessage.objects.create(
        session=session, role=ChatMessage.Role.BOT, text=clean,
        album_url=gallery_path,  # relative /gallery/<slug>; frontend renders a button
    )
    if handoff:
        session.status = ChatSession.Status.WAITING_ADMIN
        session.save(update_fields=["status", "updated_at"])
        try:
            from .push import send_push
            send_push("নতুন চ্যাট", "একজন গ্রাহক কথা বলতে চান", "/admin/chats")
        except Exception:
            pass
    return msg
