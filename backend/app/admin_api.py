"""
Frontend admin panel API (English). Token-authenticated.

Every endpoint here declares the **section** it belongs to (see
`app/permissions.py`): the owner (superuser) sees everything, a moderator sees
only the sections granted to them, at view or full level. A view that declares
no section is refused, so forgetting one fails closed.

The Django admin remains available in parallel — owner only.
"""

from decimal import Decimal

from django.conf import settings
from django.contrib.auth import authenticate
from django.contrib.auth.models import update_last_login
from django.db.models import Count, OuterRef, Q, Subquery
from django.utils import timezone
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.authtoken.models import Token
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.response import Response

from .pagination import AdminPagination
from .permissions import (
    AnyStaffPermission,
    OwnerPermission,
    SectionViewSetMixin,
    access_map,
    can_read,
    is_owner,
    section_access,
)

from .models import (
    CapiEvent,
    CartItem,
    ColorOption,
    ComboField,
    ComboImage,
    ConfigurationImage,
    ConsignmentEvent,
    CustomOrderRequest,
    DupattaOption,
    ExtraConsignment,
    HomeCategory,
    InsideDesign,
    Lead,
    Order,
    PrebuiltCombo,
    Product,
    ProductField,
    PushSubscription,
    ProductImage,
    OrderTag,
    ProductSpec,
    SiteSettings,
    StaticDesign,
    ToppingDesign,
)
from .serializers import CartItemSerializer
from .services import notifications, presence
from .services.steadfast_order import SteadfastError, create_consignment


# --------------------------------------------------------------------------- #
# Auth
# --------------------------------------------------------------------------- #

@api_view(["POST"])
def admin_login(request):
    """POST {username, password} -> {token, username}. Staff only."""
    username = request.data.get("username")
    password = request.data.get("password")
    user = authenticate(username=username, password=password)
    # `authenticate` already refuses inactive users, but say it explicitly:
    # deactivating a moderator must lock them out, not merely hide the nav.
    if user is None or not user.is_staff or not user.is_active:
        return Response(
            {"error": "Invalid credentials or not a staff account"},
            status=status.HTTP_401_UNAUTHORIZED,
        )
    token, _ = Token.objects.get_or_create(user=user)
    # `authenticate()` does not stamp last_login — only `django.contrib.auth.login()`
    # does, via the user_logged_in signal, and token auth never calls it. Without
    # this the panel reports whenever the account last used the *Django* admin,
    # which for the owner meant a months-old date.
    update_last_login(None, user)
    presence.touch(user, force=True)
    return Response({"token": token.key, **_identity(user)})


def _identity(user):
    """What the panel needs to decide which sections to show. The frontend uses
    this for UX only — every rule is re-checked server-side on each request."""
    return {
        "username": user.username,
        "is_owner": is_owner(user),
        "access": access_map(user),
    }


@api_view(["GET"])
@permission_classes([AnyStaffPermission])
def admin_me(request):
    return Response(_identity(request.user))


# --------------------------------------------------------------------------- #
# Catalog CRUD serializers
# --------------------------------------------------------------------------- #

class AdminProductImageSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProductImage
        fields = ["id", "product", "image", "alt", "order", "is_primary"]


class AdminProductSerializer(serializers.ModelSerializer):
    images = AdminProductImageSerializer(many=True, read_only=True)
    image_count = serializers.IntegerField(source="images.count", read_only=True)

    class Meta:
        model = Product
        fields = [
            "id", "name", "slug", "kind", "category", "base_price", "preview_ratio",
            "allows_individual_purchase", "active",
            "exclusive_group", "customize_order",
            # E-commerce catalog fields
            "description", "compare_at_price", "stock", "track_stock",
            "low_stock_threshold", "is_featured", "is_popular", "home_order",
            "images", "image_count",
        ]
        # slug auto-generates if omitted
        extra_kwargs = {"slug": {"required": False}}

    def _ensure_slug(self, validated_data, instance=None):
        from django.utils.text import slugify
        if not validated_data.get("slug"):
            base = slugify(validated_data.get("name") or (instance.name if instance else "")) or "product"
            slug = base
            i = 2
            qs = Product.objects.all()
            if instance:
                qs = qs.exclude(pk=instance.pk)
            while qs.filter(slug=slug).exists():
                slug = f"{base}-{i}"
                i += 1
            validated_data["slug"] = slug
        return validated_data

    def create(self, validated_data):
        return super().create(self._ensure_slug(validated_data))

    def update(self, instance, validated_data):
        return super().update(instance, self._ensure_slug(validated_data, instance))


class AdminColorSerializer(serializers.ModelSerializer):
    class Meta:
        model = ColorOption
        fields = ["id", "product", "name", "base_image", "price_modifier", "active"]


class AdminToppingSerializer(serializers.ModelSerializer):
    class Meta:
        model = ToppingDesign
        fields = [
            "id", "product", "placement", "image",
            "pos_x", "pos_y", "scale", "price_modifier", "active",
        ]


class AdminInsideSerializer(serializers.ModelSerializer):
    class Meta:
        model = InsideDesign
        fields = ["id", "product", "preview_image", "price_modifier", "active"]


class AdminStaticSerializer(serializers.ModelSerializer):
    class Meta:
        model = StaticDesign
        fields = ["id", "product", "image", "price_modifier", "active"]


class AdminDupattaSerializer(serializers.ModelSerializer):
    class Meta:
        model = DupattaOption
        fields = [
            "id", "product", "lace_type", "text_lines",
            "preview_image", "price", "active",
        ]


def _fire_purchase(order):
    """Report a website order's Purchase to Meta on confirm. Deduped by event_id,
    so calling it from confirm AND set_status is safe. Never breaks the action."""
    try:
        from .services.capi import fire_order_purchase
        fire_order_purchase(order)
    except Exception:
        import logging
        logging.getLogger(__name__).exception("CAPI purchase failed for %s", order.uid)


# Steadfast's delivery_status value that means the parcel reached the customer.
# `partial_delivered` deliberately does NOT count — part of the parcel came back.
# The rule itself lives in services/consignments.py (shared with the webhook).
from .services.consignments import DELIVERED as STEADFAST_DELIVERED  # noqa: E402


def _courier_error(exc):
    """The one answer every courier action gives when Steadfast refuses.

    Deliberately NOT 502/504. Those are what a reverse proxy emits when the app
    itself failed to answer, and this backend sits behind Cloudflare ->
    LiteSpeed -> Passenger: an app-level 502 is indistinguishable in the browser
    console from the gateway giving up, so a courier problem reads as the site
    being down. The courier refusing our request is a conflict (409); a
    consignment it no longer has is a 404.
    """
    from .services.steadfast_order import ConsignmentGoneError
    code = (status.HTTP_404_NOT_FOUND if isinstance(exc, ConsignmentGoneError)
            else status.HTTP_409_CONFLICT)
    return Response({"error": str(exc)}, status=code)


def _mark_consignment_missing(order, missing):
    """Record whether Steadfast still recognises this order's PRIMARY parcel.

    Cleared as readily as it is set: a 401 is also what wrong API keys look
    like, and a consignment can be re-created in their panel. Nothing here is
    a verdict — it is the last answer Steadfast gave.
    """
    if order.consignment_missing != missing:
        order.consignment_missing = missing
        order.save(update_fields=["consignment_missing", "updated_at"])


def _mark_extra_missing(ec, missing):
    """Same, per additional parcel."""
    if ec.missing != missing:
        ec.missing = missing
        ec.save(update_fields=["missing"])


def _sync_order_from_steadfast(order):
    """Refresh `order`'s Steadfast statuses (primary + every extra consignment) and
    promote the order to `delivered` when ALL of its booked parcels are delivered.

    An order can ship as several consignments, so one delivered parcel is not a
    delivered order. Returns (changed_to_delivered: bool, statuses: list[str]).
    Raises SteadfastError — the caller decides whether that aborts the sweep.
    """
    from .services.consignments import parcel_statuses, promote_if_all_delivered
    from .services.steadfast_order import ConsignmentGoneError, get_status_by_cid

    # The sweep is where a deleted parcel actually gets noticed — nobody opens
    # every order by hand. So it marks as well as reports; the caller still
    # collects the error either way.
    try:
        polled = get_status_by_cid(order.steadfast_consignment_id)
    except ConsignmentGoneError:
        _mark_consignment_missing(order, True)
        raise
    _mark_consignment_missing(order, False)
    if polled != order.steadfast_status:
        order.steadfast_status = polled
        order.save(update_fields=["steadfast_status", "updated_at"])

    for ec in order.extra_consignments.all():
        if not ec.consignment_id:
            continue              # never booked → cannot be delivered
        try:
            st = get_status_by_cid(ec.consignment_id)
        except ConsignmentGoneError:
            _mark_extra_missing(ec, True)
            raise
        _mark_extra_missing(ec, False)
        if st != ec.status:
            ec.status = st
            ec.save(update_fields=["status"])

    # The promotion rule is shared with the webhook so the two can't drift.
    return promote_if_all_delivered(order), parcel_statuses(order)


# --------------------------------------------------------------------------- #
# Catalog CRUD viewsets  (?product=<id> filter on option endpoints)
# --------------------------------------------------------------------------- #

class _AdminBase(SectionViewSetMixin, viewsets.ModelViewSet):
    """Every subclass MUST set `section` — SectionPermission refuses a view
    that declares none, so a forgotten one fails closed instead of open."""

    def get_queryset(self):
        # .all() clones the class-level queryset. Without it the SAME QuerySet
        # object is reused across requests in a worker process, and Django caches
        # its results — so newly created rows never appear (and each Passenger
        # worker serves a different stale snapshot).
        qs = self.queryset.all()
        product = self.request.query_params.get("product")
        if product and hasattr(self.queryset.model, "product"):
            qs = qs.filter(product_id=product)
        return qs


class AdminProductViewSet(_AdminBase):
    section = "products"
    queryset = Product.objects.all().prefetch_related("images").order_by("category", "name")
    serializer_class = AdminProductSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        group = self.request.query_params.get("group")
        if group == "simple":
            qs = qs.filter(kind=Product.Kind.SIMPLE)
        elif group == "custom":
            qs = qs.exclude(kind=Product.Kind.SIMPLE)
        return qs


class AdminProductImageViewSet(_AdminBase):
    """Catalog gallery images. ?product=<id> to filter."""
    section = "products"

    queryset = ProductImage.objects.all()
    serializer_class = AdminProductImageSerializer


class AdminProductSpecSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProductSpec
        fields = ["id", "product", "label", "value", "order"]


class AdminProductSpecViewSet(_AdminBase):
    """Product detail spec rows (label/value). ?product=<id> to filter."""
    section = "products"

    queryset = ProductSpec.objects.all()
    serializer_class = AdminProductSpecSerializer


class AdminProductFieldSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProductField
        fields = ["id", "product", "label", "placeholder", "required", "order"]


class AdminProductFieldViewSet(_AdminBase):
    """Customer input fields asked during customization. ?product=<id> to filter."""
    section = "products"

    queryset = ProductField.objects.all()
    serializer_class = AdminProductFieldSerializer


class AdminHomeCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = HomeCategory
        fields = ["id", "title", "image", "link", "order", "active"]


class AdminHomeCategoryViewSet(SectionViewSetMixin, viewsets.ModelViewSet):
    section = "homepage"
    queryset = HomeCategory.objects.all()
    serializer_class = AdminHomeCategorySerializer


class AdminSiteSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = SiteSettings
        fields = ["hero_image", "hero_title", "hero_subtitle", "band_image"]


# --------------------------------------------------------------------------- #
# Manual (off-website) order lines
# --------------------------------------------------------------------------- #
#
# A WhatsApp/Messenger order is typed in by hand, but it should still end up
# looking like a website order: linked to the real listing or product (so the
# order carries its photo and stays editable through the normal option editor)
# and carrying the details the customer sent in chat (bride/groom name, date,
# nickname…). Those details go into the SAME config["fields"] shape the
# storefront uses — label snapshotted next to the value — so renaming a product
# field later never rewrites a placed order, and every existing surface (cart,
# order detail, challan) renders them with no extra code.

MANUAL_TEXT_CAP = 200       # same cap cart_add applies to customer-typed answers
MANUAL_MAX_FIELDS = 20


def _dec(v):
    try:
        return Decimal(str(v if v not in (None, "") else 0))
    except Exception:
        return Decimal("0")


def _catalogue_price(combo, product):
    """Fallback price when the admin leaves the box empty: what the shop charges."""
    if combo:
        return combo.price
    if product:
        from .services.pricing import price_bounds
        lo, _hi = price_bounds(product)
        # A dupatta's option price is absolute, so base_price is only a fallback
        # for a product with no priced options at all (see CLAUDE.md).
        return lo or product.base_price
    return Decimal("0")


def _manual_line(it):
    """One admin-entered item payload -> (product, combo, config, price).

    Returns None for a line with nothing in it. The price the admin typed always
    wins (snapshot philosophy); the catalogue price is only a default.
    """
    combo = product = None
    if it.get("combo"):
        combo = PrebuiltCombo.objects.filter(pk=it["combo"]).first()
    if it.get("product") and combo is None:
        product = Product.objects.filter(pk=it["product"]).first()

    linked = combo or product
    title = str(it.get("title") or "").strip()[:MANUAL_TEXT_CAP] or (linked.name if linked else "")
    if not title:
        return None

    raw = it.get("price")
    price = _dec(raw) if raw not in (None, "") else _catalogue_price(combo, product)

    cfg = {"title": title, "manual": True}
    fields = []
    for f in (it.get("fields") or [])[:MANUAL_MAX_FIELDS]:
        label = str(f.get("label") or "").strip()[:MANUAL_TEXT_CAP]
        value = str(f.get("value") or "").strip()[:MANUAL_TEXT_CAP]
        if label or value:
            fields.append({"label": label, "value": value})
    if fields:
        cfg["fields"] = fields
    note = str(it.get("note") or "").strip()[:MANUAL_TEXT_CAP]
    if note:
        cfg["note"] = note
    return product, combo, cfg, price


def _manual_lines(items):
    """Parse a whole items payload, dropping the empty lines."""
    parsed = (_manual_line(it) for it in (items or []))
    return [line for line in parsed if line is not None]


# Option keys describe ONE product's configuration. Point the line at something
# else and they are a description of a thing that is no longer being bought.
_OPTION_KEYS = ("color", "corner", "center", "inside", "static", "dupatta", "combo_items")


def _apply_item_line(item, raw):
    """Write one admin-edited line onto a CartItem (unsaved). None = empty line.

    Used by `edit_items` for both existing and new lines, so a swapped item and a
    freshly added one obey exactly the same rules.
    """
    def cap(v):
        return str(v or "").strip()[:MANUAL_TEXT_CAP]

    cfg = dict(item.config or {})

    # A link is only touched when the payload speaks about it, so an edit that
    # only fixes a spelling cannot silently unlink the line from its listing.
    relinking = "combo" in raw or "product" in raw
    if relinking:
        combo = (PrebuiltCombo.objects.filter(pk=raw.get("combo")).first()
                 if raw.get("combo") else None)
        product = (Product.objects.filter(pk=raw.get("product")).first()
                   if raw.get("product") and combo is None else None)
        changed = (combo.pk if combo else None) != item.combo_id or \
                  (product.pk if product else None) != item.product_id
        if changed:
            for key in _OPTION_KEYS:
                cfg.pop(key, None)
            item.combo = combo
            item.product = product
    else:
        combo, product, changed = item.combo, item.product, False

    if "title" in raw:
        title = cap(raw.get("title"))
        if title:
            cfg["title"] = title
        else:
            cfg.pop("title", None)

    linked = combo or product
    if not (cfg.get("title") or linked):
        return None                       # a line with no name and no link is nothing

    if "fields" in raw and isinstance(raw["fields"], list):
        fields = []
        for f in raw["fields"][:MANUAL_MAX_FIELDS]:
            if not isinstance(f, dict):
                continue
            label, value = cap(f.get("label")), cap(f.get("value"))
            if label or value:
                fields.append({"label": label, "value": value})
        if fields:
            cfg["fields"] = fields
        else:
            cfg.pop("fields", None)

    if "note" in raw:
        note = cap(raw.get("note"))
        if note:
            cfg["note"] = note
        else:
            cfg.pop("note", None)

    if item.pk is None:
        cfg["manual"] = True              # typed by an admin, never by the customer

    typed = raw.get("price")
    if typed not in (None, ""):
        item.price_snapshot = _dec(typed)          # this order's price, nothing else
    elif changed or item.pk is None:
        item.price_snapshot = _catalogue_price(combo, product)

    item.config = cfg
    return item


def _create_manual_items(order, lines):
    """Write the parsed lines and return the subtotal."""
    subtotal = Decimal("0")
    for product, combo, cfg, price in lines:
        subtotal += price
        CartItem.objects.create(
            order=order, session_key="admin",
            product=product, combo=combo, config=cfg, price_snapshot=price,
        )
    return subtotal


@api_view(["POST"])
@permission_classes([section_access("orders")])
def admin_create_order(request):
    """
    Create an order manually (for orders received off the website — phone,
    WhatsApp, in person). Body:
    {customer_name, phone, whatsapp?, email?, division?, district?, thana?,
     address?, delivery_charge?, advance_received?, status?,
     items: [{title?, price?, product?, combo?, note?,
              fields?: [{label, value}, ...]}, ...]}
    A line needs either a title or a linked product/combo; everything else is
    optional. See _manual_line.
    """
    d = request.data
    lines = _manual_lines(d.get("items"))
    if not lines:
        return Response({"error": "Add at least one item"}, status=status.HTTP_400_BAD_REQUEST)

    dec = _dec

    order = Order.objects.create(
        customer_name=d.get("customer_name", ""),
        phone=d.get("phone", ""),
        whatsapp=d.get("whatsapp", ""),
        email=d.get("email", ""),
        division=d.get("division", ""),
        district=d.get("district", ""),
        thana=d.get("thana", ""),
        address=d.get("address", ""),
        delivery_charge=dec(d.get("delivery_charge")),
        advance_received=dec(d.get("advance_received")),
        status=d.get("status") or Order.Status.CONFIRMED,
        payment_verified=True,
        admin_seen=True,  # admin created it — don't alert themselves.
    )

    order.subtotal = _create_manual_items(order, lines)
    order.cod_amount = order.compute_cod()
    order.is_repeat_customer = (
        Order.objects.filter(phone=order.phone).exclude(pk=order.pk).exists()
        if order.phone else False
    )
    order.save()

    # Offline/manual sale (phone, WhatsApp, walk-in) -> report to Meta so ad-driven
    # DM orders still train the algorithm. Deduped by event_id with the website
    # Purchase; never let tracking break order creation.
    try:
        from .services.capi import track_purchase
        track_purchase(order, action_source="system_generated")
    except Exception:
        import logging
        logging.getLogger(__name__).exception("CAPI manual purchase failed for %s", order.uid)

    return Response({"id": order.id, "uid": order.uid}, status=status.HTTP_201_CREATED)


@api_view(["POST"])
@permission_classes([section_access("fraud", view_writes=True)])
def admin_fraud_check(request):
    """Run the courier fraud check (Steadfast + Pathao) for any phone number."""
    from .services.fraud_check import check_phone
    phone = str(request.data.get("phone", "")).strip()
    if not phone:
        return Response({"error": "Enter a phone number"}, status=status.HTTP_400_BAD_REQUEST)
    return Response(check_phone(phone))


@api_view(["GET", "PATCH", "PUT"])
@permission_classes([OwnerPermission])
def admin_site_settings(request):
    """Homepage hero/band media + copy (singleton)."""
    obj = SiteSettings.get_solo()
    if request.method == "GET":
        return Response(
            AdminSiteSettingsSerializer(obj, context={"request": request}).data
        )
    ser = AdminSiteSettingsSerializer(
        obj, data=request.data, partial=True, context={"request": request}
    )
    ser.is_valid(raise_exception=True)
    ser.save()
    return Response(ser.data)


# --------------------------------------------------------------------------- #
# Manual leads + CAPI event log (Meta Conversions API hub)
# --------------------------------------------------------------------------- #

class AdminLeadSerializer(serializers.ModelSerializer):
    class Meta:
        model = Lead
        fields = [
            "id", "email", "phone", "first_name", "last_name", "city", "state",
            "zip_code", "gender", "date_of_birth", "country", "external_id",
            "source", "note",
            "is_qualified", "is_converted", "conversion_value", "created_at",
        ]
        read_only_fields = ["created_at"]


class AdminLeadViewSet(SectionViewSetMixin, viewsets.ModelViewSet):
    """Manual ad leads. Saving with Qualified/Converted fires CAPI (dedup-guarded)."""
    section = "leads"

    queryset = Lead.objects.all()
    serializer_class = AdminLeadSerializer
    pagination_class = AdminPagination

    def perform_create(self, serializer):
        self._fire(serializer.save())

    def perform_update(self, serializer):
        self._fire(serializer.save())

    def _fire(self, lead):
        from .services.capi import track_manual_lead, track_manual_purchase
        try:
            if lead.is_qualified:
                track_manual_lead(lead)
            if lead.is_converted and lead.conversion_value:
                track_manual_purchase(lead)
        except Exception:
            import logging
            logging.getLogger(__name__).exception("CAPI manual fire failed for lead %s", lead.pk)


class AdminCapiEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = CapiEvent
        fields = [
            "id", "event_name", "event_id", "action_source", "value", "currency",
            "status", "attempts", "last_attempt_at", "response", "created_at",
        ]


class AdminCapiEventViewSet(SectionViewSetMixin, viewsets.ReadOnlyModelViewSet):
    section = "capi"
    queryset = CapiEvent.objects.all()
    serializer_class = AdminCapiEventSerializer
    # One row per order and per lead, kept as an audit trail — this is the
    # fastest-growing table in the panel.
    pagination_class = AdminPagination


class AdminColorViewSet(_AdminBase):
    section = "products"
    queryset = ColorOption.objects.all()
    serializer_class = AdminColorSerializer


class AdminToppingViewSet(_AdminBase):
    section = "products"
    queryset = ToppingDesign.objects.all()
    serializer_class = AdminToppingSerializer


class AdminInsideViewSet(_AdminBase):
    section = "products"
    queryset = InsideDesign.objects.all()
    serializer_class = AdminInsideSerializer


class AdminStaticViewSet(_AdminBase):
    section = "products"
    queryset = StaticDesign.objects.all()
    serializer_class = AdminStaticSerializer


class AdminDupattaViewSet(_AdminBase):
    section = "products"
    queryset = DupattaOption.objects.all()
    serializer_class = AdminDupattaSerializer


class AdminConfigImageSerializer(serializers.ModelSerializer):
    class Meta:
        model = ConfigurationImage
        fields = ["id", "product", "color", "corner", "center", "image", "active"]


class AdminConfigImageViewSet(_AdminBase):
    section = "products"
    queryset = ConfigurationImage.objects.all()
    serializer_class = AdminConfigImageSerializer


class AdminComboImageSerializer(serializers.ModelSerializer):
    class Meta:
        model = ComboImage
        fields = ["id", "combo", "image", "order"]


class AdminComboFieldSerializer(serializers.ModelSerializer):
    class Meta:
        model = ComboField
        fields = ["id", "combo", "label", "placeholder", "required", "order"]


class AdminComboFieldViewSet(_AdminBase):
    """Customer inputs asked on a combo's page (e.g. বরের নাম)."""
    section = "combos"

    queryset = ComboField.objects.all()
    serializer_class = AdminComboFieldSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        combo = self.request.query_params.get("combo")
        return qs.filter(combo_id=combo) if combo else qs


class AdminComboSerializer(serializers.ModelSerializer):
    images = AdminComboImageSerializer(many=True, read_only=True)

    class Meta:
        model = PrebuiltCombo
        fields = [
            "id", "name", "slug", "category", "description", "price",
            "products", "preset_config", "featured", "active", "images",
        ]
        # Bengali names slugify to empty -> auto-generate a unique slug if omitted.
        extra_kwargs = {"slug": {"required": False}}

    def _ensure_slug(self, validated_data, instance=None):
        from django.utils.text import slugify
        if not validated_data.get("slug"):
            base = slugify(validated_data.get("name") or (instance.name if instance else "")) or "combo"
            slug = base
            i = 2
            qs = PrebuiltCombo.objects.all()
            if instance:
                qs = qs.exclude(pk=instance.pk)
            while qs.filter(slug=slug).exists():
                slug = f"{base}-{i}"
                i += 1
            validated_data["slug"] = slug
        return validated_data

    def create(self, validated_data):
        return super().create(self._ensure_slug(validated_data))

    def update(self, instance, validated_data):
        return super().update(instance, self._ensure_slug(validated_data, instance))


class AdminComboViewSet(_AdminBase):
    section = "combos"
    queryset = PrebuiltCombo.objects.all().prefetch_related("images", "products")
    serializer_class = AdminComboSerializer


class AdminComboImageViewSet(_AdminBase):
    section = "combos"
    queryset = ComboImage.objects.all()
    serializer_class = AdminComboImageSerializer

    def get_queryset(self):
        qs = self.queryset.all()   # .all() -> fresh clone, never a cached result set
        combo = self.request.query_params.get("combo")
        if combo:
            qs = qs.filter(combo_id=combo)
        return qs


# --------------------------------------------------------------------------- #
# Orders
# --------------------------------------------------------------------------- #

class ConsignmentEventSerializer(serializers.ModelSerializer):
    """One line of a parcel's timeline, as Steadfast pushed it."""

    class Meta:
        model = ConsignmentEvent
        fields = ["id", "notification_type", "status", "tracking_message",
                  "event_time", "received_at"]


class ExtraConsignmentSerializer(serializers.ModelSerializer):
    events = ConsignmentEventSerializer(many=True, read_only=True)

    class Meta:
        model = ExtraConsignment
        fields = ["id", "invoice", "consignment_id", "tracking_code", "status",
                  "missing", "cod_amount", "recipient_name", "recipient_phone",
                  "recipient_address", "item_description", "created_at", "events"]


class OrderTagSerializer(serializers.ModelSerializer):
    order_count = serializers.IntegerField(source="orders.count", read_only=True)

    class Meta:
        model = OrderTag
        fields = ["id", "name", "colour", "order_count"]

    def validate_name(self, value):
        name = (value or "").strip()
        if not name:
            raise serializers.ValidationError("A tag needs a name.")
        # Case-insensitive uniqueness: "Urgent" and "urgent" as two tags would
        # split the very list the admin made the tag to gather.
        clash = OrderTag.objects.filter(name__iexact=name)
        if self.instance:
            clash = clash.exclude(pk=self.instance.pk)
        if clash.exists():
            raise serializers.ValidationError("A tag with that name already exists.")
        return name


class AdminOrderSerializer(serializers.ModelSerializer):
    items = CartItemSerializer(many=True, read_only=True)
    total = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    full_address = serializers.CharField(read_only=True)
    extra_consignments = ExtraConsignmentSerializer(many=True, read_only=True)
    consignment_events = serializers.SerializerMethodField()
    tags = OrderTagSerializer(many=True, read_only=True)

    def get_consignment_events(self, obj):
        """The PRIMARY parcel's timeline. Each extra carries its own under itself,
        so this filters them out rather than mixing two parcels into one story."""
        rows = [e for e in obj.consignment_events.all() if e.extra_id is None]
        return ConsignmentEventSerializer(rows, many=True).data

    class Meta:
        model = Order
        fields = [
            "id", "uid", "customer_name", "phone", "whatsapp", "email",
            "division", "district", "thana", "address", "full_address",
            "is_repeat_customer",
            "subtotal", "delivery_charge", "total",
            "advance_required", "advance_amount", "advance_received", "cod_amount",
            "payment_method", "transaction_id", "payment_screenshot", "payment_verified",
            "fraud_check_result",
            "steadfast_consignment_id", "steadfast_tracking_code", "steadfast_status",
            "consignment_missing",
            "courier_submitted", "status", "status_display", "created_at",
            "items", "extra_consignments", "consignment_events", "tags",
        ]
        read_only_fields = fields


class AdminOrderTagViewSet(SectionViewSetMixin, viewsets.ModelViewSet):
    """The tag vocabulary. Renaming here renames it on every order at once —
    that is the reason tags are rows and not text typed onto each order."""

    section = "orders"
    queryset = OrderTag.objects.all()
    serializer_class = OrderTagSerializer


def with_mark_counts(qs):
    """Annotate `_marks` = how many cash-book rows are marked against each order.

    Two M2Ms joined at once, so both Counts must be `distinct=True` — without it
    each join multiplies the other's rows and every count comes back squared.
    """
    from django.db.models import Count

    return qs.annotate(
        _marks=Count("expense_marks", distinct=True) + Count("income_marks", distinct=True),
    )


class AdminOrderListSerializer(serializers.ModelSerializer):
    """The Orders LIST — scalars only, no items.

    The full serializer walks every item's config to resolve option photos and
    typed answers, which costs ~10 queries per order and buys the list nothing:
    the table renders ten scalar fields and the dashboard seven. On an unpaginated
    list that multiplied by every order ever placed, so the page got slower every
    week until it read as "the panel is hanging". Opening one order still uses the
    full serializer — there it is one row, and the detail is the point.
    """

    total = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    # One prefetch for the whole page — the list stays flat in queries.
    tags = OrderTagSerializer(many=True, read_only=True)
    marked_count = serializers.SerializerMethodField()

    def get_marked_count(self, obj) -> int:
        """How many cash-book entries are MARKED against this order.

        Annotated by the list queryset so the whole page stays one query. The
        dashboard renders this same serializer over a plain queryset, so a
        missing annotation counts on the spot rather than raising — it is at
        most the handful of recent orders that card shows.
        """
        n = getattr(obj, "_marks", None)
        if n is None:
            n = obj.expense_marks.count() + obj.income_marks.count()
        return n

    class Meta:
        model = Order
        fields = [
            "id", "uid", "customer_name", "phone", "district",
            "subtotal", "delivery_charge", "total", "advance_received", "cod_amount",
            "payment_verified", "courier_submitted", "is_repeat_customer",
            "steadfast_status", "consignment_missing",
            "status", "status_display", "created_at", "tags",
            "marked_count",
        ]
        read_only_fields = fields


class AdminOrderViewSet(SectionViewSetMixin, mixins.DestroyModelMixin, viewsets.ReadOnlyModelViewSet):
    section = "orders"
    # Opening the Orders page POSTs mark_seen to clear the badge. Refusing that
    # for a view-only moderator would look like a broken page, not a read-only
    # one — it acknowledges a notification, it does not change an order.
    VIEW_WRITES = ("mark_seen",)
    serializer_class = AdminOrderSerializer
    queryset = Order.objects.all().prefetch_related(
        "items", "extra_consignments__events", "consignment_events", "tags")
    # Orders are never deleted, so an unpaginated list is a payload that grows
    # every week forever. The query count is already flat (see the list
    # serializer); this bounds the rows. Sorting/filtering stay backend-side, so
    # page 1 is still the top of the whole ordered set, not of a slice.
    pagination_class = AdminPagination

    def get_serializer_class(self):
        # Only the list is trimmed. Every action that answers with ONE order —
        # retrieve, confirm, set_status, edit_items… — keeps the full shape the
        # detail page renders, so no write action starts returning less than the
        # page it came from expects.
        if self._is_list():
            return AdminOrderListSerializer
        return AdminOrderSerializer

    def _is_list(self):
        # `action` is unset when the viewset is built directly (as the sorting
        # tests do) — treat that as "not the list" so nothing silently thins.
        return getattr(self, "action", None) == "list"


    # Only orders with no money/courier history may be hard-deleted; anything
    # further along must be cancelled instead (keeps the audit trail).
    DELETABLE_STATUSES = {
        Order.Status.IN_REVIEW, Order.Status.PENDING_PAYMENT, Order.Status.CANCELLED,
    }

    # Default list order: the admin's attention order, not the DB's. Rows that
    # need a phone call come first, finished/dead ones sink. Reorder this list to
    # change the default sort — nothing else depends on the positions.
    STATUS_PRIORITY = [
        Order.Status.IN_REVIEW,
        Order.Status.PENDING_PAYMENT,   # legacy, same "needs review" bucket
        Order.Status.IN_PRODUCTION,
        Order.Status.CONFIRMED,
        Order.Status.SHIPPED,
        Order.Status.DELIVERED,
        Order.Status.CANCELLED,
    ]

    # Whitelisted ?sort= values → order_by() args. `_total` is an annotation
    # added below (Order.total is a Python property, so the DB can't sort on it).
    SORTS = {
        "status": None,                 # workflow priority (default), see below
        "-status": None,
        "newest": ["-created_at"],
        "oldest": ["created_at"],
        "total_high": ["-_total", "-created_at"],
        "total_low": ["_total", "-created_at"],
        "name": ["customer_name", "-created_at"],
        "-name": ["-customer_name", "-created_at"],
        "code": ["uid"],
        "-code": ["-uid"],
        "district": ["district", "thana", "-created_at"],
        "-district": ["-district", "-thana", "-created_at"],
        "paid": ["-payment_verified", "-created_at"],
        "unpaid": ["payment_verified", "-created_at"],
        # Cash-book entries marked against the order (`_marks`, annotated below).
        "marked": ["-_marks", "-created_at"],
        "unmarked": ["_marks", "-created_at"],
        "courier": ["-courier_submitted", "-created_at"],
        "no_courier": ["courier_submitted", "-created_at"],
        "repeat": ["-is_repeat_customer", "-created_at"],
    }
    DEFAULT_SORT = "status"

    def get_queryset(self):
        from django.db.models import Case, F, IntegerField, Q, Value, When

        qs = super().get_queryset()
        if self._is_list():
            # The light list serializer reads no relation except tags, and
            # prefetching items + consignments for every order ever placed is
            # most of what made this page slow. One prefetch, not four.
            qs = qs.prefetch_related(None).prefetch_related("tags")
        # Annotated for every action, not just the list: `?sort=marked` orders by
        # it, and a sort that only worked on one code path is a trap.
        qs = with_mark_counts(qs)
        st = self.request.query_params.get("status")
        if st:
            qs = qs.filter(status=st)
        # Tag filter: by id from the chip row, by name when typed/bookmarked.
        tag = (self.request.query_params.get("tag") or "").strip()
        if tag:
            qs = qs.filter(tags__pk=tag) if tag.isdigit() else qs.filter(tags__name__iexact=tag)
        q = (self.request.query_params.get("q") or "").strip()
        if q:
            # A digits-only term is ambiguous — it is far more often a phone
            # number than a row id — so the id is an EXTRA match, never a
            # replacement: searching "34" still finds phones containing 34.
            by_id = Q(pk=int(q)) if q.isdigit() and len(q) < 10 else Q(pk__in=[])
            qs = qs.filter(
                by_id
                | Q(uid__icontains=q)
                | Q(customer_name__icontains=q)
                | Q(phone__icontains=q)
                | Q(whatsapp__icontains=q)
                | Q(email__icontains=q)
                # Searching a tag name finds the orders carrying it, which is
                # most of why an admin tags an order in the first place.
                | Q(tags__name__icontains=q)
            ).distinct()

        sort = self.request.query_params.get("sort") or self.DEFAULT_SORT
        if sort not in self.SORTS:
            sort = self.DEFAULT_SORT

        qs = qs.annotate(_total=F("subtotal") + F("delivery_charge"))

        if sort in ("status", "-status"):
            whens = [
                When(status=s, then=Value(i))
                for i, s in enumerate(self.STATUS_PRIORITY)
            ]
            qs = qs.annotate(
                _rank=Case(*whens, default=Value(len(self.STATUS_PRIORITY)),
                           output_field=IntegerField()),
            )
            rank = "_rank" if sort == "status" else "-_rank"
            return qs.order_by(rank, "-created_at")

        return qs.order_by(*self.SORTS[sort])

    def destroy(self, request, *args, **kwargs):
        # Owner-only on top of the status guard: a moderator with full Orders
        # access can CANCEL an order, but erasing one is not delegable.
        if not is_owner(request.user):
            return Response(
                {"error": "Only the owner can delete an order. Cancel it instead."},
                status=status.HTTP_403_FORBIDDEN,
            )
        order = self.get_object()
        if order.status not in self.DELETABLE_STATUSES:
            return Response(
                {"error": "Only pending or cancelled orders can be deleted. "
                          "Cancel the order first."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return super().destroy(request, *args, **kwargs)

    @action(detail=False, methods=["post"])
    def mark_seen(self, request):
        """Clear the 'new orders' badge — called when admin opens the Orders page."""
        Order.objects.filter(admin_seen=False).update(admin_seen=True)
        return Response({"ok": True})

    @action(detail=True, methods=["post"])
    def verify_payment(self, request, pk=None):
        order = self.get_object()
        order.payment_verified = True
        order.save(update_fields=["payment_verified", "updated_at"])
        return Response(self.get_serializer(order).data)

    @action(detail=True, methods=["post"])
    def set_status(self, request, pk=None):
        order = self.get_object()
        new_status = request.data.get("status")
        valid = dict(Order.Status.choices)
        if new_status not in valid:
            return Response({"error": "Invalid status"}, status=status.HTTP_400_BAD_REQUEST)
        order.status = new_status
        order.save(update_fields=["status", "updated_at"])
        if new_status == Order.Status.CONFIRMED:
            _fire_purchase(order)  # any move into confirmed reports the Purchase
        notifications.notify_order_status(order)
        return Response(self.get_serializer(order).data)

    @action(detail=False, methods=["get"])
    def catalogue(self, request):
        """Everything sellable, light, for the manual-order item picker.

        Deliberately not the catalog CRUD serializers — this only needs a name, a
        price the shop actually charges, a thumbnail to recognise it by, and the
        detail labels to prefill (so a listing asks for বরের নাম etc. exactly like
        the storefront would). Plain Products are included even though the
        storefront never sells them directly: on WhatsApp the owner does.
        """
        def abs_url(f):
            if not f:
                return None
            return request.build_absolute_uri(f.url)

        def first_image(obj):
            # iter() over the prefetched cache — .first() would re-query per row.
            row = next(iter(obj.images.all()), None)
            return abs_url(row.image if row else None)

        listings = []
        for c in (PrebuiltCombo.objects.filter(active=True)
                  .prefetch_related("images", "input_fields")):
            listings.append({
                "id": c.id, "name": c.name, "category": c.category,
                "price": str(c.price),
                "image": first_image(c),
                "fields": [f.label for f in c.input_fields.all()],
            })

        products = []
        for p in (Product.objects.filter(active=True)
                  .prefetch_related("images", "input_fields")):
            products.append({
                "id": p.id, "name": p.name, "category": p.category, "kind": p.kind,
                "price": str(_catalogue_price(None, p)),
                "customizable": p.is_customizable,
                "image": first_image(p),
                "fields": [f.label for f in p.input_fields.all()],
            })

        return Response({"listings": listings, "products": products})

    @action(detail=True, methods=["post"])
    def edit(self, request, pk=None):
        """Edit customer/address/charges (and manual-order items). Recomputes totals."""
        order = self.get_object()
        d = request.data

        def dec(v):
            try:
                return Decimal(str(v if v not in (None, "") else 0))
            except Exception:
                return Decimal("0")

        for f in ["customer_name", "phone", "whatsapp", "email",
                  "division", "district", "thana", "address"]:
            if f in d:
                setattr(order, f, d.get(f) or "")
        if "delivery_charge" in d:
            order.delivery_charge = dec(d.get("delivery_charge"))
        if "advance_received" in d:
            order.advance_received = dec(d.get("advance_received"))

        # Replace line items only for fully manual (admin-entered) orders.
        items = d.get("items")
        existing = list(order.items.all())
        all_manual = bool(existing) and all((it.config or {}).get("manual") for it in existing)
        if items is not None and all_manual:
            lines = _manual_lines(items)
            if lines:
                order.items.all().delete()
                order.subtotal = _create_manual_items(order, lines)

        order.cod_amount = order.compute_cod()
        order.is_repeat_customer = (
            Order.objects.filter(phone=order.phone).exclude(pk=order.pk).exists()
            if order.phone else False
        )
        order.save()
        return Response(self.get_serializer(order).data)

    @action(detail=True, methods=["post"])
    def recheck_fraud(self, request, pk=None):
        """Re-run the courier delivery-history (fraud) check for this order's phone
        and store the fresh result. The detail page's 'Courier delivery history'
        card renders from `fraud_check_result`."""
        from .services.fraud_check import check_phone
        order = self.get_object()
        if not order.phone:
            return Response({"error": "Order has no phone number"},
                            status=status.HTTP_400_BAD_REQUEST)
        # The whole point of this button is to go and ask again.
        order.fraud_check_result = check_phone(order.phone, refresh=True)
        order.save(update_fields=["fraud_check_result", "updated_at"])
        return Response(self.get_serializer(order).data)

    @action(detail=True, methods=["post"])
    def steadfast_status(self, request, pk=None):
        """Refresh this order's Steadfast delivery status."""
        from .services.steadfast_order import ConsignmentGoneError, SteadfastError, get_status
        order = self.get_object()
        if not order.steadfast_consignment_id:
            return Response({"error": "No consignment booked yet"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            st = get_status(order)
        except ConsignmentGoneError as exc:
            # Leave `steadfast_status` alone — the last status Steadfast DID
            # report is still the truth about what happened to that parcel.
            # The parcel being gone is a separate fact, recorded separately.
            _mark_consignment_missing(order, True)
            return _courier_error(exc)
        except SteadfastError as exc:
            return _courier_error(exc)
        _mark_consignment_missing(order, False)
        order.steadfast_status = st
        order.save(update_fields=["steadfast_status", "updated_at"])
        return Response(self.get_serializer(order).data)

    # One press must not outlive the Passenger request, and each parcel is its own
    # HTTP round-trip (COURIER.TIMEOUT_SECONDS each), so cap the batch. The
    # response reports `remaining` — press again to continue.
    SYNC_BATCH = 40

    @action(detail=False, methods=["post"])
    def sync_steadfast(self, request):
        """Bulk-refresh Steadfast status for every SHIPPED, booked order and mark the
        delivered ones `delivered`.

        Deliberately limited to `status=shipped`: earlier states are the admin's
        call (a parcel is not booked yet or is awaiting a phone confirm) and
        `delivered`/`cancelled` are terminal. Per-order failures are collected, not
        fatal — one dead parcel must not stop the sweep.
        """
        from .services.steadfast_order import SteadfastError

        qs = (Order.objects
              .filter(status=Order.Status.SHIPPED)
              .exclude(steadfast_consignment_id="")
              .prefetch_related("extra_consignments")
              .order_by("created_at"))          # oldest first — most likely delivered
        total = qs.count()
        batch = list(qs[:self.SYNC_BATCH])

        delivered, errors = [], []
        for order in batch:
            try:
                became_delivered, _ = _sync_order_from_steadfast(order)
            except SteadfastError as exc:
                errors.append({"uid": order.uid, "error": str(exc)})
                continue
            except Exception as exc:          # never let one bad row kill the sweep
                import logging
                logging.getLogger(__name__).exception(
                    "Steadfast sync failed for %s", order.uid)
                errors.append({"uid": order.uid, "error": str(exc)})
                continue
            if became_delivered:
                delivered.append(order.uid)

        return Response({
            "checked": len(batch),
            "delivered": delivered,
            "delivered_count": len(delivered),
            "errors": errors,
            "remaining": max(total - len(batch), 0),
        })

    @action(detail=True, methods=["post"])
    def resubmit_steadfast(self, request, pk=None):
        """Re-book the consignment on Steadfast (after a failed/unknown submit).
        Uses a fresh unique invoice so Steadfast doesn't reject it as a duplicate."""
        # Deliberately NOT re-imported locally: a local `from ... import
        # create_consignment` shadows the module-level name, so a test patching
        # `app.admin_api.create_consignment` silently misses this one action and
        # fires a REAL booking request at Steadfast.
        order = self.get_object()
        invoice = f"{order.uid}-{timezone.now().strftime('%H%M%S')}"
        try:
            res = create_consignment(order, invoice=invoice,
                                     overrides=self._primary_overrides(order, request.data))
        except SteadfastError as exc:
            return _courier_error(exc)
        # A fresh booking replaces whatever was missing.
        order.consignment_missing = False
        order.steadfast_consignment_id = res["consignment_id"]
        order.steadfast_tracking_code = res["tracking_code"]
        order.steadfast_status = res["status"]
        order.cod_amount = res["cod_amount"]
        order.courier_submitted = True
        order.save()
        return Response(self.get_serializer(order).data)

    @action(detail=True, methods=["post"])
    def book_extra(self, request, pk=None):
        """Book an ADDITIONAL Steadfast consignment for this order with edited fields."""
        order = self.get_object()
        d = request.data

        def dec(v):
            try:
                return Decimal(str(v)) if v not in (None, "") else None
            except Exception:
                return None

        # Unique invoice: {uid}-2, -3, ... bump past any existing.
        n = order.extra_consignments.count() + 2
        while order.extra_consignments.filter(invoice=f"{order.uid}-{n}").exists():
            n += 1
        invoice = f"{order.uid}-{n}"

        overrides = {}
        for f in ["recipient_name", "recipient_phone", "recipient_address", "item_description"]:
            if d.get(f):
                overrides[f] = d[f]
        cod = dec(d.get("cod_amount"))
        if cod is not None:
            overrides["cod_amount"] = cod
        if order.whatsapp:
            overrides["alternative_phone"] = order.whatsapp

        try:
            res = create_consignment(order, invoice=invoice, overrides=overrides)
        except SteadfastError as exc:
            return _courier_error(exc)

        ec = ExtraConsignment.objects.create(
            order=order, invoice=invoice,
            consignment_id=res["consignment_id"], tracking_code=res["tracking_code"],
            status=res["status"],
            cod_amount=cod if cod is not None else res.get("cod_amount") or Decimal("0"),
            recipient_name=overrides.get("recipient_name", order.customer_name or ""),
            recipient_phone=overrides.get("recipient_phone", order.phone or ""),
            recipient_address=overrides.get("recipient_address", order.full_address or ""),
            item_description=overrides.get("item_description", ""),
        )
        return Response(ExtraConsignmentSerializer(ec).data)

    def _get_extra(self, order, request):
        """Resolve the ExtraConsignment named by `extra_id` in the body, or None."""
        return order.extra_consignments.filter(pk=request.data.get("extra_id")).first()

    @staticmethod
    def _primary_overrides(order, data):
        """Recipient/COD/description edits for the PRIMARY consignment's Steadfast
        payload (parity with book_extra). Blank/absent fields fall back to the
        order-derived values inside create_consignment."""
        overrides = {}
        for f in ["recipient_name", "recipient_phone", "recipient_address", "item_description"]:
            if data.get(f):
                overrides[f] = data[f]
        cod = data.get("cod_amount")
        if cod not in (None, ""):
            try:
                overrides["cod_amount"] = Decimal(str(cod))
            except Exception:
                pass
        if order.whatsapp:
            overrides["alternative_phone"] = order.whatsapp
        return overrides

    @action(detail=True, methods=["post"])
    def extra_status(self, request, pk=None):
        """Refresh ONE additional consignment's Steadfast delivery status."""
        from .services.steadfast_order import (ConsignmentGoneError, SteadfastError,
                                               get_status_by_cid)
        order = self.get_object()
        ec = self._get_extra(order, request)
        if not ec:
            return Response({"error": "Consignment not found"}, status=status.HTTP_404_NOT_FOUND)
        if not ec.consignment_id:
            return Response({"error": "Not booked yet"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            polled = get_status_by_cid(ec.consignment_id)
        except ConsignmentGoneError as exc:
            _mark_extra_missing(ec, True)     # keep `status`, see steadfast_status
            return _courier_error(exc)
        except SteadfastError as exc:
            return _courier_error(exc)
        ec.status = polled
        ec.missing = False
        ec.save(update_fields=["status", "missing"])
        # The viewset prefetched `extra_consignments` and `_get_extra` re-queried
        # one, so the row just written and the row about to be serialized are two
        # different objects. Drop the prefetch cache or the panel is answered with
        # the value from before this refresh.
        order.refresh_from_db()
        return Response(self.get_serializer(order).data)

    @action(detail=True, methods=["post"])
    def resubmit_extra(self, request, pk=None):
        """Re-book ONE additional consignment on Steadfast (after a failed/unknown
        submit), reusing its stored recipient/COD/description with a fresh invoice."""
        order = self.get_object()
        ec = self._get_extra(order, request)
        if not ec:
            return Response({"error": "Consignment not found"}, status=status.HTTP_404_NOT_FOUND)
        invoice = f"{order.uid}-{timezone.now().strftime('%H%M%S')}"
        overrides = {
            "recipient_name": ec.recipient_name,
            "recipient_phone": ec.recipient_phone,
            "recipient_address": ec.recipient_address,
            "item_description": ec.item_description,
            "cod_amount": ec.cod_amount,
        }
        if order.whatsapp:
            overrides["alternative_phone"] = order.whatsapp
        try:
            res = create_consignment(order, invoice=invoice, overrides=overrides)
        except SteadfastError as exc:
            return _courier_error(exc)
        ec.invoice = invoice
        ec.consignment_id = res["consignment_id"]
        ec.tracking_code = res["tracking_code"]
        ec.status = res["status"]
        ec.missing = False      # a fresh booking replaces whatever was missing
        ec.save(update_fields=["invoice", "consignment_id", "tracking_code",
                               "status", "missing"])
        order.refresh_from_db()     # stale prefetch, see extra_status
        return Response(self.get_serializer(order).data)

    @action(detail=True, methods=["post"])
    def edit_config(self, request, pk=None):
        """Edit the customer-submitted TEXT in one order item's config: field answers,
        the special-instruction note, and combo line values. Option selections
        (color/design/dupatta) and the price snapshot are left untouched, so no
        re-pricing is needed. Values capped at 200 chars, matching cart_add.

        `fields` is the COMPLETE new list, so the admin can add a detail the
        customer sent later ("nickname on the pen") or drop one that was a
        mistake. An entry that omits `label` keeps the snapshotted label at that
        position — the storefront's own labels are answers to a question the
        customer was asked, and retyping them would rewrite history for no gain.
        """
        order = self.get_object()
        item = order.items.filter(pk=request.data.get("item_id")).first()
        if not item:
            return Response({"error": "Item not found in this order"},
                            status=status.HTTP_404_NOT_FOUND)
        cfg = dict(item.config or {})

        def cap(v):
            return str(v or "").strip()[:MANUAL_TEXT_CAP]

        incoming_fields = request.data.get("fields")
        if isinstance(incoming_fields, list):
            old = cfg.get("fields") if isinstance(cfg.get("fields"), list) else []
            rebuilt = []
            for i, incoming in enumerate(incoming_fields[:MANUAL_MAX_FIELDS]):
                if not isinstance(incoming, dict):
                    continue
                label = (cap(incoming["label"]) if "label" in incoming
                         else (old[i].get("label", "") if i < len(old) else ""))
                value = (cap(incoming["value"]) if "value" in incoming
                         else (old[i].get("value", "") if i < len(old) else ""))
                if label or value:
                    rebuilt.append({"label": label, "value": value})
            if rebuilt:
                cfg["fields"] = rebuilt
            else:
                cfg.pop("fields", None)

        # Combo item line values (positional, per product).
        incoming_ci = request.data.get("combo_items")
        if isinstance(incoming_ci, list) and isinstance(cfg.get("combo_items"), list):
            for existing_it, incoming_it in zip(cfg["combo_items"], incoming_ci):
                ex_lines = existing_it.get("lines") or []
                in_lines = (incoming_it or {}).get("lines") or []
                for ex_ln, in_ln in zip(ex_lines, in_lines):
                    if isinstance(in_ln, dict) and "value" in in_ln:
                        ex_ln["value"] = cap(in_ln.get("value"))

        # Note (optional; blank clears it).
        if "note" in request.data:
            note = cap(request.data.get("note"))
            if note:
                cfg["note"] = note
            else:
                cfg.pop("note", None)

        item.config = cfg
        item.save(update_fields=["config"])
        return Response(self.get_serializer(order).data)

    @action(detail=True, methods=["post"])
    def set_tags(self, request, pk=None):
        """Replace this order's tags. Body `{tags: [id, …]}` — the complete list,
        so removing one is just leaving it out.

        `{names: [...]}` is accepted too and creates what does not exist yet: the
        admin is usually typing the tag at the moment they need it, and making
        them go define it somewhere else first is how tagging stops happening.
        """
        order = self.get_object()
        ids = request.data.get("tags")
        names = request.data.get("names")
        if ids is None and names is None:
            return Response({"error": "Send tags (ids) or names"},
                            status=status.HTTP_400_BAD_REQUEST)

        tags = list(OrderTag.objects.filter(pk__in=[i for i in (ids or []) if str(i).isdigit()]))
        for raw in (names or []):
            name = str(raw or "").strip()[:40]
            if not name:
                continue
            tag = OrderTag.objects.filter(name__iexact=name).first()
            if tag is None:
                tag = OrderTag.objects.create(name=name)
            if tag not in tags:
                tags.append(tag)

        order.tags.set(tags)
        return Response(self.get_serializer(order).data)

    @action(detail=True, methods=["post"])
    def edit_items(self, request, pk=None):
        """Rewrite the whole item list of a placed order — customers change their
        minds after ordering, and until now only a fully-manual order could be
        re-lined.

        Body: {items: [{id?, product?, combo?, title?, price?, note?,
                        fields?: [{label, value}]}, ...]}

        A line carrying `id` is EDITED IN PLACE, which is the point: an untouched
        website line keeps its option config (color/corner/center) and therefore
        its photo and its option editor. A line with no `id` is new. An existing
        line the payload omits is deleted. `price` is this order's price for that
        line and nothing else — the catalogue is never written to, so the
        snapshot guarantee holds in the direction that matters.
        """
        order = self.get_object()
        payload = request.data.get("items")
        if not isinstance(payload, list):
            return Response({"error": "items must be a list"},
                            status=status.HTTP_400_BAD_REQUEST)

        existing = {i.pk: i for i in order.items.all()}
        kept, seen = [], set()
        for raw in payload:
            if not isinstance(raw, dict):
                continue
            try:
                item_id = int(raw.get("id")) if raw.get("id") not in (None, "") else None
            except (TypeError, ValueError):
                item_id = None
            item = existing.get(item_id)
            if item_id is not None and item is None:
                return Response({"error": f"Item {item_id} is not in this order"},
                                status=status.HTTP_404_NOT_FOUND)
            applied = _apply_item_line(item or CartItem(order=order, session_key="admin"), raw)
            if applied is None:
                continue                      # nothing in the line — silently dropped
            kept.append(applied)
            if item is not None:
                seen.add(item.pk)

        if not kept:
            return Response({"error": "An order must keep at least one item"},
                            status=status.HTTP_400_BAD_REQUEST)

        for item in kept:
            item.save()
        # Deleted last: if anything above failed, the order still has its lines.
        order.items.exclude(pk__in=[i.pk for i in kept]).delete()

        order.subtotal = sum((i.price_snapshot for i in kept), Decimal("0"))
        order.cod_amount = order.compute_cod()
        order.save()
        return Response(self.get_serializer(order).data)

    @action(detail=True, methods=["post"])
    def edit_item_options(self, request, pk=None):
        """Change a placed item's color/design selection and reprice from the engine.
        Text answers (fields/note/combo_items) are preserved; only option keys change."""
        from .services.pricing import price_selection
        order = self.get_object()
        item = order.items.filter(pk=request.data.get("item_id")).first()
        if not item:
            return Response({"error": "Item not found in this order"},
                            status=status.HTTP_404_NOT_FOUND)
        if not item.product_id or not item.product.is_customizable:
            return Response({"error": "Not a customizable product item"},
                            status=status.HTTP_400_BAD_REQUEST)
        selection = request.data.get("selection") or {}
        try:
            price, option_cfg = price_selection(item.product, selection)
        except ValueError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        merged = dict(item.config or {})
        for k in ("color", "corner", "center", "inside", "static", "dupatta"):
            merged.pop(k, None)
        merged.update(option_cfg)

        item.config = merged
        item.price_snapshot = price
        item.save(update_fields=["config", "price_snapshot"])

        # Refresh from DB to ensure we pick up the saved item in the sum calculation
        order.refresh_from_db()
        order.subtotal = sum((i.price_snapshot for i in order.items.all()), Decimal("0"))
        order.cod_amount = order.compute_cod()
        order.save()
        return Response(self.get_serializer(order).data)

    @action(detail=True, methods=["post"])
    def confirm(self, request, pk=None):
        """
        Enter advance received, book Steadfast consignment, confirm order.
        On Steadfast failure the order is NOT confirmed. See plan §15.4.
        """
        order = self.get_object()
        if order.courier_submitted:
            return Response({"error": "Already booked to Steadfast"},
                            status=status.HTTP_400_BAD_REQUEST)
        try:
            advance = Decimal(str(request.data.get("advance_received", "0")))
        except (TypeError, ValueError):
            return Response({"error": "Invalid advance amount"},
                            status=status.HTTP_400_BAD_REQUEST)

        order.advance_received = advance
        order.cod_amount = order.compute_cod()
        try:
            result = create_consignment(order,
                                        overrides=self._primary_overrides(order, request.data))
        except SteadfastError as exc:
            return _courier_error(SteadfastError(f"Steadfast booking failed: {exc}"))

        order.consignment_missing = False
        order.steadfast_consignment_id = result["consignment_id"]
        order.steadfast_tracking_code = result["tracking_code"]
        order.steadfast_status = result["status"]
        order.courier_submitted = True
        order.status = Order.Status.CONFIRMED
        order.save()
        _fire_purchase(order)
        notifications.notify_order_status(order)
        return Response(self.get_serializer(order).data)


# --------------------------------------------------------------------------- #
# Custom order requests (pricing queue)
# --------------------------------------------------------------------------- #

class AdminCustomRequestSerializer(serializers.ModelSerializer):
    reference_images = serializers.SerializerMethodField()

    class Meta:
        model = CustomOrderRequest
        fields = [
            "id", "customer_name", "phone", "description", "status",
            "admin_final_price", "created_at", "reference_images",
        ]
        read_only_fields = ["created_at", "reference_images"]

    def get_reference_images(self, obj):
        request = self.context.get("request")
        urls = []
        for ref in obj.reference_images.all():
            u = ref.image.url
            urls.append(request.build_absolute_uri(u) if request else u)
        return urls


class AdminCustomRequestViewSet(SectionViewSetMixin, viewsets.ModelViewSet):
    section = "custom"
    serializer_class = AdminCustomRequestSerializer
    queryset = CustomOrderRequest.objects.all().prefetch_related("reference_images")

    def get_queryset(self):
        qs = super().get_queryset()
        st = self.request.query_params.get("status")
        if st:
            qs = qs.filter(status=st)
        return qs

    @action(detail=True, methods=["post"])
    def set_price(self, request, pk=None):
        req = self.get_object()
        try:
            price = Decimal(str(request.data.get("price")))
        except (TypeError, ValueError):
            return Response({"error": "Invalid price"}, status=status.HTTP_400_BAD_REQUEST)
        req.admin_final_price = price
        req.status = CustomOrderRequest.Status.PRICED
        req.save(update_fields=["admin_final_price", "status"])
        # Push the price onto a linked cart item so it can be ordered.
        if req.cart_item_id:
            req.cart_item.price_snapshot = price
            req.cart_item.is_custom_request = False
            req.cart_item.save(update_fields=["price_snapshot", "is_custom_request"])
        return Response(self.get_serializer(req).data)

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        req = self.get_object()
        req.status = CustomOrderRequest.Status.REJECTED
        req.save(update_fields=["status"])
        return Response(self.get_serializer(req).data)


# --------------------------------------------------------------------------- #
# Dashboard
# --------------------------------------------------------------------------- #

@api_view(["GET"])
@permission_classes([section_access("analytics")])
def admin_analytics(request):
    """Chart data: orders + revenue for last 14 days, status breakdown."""
    from datetime import timedelta

    from django.db.models import Count, Sum
    from django.db.models.functions import Cast
    from django.db.models import DateField

    today = timezone.localdate()
    start = today - timedelta(days=13)

    orders = Order.objects.filter(created_at__date__gte=start)
    per_day = (
        orders.annotate(day=Cast("created_at", DateField()))
        .values("day")
        .annotate(count=Count("id"), revenue=Sum("subtotal"))
    )
    by_day = {row["day"].isoformat(): row for row in per_day}

    days = []
    for i in range(14):
        d = (start + timedelta(days=i)).isoformat()
        row = by_day.get(d)
        days.append({
            "date": d,
            "orders": row["count"] if row else 0,
            "revenue": float(row["revenue"]) if row and row["revenue"] else 0,
        })

    status_counts = list(
        Order.objects.values("status").annotate(count=Count("id")).order_by()
    )

    return Response({
        "daily": days,
        "status_breakdown": status_counts,
    })


@api_view(["GET"])
@permission_classes([section_access("analytics")])
def admin_analytics_live(request):
    """Visitors right now + a short live event feed. Polled every ~10s."""
    from .models import AnalyticsEvent
    from .services import analytics

    data = analytics.presence()
    recent = AnalyticsEvent.objects.select_related("combo", "product")[:15]
    data["recent"] = [{
        "name": e.name,
        "path": e.path,
        "ts": e.ts,
        "label": (e.combo.name if e.combo_id else
                  e.product.name if e.product_id else
                  (e.props or {}).get("q", "")),
    } for e in recent]
    return Response(data)


@api_view(["GET"])
@permission_classes([section_access("analytics")])
def admin_analytics_overview(request):
    """Dashboard payload: today live from raw tables, history from the rollups.

    `?days=N` (default 7, max 90) sets the history window. Nothing here scans the
    raw event table beyond today — that is the whole point of the rollups.
    """
    from datetime import timedelta

    from django.db.models import F, Sum

    from .models import (
        DailyComboStat, DailyFunnelStat, DailyPageStat, DailySourceStat, DailyStat,
    )
    from .services import analytics

    try:
        days = min(max(int(request.query_params.get("days", 7)), 1), 90)
    except (TypeError, ValueError):
        days = 7

    today = timezone.localdate()
    start = today - timedelta(days=days - 1)

    # --- trend: rolled-up days + today computed live ------------------------ #
    rolled = {s.date: s for s in DailyStat.objects.filter(date__gte=start, date__lte=today)}
    live_today = analytics.today_totals(today)
    trend = []
    for i in range(days):
        day = start + timedelta(days=i)
        if day == today:
            trend.append({
                "date": day.isoformat(),
                "visitors": live_today["visitors"],
                "sessions": live_today["sessions"],
                "pageviews": live_today["pageviews"],
            })
            continue
        s = rolled.get(day)
        trend.append({
            "date": day.isoformat(),
            "visitors": s.visitors if s else 0,
            "sessions": s.sessions if s else 0,
            "pageviews": s.pageviews if s else 0,
        })

    pages = list(
        DailyPageStat.objects.filter(date__gte=start)
        .values("path")
        .annotate(views=Sum("views"), sessions=Sum("sessions"),
                  entries=Sum("entries"), exits=Sum("exits"))
        .order_by("-views")[:15]
    )
    _label_pages(pages)

    combos = list(
        DailyComboStat.objects.filter(date__gte=start)
        .values("combo_id", name=F("combo__name"))
        .annotate(views=Sum("views"), carts=Sum("carts"),
                  orders=Sum("orders"), revenue=Sum("revenue"))
        .order_by("-views")[:20]
    )
    for c in combos:
        c["revenue"] = float(c["revenue"] or 0)
        c["conversion"] = round((c["orders"] or 0) / c["views"] * 100, 1) if c["views"] else 0

    sources = list(
        DailySourceStat.objects.filter(date__gte=start)
        .values("source")
        .annotate(sessions=Sum("sessions"), orders=Sum("orders"))
        .order_by("-sessions")[:10]
    )

    funnel_rows = {
        r["step"]: r["n"] for r in
        DailyFunnelStat.objects.filter(date__gte=start)
        .values("step").annotate(n=Sum("sessions"))
    }
    funnel = [{"step": s, "sessions": funnel_rows.get(s, 0)} for s in DailyFunnelStat.STEPS]

    return Response({
        "days": days,
        "today": live_today,
        "live": analytics.presence(),
        "trend": trend,
        "top_pages": pages,
        "top_combos": combos,
        "sources": sources,
        "funnel": funnel,
        # Demand we aren't serving. Counted in Python off a single indexed event
        # name — a JSON-key GROUP BY would tie this to one DB backend.
        "empty_searches": _empty_searches(start),
        "devices": _device_split(start),
    })


def _label_pages(rows):
    """Name the catalogue paths in place, e.g. /combo/combo-7 -> the listing's name.

    Bengali names slugify to empty, so combo slugs are auto-generated (combo-7) —
    the raw path alone tells the owner nothing about WHICH listing was read.
    Unresolvable paths (a deleted listing, or a collapsed :slug placeholder) just
    keep no label.
    """
    from .models import GalleryTag

    wanted = {"/combo/": {}, "/gallery/": {}}
    for r in rows:
        for prefix in wanted:
            if r["path"].startswith(prefix) and not r["path"].endswith("/:slug"):
                wanted[prefix][r["path"].split("/")[-1]] = r["path"]

    names = {}
    # PrebuiltCombo calls it `name`, GalleryTag calls it `title`.
    for prefix, model, field in (("/combo/", PrebuiltCombo, "name"),
                                 ("/gallery/", GalleryTag, "title")):
        slugs = wanted[prefix]
        if not slugs:
            continue
        for slug, name in model.objects.filter(slug__in=slugs).values_list("slug", field):
            names[slugs[slug]] = name

    for r in rows:
        r["label"] = names.get(r["path"], "")


def _empty_searches(start, limit=10):
    """Top zero-result search terms since `start` (JSON prop, counted in Python —
    a few hundred rows at most, and it keeps the query DB-agnostic)."""
    from collections import Counter

    from .models import AnalyticsEvent

    terms = Counter()
    rows = (AnalyticsEvent.objects
            .filter(name="search_empty", ts__date__gte=start)
            .values_list("props", flat=True)[:5000])
    for props in rows:
        q = str((props or {}).get("q", "")).strip()
        if q:
            terms[q[:60]] += 1
    return [{"term": t, "count": n} for t, n in terms.most_common(limit)]


def _device_split(start):
    from django.db.models import Count as _Count

    from .models import VisitorSession
    return list(
        VisitorSession.objects.filter(started_at__date__gte=start)
        .values("device").annotate(sessions=_Count("id")).order_by("-sessions")
    )


@api_view(["GET"])
@permission_classes([section_access("dashboard")])
def admin_dashboard(request):
    today = timezone.localdate()

    # The dashboard is a window onto other sections, so it shows only what the
    # caller could open directly — a moderator without Finance does not get the
    # month's takings handed to them on the landing page.
    sees_money = can_read(request.user, "finance")
    sees_orders = can_read(request.user, "orders")
    # The card shows uid/customer/total/status, so it takes the light serializer
    # too — the full one walked every item's option config for ten orders.
    recent = (with_mark_counts(Order.objects.all())[:10] if sees_orders
              else Order.objects.none())

    # Money is business-wide now (Finance cash-book), not per order: this month's
    # income minus spending. See app/finance_api.py.
    if sees_money:
        from .finance_api import month_net
        net = month_net(today)
    else:
        net = {"income": None, "expense": None, "net": None, "dues": None}

    from .models import DailyStat
    stat = DailyStat.objects.filter(date=today).first()

    return Response({
        "shows_money": sees_money,
        "shows_orders": sees_orders,
        "orders_today": Order.objects.filter(created_at__date=today).count(),
        "pending_payment": Order.objects.filter(
            payment_verified=False, status=Order.Status.PENDING_PAYMENT,
        ).exclude(transaction_id="").count(),
        "pending_custom": CustomOrderRequest.objects.filter(
            status=CustomOrderRequest.Status.PENDING,
        ).count(),
        # Cancelled orders never became sales, so they must not inflate the
        # headline count the owner reads as "how much have I sold".
        "total_orders": Order.objects.exclude(status=Order.Status.CANCELLED).count(),
        "month_income": net["income"],
        "month_expense": net["expense"],
        "month_net": net["net"],
        "dues_total": net["dues"],
        "recent_orders": AdminOrderListSerializer(
            recent, many=True, context={"request": request}
        ).data,
        "visitors_today": stat.visitors if stat else 0,
        "popups_shown_today": stat.popups_shown if stat else 0,
        "popups_clicked_today": stat.popups_clicked if stat else 0,
    })


# --------------------------------------------------------------------------- #
# Gallery (admin: photo library + tags)
# --------------------------------------------------------------------------- #

from .models import GalleryPhoto, GalleryTag  # noqa: E402
from .services import gallery_cache  # noqa: E402


class AdminGalleryPhotoSerializer(serializers.ModelSerializer):
    tag_count = serializers.IntegerField(source="tags.count", read_only=True)

    class Meta:
        model = GalleryPhoto
        fields = ["id", "image", "display", "thumbnail", "caption", "alt", "order", "tag_count"]
        read_only_fields = ["display", "thumbnail"]


class AdminGalleryPhotoViewSet(SectionViewSetMixin, viewsets.ModelViewSet):
    section = "gallery"
    queryset = GalleryPhoto.objects.all()
    serializer_class = AdminGalleryPhotoSerializer

    def create(self, request, *args, **kwargs):
        files = request.FILES.getlist("images") or request.FILES.getlist("image")
        if not files:
            return Response({"error": "no images"}, status=status.HTTP_400_BAD_REQUEST)
        # Optional: attach every uploaded photo straight to a tag (skips the
        # separate multi-select step).
        tag = None
        tag_id = request.data.get("tag")
        if tag_id:
            tag = GalleryTag.objects.filter(pk=tag_id).first()
        created, errors, new_photos = [], [], []
        for f in files:
            try:
                photo = GalleryPhoto(image=f)
                photo.save()
                new_photos.append(photo)
                created.append(
                    AdminGalleryPhotoSerializer(photo, context={"request": request}).data
                )
            except Exception as exc:  # noqa: BLE001 - report per-file, don't fail the batch
                errors.append({"file": f.name, "error": str(exc)})
        if tag and new_photos:
            tag.photos.add(*new_photos)
        gallery_cache.invalidate([tag.slug] if tag else None)
        return Response({"created": created, "errors": errors}, status=status.HTTP_201_CREATED)

    def perform_destroy(self, instance):
        super().perform_destroy(instance)
        gallery_cache.invalidate()


class AdminGalleryTagSerializer(serializers.ModelSerializer):
    photo_ids = serializers.PrimaryKeyRelatedField(
        source="photos", many=True, queryset=GalleryPhoto.objects.all(), required=False,
    )
    count = serializers.IntegerField(source="photos.count", read_only=True)

    class Meta:
        model = GalleryTag
        fields = ["id", "title", "slug", "description", "cover", "order",
                  "active", "is_bot_default", "photo_ids", "count"]
        extra_kwargs = {"slug": {"required": False, "allow_blank": True}}

    def validate_slug(self, value):
        from django.utils.text import slugify
        # Blank -> model auto-generates. Otherwise normalize to an ASCII url slug.
        return slugify(value) if value else value


class AdminGalleryTagViewSet(SectionViewSetMixin, viewsets.ModelViewSet):
    section = "gallery"
    queryset = GalleryTag.objects.all()
    serializer_class = AdminGalleryTagSerializer

    def perform_create(self, serializer):
        serializer.save()
        gallery_cache.invalidate()

    def perform_update(self, serializer):
        serializer.save()
        gallery_cache.invalidate()

    def perform_destroy(self, instance):
        super().perform_destroy(instance)
        gallery_cache.invalidate()

    @action(detail=True, methods=["post"])
    def set_photos(self, request, pk=None):
        tag = self.get_object()
        ids = request.data.get("photo_ids", [])
        tag.photos.set(GalleryPhoto.objects.filter(id__in=ids))
        gallery_cache.invalidate([tag.slug])
        return Response({"count": tag.photos.count()})


# --------------------------------------------------------------------------- #
# Chat (admin: live chats)
# --------------------------------------------------------------------------- #

from .models import ChatMessage, ChatSession  # noqa: E402
from .serializers import ChatMessageSerializer, ChatSessionSerializer  # noqa: E402


class AdminChatSessionViewSet(SectionViewSetMixin, viewsets.ReadOnlyModelViewSet):
    section = "chats"
    serializer_class = ChatSessionSerializer
    queryset = ChatSession.objects.all()
    pagination_class = AdminPagination

    def get_queryset(self):
        qs = super().get_queryset()
        st = self.request.query_params.get("status")
        if st:
            qs = qs.filter(status=st)
        # The preview and the unread badge come back with the row. As method
        # fields they were two queries PER SESSION on a list that polls every few
        # seconds — the cost of the page grew with every chat ever opened.
        return qs.annotate(
            last_text=Subquery(
                ChatMessage.objects.filter(session=OuterRef("pk"))
                .order_by("-id").values("text")[:1]
            ),
            unread_count=Count(
                "messages",
                filter=Q(messages__role=ChatMessage.Role.CUSTOMER,
                         messages__read_by_admin=False),
            ),
        )

    @action(detail=True, methods=["get"])
    def messages(self, request, pk=None):
        session = self.get_object()
        after = request.query_params.get("after")
        qs = session.messages.all()
        if after:
            qs = qs.filter(id__gt=after)
        # Mark customer messages as read by admin.
        session.messages.filter(role=ChatMessage.Role.CUSTOMER, read_by_admin=False).update(read_by_admin=True)
        return Response({
            "status": session.status,
            "messages": ChatMessageSerializer(qs, many=True, context={"request": request}).data,
        })

    @action(detail=True, methods=["post"])
    def reply(self, request, pk=None):
        session = self.get_object()
        text = (request.data.get("text") or "").strip()
        image = request.FILES.get("image")
        if not text and not image:
            return Response({"error": "empty"}, status=status.HTTP_400_BAD_REQUEST)
        # A human reply takes over the conversation from the bot.
        if session.status != ChatSession.Status.CLOSED:
            session.status = ChatSession.Status.ADMIN
            session.save(update_fields=["status", "updated_at"])
        msg = ChatMessage.objects.create(
            session=session, role=ChatMessage.Role.ADMIN, text=text, upload=image,
        )
        return Response(ChatMessageSerializer(msg, context={"request": request}).data)

    @action(detail=True, methods=["post"])
    def set_status(self, request, pk=None):
        session = self.get_object()
        new_status = request.data.get("status")
        if new_status not in dict(ChatSession.Status.choices):
            return Response({"error": "invalid status"}, status=status.HTTP_400_BAD_REQUEST)
        session.status = new_status
        session.save(update_fields=["status", "updated_at"])
        return Response(ChatSessionSerializer(session).data)


@api_view(["GET", "PUT"])
@permission_classes([OwnerPermission])
def admin_bot_config(request):
    """Get or update the editable chatbot instructions (no restart needed)."""
    from .models import BotConfig
    cfg = BotConfig.get_solo()
    if request.method == "PUT":
        cfg.instructions = request.data.get("instructions", "")
        cfg.save(update_fields=["instructions", "updated_at"])
    return Response({"instructions": cfg.instructions, "updated_at": cfg.updated_at})


@api_view(["GET"])
@permission_classes([AnyStaffPermission])
def admin_chat_unread(request):
    """
    Counts for the badge + alert sounds, polled from every admin page.

    Open to any staff account, but each counter is scoped to what the caller may
    actually see — a packing moderator gets no chat badge. Zeroing beats a 403
    here: the layout polls this constantly, and one refusal would break every
    page for someone who simply lacks one section.
    """
    waiting = unread = new_orders = 0
    if can_read(request.user, "chats"):
        waiting = ChatSession.objects.filter(status=ChatSession.Status.WAITING_ADMIN).count()
        unread = ChatMessage.objects.filter(
            role=ChatMessage.Role.CUSTOMER, read_by_admin=False,
            session__status__in=[ChatSession.Status.WAITING_ADMIN, ChatSession.Status.ADMIN],
        ).count()
    if can_read(request.user, "orders"):
        new_orders = Order.objects.filter(admin_seen=False).count()
    return Response({"waiting": waiting, "unread": unread, "new_orders": new_orders})


@api_view(["GET"])
@permission_classes([AnyStaffPermission])
def admin_push_key(request):
    """Public VAPID key the browser needs to subscribe to Web Push."""
    return Response({"public_key": settings.WEBPUSH["VAPID_PUBLIC_KEY"]})


@api_view(["POST"])
@permission_classes([AnyStaffPermission])
def admin_push_subscribe(request):
    """Save (or refresh) a browser push subscription for admin alerts."""
    d = request.data or {}
    endpoint = d.get("endpoint")
    keys = d.get("keys") or {}
    p256dh, auth = keys.get("p256dh"), keys.get("auth")
    if not (endpoint and p256dh and auth):
        return Response({"error": "Invalid subscription"}, status=status.HTTP_400_BAD_REQUEST)
    # Stamped with the caller so alerts can be aimed at the staff who can act
    # on them (see services/push.py).
    PushSubscription.objects.update_or_create(
        endpoint=endpoint,
        defaults={"p256dh": p256dh, "auth": auth, "user": request.user},
    )
    return Response({"ok": True})
