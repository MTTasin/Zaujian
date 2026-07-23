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

class Order(models.Model):
    class Status(models.TextChoices):
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
    cost_price = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True,
        help_text="Total cost to fulfil this order. Blank = not costed yet.",
    )

    # Manual payment
    payment_method = models.CharField(
        max_length=10, choices=PaymentMethod.choices, blank=True
    )
    transaction_id = models.CharField(max_length=64, blank=True)
    payment_screenshot = models.ImageField(upload_to="payments/", null=True, blank=True)
    payment_verified = models.BooleanField(default=False)

    # Fraud check (raw response stored for the record)
    fraud_check_result = models.JSONField(default=dict, blank=True)

    # Steadfast consignment (booked only on admin confirm)
    steadfast_consignment_id = models.CharField(max_length=64, blank=True)
    steadfast_tracking_code = models.CharField(max_length=64, blank=True)
    steadfast_status = models.CharField(max_length=32, blank=True)
    courier_submitted = models.BooleanField(default=False)

    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.PENDING_PAYMENT
    )
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

    @property
    def profit(self):
        """Subtotal minus cost. None until a cost has been entered."""
        if self.cost_price is None:
            return None
        return self.subtotal - self.cost_price

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
    """A browser Web Push subscription for the admin (new order / handoff alerts).

    Single-admin shop: every saved subscription is notified, so the same admin
    gets alerts on all their registered devices. Stale ones self-delete on send.
    """

    endpoint = models.URLField(max_length=500, unique=True)
    p256dh = models.CharField(max_length=200)
    auth = models.CharField(max_length=100)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"PushSubscription #{self.pk}"


# --------------------------------------------------------------------------- #
# Visitor tracking + help nudge
# --------------------------------------------------------------------------- #

class DailyStat(models.Model):
    """One row per day of lightweight storefront counters (no per-visitor rows)."""
    date = models.DateField(unique=True)
    visitors = models.PositiveIntegerField(default=0)
    popups_shown = models.PositiveIntegerField(default=0)
    popups_clicked = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["-date"]

    def __str__(self):
        return f"Stats {self.date}: {self.visitors} visitors"
