"""
Frontend admin panel API (English). Token-authenticated, IsAdminUser only.

Sections: auth, dashboard, orders (status/verify/confirm+book Steadfast),
custom-request pricing, and full catalog CRUD with image upload.

The Django admin remains available in parallel.
"""

from decimal import Decimal

from django.conf import settings
from django.contrib.auth import authenticate
from django.utils import timezone
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.authtoken.models import Token
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response

from .models import (
    CapiEvent,
    CartItem,
    ColorOption,
    ComboField,
    ComboImage,
    ConfigurationImage,
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
    ProductSpec,
    SiteSettings,
    StaticDesign,
    ToppingDesign,
)
from .serializers import CartItemSerializer
from .services import notifications
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
    if user is None or not user.is_staff:
        return Response(
            {"error": "Invalid credentials or not a staff account"},
            status=status.HTTP_401_UNAUTHORIZED,
        )
    token, _ = Token.objects.get_or_create(user=user)
    return Response({"token": token.key, "username": user.username})


@api_view(["GET"])
@permission_classes([IsAdminUser])
def admin_me(request):
    return Response({"username": request.user.username})


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


# --------------------------------------------------------------------------- #
# Catalog CRUD viewsets  (?product=<id> filter on option endpoints)
# --------------------------------------------------------------------------- #

class _AdminBase(viewsets.ModelViewSet):
    permission_classes = [IsAdminUser]

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

    queryset = ProductImage.objects.all()
    serializer_class = AdminProductImageSerializer


class AdminProductSpecSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProductSpec
        fields = ["id", "product", "label", "value", "order"]


class AdminProductSpecViewSet(_AdminBase):
    """Product detail spec rows (label/value). ?product=<id> to filter."""

    queryset = ProductSpec.objects.all()
    serializer_class = AdminProductSpecSerializer


class AdminProductFieldSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProductField
        fields = ["id", "product", "label", "placeholder", "required", "order"]


class AdminProductFieldViewSet(_AdminBase):
    """Customer input fields asked during customization. ?product=<id> to filter."""

    queryset = ProductField.objects.all()
    serializer_class = AdminProductFieldSerializer


class AdminHomeCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = HomeCategory
        fields = ["id", "title", "image", "link", "order", "active"]


class AdminHomeCategoryViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAdminUser]
    queryset = HomeCategory.objects.all()
    serializer_class = AdminHomeCategorySerializer


class AdminSiteSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = SiteSettings
        fields = ["hero_image", "hero_title", "hero_subtitle", "band_image"]


@api_view(["POST"])
@permission_classes([IsAdminUser])
def admin_create_order(request):
    """
    Create an order manually (for orders received off the website — phone,
    WhatsApp, in person). Body:
    {customer_name, phone, whatsapp?, email?, division?, district?, thana?,
     address?, delivery_charge?, advance_received?, status?,
     items: [{title, price}, ...]}
    """
    d = request.data
    items = d.get("items") or []
    items = [it for it in items if str(it.get("title", "")).strip()]
    if not items:
        return Response({"error": "Add at least one item"}, status=status.HTTP_400_BAD_REQUEST)

    def dec(v):
        try:
            return Decimal(str(v or 0))
        except Exception:
            return Decimal("0")

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

    subtotal = Decimal("0")
    for it in items:
        price = dec(it.get("price"))
        subtotal += price
        CartItem.objects.create(
            order=order,
            session_key="admin",
            config={"title": str(it.get("title", "")).strip(), "manual": True},
            price_snapshot=price,
        )

    order.subtotal = subtotal
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
@permission_classes([IsAdminUser])
def admin_fraud_check(request):
    """Run the courier fraud check (Steadfast + Pathao) for any phone number."""
    from .services.fraud_check import check_phone
    phone = str(request.data.get("phone", "")).strip()
    if not phone:
        return Response({"error": "Enter a phone number"}, status=status.HTTP_400_BAD_REQUEST)
    return Response(check_phone(phone))


@api_view(["GET", "PATCH", "PUT"])
@permission_classes([IsAdminUser])
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


class AdminLeadViewSet(viewsets.ModelViewSet):
    """Manual ad leads. Saving with Qualified/Converted fires CAPI (dedup-guarded)."""

    permission_classes = [IsAdminUser]
    queryset = Lead.objects.all()
    serializer_class = AdminLeadSerializer

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


class AdminCapiEventViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsAdminUser]
    queryset = CapiEvent.objects.all()
    serializer_class = AdminCapiEventSerializer


class AdminColorViewSet(_AdminBase):
    queryset = ColorOption.objects.all()
    serializer_class = AdminColorSerializer


class AdminToppingViewSet(_AdminBase):
    queryset = ToppingDesign.objects.all()
    serializer_class = AdminToppingSerializer


class AdminInsideViewSet(_AdminBase):
    queryset = InsideDesign.objects.all()
    serializer_class = AdminInsideSerializer


class AdminStaticViewSet(_AdminBase):
    queryset = StaticDesign.objects.all()
    serializer_class = AdminStaticSerializer


class AdminDupattaViewSet(_AdminBase):
    queryset = DupattaOption.objects.all()
    serializer_class = AdminDupattaSerializer


class AdminConfigImageSerializer(serializers.ModelSerializer):
    class Meta:
        model = ConfigurationImage
        fields = ["id", "product", "color", "corner", "center", "image", "active"]


class AdminConfigImageViewSet(_AdminBase):
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
    queryset = PrebuiltCombo.objects.all().prefetch_related("images", "products")
    serializer_class = AdminComboSerializer


class AdminComboImageViewSet(_AdminBase):
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

class ExtraConsignmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = ExtraConsignment
        fields = ["id", "invoice", "consignment_id", "tracking_code", "status",
                  "cod_amount", "recipient_name", "recipient_phone",
                  "recipient_address", "item_description", "created_at"]


class AdminOrderSerializer(serializers.ModelSerializer):
    items = CartItemSerializer(many=True, read_only=True)
    total = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    full_address = serializers.CharField(read_only=True)
    profit = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)
    extra_consignments = ExtraConsignmentSerializer(many=True, read_only=True)

    class Meta:
        model = Order
        fields = [
            "id", "uid", "customer_name", "phone", "whatsapp", "email",
            "division", "district", "thana", "address", "full_address",
            "is_repeat_customer",
            "subtotal", "delivery_charge", "total",
            "advance_required", "advance_amount", "advance_received", "cod_amount",
            "cost_price", "profit",
            "payment_method", "transaction_id", "payment_screenshot", "payment_verified",
            "fraud_check_result",
            "steadfast_consignment_id", "steadfast_tracking_code", "steadfast_status",
            "courier_submitted", "status", "status_display", "created_at",
            "items", "extra_consignments",
        ]
        read_only_fields = fields


class AdminOrderViewSet(mixins.DestroyModelMixin, viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsAdminUser]
    serializer_class = AdminOrderSerializer
    queryset = Order.objects.all().prefetch_related("items")

    # Only orders with no money/courier history may be hard-deleted; anything
    # further along must be cancelled instead (keeps the audit trail).
    DELETABLE_STATUSES = {Order.Status.PENDING_PAYMENT, Order.Status.CANCELLED}

    def get_queryset(self):
        from django.db.models import Q

        qs = super().get_queryset()
        st = self.request.query_params.get("status")
        if st:
            qs = qs.filter(status=st)
        q = (self.request.query_params.get("q") or "").strip()
        if q:
            qs = qs.filter(
                Q(uid__icontains=q)
                | Q(customer_name__icontains=q)
                | Q(phone__icontains=q)
                | Q(whatsapp__icontains=q)
                | Q(email__icontains=q)
            )
        return qs

    def destroy(self, request, *args, **kwargs):
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
        notifications.notify_order_status(order)
        return Response(self.get_serializer(order).data)

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
        if "cost_price" in d:
            v = d.get("cost_price")
            order.cost_price = dec(v) if v not in (None, "") else None

        # Replace line items only for fully manual (admin-entered) orders.
        items = d.get("items")
        existing = list(order.items.all())
        all_manual = bool(existing) and all((it.config or {}).get("manual") for it in existing)
        if items is not None and all_manual:
            order.items.all().delete()
            subtotal = Decimal("0")
            for it in items:
                title = str(it.get("title", "")).strip()
                if not title:
                    continue
                price = dec(it.get("price"))
                subtotal += price
                CartItem.objects.create(
                    order=order, session_key="admin",
                    config={"title": title, "manual": True}, price_snapshot=price,
                )
            order.subtotal = subtotal

        order.cod_amount = order.compute_cod()
        order.is_repeat_customer = (
            Order.objects.filter(phone=order.phone).exclude(pk=order.pk).exists()
            if order.phone else False
        )
        order.save()
        return Response(self.get_serializer(order).data)

    @action(detail=True, methods=["post"])
    def steadfast_status(self, request, pk=None):
        """Refresh this order's Steadfast delivery status."""
        from .services.steadfast_order import SteadfastError, get_status
        order = self.get_object()
        if not order.steadfast_consignment_id:
            return Response({"error": "No consignment booked yet"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            st = get_status(order)
        except SteadfastError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
        order.steadfast_status = st
        order.save(update_fields=["steadfast_status", "updated_at"])
        return Response(self.get_serializer(order).data)

    @action(detail=True, methods=["post"])
    def resubmit_steadfast(self, request, pk=None):
        """Re-book the consignment on Steadfast (after a failed/unknown submit).
        Uses a fresh unique invoice so Steadfast doesn't reject it as a duplicate."""
        from .services.steadfast_order import SteadfastError, create_consignment
        order = self.get_object()
        invoice = f"{order.uid}-{timezone.now().strftime('%H%M%S')}"
        try:
            res = create_consignment(order, invoice=invoice)
        except SteadfastError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
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
            return Response({"error": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)

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

    @action(detail=True, methods=["post"])
    def edit_config(self, request, pk=None):
        """Edit the customer-submitted TEXT in one order item's config: field answer
        values, the special-instruction note, and combo line values. Option
        selections (color/design/dupatta) and the price snapshot are left untouched,
        so no re-pricing is needed. Values capped at 200 chars, matching cart_add."""
        order = self.get_object()
        item = order.items.filter(pk=request.data.get("item_id")).first()
        if not item:
            return Response({"error": "Item not found in this order"},
                            status=status.HTTP_404_NOT_FOUND)
        cfg = dict(item.config or {})

        def cap(v):
            return str(v or "").strip()[:200]

        # Field answers: labels stay snapshotted, only values change (positional).
        incoming_fields = request.data.get("fields")
        if isinstance(incoming_fields, list) and isinstance(cfg.get("fields"), list):
            for existing, incoming in zip(cfg["fields"], incoming_fields):
                if isinstance(incoming, dict) and "value" in incoming:
                    existing["value"] = cap(incoming.get("value"))

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
            result = create_consignment(order)
        except SteadfastError as exc:
            return Response({"error": f"Steadfast booking failed: {exc}"},
                            status=status.HTTP_502_BAD_GATEWAY)

        order.steadfast_consignment_id = result["consignment_id"]
        order.steadfast_tracking_code = result["tracking_code"]
        order.steadfast_status = result["status"]
        order.courier_submitted = True
        order.status = Order.Status.CONFIRMED
        order.save()
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


class AdminCustomRequestViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAdminUser]
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
@permission_classes([IsAdminUser])
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
@permission_classes([IsAdminUser])
def admin_dashboard(request):
    from django.db.models import F, Sum

    today = timezone.localdate()
    recent = Order.objects.all()[:10]

    live = Order.objects.exclude(status=Order.Status.CANCELLED)
    profit_agg = live.exclude(cost_price__isnull=True).aggregate(
        p=Sum(F("subtotal") - F("cost_price"))
    )
    total_profit = float(profit_agg["p"] or 0)
    uncosted_count = live.filter(cost_price__isnull=True).count()

    from .models import DailyStat
    stat = DailyStat.objects.filter(date=today).first()

    return Response({
        "orders_today": Order.objects.filter(created_at__date=today).count(),
        "pending_payment": Order.objects.filter(
            payment_verified=False, status=Order.Status.PENDING_PAYMENT,
        ).exclude(transaction_id="").count(),
        "pending_custom": CustomOrderRequest.objects.filter(
            status=CustomOrderRequest.Status.PENDING,
        ).count(),
        "total_orders": Order.objects.count(),
        "total_profit": total_profit,
        "uncosted_count": uncosted_count,
        "recent_orders": AdminOrderSerializer(
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


class AdminGalleryPhotoViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAdminUser]
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


class AdminGalleryTagViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAdminUser]
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


class AdminChatSessionViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsAdminUser]
    serializer_class = ChatSessionSerializer
    queryset = ChatSession.objects.all()

    def get_queryset(self):
        qs = super().get_queryset()
        st = self.request.query_params.get("status")
        if st:
            qs = qs.filter(status=st)
        return qs

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
@permission_classes([IsAdminUser])
def admin_bot_config(request):
    """Get or update the editable chatbot instructions (no restart needed)."""
    from .models import BotConfig
    cfg = BotConfig.get_solo()
    if request.method == "PUT":
        cfg.instructions = request.data.get("instructions", "")
        cfg.save(update_fields=["instructions", "updated_at"])
    return Response({"instructions": cfg.instructions, "updated_at": cfg.updated_at})


@api_view(["GET"])
@permission_classes([IsAdminUser])
def admin_chat_unread(request):
    """Count of sessions needing attention (for badge + sound polling)."""
    waiting = ChatSession.objects.filter(status=ChatSession.Status.WAITING_ADMIN).count()
    unread = ChatMessage.objects.filter(
        role=ChatMessage.Role.CUSTOMER, read_by_admin=False,
        session__status__in=[ChatSession.Status.WAITING_ADMIN, ChatSession.Status.ADMIN],
    ).count()
    new_orders = Order.objects.filter(admin_seen=False).count()
    return Response({"waiting": waiting, "unread": unread, "new_orders": new_orders})


@api_view(["GET"])
@permission_classes([IsAdminUser])
def admin_push_key(request):
    """Public VAPID key the browser needs to subscribe to Web Push."""
    return Response({"public_key": settings.WEBPUSH["VAPID_PUBLIC_KEY"]})


@api_view(["POST"])
@permission_classes([IsAdminUser])
def admin_push_subscribe(request):
    """Save (or refresh) a browser push subscription for admin alerts."""
    d = request.data or {}
    endpoint = d.get("endpoint")
    keys = d.get("keys") or {}
    p256dh, auth = keys.get("p256dh"), keys.get("auth")
    if not (endpoint and p256dh and auth):
        return Response({"error": "Invalid subscription"}, status=status.HTTP_400_BAD_REQUEST)
    PushSubscription.objects.update_or_create(
        endpoint=endpoint, defaults={"p256dh": p256dh, "auth": auth},
    )
    return Response({"ok": True})
