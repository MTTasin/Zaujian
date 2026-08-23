"""
Data models for Zaujain Nikah Point.

All money is Decimal, never float. Customer-facing labels are Bengali (stored
as text). Admin labels/help are English. See CLAUDE.md and plan §4, §15.
"""

from decimal import Decimal

from django.db import models
from django.utils import timezone


# --------------------------------------------------------------------------- #
# Catalog
# --------------------------------------------------------------------------- #

class Product(models.Model):
    # Legacy 5-type list, kept for reference/backfill only.
    class Category(models.TextChoices):
        BOOK = "book", "Book"
        BOX = "box", "Box"
        PEN = "pen", "Pen"
        MIRROR = "mirror", "Mirror"
        DUPATTA = "dupatta", "Dupatta"

    # Behavior = which configurator + pricing rules apply. Drives everything.
    class Kind(models.TextChoices):
        LAYERED = "layered", "Layered (color + corner + center, e.g. book/box)"
        GALLERY = "gallery", "Gallery (pick one design, e.g. pen/mirror)"
        DUPATTA = "dupatta", "Dupatta (lace + lines lookup)"
        SIMPLE = "simple", "Simple (buy as-is or pick one design)"

    name = models.CharField(max_length=120, help_text="Bengali name shown to customer")
    slug = models.SlugField(max_length=140, unique=True)
    kind = models.CharField(
        max_length=20, choices=Kind.choices, default=Kind.SIMPLE,
        help_text="How this product is customized",
    )
    # Free-text merchandising label for grouping/filtering on the shop page.
    category = models.CharField(
        max_length=40, blank=True,
        help_text="Group label shown to customers, e.g. বই, আতর, তসবিহ",
    )
    exclusive_group = models.CharField(
        max_length=40, blank=True,
        help_text=(
            "Products sharing this group cannot be selected together in the "
            "configurator (e.g. 'nikahnama' on book, frame, thumb). Blank = no restriction."
        ),
    )
    customize_order = models.PositiveSmallIntegerField(
        default=0, help_text="Position in the /customize picker. Lower shows first.",
    )
    base_price = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0"))
    allows_individual_purchase = models.BooleanField(default=True)
    active = models.BooleanField(default=True)
    # Aspect ratio of the configurator preview (CSS aspect-ratio, "w / h").
    class PreviewRatio(models.TextChoices):
        SQUARE = "1 / 1", "Square"
        BOOK = "9 / 12", "Book (tall 9:12)"
        BOX = "12 / 10", "Box (wide 12:10)"
    preview_ratio = models.CharField(
        max_length=12, choices=PreviewRatio.choices, default=PreviewRatio.SQUARE,
        help_text="Shape of the live preview box",
    )

    # ---- E-commerce catalog fields ----
    # A Product is the unified sellable item. kind=simple => plain product;
    # other kinds => product that also offers the customization flow.
    description = models.TextField(blank=True, help_text="Detail-page description (Bengali)")
    compare_at_price = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True,
        help_text="Original price for a strike-through discount (optional)",
    )
    stock = models.PositiveIntegerField(default=0)
    track_stock = models.BooleanField(
        default=False, help_text="Enforce stock: block add-to-cart when 0",
    )
    low_stock_threshold = models.PositiveSmallIntegerField(default=3)
    is_featured = models.BooleanField(
        default=False, help_text="Show in Featured Products on the homepage",
    )
    is_popular = models.BooleanField(
        default=False, help_text="Show in Popular Products on the homepage",
    )
    home_order = models.PositiveSmallIntegerField(
        default=0, help_text="Ordering within homepage sections (lower first)",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["category", "name"]

    def __str__(self):
        return f"{self.name} ({self.kind})"

    @property
    def is_layered(self):
        return self.kind == self.Kind.LAYERED

    @property
    def is_customizable(self):
        """Whether this product offers the configurator (not a plain item)."""
        return self.kind != self.Kind.SIMPLE or self.dupatta_options.exists()

    @property
    def in_stock(self):
        return (not self.track_stock) or self.stock > 0


class ProductImage(models.Model):
    """General catalog photo gallery for a product (distinct from configurator overlays)."""

    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="images")
    image = models.ImageField(upload_to="products/")
    alt = models.CharField(max_length=140, blank=True)
    order = models.PositiveSmallIntegerField(default=0)
    is_primary = models.BooleanField(default=False)

    class Meta:
        ordering = ["-is_primary", "order", "id"]

    def __str__(self):
        return f"Image for {self.product.name} #{self.pk}"


class ProductSpec(models.Model):
    """A label/value detail row shown on the product page (admin-editable)."""

    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="specs")
    label = models.CharField(max_length=80, help_text="e.g. উপকরণ, সাইজ, যা যা থাকছে")
    value = models.CharField(max_length=300)
    order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["order", "id"]

    def __str__(self):
        return f"{self.product.name}: {self.label}"


class ProductField(models.Model):
    """An admin-defined input the configurator asks the customer to fill in.

    e.g. label="বরের নাম" / "এখানে কি বসবে?". Single-line text only.
    Answers are snapshotted into CartItem.config["fields"] as {label, value}.
    """

    product = models.ForeignKey(
        Product, on_delete=models.CASCADE, related_name="input_fields",
    )
    label = models.CharField(
        max_length=120, help_text="Shown to the customer, e.g. বরের নাম / এখানে কি বসবে?",
    )
    placeholder = models.CharField(max_length=120, blank=True, help_text="Optional hint")
    required = models.BooleanField(
        default=True, help_text="Required fields block the confirm button",
    )
    order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["order", "id"]

    def __str__(self):
        return f"{self.product.name}: {self.label}"


class ColorOption(models.Model):
    """Base color of a layered item (book/box). Full plain image, no design."""

    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="colors")
    name = models.CharField(max_length=80, help_text="e.g. maroon, ivory, black (Bengali)")
    base_image = models.ImageField(upload_to="colors/", help_text="Plain item in this color")
    price_modifier = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0"))
    active = models.BooleanField(default=True)

    class Meta:
        ordering = ["product", "name"]

    def __str__(self):
        return f"{self.product.name} / {self.name}"


class ToppingDesign(models.Model):
    """Transparent PNG overlay (corner or center) placed over a base color image."""

    class Placement(models.TextChoices):
        CORNER = "corner", "Corner"
        CENTER = "center", "Center"

    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="toppings")
    placement = models.CharField(max_length=10, choices=Placement.choices)
    image = models.ImageField(upload_to="toppings/", help_text="Transparent PNG overlay")
    # Position data so the overlay lines up over each base image.
    pos_x = models.FloatField(default=0, help_text="X offset (px or %) on the base image")
    pos_y = models.FloatField(default=0, help_text="Y offset (px or %) on the base image")
    scale = models.FloatField(default=1.0, help_text="Scale factor for the overlay")
    price_modifier = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0"))
    active = models.BooleanField(default=True)

    class Meta:
        ordering = ["product", "placement"]

    def __str__(self):
        return f"{self.product.name} / {self.get_placement_display()} #{self.pk}"


class InsideDesign(models.Model):
    """Book-only inside page design, chosen from a standalone gallery (not layered)."""

    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="inside_designs")
    preview_image = models.ImageField(upload_to="inside/")
    price_modifier = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0"))
    active = models.BooleanField(default=True)

    def __str__(self):
        return f"{self.product.name} inside #{self.pk}"


class StaticDesign(models.Model):
    """Finished single-image design for simple products (pen, mirror). No layering."""

    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="static_designs")
    image = models.ImageField(upload_to="static_designs/")
    price_modifier = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0"))
    active = models.BooleanField(default=True)

    def __str__(self):
        return f"{self.product.name} design #{self.pk}"


class ConfigurationImage(models.Model):
    """
    A real photo of a specific layered combination (color + corner + center).
    When the customer's cover selection matches, this photo is shown instead of
    the stacked overlays. Blank corner/center = "any". Best match wins.
    """

    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="config_images")
    color = models.ForeignKey(ColorOption, on_delete=models.CASCADE, null=True, blank=True)
    corner = models.ForeignKey(
        ToppingDesign, on_delete=models.CASCADE, null=True, blank=True,
        related_name="config_images_corner",
    )
    center = models.ForeignKey(
        ToppingDesign, on_delete=models.CASCADE, null=True, blank=True,
        related_name="config_images_center",
    )
    image = models.ImageField(upload_to="config_images/")
    active = models.BooleanField(default=True)

    def __str__(self):
        return f"{self.product.name} config image #{self.pk}"


class DupattaOption(models.Model):
    """Dupatta uses direct-lookup pricing per exact lace/line combination."""

    class LaceType(models.TextChoices):
        SINGLE = "single", "Single lace"
        FOUR = "four", "Four lace"

    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="dupatta_options")
    lace_type = models.CharField(max_length=10, choices=LaceType.choices)
    text_lines = models.PositiveSmallIntegerField(default=0, help_text="Number of text lines")
    preview_image = models.ImageField(upload_to="dupatta/")
    price = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0"))
    active = models.BooleanField(default=True)

    class Meta:
        ordering = ["lace_type", "text_lines"]
        constraints = [
            models.UniqueConstraint(
                fields=["product", "lace_type", "text_lines"],
                name="unique_dupatta_combo",
            )
        ]

    def __str__(self):
        return f"Dupatta {self.get_lace_type_display()} / {self.text_lines} lines"


# --------------------------------------------------------------------------- #
# Prebuilt combos (ready-made bundles shown on landing / products page)
# --------------------------------------------------------------------------- #

class PrebuiltCombo(models.Model):
    """
    A ready-made bundle with a fixed price and one or more photos. Customers can
    buy it as-is or open the customizer preloaded with its items.
    """

    name = models.CharField(max_length=140, help_text="Bengali name shown to customer")
    slug = models.SlugField(max_length=160, unique=True)
    description = models.TextField(blank=True)
    price = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0"))
    # Free-text label shown on the card and used by the /products filter. A
    # listing with one linked product is a single item, not a bundle, so the card
    # must be able to say দুপাট্টা rather than কম্বো.
    category = models.CharField(
        max_length=60, blank=True,
        help_text="Shown on the card and used by the /products filter, e.g. দুপাট্টা",
    )
    # Which configurable products this combo maps to (for "make changes" preselect).
    products = models.ManyToManyField(Product, blank=True, related_name="combos")
    # The pictured design, per product: {"<product_id>": {"color": {"id": 7}, ...}}.
    # Same shape the customizer produces, so it seeds the wizard and snapshots into
    # the cart. Optional per product — missing entries fall back to defaults.
    preset_config = models.JSONField(default=dict, blank=True)
    featured = models.BooleanField(default=False, help_text="Show on the landing page")
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-featured", "name"]

    def __str__(self):
        return self.name


class ComboField(models.Model):
    """An admin-defined input the combo page asks the customer to fill in.

    Mirrors ProductField. The related_name is deliberately `input_fields` so the
    shared `_collect_inputs()` validator works for combos unchanged.
    """

    combo = models.ForeignKey(
        PrebuiltCombo, on_delete=models.CASCADE, related_name="input_fields",
    )
    label = models.CharField(
        max_length=120, help_text="Shown to the customer, e.g. বরের নাম / এখানে কি বসবে?",
    )
    placeholder = models.CharField(max_length=120, blank=True, help_text="Optional hint")
    required = models.BooleanField(
        default=True, help_text="Required fields block the add-to-cart button",
    )
    order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["order", "id"]

    def __str__(self):
        return f"{self.combo.name}: {self.label}"


class ComboImage(models.Model):
    combo = models.ForeignKey(PrebuiltCombo, on_delete=models.CASCADE, related_name="images")
    image = models.ImageField(upload_to="combos/")
    order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["order", "id"]

    def __str__(self):
        return f"Image for {self.combo.name}"


# --------------------------------------------------------------------------- #
# Cart
# --------------------------------------------------------------------------- #

class CartItem(models.Model):
    """
    One line in the cart: either a configured product OR a prebuilt combo.
    Selected options are snapshotted into `config` with a `price_snapshot` taken
    at add-time, so later admin price edits never mutate a placed line (§15.8).
    """

    session_key = models.CharField(max_length=64, blank=True, db_index=True)
    product = models.ForeignKey(
        Product, on_delete=models.PROTECT, related_name="cart_items",
        null=True, blank=True,
    )
    combo = models.ForeignKey(
        PrebuiltCombo, on_delete=models.PROTECT, related_name="cart_items",
        null=True, blank=True,
    )

    # Snapshot of chosen options, e.g.
    # {"color": {"id": 3, "name": "maroon"}, "corner": {"id": 7}, ...}
    config = models.JSONField(default=dict, blank=True)
    price_snapshot = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0"))

    is_custom_request = models.BooleanField(default=False)
    order = models.ForeignKey(
        "Order", on_delete=models.CASCADE, related_name="items",
        null=True, blank=True,
        help_text="Set once the cart item becomes part of a placed order",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        label = self.product.name if self.product else (self.combo.name if self.combo else "?")
        return f"CartItem {self.pk} - {label}"


# --------------------------------------------------------------------------- #
# Custom order requests
# --------------------------------------------------------------------------- #

class CustomOrderRequest(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending review"
        PRICED = "priced", "Priced"
        REJECTED = "rejected", "Rejected"

    cart_item = models.OneToOneField(
        CartItem, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="custom_request",
    )
    # Standalone requests (no configurator) capture contact directly.
    customer_name = models.CharField(max_length=120, blank=True)
    phone = models.CharField(max_length=20, blank=True)
    description = models.TextField(blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    admin_final_price = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True
    )
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"CustomRequest {self.pk} ({self.get_status_display()})"


class CustomOrderReferenceImage(models.Model):
    request = models.ForeignKey(
        CustomOrderRequest, on_delete=models.CASCADE, related_name="reference_images"
    )
    image = models.ImageField(upload_to="custom_requests/")

    def __str__(self):
        return f"Ref image for request {self.request_id}"


# --------------------------------------------------------------------------- #
# Orders
# --------------------------------------------------------------------------- #

class OrderTag(models.Model):
    """A free-form marking an admin puts on orders — "urgent", "gift wrap",
    "call before delivery", "photo pending".

    Deliberately its OWN table rather than a text field on the order: a tag has
    to be renameable in one place (rename it and every order follows) and
    searchable without matching a customer whose name happens to contain the
    word. Status stays a status; this is for everything the workflow does not
    model and never should.
    """

    # Preset swatches rather than a colour picker: the point is that a tag is
    # recognisable at a glance across a list, which needs few, distinct colours.
    class Colour(models.TextChoices):
        SLATE = "slate", "Grey"
        RED = "red", "Red"
        AMBER = "amber", "Amber"
        EMERALD = "emerald", "Green"
        BLUE = "blue", "Blue"
        VIOLET = "violet", "Violet"
        PLUM = "plum", "Plum"

    name = models.CharField(max_length=40, unique=True)
    colour = models.CharField(max_length=10, choices=Colour.choices, default=Colour.SLATE)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class Order(models.Model):
    class Status(models.TextChoices):
        # New website orders land here — an admin phones the customer, then
        # Confirm (fires the Meta Purchase) or Cancel. Nothing auto-confirms, so
        # a declined order never reaches Meta. advance_required just marks the
        # ones that must pay first; it is no longer its own status.
        IN_REVIEW = "in_review", "In review"
        PENDING_PAYMENT = "pending_payment", "Pending payment"
        CONFIRMED = "confirmed", "Confirmed"
        IN_PRODUCTION = "in_production", "In production"
        SHIPPED = "shipped", "Shipped"
        DELIVERED = "delivered", "Delivered"
        CANCELLED = "cancelled", "Cancelled"

    class PaymentMethod(models.TextChoices):
        BKASH = "bkash", "Manual bKash"
        NAGAD = "nagad", "Manual Nagad"

    # Public short code shown to customers instead of the numeric id.
    uid = models.CharField(max_length=8, unique=True, blank=True, db_index=True)

    # Customer
    customer_name = models.CharField(max_length=120)
    phone = models.CharField(max_length=20, db_index=True)
    whatsapp = models.CharField(max_length=20, blank=True, help_text="WhatsApp number for order confirmation call")
    email = models.EmailField(blank=True, help_text="For order/status notifications")
    # Structured BD address + free street line.
    division = models.CharField(max_length=40, blank=True)
    district = models.CharField(max_length=40, blank=True)
    thana = models.CharField(max_length=60, blank=True)
    address = models.TextField(help_text="Street / house / road")
    is_repeat_customer = models.BooleanField(default=False)

    # Money
    subtotal = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0"))
    delivery_charge = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0"))
    advance_required = models.BooleanField(default=False)
    advance_amount = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0"))
    advance_received = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0"))
    cod_amount = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0"))
    # No per-order costing: money is tracked business-wide in the Finance
    # cash-book (Expense/Income). Expenses may be *marked* against an order for
    # reference, but nothing is allocated back to it.

    # Manual payment
    payment_method = models.CharField(
        max_length=10, choices=PaymentMethod.choices, blank=True
    )
    transaction_id = models.CharField(max_length=64, blank=True)
    payment_screenshot = models.ImageField(upload_to="payments/", null=True, blank=True)
    payment_verified = models.BooleanField(default=False)

    # Fraud check (raw response stored for the record)
    fraud_check_result = models.JSONField(default=dict, blank=True)

    # Meta attribution captured at checkout, REPLAYED when the order is confirmed.
    # For COD we delay the Purchase to manual confirm (cancelled reviews never
    # reach Meta); storing fbp/fbc/ip/ua here keeps match quality high even though
    # the event fires later, server-side. See app/services/capi.fire_order_purchase.
    meta_fbp = models.CharField(max_length=128, blank=True)
    meta_fbc = models.CharField(max_length=255, blank=True)
    meta_source_url = models.CharField(max_length=500, blank=True)
    meta_client_ip = models.CharField(max_length=45, blank=True)
    meta_user_agent = models.TextField(blank=True)

    # Steadfast consignment (booked only on admin confirm)
    steadfast_consignment_id = models.CharField(max_length=64, blank=True)
    steadfast_tracking_code = models.CharField(max_length=64, blank=True)
    steadfast_status = models.CharField(max_length=32, blank=True)
    courier_submitted = models.BooleanField(default=False)
    # Steadfast no longer recognises `steadfast_consignment_id` — almost always
    # because it was deleted in their panel. Kept OUT of `steadfast_status`,
    # which holds their own delivery_status vocabulary and stays the record of
    # what last actually happened to the parcel. This is what re-enables the
    # panel's Re-submit button: without it a deleted parcel leaves a stale
    # status behind forever and the one button that fixes it stays greyed out.
    consignment_missing = models.BooleanField(default=False)

    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.PENDING_PAYMENT
    )
    # Admin-only markings. Removing a tag from the shop deletes the marking
    # everywhere, which is the intent — an M2M, so no order data is touched.
    tags = models.ManyToManyField(OrderTag, blank=True, related_name="orders")

    # False until an admin opens the Orders page — drives the "new orders" badge + sound.
    admin_seen = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"Order {self.uid or self.pk} - {self.customer_name}"

    @staticmethod
    def _gen_uid():
        import secrets
        alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no ambiguous chars
        return "".join(secrets.choice(alphabet) for _ in range(6))

    def save(self, *args, **kwargs):
        if not self.uid:
            uid = self._gen_uid()
            while Order.objects.filter(uid=uid).exists():
                uid = self._gen_uid()
            self.uid = uid
        super().save(*args, **kwargs)

    @property
    def total(self):
        return self.subtotal + self.delivery_charge

    @property
    def full_address(self):
        parts = [self.address, self.thana, self.district, self.division]
        return ", ".join(p for p in parts if p)

    def compute_cod(self):
        """COD = subtotal + delivery - advance received. Never negative."""
        cod = self.total - self.advance_received
        return cod if cod > 0 else Decimal("0")


class ExtraConsignment(models.Model):
    """An additional Steadfast booking for an order, beyond the primary one on Order."""

    order = models.ForeignKey(
        Order, on_delete=models.CASCADE, related_name="extra_consignments",
    )
    invoice = models.CharField(max_length=40)
    consignment_id = models.CharField(max_length=64, blank=True)
    tracking_code = models.CharField(max_length=64, blank=True)
    status = models.CharField(max_length=32, blank=True)
    # See Order.consignment_missing — same fact, per additional parcel.
    missing = models.BooleanField(default=False)
    cod_amount = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0"))
    recipient_name = models.CharField(max_length=100, blank=True)
    recipient_phone = models.CharField(max_length=20, blank=True)
    recipient_address = models.CharField(max_length=250, blank=True)
    item_description = models.CharField(max_length=250, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]

    def __str__(self):
        return f"Extra consignment {self.invoice} for order {self.order_id}"


class ConsignmentEvent(models.Model):
    """One push from Steadfast's webhook — a status change or a tracking message.

    Their API can only be POLLED for a single status string, so the timeline the
    merchant panel shows ("received at AMBARKHANA", "assigned to rider") exists
    nowhere we can fetch: it only arrives here, once, as it happens. Hence the
    table — append-only history per parcel, never a source of truth for money or
    order state (the webhook writes those onto Order/ExtraConsignment as usual).
    A parcel can be the order's primary consignment (`extra` blank) or one of the
    additional ones.
    """

    class Kind(models.TextChoices):
        DELIVERY_STATUS = "delivery_status", "Delivery status update"
        TRACKING_UPDATE = "tracking_update", "Tracking update"

    order = models.ForeignKey(
        Order, on_delete=models.CASCADE, related_name="consignment_events",
        null=True, blank=True,
        help_text="Blank only if the consignment id matched nothing we booked",
    )
    extra = models.ForeignKey(
        ExtraConsignment, on_delete=models.CASCADE, related_name="events",
        null=True, blank=True,
        help_text="Set when the parcel is an additional consignment, not the primary",
    )
    consignment_id = models.CharField(max_length=64, db_index=True)
    invoice = models.CharField(max_length=64, blank=True)
    notification_type = models.CharField(max_length=32)
    # Their delivery_status values: pending / delivered / partial_delivered /
    # cancelled / unknown. Stored lower-cased so it compares with the polled one.
    status = models.CharField(max_length=32, blank=True)
    tracking_message = models.TextField(blank=True)
    cod_amount = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    # What Steadfast actually charged for this parcel. Not used in the cash-book
    # (a payout is entered net, see the Finance section) — it is just visible.
    delivery_charge = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    # Their timestamp string, kept verbatim: no timezone is documented, so parsing
    # it into a datetime would be inventing one.
    event_time = models.CharField(max_length=40, blank=True)
    payload = models.JSONField(default=dict, blank=True)
    received_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-received_at", "-id"]
        indexes = [models.Index(fields=["consignment_id", "received_at"])]

    def __str__(self):
        return f"{self.notification_type} for consignment {self.consignment_id}"


# --------------------------------------------------------------------------- #
# Chatbot (AI salesman + human handoff)
# --------------------------------------------------------------------------- #

class GalleryPhoto(models.Model):
    """A photo in the self-hosted gallery. Keeps the original + web derivatives."""

    image = models.ImageField(upload_to="gallery/orig/")
    display = models.ImageField(upload_to="gallery/display/", blank=True)
    thumbnail = models.ImageField(upload_to="gallery/thumb/", blank=True)
    caption = models.CharField(max_length=160, blank=True)
    alt = models.CharField(max_length=160, blank=True)
    order = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["order", "-created_at"]

    def __str__(self):
        return self.caption or f"Photo #{self.pk}"

    def save(self, *args, **kwargs):
        from .services.images import make_derivatives

        # (Re)generate derivatives when a new original is present and unprocessed.
        if self.image and not self.display:
            self.image.seek(0)
            display, thumb = make_derivatives(self.image)
            self.display.save(display.name, display, save=False)
            self.thumbnail.save(thumb.name, thumb, save=False)
        super().save(*args, **kwargs)


class GalleryTag(models.Model):
    """A named group of gallery photos. slug is the URL segment + bot reference."""

    title = models.CharField(max_length=80, help_text="Bengali label shown to customers")
    slug = models.SlugField(max_length=60, unique=True, blank=True)
    description = models.CharField(max_length=300, blank=True)
    cover = models.ForeignKey(
        GalleryPhoto, null=True, blank=True, on_delete=models.SET_NULL, related_name="+",
    )
    order = models.PositiveSmallIntegerField(default=0)
    active = models.BooleanField(default=True)
    is_bot_default = models.BooleanField(
        default=False, help_text="Bot links here when a customer asks for a photo without specifying",
    )
    photos = models.ManyToManyField(GalleryPhoto, related_name="tags", blank=True)

    class Meta:
        ordering = ["order", "id"]

    def __str__(self):
        return self.title

    def save(self, *args, **kwargs):
        import uuid

        from django.utils.text import slugify

        if not self.slug:
            # Bengali titles slugify to "" (ASCII-only). Never allow an empty slug
            # — the URL route (<slug:slug>) + bot references need a real value.
            base = slugify(self.title) or f"tag-{uuid.uuid4().hex[:6]}"
            slug, n = base, 2
            while GalleryTag.objects.exclude(pk=self.pk).filter(slug=slug).exists():
                slug, n = f"{base}-{n}", n + 1
            self.slug = slug[:60]
        super().save(*args, **kwargs)
        if self.is_bot_default:
            GalleryTag.objects.exclude(pk=self.pk).filter(is_bot_default=True).update(
                is_bot_default=False
            )


class ChatSession(models.Model):
    class Status(models.TextChoices):
        BOT = "bot", "Bot handling"
        WAITING_ADMIN = "waiting_admin", "Waiting for admin"
        ADMIN = "admin", "Admin handling"
        CLOSED = "closed", "Closed"

    token = models.CharField(max_length=64, db_index=True, help_text="Anonymous browser token")
    customer_name = models.CharField(max_length=120, blank=True)
    phone = models.CharField(max_length=20, blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.BOT)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]

    def __str__(self):
        return f"Chat {self.pk} ({self.status})"


class ChatMessage(models.Model):
    class Role(models.TextChoices):
        CUSTOMER = "customer", "Customer"
        BOT = "bot", "Bot"
        ADMIN = "admin", "Admin"
        SYSTEM = "system", "System"

    session = models.ForeignKey(ChatSession, on_delete=models.CASCADE, related_name="messages")
    role = models.CharField(max_length=10, choices=Role.choices)
    text = models.TextField(blank=True)
    # Optional media the bot attached (resolved keys).
    image = models.URLField(blank=True)  # legacy single image (kept for compat)
    images = models.JSONField(default=list, blank=True)  # up to 4 preview urls (grid)
    more_count = models.PositiveIntegerField(default=0)  # remaining images -> "+N"
    album_url = models.URLField(blank=True)  # full gallery / external album
    # Image sent by a customer or admin (chat_uploads/); capped on save.
    upload = models.ImageField(upload_to="chat_uploads/", null=True, blank=True)
    read_by_admin = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]

    def __str__(self):
        return f"{self.role}: {self.text[:40]}"

    def save(self, *args, **kwargs):
        from .services.images import process_image

        # Cap a freshly-attached image once; drop it if not a valid image.
        if self.upload and not getattr(self, "_upload_capped", False):
            try:
                self.upload.seek(0)
                capped = process_image(self.upload, max_edge=1600, quality=82)
                self.upload.save(capped.name, capped, save=False)
                self._upload_capped = True
            except ValueError:
                self.upload = None
        super().save(*args, **kwargs)


class BotConfig(models.Model):
    """Singleton holding the editable chatbot instructions (admin-editable)."""

    instructions = models.TextField(blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return "Bot configuration"

    @classmethod
    def get_solo(cls):
        obj = cls.objects.first()
        if obj is None:
            obj = cls.objects.create(instructions="")
        return obj


# --------------------------------------------------------------------------- #
# Homepage content (admin-managed images & copy)
# --------------------------------------------------------------------------- #

class SiteSettings(models.Model):
    """Singleton holding editable homepage media/copy (admin-managed)."""

    hero_image = models.ImageField(upload_to="site/", null=True, blank=True)
    hero_title = models.CharField(max_length=200, blank=True)
    hero_subtitle = models.CharField(max_length=300, blank=True)
    band_image = models.ImageField(
        upload_to="site/", null=True, blank=True,
        help_text="Image in the 'customize' feature band",
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Site settings"
        verbose_name_plural = "Site settings"

    def __str__(self):
        return "Homepage settings"

    @classmethod
    def get_solo(cls):
        obj = cls.objects.first()
        if obj is None:
            obj = cls.objects.create()
        return obj


class CapiEvent(models.Model):
    """Audit log + dedup for Meta Conversions API events (website + manual)."""

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        SENT = "sent", "Sent"
        FAILED = "failed", "Failed"

    event_name = models.CharField(max_length=40)  # Purchase, Lead, ViewContent…
    event_id = models.CharField(max_length=100, unique=True, db_index=True)
    action_source = models.CharField(max_length=30, default="website")
    value = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    currency = models.CharField(max_length=8, default="BDT")
    # What we sent (PII already hashed) + Meta's response, for audit/debug.
    payload = models.JSONField(default=dict, blank=True)
    response = models.JSONField(default=dict, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    attempts = models.PositiveSmallIntegerField(default=0)
    last_attempt_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.event_name} {self.event_id} ({self.status})"


class Lead(models.Model):
    """A manually-entered ad lead (messaging / walk-in) for PII-matched CAPI.
    Tick Qualified -> fires a `Lead`; tick Converted + value -> fires `Purchase`
    (action_source=system_generated). Ports the old standalone project's flow."""

    class Gender(models.TextChoices):
        MALE = "m", "Male"
        FEMALE = "f", "Female"

    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=20, blank=True, db_index=True)
    first_name = models.CharField(max_length=80, blank=True)
    last_name = models.CharField(max_length=80, blank=True)
    city = models.CharField(max_length=80, blank=True)
    state = models.CharField(max_length=80, blank=True)
    zip_code = models.CharField(max_length=20, blank=True)
    gender = models.CharField(max_length=1, choices=Gender.choices, blank=True)
    date_of_birth = models.DateField(null=True, blank=True, help_text="Meta 'db' match key")
    country = models.CharField(
        max_length=2, blank=True,
        help_text="2-letter ISO code (e.g. bd). Blank = META DEFAULT_COUNTRY.",
    )
    external_id = models.CharField(
        max_length=100, blank=True,
        help_text="Your own customer/lead ID for Meta 'external_id'. Blank = phone/email.",
    )
    source = models.CharField(
        max_length=40, blank=True,
        help_text="Where the lead came from, e.g. Messenger, WhatsApp, Instagram, walk-in",
    )
    note = models.TextField(blank=True)
    is_qualified = models.BooleanField(default=False)
    is_converted = models.BooleanField(default=False)
    conversion_value = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"Lead {self.pk} — {self.phone or self.email or self.first_name}"


class HomeCategory(models.Model):
    """A tile in the homepage 'বিভাগ থেকে দেখুন' strip, with an admin-uploaded image."""

    title = models.CharField(max_length=80, help_text="Bengali label shown on the tile")
    image = models.ImageField(upload_to="home_categories/", null=True, blank=True)
    link = models.CharField(
        max_length=200, blank=True,
        help_text="Where the tile goes, e.g. /shop?category=বই",
    )
    order = models.PositiveSmallIntegerField(default=0)
    active = models.BooleanField(default=True)

    class Meta:
        ordering = ["order", "id"]
        verbose_name_plural = "Home categories"

    def __str__(self):
        return self.title


class PushSubscription(models.Model):
    """A browser Web Push subscription for a staff device (new order / handoff).

    Single-admin shop: every saved subscription is notified, so the same admin
    gets alerts on all their registered devices. Stale ones self-delete on send.
    """

    endpoint = models.URLField(max_length=500, unique=True)
    p256dh = models.CharField(max_length=200)
    auth = models.CharField(max_length=100)
    user = models.ForeignKey(
        "auth.User", null=True, blank=True, on_delete=models.CASCADE,
        related_name="push_subscriptions",
        help_text="Whose device this is. Null = registered before staff accounts "
                  "existed; treated as the owner, so it still gets everything.",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"PushSubscription #{self.pk}"


# --------------------------------------------------------------------------- #
# Visitor tracking + help nudge
# --------------------------------------------------------------------------- #

class DailyStat(models.Model):
    """One row per day of lightweight storefront counters (no per-visitor rows).

    `visitors`/`popups_*` are bumped live by the nudge endpoint; the analytics
    fields below are (re)written by the nightly `rollup_analytics` command.
    """
    date = models.DateField(unique=True)
    visitors = models.PositiveIntegerField(default=0)
    popups_shown = models.PositiveIntegerField(default=0)
    popups_clicked = models.PositiveIntegerField(default=0)
    # Rolled up from VisitorSession.
    sessions = models.PositiveIntegerField(default=0)
    pageviews = models.PositiveIntegerField(default=0)
    new_visitors = models.PositiveIntegerField(default=0)
    bounced_sessions = models.PositiveIntegerField(default=0)
    total_seconds = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["-date"]

    def __str__(self):
        return f"Stats {self.date}: {self.visitors} visitors"

    @property
    def bounce_rate(self):
        return (self.bounced_sessions / self.sessions * 100) if self.sessions else 0

    @property
    def avg_seconds(self):
        return (self.total_seconds / self.sessions) if self.sessions else 0


# --------------------------------------------------------------------------- #
# Analytics  (self-hosted, cookie-free)
#
# Three layers, so the DB never grows without bound:
#   1. AnalyticsEvent  — raw rows, purged after ANALYTICS_RETENTION_DAYS.
#   2. VisitorSession  — one row per session; also powers "visitors right now"
#      (a heartbeat only touches `last_seen`, so presence costs no new rows).
#   3. Daily*Stat       — nightly rollups, kept forever, what the dashboard reads
#      for anything older than today.
# No queue exists here, so rollups run from cron, never in the request path.
# --------------------------------------------------------------------------- #

class AnalyticsEvent(models.Model):
    """One raw storefront interaction. Written in batches by /api/t/."""

    # Server-side whitelist — the collector drops anything not in here, so a
    # hostile client can never invent event names or bloat the table.
    NAMES = frozenset({
        "pageview",         # every route change
        "view_combo",       # opened a listing
        "view_product",     # opened a customizable product
        "add_to_cart",
        "begin_checkout",
        "purchase",
        "search",           # ?q= submitted
        "search_empty",     # ...that returned nothing (what we don't sell)
        "wizard_step",      # reached a configurator step
        "wizard_abandon",   # left the wizard without finishing
        "chat_open",
        "nudge_shown",
        "nudge_clicked",
        "scroll",           # depth milestone (props: {"d": 25|50|75|100})
        "click",            # element with data-track
    })
    # Accepted by the collector but stored on the session only (no row): the
    # presence heartbeat. Storing it would multiply the table for zero insight.
    SESSION_ONLY = frozenset({"ping"})

    ts = models.DateTimeField(default=timezone.now, db_index=True)
    session_id = models.CharField(max_length=32, db_index=True)
    visitor_id = models.CharField(max_length=32, db_index=True)
    name = models.CharField(max_length=32)
    path = models.CharField(max_length=200, blank=True)
    # Nullable FKs so a deleted listing never deletes history.
    combo = models.ForeignKey(
        "PrebuiltCombo", null=True, blank=True, on_delete=models.SET_NULL, related_name="+",
    )
    product = models.ForeignKey(
        "Product", null=True, blank=True, on_delete=models.SET_NULL, related_name="+",
    )
    value = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    props = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["-ts"]
        indexes = [
            models.Index(fields=["name", "ts"]),
            models.Index(fields=["combo", "ts"]),
        ]

    def __str__(self):
        return f"{self.name} {self.path} @ {self.ts:%Y-%m-%d %H:%M}"


class VisitorSession(models.Model):
    """One row per browsing session. `last_seen` is what "visitors right now" reads."""

    session_id = models.CharField(max_length=32, unique=True)
    visitor_id = models.CharField(max_length=32, db_index=True)
    started_at = models.DateTimeField(default=timezone.now, db_index=True)
    last_seen = models.DateTimeField(default=timezone.now, db_index=True)
    current_path = models.CharField(max_length=200, blank=True)
    entry_path = models.CharField(max_length=200, blank=True)
    exit_path = models.CharField(max_length=200, blank=True)
    pageviews = models.PositiveIntegerField(default=0)
    events = models.PositiveIntegerField(default=0)
    # Derived server-side from the referrer / fbclid / utm_source — never trusted
    # from the client, never stores the raw URL.
    source = models.CharField(max_length=40, blank=True)
    device = models.CharField(max_length=10, blank=True)   # mobile / tablet / desktop
    is_new_visitor = models.BooleanField(default=True)
    converted = models.BooleanField(default=False)         # reached purchase

    class Meta:
        ordering = ["-last_seen"]

    def __str__(self):
        return f"Session {self.session_id[:8]} ({self.pageviews} pages)"

    @property
    def seconds(self):
        return max(int((self.last_seen - self.started_at).total_seconds()), 0)


class DailyPageStat(models.Model):
    """Per-path rollup: what people actually read."""
    date = models.DateField(db_index=True)
    path = models.CharField(max_length=200)
    views = models.PositiveIntegerField(default=0)
    sessions = models.PositiveIntegerField(default=0)   # unique sessions that saw it
    entries = models.PositiveIntegerField(default=0)    # sessions that STARTED here
    exits = models.PositiveIntegerField(default=0)      # ...and that ENDED here

    class Meta:
        ordering = ["-date", "-views"]
        unique_together = [("date", "path")]

    def __str__(self):
        return f"{self.date} {self.path}: {self.views}"


class DailyComboStat(models.Model):
    """Per-listing funnel — the "which products do they like" table.

    Views come from events; orders/revenue are joined from real Orders, so the
    conversion column is trustworthy rather than client-reported.
    """
    date = models.DateField(db_index=True)
    combo = models.ForeignKey("PrebuiltCombo", on_delete=models.CASCADE, related_name="daily_stats")
    views = models.PositiveIntegerField(default=0)
    carts = models.PositiveIntegerField(default=0)
    orders = models.PositiveIntegerField(default=0)
    revenue = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0"))

    class Meta:
        ordering = ["-date", "-views"]
        unique_together = [("date", "combo")]

    def __str__(self):
        return f"{self.date} {self.combo_id}: {self.views} views / {self.orders} orders"


class DailySourceStat(models.Model):
    """Where the traffic came from, and whether it bought."""
    date = models.DateField(db_index=True)
    source = models.CharField(max_length=40)
    sessions = models.PositiveIntegerField(default=0)
    orders = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["-date", "-sessions"]
        unique_together = [("date", "source")]

    def __str__(self):
        return f"{self.date} {self.source}: {self.sessions}"


class DailyFunnelStat(models.Model):
    """Sessions reaching each funnel step on a day (view → cart → checkout → order)."""

    STEPS = ["view_combo", "add_to_cart", "begin_checkout", "purchase"]

    date = models.DateField(db_index=True)
    step = models.CharField(max_length=32)
    sessions = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["-date"]
        unique_together = [("date", "step")]

    def __str__(self):
        return f"{self.date} {self.step}: {self.sessions}"


# --------------------------------------------------------------------------- #
# Finance (cash-book)
# --------------------------------------------------------------------------- #
#
# Cash basis: income is recorded when the money is actually in hand (mostly
# Steadfast payouts, but any other source too), spending when it is committed.
# There is NO per-order costing — linking an Expense/Income to orders is a MARK
# ONLY ("this is what that money was for"); it never splits, allocates or feeds
# any total. Steadfast already nets out the delivery charge and its 1% COD fee
# before paying, so the payout figure the admin types in IS the income and is
# never recomputed here.
# See docs/superpowers/specs/2026-07-27-finance-cashbook-design.md.


def local_clock_time():
    """Callable default for `CreditPayment.time` — the clock, seconds trimmed.

    Named at module level (not a lambda) because a migration has to import it.
    """
    return timezone.localtime().time().replace(microsecond=0)


class FinanceAccount(models.TextChoices):
    """Where the money moved. Not a ledger — just a label for reconciling.

    MFS accounts (bKash/Nagad) charge a percentage to move money; that charge is
    stored per entry in `fee_amount`, auto-filled from settings.FINANCE_FEE_RATES
    but always editable — the real rate depends on cash-out vs send-money.
    """
    CASH = "cash", "Cash"
    BANK = "bank", "Bank"
    BKASH = "bkash", "bKash"
    NAGAD = "nagad", "Nagad"
    CARD = "card", "Card"
    OTHER = "other", "Other"


class FinanceCategory(models.Model):
    """One table for both sides; `kind` keeps them apart. Admin-managed."""

    class Kind(models.TextChoices):
        INCOME = "income", "Income"
        EXPENSE = "expense", "Expense"

    name = models.CharField(max_length=60)
    kind = models.CharField(max_length=10, choices=Kind.choices)
    order = models.PositiveSmallIntegerField(default=0)
    active = models.BooleanField(default=True)

    class Meta:
        ordering = ["kind", "order", "name"]
        unique_together = [("name", "kind")]
        verbose_name_plural = "Finance categories"

    def __str__(self):
        return f"{self.name} ({self.get_kind_display()})"


class Supplier(models.Model):
    """Someone goods are bought FROM — purchases go on credit (money owed BY us)."""

    name = models.CharField(max_length=120)
    phone = models.CharField(max_length=20, blank=True)
    note = models.TextField(blank=True)
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class Buyer(models.Model):
    """Someone who buys FROM us on credit — a reseller, a shop, a bulk customer.

    Deliberately separate from Supplier (owner's call): the two directions never
    get confused, at the cost of entering a person twice if they are both.
    Website customers are NOT buyers — a normal COD order settles through the
    order itself; this is for goods handed over against a later payment.
    """

    name = models.CharField(max_length=120)
    phone = models.CharField(max_length=20, blank=True)
    note = models.TextField(blank=True)
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class Expense(models.Model):
    """Money out. `amount` = what the purchase cost, VAT included.

    `fee_amount` is the bKash/Nagad/bank charge paid ON TOP to move that money,
    kept separate so a transfer fee never hides inside a price. Total cash out
    for this row is `amount + fee_amount`.
    """

    date = models.DateField(default=timezone.localdate, db_index=True)
    category = models.ForeignKey(
        FinanceCategory, on_delete=models.PROTECT, related_name="expenses",
        limit_choices_to={"kind": FinanceCategory.Kind.EXPENSE},
    )
    description = models.CharField(max_length=200, blank=True)
    amount = models.DecimalField(
        max_digits=12, decimal_places=2,
        help_text="Total money out, VAT included — what actually left the account.",
    )
    # Breakdown only. Already part of `amount`; never added on top of it.
    vat_amount = models.DecimalField(
        max_digits=12, decimal_places=2, default=Decimal("0"),
        help_text="VAT portion already included in the amount (ads = 15% in BD).",
    )
    # Charged ON TOP of `amount` (bKash/Nagad cash-out or send-money fee, bank
    # transfer charge). Auto-filled from the account's rate, always editable.
    fee_amount = models.DecimalField(
        max_digits=12, decimal_places=2, default=Decimal("0"),
        help_text="MFS/transfer charge paid on top of the amount.",
    )
    account = models.CharField(
        max_length=10, choices=FinanceAccount.choices, default=FinanceAccount.CASH,
    )
    supplier = models.ForeignKey(
        Supplier, null=True, blank=True, on_delete=models.SET_NULL, related_name="expenses",
    )
    is_credit = models.BooleanField(
        default=False, help_text="Taken on credit — pay later, tracked in Dues.",
    )
    reference = models.CharField(max_length=80, blank=True, help_text="Invoice / trx id")
    receipt = models.ImageField(upload_to="finance/", null=True, blank=True)
    # A MARK, not an allocation: which orders this money was spent on. Zero
    # effect on any total — see the module note above.
    orders = models.ManyToManyField(
        "Order", blank=True, related_name="expense_marks",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-date", "-id"]

    def __str__(self):
        return f"{self.date} {self.description or self.category_id}: {self.amount}"

    @property
    def total_out(self):
        """Full cost of this row: the purchase plus the charge to move the money."""
        return self.amount + self.fee_amount


class Income(models.Model):
    """Money in — a Steadfast payout, a sale, or anything else.

    `is_credit` = sold on credit: goods are gone but the money has not arrived.
    Cash basis, so such a row contributes NOTHING to income until an
    IncomePayment lands; the outstanding part is a receivable instead.
    """

    date = models.DateField(default=timezone.localdate, db_index=True)
    category = models.ForeignKey(
        FinanceCategory, on_delete=models.PROTECT, related_name="incomes",
        limit_choices_to={"kind": FinanceCategory.Kind.INCOME},
    )
    description = models.CharField(max_length=200, blank=True)
    amount = models.DecimalField(
        max_digits=12, decimal_places=2,
        help_text="Money received. For a courier payout this is the NET amount "
                  "paid out — Steadfast already deducted delivery + its 1% COD fee.",
    )
    # DEDUCTED from `amount` (bKash/Nagad cash-out charge on money received).
    # Net in hand = amount - fee_amount.
    fee_amount = models.DecimalField(
        max_digits=12, decimal_places=2, default=Decimal("0"),
        help_text="MFS/cash-out charge taken out of the amount received.",
    )
    account = models.CharField(
        max_length=10, choices=FinanceAccount.choices, default=FinanceAccount.CASH,
    )
    reference = models.CharField(max_length=80, blank=True, help_text="Payout / trx id")
    buyer = models.ForeignKey(
        Buyer, null=True, blank=True, on_delete=models.SET_NULL, related_name="incomes",
    )
    is_credit = models.BooleanField(
        default=False, help_text="Sold on credit — money not received yet.",
    )
    # Same MARK semantics as Expense.orders.
    orders = models.ManyToManyField(
        "Order", blank=True, related_name="income_marks",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-date", "-id"]

    def __str__(self):
        return f"{self.date} {self.description or self.category_id}: {self.amount}"

    @property
    def net_amount(self):
        """Cash this row put in hand. A credit sale puts in nothing by itself —
        the money arrives as CreditPayment rows against the buyer's balance."""
        if self.is_credit:
            return Decimal("0")
        return self.amount - self.fee_amount


class CreditPayment(models.Model):
    """Money moved against a CONTACT's running balance — not against one invoice.

    The owner keeps a running account per supplier/buyer: several credits build
    up, payments come in round amounts, and a payment simply reduces the total
    owed. Nothing is allocated to a specific Expense/Income row, so no history is
    ever rewritten — the credits and the payments both stay as they happened and
    the balance is the difference.
    """

    class Kind(models.TextChoices):
        PAYABLE = "payable", "We paid a supplier"
        RECEIVABLE = "receivable", "A buyer paid us"

    kind = models.CharField(max_length=12, choices=Kind.choices)
    supplier = models.ForeignKey(
        Supplier, null=True, blank=True, on_delete=models.CASCADE,
        related_name="credit_payments",
    )
    buyer = models.ForeignKey(
        Buyer, null=True, blank=True, on_delete=models.CASCADE,
        related_name="credit_payments",
    )
    date = models.DateField(default=timezone.localdate, db_index=True)
    # A payment is round money handed over at a moment — the owner phones the
    # supplier, sends bKash, and wants the receipt to say when. The DAY alone is
    # not enough when two payments to the same contact land the same day.
    # Nullable because rows written before this field existed have no honest
    # value; the API falls back to `created_at` for those and never invents one.
    time = models.TimeField(
        null=True, blank=True, default=local_clock_time,
        help_text="Clock time the money moved. Blank on payments recorded "
                  "before times were kept.",
    )
    amount = models.DecimalField(
        max_digits=12, decimal_places=2,
        help_text="What changed hands between the two parties — this is what "
                  "moves the balance.",
    )
    fee_amount = models.DecimalField(
        max_digits=12, decimal_places=2, default=Decimal("0"),
        help_text="MFS/transfer charge. Real money, but it never touches the balance.",
    )
    account = models.CharField(
        max_length=10, choices=FinanceAccount.choices, default=FinanceAccount.CASH,
    )
    note = models.CharField(max_length=200, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-date", "-id"]

    def __str__(self):
        who = self.supplier or self.buyer
        return f"{self.get_kind_display()} {self.amount} ({who})"

    @property
    def contact_id(self):
        return self.supplier_id if self.kind == self.Kind.PAYABLE else self.buyer_id

    @property
    def cash_effect(self):
        """Cash out for a payable (amount + charge), cash in for a receivable
        (amount - charge)."""
        if self.kind == self.Kind.PAYABLE:
            return self.amount + self.fee_amount
        return self.amount - self.fee_amount


# --------------------------------------------------------------------------- #
# Staff / moderators
# --------------------------------------------------------------------------- #

class StaffProfile(models.Model):
    """
    Per-section access for one staff user (a moderator).

    The owner is a superuser and needs no row here — `access_level()` short
    circuits on `is_superuser`. A staff user WITHOUT a profile therefore has
    access to nothing, which is the safe default: an account created straight in
    Django admin cannot inherit power by accident.

    `access` is a plain dict, `{"orders": "full", "finance": "view"}`, validated
    against `app.permissions.SECTIONS` on write. A dict rather than a row per
    section because the section list lives in code (it tracks the panel's pages,
    not data) and the whole map is read on every request.
    """

    user = models.OneToOneField(
        "auth.User", on_delete=models.CASCADE, related_name="staff_profile",
    )
    access = models.JSONField(
        default=dict, blank=True,
        help_text='Section -> "view" | "full". Missing section = no access.',
    )
    note = models.CharField(
        max_length=200, blank=True,
        help_text="What this person does — e.g. 'packing desk', 'accounts'.",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Access for {self.user.username}"


class AdminPresence(models.Model):
    """
    When each staff account was last seen using the panel — "active now",
    "active 20m ago".

    Kept off `StaffProfile` on purpose: that model is the permission map and the
    owner deliberately has no row there, but the owner's presence is exactly the
    row you most want. One row per staff user, rewritten in place, so this table
    never grows past the size of the team.

    Written by `AdminAuditMiddleware` on any authenticated `/api/admin/` request
    (throttled — see `services/presence.py`), which means the panel's own 6s
    badge poll keeps an open tab looking alive without a write per poll.
    """

    user = models.OneToOneField(
        "auth.User", on_delete=models.CASCADE, related_name="presence",
    )
    last_seen = models.DateTimeField(default=timezone.now, db_index=True)

    def __str__(self):
        return f"{self.user.username} seen {self.last_seen:%Y-%m-%d %H:%M}"


class AdminAuditLog(models.Model):
    """
    Append-only record of every write a staff user makes through the panel.

    Answers "who cancelled this order". Written by `AdminAuditMiddleware`, never
    edited or deleted through the API; `purge_audit_log` trims it on a schedule
    so it cannot grow without bound. `username` is snapshotted so the trail
    survives the account being deleted.
    """

    user = models.ForeignKey(
        "auth.User", null=True, blank=True, on_delete=models.SET_NULL,
        related_name="audit_entries",
    )
    username = models.CharField(max_length=150)
    method = models.CharField(max_length=8)
    path = models.CharField(max_length=200)
    section = models.CharField(max_length=32, blank=True)
    status_code = models.PositiveSmallIntegerField(default=0)
    object_repr = models.CharField(max_length=200, blank=True)
    payload = models.JSONField(
        default=dict, blank=True,
        help_text="Request body, secrets redacted and truncated.",
    )
    ip = models.GenericIPAddressField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [models.Index(fields=["section", "-created_at"])]

    def __str__(self):
        return f"{self.username} {self.method} {self.path} ({self.status_code})"
