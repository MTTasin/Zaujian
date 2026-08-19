"""
DRF serializers for the storefront API. Read-only catalog + pricing.
Customer-facing text fields (names) hold Bengali strings as stored.
"""

from rest_framework import serializers

from .models import (
    CartItem,
    ChatMessage,
    ChatSession,
    ColorOption,
    ComboField,
    ComboImage,
    CustomOrderRequest,
    DupattaOption,
    GalleryPhoto,
    HomeCategory,
    InsideDesign,
    Order,
    PrebuiltCombo,
    Product,
    ProductField,
    ProductImage,
    ProductSpec,
    SiteSettings,
    StaticDesign,
    ToppingDesign,
)
from .services.pricing import price_bounds


class ColorOptionSerializer(serializers.ModelSerializer):
    class Meta:
        model = ColorOption
        fields = ["id", "name", "base_image", "price_modifier"]


class ToppingDesignSerializer(serializers.ModelSerializer):
    class Meta:
        model = ToppingDesign
        fields = ["id", "placement", "image", "pos_x", "pos_y", "scale", "price_modifier"]


class InsideDesignSerializer(serializers.ModelSerializer):
    class Meta:
        model = InsideDesign
        fields = ["id", "preview_image", "price_modifier"]


class StaticDesignSerializer(serializers.ModelSerializer):
    class Meta:
        model = StaticDesign
        fields = ["id", "image", "price_modifier"]


class DupattaOptionSerializer(serializers.ModelSerializer):
    class Meta:
        model = DupattaOption
        fields = ["id", "lace_type", "text_lines", "preview_image", "price"]


class ProductImageSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProductImage
        fields = ["id", "image", "alt", "order", "is_primary"]


class ProductSpecSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProductSpec
        fields = ["id", "label", "value", "order"]


class ProductFieldSerializer(serializers.ModelSerializer):
    """Admin-defined inputs the configurator asks the customer to fill in."""

    class Meta:
        model = ProductField
        fields = ["id", "label", "placeholder", "required", "order"]


class ComboFieldSerializer(serializers.ModelSerializer):
    """Same, for a prebuilt combo bought as-is."""

    class Meta:
        model = ComboField
        fields = ["id", "label", "placeholder", "required", "order"]


def _product_thumbnail(obj, request):
    """Prefer the catalog gallery; fall back to a configurator option image."""
    img = None
    pi = obj.images.first()  # ordered: primary, then order
    if pi is not None:
        img = pi.image
    else:
        candidate = (
            obj.colors.filter(active=True).first()
            or obj.static_designs.filter(active=True).first()
            or obj.dupatta_options.filter(active=True).first()
        )
        if candidate is not None:
            img = (
                getattr(candidate, "base_image", None)
                or getattr(candidate, "image", None)
                or getattr(candidate, "preview_image", None)
            )
    if not img:
        return None
    url = img.url
    return request.build_absolute_uri(url) if request else url


class _BoundsMixin:
    """`min_price` and `max_price` are two halves of one calculation.

    As two independent method fields they ran `price_bounds()` twice per product
    — up to three aggregate queries thrown away each time, on every catalogue
    read. Memoized per product per serialization pass.
    """

    def _bounds(self, obj):
        root = self.root
        cache = getattr(root, "_price_bounds", None)
        if cache is None:
            cache = {}
            root._price_bounds = cache
        if obj.pk not in cache:
            cache[obj.pk] = price_bounds(obj)
        return cache[obj.pk]

    def get_min_price(self, obj):
        return str(self._bounds(obj)[0])

    def get_max_price(self, obj):
        return str(self._bounds(obj)[1])


class ProductListSerializer(_BoundsMixin, serializers.ModelSerializer):
    thumbnail = serializers.SerializerMethodField()
    min_price = serializers.SerializerMethodField()
    max_price = serializers.SerializerMethodField()
    in_stock = serializers.SerializerMethodField()
    is_customizable = serializers.SerializerMethodField()

    class Meta:
        model = Product
        fields = [
            "id", "name", "slug", "kind", "category", "base_price",
            "exclusive_group", "customize_order",
            "compare_at_price", "allows_individual_purchase",
            "is_featured", "is_popular", "stock", "track_stock", "in_stock",
            "is_customizable", "thumbnail", "min_price", "max_price",
        ]

    def get_in_stock(self, obj):
        return obj.in_stock

    def get_is_customizable(self, obj):
        return obj.is_customizable

    def get_thumbnail(self, obj):
        return _product_thumbnail(obj, self.context.get("request"))


class ProductDetailSerializer(_BoundsMixin, serializers.ModelSerializer):
    """Full product payload: catalog gallery + info + configurator options."""

    images = ProductImageSerializer(many=True, read_only=True)
    specs = ProductSpecSerializer(many=True, read_only=True)
    input_fields = ProductFieldSerializer(many=True, read_only=True)
    colors = serializers.SerializerMethodField()
    toppings = serializers.SerializerMethodField()
    inside_designs = serializers.SerializerMethodField()
    static_designs = serializers.SerializerMethodField()
    dupatta_options = serializers.SerializerMethodField()
    config_images = serializers.SerializerMethodField()
    min_price = serializers.SerializerMethodField()
    max_price = serializers.SerializerMethodField()
    in_stock = serializers.SerializerMethodField()
    is_customizable = serializers.SerializerMethodField()
    thumbnail = serializers.SerializerMethodField()

    class Meta:
        model = Product
        fields = [
            "id", "name", "slug", "kind", "category", "description",
            "base_price", "compare_at_price", "preview_ratio",
            "exclusive_group", "customize_order",
            "allows_individual_purchase", "is_featured", "is_popular",
            "stock", "track_stock", "in_stock", "is_customizable",
            "thumbnail", "images", "specs", "input_fields", "min_price", "max_price",
            "colors", "toppings", "inside_designs", "static_designs", "dupatta_options",
            "config_images",
        ]

    def get_in_stock(self, obj):
        return obj.in_stock

    def get_is_customizable(self, obj):
        return obj.is_customizable

    def get_thumbnail(self, obj):
        return _product_thumbnail(obj, self.context.get("request"))

    def _active(self, qs):
        return qs.filter(active=True)

    def get_colors(self, obj):
        return ColorOptionSerializer(
            self._active(obj.colors), many=True, context=self.context
        ).data

    def get_toppings(self, obj):
        return ToppingDesignSerializer(
            self._active(obj.toppings), many=True, context=self.context
        ).data

    def get_inside_designs(self, obj):
        return InsideDesignSerializer(
            self._active(obj.inside_designs), many=True, context=self.context
        ).data

    def get_static_designs(self, obj):
        return StaticDesignSerializer(
            self._active(obj.static_designs), many=True, context=self.context
        ).data

    def get_dupatta_options(self, obj):
        return DupattaOptionSerializer(
            self._active(obj.dupatta_options), many=True, context=self.context
        ).data

    def get_config_images(self, obj):
        request = self.context.get("request")
        out = []
        for ci in obj.config_images.filter(active=True):
            url = ci.image.url
            out.append({
                "color": ci.color_id,
                "corner": ci.corner_id,
                "center": ci.center_id,
                "image": request.build_absolute_uri(url) if request else url,
            })
        return out


# --------------------------------------------------------------------------- #
# Cart / orders / custom requests
# --------------------------------------------------------------------------- #

class Lookup:
    """Memo for one serialization pass.

    A snapshot repeats itself: every line of a combo names the same product,
    every item of an order names the same combo, and `config_display` and
    `preview_image` ask for the very same colour row one after the other.
    Without this, each repeat is its own query — a single combo line measured 20.
    Scoped to one serializer instance, so nothing is ever carried between
    requests and a row edited mid-request is still re-read by the next one.
    """

    def __init__(self):
        self._memo = {}

    def get(self, key, build):
        if key not in self._memo:
            self._memo[key] = build()
        return self._memo[key]

    def product(self, pk):
        return self.get(("product", pk), lambda: Product.objects.filter(pk=pk).first())

    def option(self, product, manager, option_id):
        """One option row, from a per-(product, manager) index.

        Reads the product's whole option table for that manager in ONE query and
        keeps it keyed by pk. A layered line asks for corner and center out of the
        same `toppings` table, and an order asks for the same product's colour
        over and over — as single-row lookups that is a query apiece. Option
        tables are small (a handful of colours, a handful of designs), so holding
        one in memory is cheaper than the round trips it replaces.
        """
        rows = self.get(
            ("options", product.pk, manager),
            lambda: {row.pk: row for row in getattr(product, manager).all()},
        )
        return rows.get(option_id)


def _resolve_preview(item, lookup=None):
    """Pick a representative image URL for a cart item from its config ids."""
    lookup = lookup or Lookup()
    cfg = item.config or {}
    p = item.product
    if item.combo_id:
        first = lookup.get(("combo_image", item.combo_id),
                           lambda: item.combo.images.first())
        return first.image.url if first else None
    if p is None:
        return None
    # book/box -> the real photo of this exact colour+corner+center combo when one
    # exists (so the cart shows what the customer actually configured), else the
    # plain colour base image.
    if "color" in cfg:
        color_id = cfg["color"].get("id")
        corner_id = (cfg.get("corner") or {}).get("id")
        center_id = (cfg.get("center") or {}).get("id")
        combo = lookup.get(
            ("config_image", p.pk, color_id, corner_id, center_id),
            lambda: p.config_images.filter(
                active=True, color_id=color_id,
                corner_id=corner_id, center_id=center_id,
            ).first(),
        )
        if combo and combo.image:
            return combo.image.url
        obj = _option_row(p, "colors", color_id, lookup)
        if obj and obj.base_image:
            return obj.base_image.url
    if "static" in cfg:
        obj = _option_row(p, "static_designs", cfg["static"].get("id"), lookup)
        if obj and obj.image:
            return obj.image.url
    if "dupatta" in cfg:
        obj = _option_row(p, "dupatta_options", cfg["dupatta"].get("id"), lookup)
        if obj and obj.preview_image:
            return obj.preview_image.url
    # Plain/as-is product (or any config with no matching option image) -> fall
    # back to the catalog gallery (primary first, per ProductImage ordering).
    pi = lookup.get(("primary_image", p.pk), lambda: p.images.first())
    if pi and pi.image:
        return pi.image.url
    return None


def _option_row(product, manager, option_id, lookup=None):
    """One option row (colour, topping, design…), memoized. None when absent."""
    if product is None or not option_id:
        return None
    lookup = lookup or Lookup()
    return lookup.option(product, manager, option_id)


# kind -> (related manager on Product, image field on the option).
# Single source of truth for turning a snapshotted option id back into a photo.
_OPTION_SOURCES = {
    "color": ("colors", "base_image"),
    "corner": ("toppings", "image"),
    "center": ("toppings", "image"),
    "inside": ("inside_designs", "preview_image"),
    "static": ("static_designs", "image"),
}

# Bengali label -> kind, for orders placed before ids were snapshotted.
_LEGACY_LABEL_KINDS = {
    "রং": "color",
    "কোণার ডিজাইন": "corner",
    "মাঝের ডিজাইন": "center",
    "ভেতরের পাতা": "inside",
    "ডিজাইন": "static",
}


def _option_image(product, kind, option_id, lookup=None):
    """The image URL for one chosen option, or None. Never raises."""
    source = _OPTION_SOURCES.get(kind)
    if not source or not option_id or product is None:
        return None
    manager, image_field = source
    obj = _option_row(product, manager, option_id, lookup)
    image = getattr(obj, image_field, None) if obj else None
    return image.url if image else None


def _preset_lines(product, cfg, lookup=None):
    """Label/value lines for one product's preset config, names resolved NOW.

    Snapshotting the names (not just ids) means renaming an option later never
    rewrites a placed order — same guarantee as the price snapshot. The ids ride
    along so the admin can be shown the actual photo; they are only ever used to
    look up an image, never to re-derive the displayed text.
    """
    lines = []

    def add(kind, label, value, option_id):
        lines.append({
            "label": label, "value": value,
            "product_id": product.id, "option_kind": kind, "option_id": option_id,
        })

    # Each option is checked against the product's own table, read once per table
    # (see Lookup.option) instead of one `.exists()` per option — this runs inside
    # the add-to-cart POST, and a combo asks for every product it links.
    lookup = lookup or Lookup()
    if "color" in cfg:
        obj = _option_row(product, "colors", cfg["color"].get("id"), lookup)
        if obj:
            add("color", "রং", obj.name, obj.id)
    if "corner" in cfg and _option_row(product, "toppings", cfg["corner"].get("id"), lookup):
        add("corner", "কোণার ডিজাইন", "নির্বাচিত", cfg["corner"].get("id"))
    if "center" in cfg and _option_row(product, "toppings", cfg["center"].get("id"), lookup):
        add("center", "মাঝের ডিজাইন", "নির্বাচিত", cfg["center"].get("id"))
    if "inside" in cfg and _option_row(product, "inside_designs", cfg["inside"].get("id"), lookup):
        add("inside", "ভেতরের পাতা", "নির্বাচিত", cfg["inside"].get("id"))
    if "static" in cfg and _option_row(product, "static_designs", cfg["static"].get("id"), lookup):
        add("static", "ডিজাইন", "নির্বাচিত", cfg["static"].get("id"))
    if "dupatta" in cfg:
        d = cfg["dupatta"]
        lace = "সিঙ্গেল লেইস" if d.get("lace_type") == "single" else "চার লেইস"
        lines.append({"label": "ওড়না", "value": f"{lace}, {d.get('text_lines', 0)} লাইন"})
    for field in cfg.get("fields") or []:
        lines.append({"label": field.get("label", ""), "value": field.get("value", "")})
    return lines


def combo_preset_snapshot(combo):
    """A combo's pictured design, resolved for snapshotting into a cart item."""
    cfg = combo.preset_config or {}
    out = []
    lookup = Lookup()
    for p in combo.products.filter(active=True):
        entry = cfg.get(str(p.id))
        if not entry:
            continue
        lines = _preset_lines(p, entry, lookup)
        if lines:
            out.append({"product": p.name, "lines": lines})
    return out


def _combo_line_image(item, product_name, line, lookup=None):
    """Image URL for one snapshotted combo line, or None. Never raises.

    New orders carry the ids inline. Orders placed before that re-read the live
    `PrebuiltCombo.preset_config` as a best-effort recovery — if the combo was
    edited or deleted since, the line simply renders without a photo, exactly as
    it did before this lookup existed.
    """
    kind = line.get("option_kind")
    option_id = line.get("option_id")
    product_id = line.get("product_id")

    lookup = lookup or Lookup()

    if kind and option_id and product_id:
        return _option_image(lookup.product(product_id), kind, option_id, lookup)

    kind = _LEGACY_LABEL_KINDS.get(line.get("label", ""))
    if not kind or not item.combo_id:
        return None
    by_name = lookup.get(
        ("combo_products_by_name", item.combo_id),
        lambda: {p.name: p for p in item.combo.products.all()},
    )
    product = by_name.get(product_name)
    if product is None:
        return None
    entry = (item.combo.preset_config or {}).get(str(product.id)) or {}
    return _option_image(product, kind, (entry.get(kind) or {}).get("id"), lookup)


def _config_display(item, request, lookup=None):
    """Human-readable summary of a cart item's config (Bengali labels)."""
    lookup = lookup or Lookup()
    cfg = item.config or {}
    p = item.product
    if item.is_custom_request:
        return [{"label": "কাস্টম ডিজাইন", "value": "দাম পরে জানানো হবে", "image": None}]
    def abs_url(url):
        if not url:
            return None
        return request.build_absolute_uri(url) if request else url

    if item.combo_id or p is None:
        # Combo bought as-is: the pictured design + the customer's own answers,
        # both snapshotted at add time.
        out = []
        for it in (cfg.get("combo_items") or []):
            name = it.get("product", "")
            for ln in it.get("lines") or []:
                label = f"{name} — {ln.get('label', '')}" if name else ln.get("label", "")
                out.append({
                    "label": label, "value": ln.get("value", ""),
                    "image": abs_url(_combo_line_image(item, name, ln, lookup)),
                })
        for field in cfg.get("fields") or []:
            out.append({
                "label": field.get("label", ""), "value": field.get("value", ""), "image": None,
            })
        if cfg.get("note"):
            out.append({"label": "বিশেষ নির্দেশনা", "value": cfg["note"], "image": None})
        return out

    lines = []
    if "color" in cfg:
        obj = _option_row(p, "colors", cfg["color"].get("id"), lookup)
        lines.append({"label": "রং", "value": cfg["color"].get("name") or (obj.name if obj else ""),
                      "image": abs_url(obj.base_image.url) if obj and obj.base_image else None})
    if "corner" in cfg:
        obj = _option_row(p, "toppings", cfg["corner"].get("id"), lookup)
        lines.append({"label": "কোণার ডিজাইন", "value": "নির্বাচিত",
                      "image": abs_url(obj.image.url) if obj and obj.image else None})
    if "center" in cfg:
        obj = _option_row(p, "toppings", cfg["center"].get("id"), lookup)
        lines.append({"label": "মাঝের ডিজাইন", "value": "নির্বাচিত",
                      "image": abs_url(obj.image.url) if obj and obj.image else None})
    if "inside" in cfg:
        obj = _option_row(p, "inside_designs", cfg["inside"].get("id"), lookup)
        lines.append({"label": "ভেতরের পাতা", "value": "নির্বাচিত",
                      "image": abs_url(obj.preview_image.url) if obj and obj.preview_image else None})
    if "static" in cfg:
        obj = _option_row(p, "static_designs", cfg["static"].get("id"), lookup)
        lines.append({"label": "ডিজাইন", "value": "নির্বাচিত",
                      "image": abs_url(obj.image.url) if obj and obj.image else None})
    if "dupatta" in cfg:
        d = cfg["dupatta"]
        lace = "সিঙ্গেল লেইস" if d.get("lace_type") == "single" else "চার লেইস"
        lines.append({"label": "ওড়না", "value": f"{lace}, {d.get('text_lines', 0)} লাইন", "image": None})
    # Customer-typed answers + optional note (labels are snapshotted with the value).
    for field in cfg.get("fields") or []:
        lines.append({
            "label": field.get("label", ""), "value": field.get("value", ""), "image": None,
        })
    if cfg.get("note"):
        lines.append({"label": "বিশেষ নির্দেশনা", "value": cfg["note"], "image": None})
    return lines


class CartItemSerializer(serializers.ModelSerializer):
    product_name = serializers.SerializerMethodField()
    product_slug = serializers.SerializerMethodField()
    category = serializers.SerializerMethodField()
    preview_image = serializers.SerializerMethodField()
    config_display = serializers.SerializerMethodField()
    contents = serializers.SerializerMethodField()

    class Meta:
        model = CartItem
        fields = [
            "id", "product", "combo", "product_name", "product_slug", "category",
            "config", "config_display", "contents", "price_snapshot",
            "is_custom_request", "preview_image",
        ]
        read_only_fields = ["price_snapshot", "config"]

    @property
    def _lookup(self):
        """One memo per serialization pass, hung off the ROOT serializer.

        An order's items are all snapshots of the same few products, so the memo
        has to outlive a single item — but it must not outlive the request, which
        is why it lives on the serializer and not in the context dict the caller
        owns (or, worse, a module global).
        """
        root = self.root
        lookup = getattr(root, "_option_lookup", None)
        if lookup is None:
            lookup = Lookup()
            root._option_lookup = lookup
        return lookup

    def get_contents(self, obj):
        """What a listing line actually contains — the line's own name is just
        "মেরুন কম্বো", which does not say what is going in the box.

        Two independent answers, because neither alone is complete: the combo's
        `description` is the authoritative contents the shop wrote (it names
        things like বরমালা that are not Products at all), and `products` is what
        the customizer links (which is what the customer configured). They are
        labelled separately rather than merged, so nothing is implied that the
        data does not actually say.
        """
        if not obj.combo_id:
            return None
        combo = obj.combo
        names = self._lookup.get(
            ("combo_product_names", combo.pk),
            lambda: [p.name for p in combo.products.all()],
        )
        return {"description": combo.description or "", "products": names}

    def get_config_display(self, obj):
        return _config_display(obj, self.context.get("request"), self._lookup)

    def get_product_name(self, obj):
        # An admin-entered line carries its own label, and it wins even when the
        # line is linked to a listing/product — the owner may have written what
        # the customer actually asked for on WhatsApp. Website lines never set it.
        title = (obj.config or {}).get("title", "")
        if title:
            return title
        if obj.product:
            return obj.product.name
        if obj.combo:
            return obj.combo.name
        return ""

    def get_product_slug(self, obj):
        if obj.product:
            return obj.product.slug
        return obj.combo.slug if obj.combo else ""

    def get_category(self, obj):
        return obj.product.category if obj.product else "combo"

    def get_preview_image(self, obj):
        url = _resolve_preview(obj, self._lookup)
        request = self.context.get("request")
        if not url:
            return None
        return request.build_absolute_uri(url) if request else url


class OrderItemSerializer(CartItemSerializer):
    pass


class OrderSerializer(serializers.ModelSerializer):
    items = CartItemSerializer(many=True, read_only=True)
    total = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)
    full_address = serializers.CharField(read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = Order
        # Customer-facing: uid only, never the numeric id.
        fields = [
            "uid", "customer_name", "phone", "whatsapp", "email",
            "division", "district", "thana", "address", "full_address",
            "subtotal", "delivery_charge", "total",
            "advance_required", "advance_amount", "is_repeat_customer",
            "payment_method", "transaction_id", "payment_screenshot",
            "steadfast_tracking_code", "steadfast_status",
            "status", "status_display", "created_at", "items",
        ]
        read_only_fields = fields


class CustomOrderRequestSerializer(serializers.ModelSerializer):
    class Meta:
        model = CustomOrderRequest
        fields = ["id", "customer_name", "phone", "description", "status", "created_at"]
        read_only_fields = ["status", "created_at"]


# --------------------------------------------------------------------------- #
# Prebuilt combos
# --------------------------------------------------------------------------- #

class ComboImageSerializer(serializers.ModelSerializer):
    class Meta:
        model = ComboImage
        fields = ["id", "image", "order"]


class ComboListSerializer(serializers.ModelSerializer):
    thumbnail = serializers.SerializerMethodField()

    class Meta:
        model = PrebuiltCombo
        fields = ["id", "name", "slug", "category", "price", "featured", "thumbnail"]

    def get_thumbnail(self, obj):
        first = obj.images.first()
        if not first:
            return None
        request = self.context.get("request")
        url = first.image.url
        return request.build_absolute_uri(url) if request else url


class ComboDetailSerializer(serializers.ModelSerializer):
    images = ComboImageSerializer(many=True, read_only=True)
    product_slugs = serializers.SerializerMethodField()
    preset_by_slug = serializers.SerializerMethodField()
    input_fields = ComboFieldSerializer(many=True, read_only=True)

    class Meta:
        model = PrebuiltCombo
        fields = [
            "id", "name", "slug", "category", "description", "price", "images",
            "product_slugs", "preset_by_slug", "input_fields",
        ]

    def get_product_slugs(self, obj):
        return list(obj.products.filter(active=True).values_list("slug", flat=True))

    def get_preset_by_slug(self, obj):
        """The pictured design keyed by product slug — seeds the customize wizard."""
        cfg = obj.preset_config or {}
        out = {}
        for p in obj.products.filter(active=True):
            entry = cfg.get(str(p.id))
            if entry:
                out[p.slug] = entry
        return out


# --------------------------------------------------------------------------- #
# Gallery
# --------------------------------------------------------------------------- #

class GalleryPhotoSerializer(serializers.ModelSerializer):
    thumb = serializers.SerializerMethodField()
    full = serializers.SerializerMethodField()

    class Meta:
        model = GalleryPhoto
        fields = ["id", "thumb", "full", "caption", "alt"]

    def _url(self, f):
        if not f:
            return ""
        request = self.context.get("request")
        return request.build_absolute_uri(f.url) if request else f.url

    def get_thumb(self, obj):
        return self._url(obj.thumbnail or obj.display or obj.image)

    def get_full(self, obj):
        return self._url(obj.display or obj.image)


# --------------------------------------------------------------------------- #
# Chat
# --------------------------------------------------------------------------- #

class ChatMessageSerializer(serializers.ModelSerializer):
    upload = serializers.SerializerMethodField()

    class Meta:
        model = ChatMessage
        fields = ["id", "role", "text", "image", "images", "more_count",
                  "album_url", "upload", "created_at"]

    def get_upload(self, obj):
        if not obj.upload:
            return ""
        request = self.context.get("request")
        return request.build_absolute_uri(obj.upload.url) if request else obj.upload.url


class ChatSessionSerializer(serializers.ModelSerializer):
    last_message = serializers.SerializerMethodField()
    unread = serializers.SerializerMethodField()

    class Meta:
        model = ChatSession
        fields = ["id", "customer_name", "phone", "status", "created_at", "updated_at",
                  "last_message", "unread"]

    # Both fields are annotated by the list view (see AdminChatSessionViewSet):
    # the list is POLLED, so a query per session per field is a query per session
    # every few seconds, forever. The per-row fallback stays for the single-object
    # responses (`reply`, `set_status`), which carry no annotation.
    def get_last_message(self, obj):
        if hasattr(obj, "last_text"):
            return (obj.last_text or "")[:80]
        m = obj.messages.last()
        return m.text[:80] if m else ""

    def get_unread(self, obj):
        if hasattr(obj, "unread_count"):
            return obj.unread_count
        return obj.messages.filter(role=ChatMessage.Role.CUSTOMER, read_by_admin=False).count()


# --------------------------------------------------------------------------- #
# Homepage content
# --------------------------------------------------------------------------- #

class SiteSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = SiteSettings
        fields = ["hero_image", "hero_title", "hero_subtitle", "band_image"]


class HomeCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = HomeCategory
        fields = ["id", "title", "image", "link", "order"]
