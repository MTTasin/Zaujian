"""
Storefront API views.

Phase 2: read-only catalog + pricing lookup.
Phases 8-11: session cart, checkout (with synchronous fraud check), manual
payment submission, and custom order requests.
"""

import logging
from decimal import Decimal

from django.conf import settings
from django.db import transaction
from rest_framework import status, viewsets
from rest_framework.decorators import api_view, parser_classes, permission_classes
from rest_framework.generics import get_object_or_404
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .models import (
    CartItem, ChatMessage, ChatSession, CustomOrderRequest, GalleryTag,
    HomeCategory, Order, PrebuiltCombo, Product, SiteSettings,
)
from .serializers import (
    CartItemSerializer,
    ChatMessageSerializer,
    ComboDetailSerializer,
    ComboListSerializer,
    CustomOrderRequestSerializer,
    GalleryPhotoSerializer,
    HomeCategorySerializer,
    OrderSerializer,
    ProductDetailSerializer,
    ProductListSerializer,
    SiteSettingsSerializer,
)
from .services import notifications
from .services.chatbot import bot_reply
from .services.fraud_check import check_phone
from .services.pricing import price_selection


# --------------------------------------------------------------------------- #
# Catalog + pricing (Phase 2)
# --------------------------------------------------------------------------- #

class ProductViewSet(viewsets.ReadOnlyModelViewSet):
    """
    Catalog. List with filters: ?featured=1 ?popular=1 ?category=<label>
    ?q=<search>. Retrieve full product payload (gallery + info + options).
    """

    lookup_field = "slug"
    queryset = Product.objects.filter(active=True).prefetch_related("images")

    def get_queryset(self):
        qs = super().get_queryset()
        p = self.request.query_params
        if p.get("featured"):
            qs = qs.filter(is_featured=True)
        if p.get("popular"):
            qs = qs.filter(is_popular=True)
        if p.get("category"):
            qs = qs.filter(category=p["category"])
        if p.get("q"):
            qs = qs.filter(name__icontains=p["q"])
        return qs.order_by("home_order", "category", "name")

    def get_serializer_class(self):
        if self.action == "retrieve":
            return ProductDetailSerializer
        return ProductListSerializer


@api_view(["GET"])
def home_view(request):
    """Everything the homepage needs in one call: hero, category tiles,
    featured products, popular products."""
    ctx = {"request": request}
    site = SiteSettings.get_solo()
    cats = HomeCategory.objects.filter(active=True)
    # Homepage product sections show only plain e-commerce products
    # (customizable items live under /customize, not the shop grids).
    featured = (
        Product.objects.filter(active=True, is_featured=True, kind=Product.Kind.SIMPLE)
        .prefetch_related("images").order_by("home_order", "name")
    )
    popular = (
        Product.objects.filter(active=True, is_popular=True, kind=Product.Kind.SIMPLE)
        .prefetch_related("images").order_by("home_order", "name")
    )
    return Response({
        "site": SiteSettingsSerializer(site, context=ctx).data,
        "categories": HomeCategorySerializer(cats, many=True, context=ctx).data,
        "featured": ProductListSerializer(featured, many=True, context=ctx).data,
        "popular": ProductListSerializer(popular, many=True, context=ctx).data,
    })


@api_view(["POST"])
def price_lookup(request, slug):
    """POST {"selection": {...}} -> {"price": "...", "config": {...}}."""
    product = get_object_or_404(Product, slug=slug, active=True)
    selection = request.data.get("selection", {})
    try:
        price, config = price_selection(product, selection)
    except ValueError as exc:
        return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response({"price": str(price), "config": config})


class ComboViewSet(viewsets.ReadOnlyModelViewSet):
    """Prebuilt combos for landing/products page. ?featured=1 to filter."""

    lookup_field = "slug"
    queryset = PrebuiltCombo.objects.filter(active=True).prefetch_related("images", "products")

    def get_queryset(self):
        qs = super().get_queryset()
        if self.request.query_params.get("featured"):
            qs = qs.filter(featured=True)
        return qs

    def get_serializer_class(self):
        return ComboDetailSerializer if self.action == "retrieve" else ComboListSerializer


def delivery_charge_for(district):
    """Delivery charge for a district — reduced inside the home district."""
    inside = (settings.SHOP.get("INSIDE_DISTRICT") or "").strip()
    inside_charge = settings.SHOP.get("DELIVERY_CHARGE_INSIDE") or ""
    if inside and inside_charge and (district or "").strip().lower() == inside.lower():
        return Decimal(str(inside_charge))
    return Decimal(str(settings.SHOP["DELIVERY_CHARGE"]))


@api_view(["GET"])
def shop_info(request):
    """Public checkout config: delivery charge + manual payment numbers."""
    return Response({
        "delivery_charge": settings.SHOP["DELIVERY_CHARGE"],
        "delivery_charge_inside": settings.SHOP["DELIVERY_CHARGE_INSIDE"],
        "inside_district": settings.SHOP["INSIDE_DISTRICT"],
        "advance_amount": settings.SHOP["ADVANCE_AMOUNT"],
        "bkash_number": settings.SHOP["BKASH_NUMBER"],
        "nagad_number": settings.SHOP["NAGAD_NUMBER"],
        "whatsapp_number": settings.SHOP["WHATSAPP_NUMBER"],
    })


# --------------------------------------------------------------------------- #
# Session helpers
# --------------------------------------------------------------------------- #

def _cart_key(request):
    """
    Anonymous cart identity. Client sends a stable X-Cart-Token (stored in
    localStorage); fall back to the Django session key. Avoids cross-origin
    cookie pain in dev while keeping carts isolated per browser.
    """
    token = request.headers.get("X-Cart-Token")
    if token:
        return token[:64]
    if not request.session.session_key:
        request.session.save()
    return request.session.session_key


def _cart_qs(request):
    return CartItem.objects.filter(
        session_key=_cart_key(request), order__isnull=True
    ).select_related("product")


def _cart_payload(request):
    items = _cart_qs(request)
    data = CartItemSerializer(items, many=True, context={"request": request}).data
    subtotal = sum((i.price_snapshot for i in items), Decimal("0"))
    return {"items": data, "subtotal": str(subtotal), "count": len(data)}


# --------------------------------------------------------------------------- #
# Cart (Phase 8)
# --------------------------------------------------------------------------- #

@api_view(["GET"])
def cart_view(request):
    return Response(_cart_payload(request))


MAX_INPUT_LEN = 200


def _collect_inputs(product, data):
    """Validate + normalize customer inputs. Returns (fields, note).

    Raises ValueError(label) when a required ProductField has no value. The label is
    snapshotted next to its value so renaming the field later never rewrites an order.
    """
    supplied = {
        str(f.get("label", "")).strip(): str(f.get("value", "")).strip()[:MAX_INPUT_LEN]
        for f in (data.get("fields") or [])
        if isinstance(f, dict)
    }
    fields = []
    for pf in product.input_fields.all():
        value = supplied.get(pf.label, "")
        if pf.required and not value:
            raise ValueError(pf.label)
        if value:
            fields.append({"label": pf.label, "value": value})
    note = str(data.get("note") or "").strip()[:MAX_INPUT_LEN]
    return fields, note


@api_view(["POST"])
def cart_add(request):
    """
    POST {slug, selection, fields?, note?, is_custom_request?} -> add configured
    product, OR POST {combo_slug} -> add a prebuilt combo at its fixed price.
    """
    combo_slug = request.data.get("combo_slug")
    if combo_slug:
        combo = get_object_or_404(PrebuiltCombo, slug=combo_slug, active=True)
        # Snapshot the pictured design so the order records exactly what was sold.
        from .serializers import combo_preset_snapshot
        preset = combo_preset_snapshot(combo)
        # Re-validate the combo's required inputs server-side (same rule as products).
        try:
            fields, note = _collect_inputs(combo, request.data)
        except ValueError as missing:
            return Response({"error": f"{missing} লিখুন"}, status=status.HTTP_400_BAD_REQUEST)
        config = {}
        if preset:
            config["combo_items"] = preset
        if fields:
            config["fields"] = fields
        if note:
            config["note"] = note
        CartItem.objects.create(
            session_key=_cart_key(request), combo=combo,
            price_snapshot=combo.price, config=config,
        )
        return Response(_cart_payload(request), status=status.HTTP_201_CREATED)

    slug = request.data.get("slug")
    product = get_object_or_404(Product, slug=slug, active=True)
    is_custom = bool(request.data.get("is_custom_request"))
    selection = request.data.get("selection", {})

    if is_custom:
        # Custom-design flag: price set later by admin. Store selection as-is.
        item = CartItem.objects.create(
            session_key=_cart_key(request), product=product,
            config={"selection": selection}, price_snapshot=Decimal("0"),
            is_custom_request=True,
        )
    else:
        try:
            price, config = price_selection(product, selection)
        except ValueError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        # Re-validate required inputs server-side — never trust the client.
        try:
            fields, note = _collect_inputs(product, request.data)
        except ValueError as missing:
            return Response(
                {"error": f"{missing} লিখুন"}, status=status.HTTP_400_BAD_REQUEST,
            )
        if fields:
            config["fields"] = fields
        if note:
            config["note"] = note
        item = CartItem.objects.create(
            session_key=_cart_key(request), product=product,
            config=config, price_snapshot=price,
        )
    return Response(_cart_payload(request), status=status.HTTP_201_CREATED)


@api_view(["PATCH", "DELETE"])
def cart_item(request, item_id):
    item = get_object_or_404(_cart_qs(request), pk=item_id)
    if request.method == "DELETE":
        item.delete()
        return Response(_cart_payload(request))

    # Combo line: fixed price, nothing to re-price — only the answers change.
    if item.combo_id:
        try:
            fields, note = _collect_inputs(item.combo, request.data)
        except ValueError as missing:
            return Response({"error": f"{missing} লিখুন"}, status=status.HTTP_400_BAD_REQUEST)
        config = dict(item.config or {})
        config.pop("fields", None)
        config.pop("note", None)
        if fields:
            config["fields"] = fields
        if note:
            config["note"] = note
        item.config = config
        item.save(update_fields=["config"])
        return Response(_cart_payload(request))

    # PATCH -> re-price with a new selection (edit flow).
    selection = request.data.get("selection", {})
    try:
        price, config = price_selection(item.product, selection)
    except ValueError as exc:
        return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    # price_selection() rebuilds config from scratch, so re-apply the customer's
    # answers — otherwise editing a line silently wipes them.
    try:
        fields, note = _collect_inputs(item.product, request.data)
    except ValueError as missing:
        return Response({"error": f"{missing} লিখুন"}, status=status.HTTP_400_BAD_REQUEST)
    if fields:
        config["fields"] = fields
    if note:
        config["note"] = note
    item.config = config
    item.price_snapshot = price
    item.save(update_fields=["config", "price_snapshot"])
    return Response(_cart_payload(request))


# --------------------------------------------------------------------------- #
# Checkout (Phase 10)
# --------------------------------------------------------------------------- #

@api_view(["POST"])
def checkout(request):
    """
    Create an order from the session cart. Runs the synchronous courier fraud
    check on the phone number and decides whether an advance is required.
    Returns the created order plus advance info for the payment step.
    """
    items = list(_cart_qs(request))
    if not items:
        return Response({"error": "কার্ট খালি"}, status=status.HTTP_400_BAD_REQUEST)

    required = ["customer_name", "phone", "address"]
    missing = [f for f in required if not request.data.get(f)]
    if missing:
        return Response(
            {"error": f"প্রয়োজনীয় তথ্য নেই: {', '.join(missing)}"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    phone = request.data["phone"]
    subtotal = sum((i.price_snapshot for i in items), Decimal("0"))
    delivery = delivery_charge_for(request.data.get("district", ""))
    advance_amount = Decimal(str(settings.SHOP["ADVANCE_AMOUNT"]))

    # Repeat customer? (any earlier order with this phone)
    is_repeat = Order.objects.filter(phone=phone).exists()

    # Synchronous fraud check (bounded timeout inside the service).
    fraud = check_phone(phone)
    advance_required = bool(fraud.get("advance_required", True))

    with transaction.atomic():
        order = Order.objects.create(
            customer_name=request.data["customer_name"],
            phone=phone,
            whatsapp=request.data.get("whatsapp", ""),
            email=request.data.get("email", ""),
            division=request.data.get("division", ""),
            district=request.data.get("district", ""),
            thana=request.data.get("thana", ""),
            address=request.data["address"],
            is_repeat_customer=is_repeat,
            subtotal=subtotal,
            delivery_charge=delivery,
            advance_required=advance_required,
            advance_amount=advance_amount if advance_required else Decimal("0"),
            fraud_check_result=fraud,
            # Good delivery record (no advance) -> straight to confirmed (plan §10).
            # Otherwise wait for the manual advance payment.
            status=(Order.Status.PENDING_PAYMENT if advance_required
                    else Order.Status.CONFIRMED),
        )
        # Attach cart items to the order (they leave the active cart).
        for item in items:
            item.order = order
            item.save(update_fields=["order"])

    notifications.notify_order_status(order)  # order-placed email + tracking link

    # Web Push alert to the admin (never breaks checkout).
    try:
        from .services.push import send_push
        send_push("নতুন অর্ডার", f"{order.customer_name} — ৳{order.total}", "/admin/orders")
    except Exception:
        logging.getLogger(__name__).exception("push failed for %s", order.uid)

    # Website Purchase -> Meta CAPI (deduped with the browser Pixel via event_id).
    try:
        from .services.capi import track_purchase
        track_purchase(
            order,
            fbp=request.data.get("fbp"),
            fbc=request.data.get("fbc"),
            event_source_url=request.data.get("source_url"),
            request=request,
        )
    except Exception:  # tracking must never break checkout
        logging.getLogger(__name__).exception("CAPI purchase failed for %s", order.uid)

    data = OrderSerializer(order, context={"request": request}).data
    return Response(data, status=status.HTTP_201_CREATED)


# --------------------------------------------------------------------------- #
# Manual payment submission (Phase 11)
# --------------------------------------------------------------------------- #

@api_view(["POST"])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def order_payment(request, uid):
    """Customer submits transaction id + screenshot after paying the advance."""
    order = get_object_or_404(Order, uid=uid)
    order.payment_method = request.data.get("payment_method", order.payment_method)
    order.transaction_id = request.data.get("transaction_id", order.transaction_id)
    if request.FILES.get("payment_screenshot"):
        order.payment_screenshot = request.FILES["payment_screenshot"]
    order.save()
    return Response(OrderSerializer(order, context={"request": request}).data)


@api_view(["GET"])
def order_detail(request, uid):
    """Public order/tracking lookup by short uid."""
    order = get_object_or_404(Order, uid=uid)
    return Response(OrderSerializer(order, context={"request": request}).data)


# --------------------------------------------------------------------------- #
# Custom order request (Phase 9)
# --------------------------------------------------------------------------- #

@api_view(["POST"])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def custom_request(request):
    """Standalone custom-design request with optional reference images."""
    serializer = CustomOrderRequestSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    req = serializer.save()
    for f in request.FILES.getlist("images"):
        req.reference_images.create(image=f)

    # Website Lead -> Meta CAPI.
    try:
        from .services.capi import track_lead
        track_lead(
            name=req.customer_name, phone=req.phone,
            event_id=request.data.get("lead_event_id") or f"lead.{req.pk}",
            fbp=request.data.get("fbp"), fbc=request.data.get("fbc"),
            event_source_url=request.data.get("source_url"), request=request,
        )
    except Exception:  # tracking must never break the request
        logging.getLogger(__name__).exception("CAPI lead failed for request %s", req.pk)

    return Response(
        CustomOrderRequestSerializer(req).data, status=status.HTTP_201_CREATED
    )


# --------------------------------------------------------------------------- #
# Chatbot (public)
# --------------------------------------------------------------------------- #

def _chat_session(request):
    """Get or create the active (non-closed) chat session for this browser token."""
    token = request.headers.get("X-Cart-Token") or _cart_key(request)
    session = (
        ChatSession.objects.filter(token=token)
        .exclude(status=ChatSession.Status.CLOSED)
        .first()
    )
    if session is None:
        session = ChatSession.objects.create(token=token)
    return session


@api_view(["POST"])
def chat_send(request):
    """Customer sends a message and/or an image. Bot replies unless a human took over."""
    text = (request.data.get("message") or "").strip()
    image = request.FILES.get("image")
    if not text and not image:
        return Response({"error": "empty"}, status=status.HTTP_400_BAD_REQUEST)

    session = _chat_session(request)
    if request.data.get("customer_name") and not session.customer_name:
        session.customer_name = request.data["customer_name"][:120]
    if request.data.get("phone") and not session.phone:
        session.phone = request.data["phone"][:20]
    session.save()

    ChatMessage.objects.create(
        session=session, role=ChatMessage.Role.CUSTOMER, text=text, upload=image,
    )

    # Only the bot auto-replies, and only while it owns the conversation.
    if session.status == ChatSession.Status.BOT:
        bot_reply(session, request=request)

    msgs = ChatMessageSerializer(
        session.messages.all(), many=True, context={"request": request}
    ).data
    return Response({"session": session.id, "status": session.status, "messages": msgs})


@api_view(["GET"])
def gallery_index(request):
    """Public: active gallery tags as tiles (Redis-cached)."""
    from django.core.cache import cache

    from .services import gallery_cache

    data = cache.get(gallery_cache.INDEX_KEY)
    if data is None:
        tags = GalleryTag.objects.filter(active=True).prefetch_related("photos")
        data = []
        for t in tags:
            cover = t.cover or t.photos.first()
            data.append({
                "slug": t.slug,
                "title": t.title,
                "cover": request.build_absolute_uri(cover.thumbnail.url) if cover and cover.thumbnail else "",
                "count": t.photos.count(),
            })
        cache.set(gallery_cache.INDEX_KEY, data, 3600)
    return Response(data)


@api_view(["GET"])
def gallery_detail(request, slug):
    """Public: one tag's photos (Redis-cached)."""
    from django.core.cache import cache

    from .services import gallery_cache

    key = gallery_cache.tag_key(slug)
    data = cache.get(key)
    if data is None:
        tag = get_object_or_404(GalleryTag, slug=slug, active=True)
        photos = GalleryPhotoSerializer(
            tag.photos.all(), many=True, context={"request": request}
        ).data
        data = {"title": tag.title, "description": tag.description, "photos": photos}
        cache.set(key, data, 3600)
    return Response(data)


@api_view(["GET"])
def chat_poll(request):
    """Customer polls for new messages (admin replies, etc.)."""
    session = _chat_session(request)
    after = request.query_params.get("after")
    qs = session.messages.all()
    if after:
        qs = qs.filter(id__gt=after)
    return Response({
        "session": session.id,
        "status": session.status,
        "messages": ChatMessageSerializer(qs, many=True, context={"request": request}).data,
    })


# --------------------------------------------------------------------------- #
# Visitor tracking + nudge
# --------------------------------------------------------------------------- #

_NUDGE_FIELDS = {"visit": "visitors", "shown": "popups_shown", "clicked": "popups_clicked"}


@api_view(["POST"])
@permission_classes([AllowAny])
def nudge_event(request):
    """Public: bump one of today's DailyStat counters. No PII, no per-visitor rows."""
    from django.db.models import F
    from django.utils import timezone
    from .models import DailyStat

    field = _NUDGE_FIELDS.get(str(request.data.get("type", "")))
    if not field:
        return Response({"error": "invalid type"}, status=status.HTTP_400_BAD_REQUEST)
    today = timezone.localdate()
    DailyStat.objects.get_or_create(date=today)
    DailyStat.objects.filter(date=today).update(**{field: F(field) + 1})
    return Response({"ok": True})
