"""
Admin panel (English). Simple forms for non-code catalog management, custom order
pricing queue, order verification, and manual Steadfast consignment booking.

The "Confirm order" flow is an intermediate page: the admin enters the advance
actually received, then the order is booked to Steadfast and marked confirmed.
See plan §11, §15.4.
"""

from django import forms
from django.contrib import admin, messages
from django.shortcuts import redirect, render
from django.urls import path, reverse
from django.utils.html import format_html

from .models import (
    CartItem,
    GalleryPhoto,
    GalleryTag,
    ChatMessage,
    ChatSession,
    ColorOption,
    ComboImage,
    ConfigurationImage,
    CustomOrderReferenceImage,
    CustomOrderRequest,
    DupattaOption,
    InsideDesign,
    Order,
    PrebuiltCombo,
    Product,
    StaticDesign,
    ToppingDesign,
)
from .services import notifications
from .services.steadfast_order import SteadfastError, create_consignment


# --------------------------------------------------------------------------- #
# Catalog
# --------------------------------------------------------------------------- #

class ColorOptionInline(admin.TabularInline):
    model = ColorOption
    extra = 1


class ToppingDesignInline(admin.TabularInline):
    model = ToppingDesign
    extra = 1


class InsideDesignInline(admin.TabularInline):
    model = InsideDesign
    extra = 1


class StaticDesignInline(admin.TabularInline):
    model = StaticDesign
    extra = 1


class DupattaOptionInline(admin.TabularInline):
    model = DupattaOption
    extra = 1


class ConfigurationImageInline(admin.TabularInline):
    model = ConfigurationImage
    extra = 1
    fields = ("color", "corner", "center", "image", "active")


@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    list_display = ("name", "kind", "category", "base_price", "allows_individual_purchase", "active")
    list_filter = ("kind", "active")
    search_fields = ("name", "slug")
    prepopulated_fields = {"slug": ("name",)}
    inlines = [
        ColorOptionInline,
        ToppingDesignInline,
        InsideDesignInline,
        StaticDesignInline,
        DupattaOptionInline,
        ConfigurationImageInline,
    ]


@admin.register(ColorOption)
class ColorOptionAdmin(admin.ModelAdmin):
    list_display = ("product", "name", "price_modifier", "active")
    list_filter = ("active", "product")


@admin.register(ToppingDesign)
class ToppingDesignAdmin(admin.ModelAdmin):
    list_display = ("product", "placement", "price_modifier", "active")
    list_filter = ("placement", "active", "product")


@admin.register(InsideDesign)
class InsideDesignAdmin(admin.ModelAdmin):
    list_display = ("product", "price_modifier", "active")
    list_filter = ("active", "product")


@admin.register(StaticDesign)
class StaticDesignAdmin(admin.ModelAdmin):
    list_display = ("product", "price_modifier", "active")
    list_filter = ("active", "product")


@admin.register(DupattaOption)
class DupattaOptionAdmin(admin.ModelAdmin):
    list_display = ("product", "lace_type", "text_lines", "price", "active")
    list_filter = ("lace_type", "active")


# --------------------------------------------------------------------------- #
# Prebuilt combos
# --------------------------------------------------------------------------- #

class ComboImageInline(admin.TabularInline):
    model = ComboImage
    extra = 1


class PrebuiltComboForm(forms.ModelForm):
    """A combo must never contain two products from the same exclusive group
    (e.g. book AND frame) — the configurator only lets a customer pick one."""

    class Meta:
        model = PrebuiltCombo
        fields = "__all__"

    def clean(self):
        cleaned = super().clean()
        chosen = cleaned.get("products")
        if not chosen:
            return cleaned
        groups = {}
        for p in chosen:
            if p.exclusive_group:
                groups.setdefault(p.exclusive_group, []).append(p.name)
        for group, names in groups.items():
            if len(names) > 1:
                raise forms.ValidationError(
                    f"A combo can contain only one of the '{group}' group — "
                    f"you picked: {', '.join(names)}."
                )
        return cleaned


@admin.register(PrebuiltCombo)
class PrebuiltComboAdmin(admin.ModelAdmin):
    form = PrebuiltComboForm
    list_display = ("name", "price", "featured", "active")
    list_filter = ("featured", "active")
    search_fields = ("name", "slug")
    prepopulated_fields = {"slug": ("name",)}
    filter_horizontal = ("products",)
    inlines = [ComboImageInline]


# --------------------------------------------------------------------------- #
# Custom order requests (pricing queue)
# --------------------------------------------------------------------------- #

class ReferenceImageInline(admin.TabularInline):
    model = CustomOrderReferenceImage
    extra = 0


@admin.register(CustomOrderRequest)
class CustomOrderRequestAdmin(admin.ModelAdmin):
    list_display = ("id", "customer_name", "phone", "status", "admin_final_price", "created_at")
    list_filter = ("status",)
    search_fields = ("customer_name", "phone")
    inlines = [ReferenceImageInline]


# --------------------------------------------------------------------------- #
# Orders
# --------------------------------------------------------------------------- #

class CartItemInline(admin.TabularInline):
    model = CartItem
    extra = 0
    readonly_fields = ("product", "config", "price_snapshot", "is_custom_request")
    can_delete = False


class ConfirmOrderForm(forms.Form):
    advance_received = forms.DecimalField(
        max_digits=10, decimal_places=2, min_value=0,
        help_text="Amount the customer has already paid as advance (0 if none). "
                  "COD = subtotal + delivery - this amount.",
    )


@admin.register(Order)
class OrderAdmin(admin.ModelAdmin):
    list_display = (
        "uid", "customer_name", "phone", "is_repeat_customer", "status", "total_display",
        "payment_verified", "advance_required", "courier_submitted",
    )
    list_filter = ("status", "payment_verified", "advance_required", "courier_submitted", "is_repeat_customer")
    search_fields = ("uid", "customer_name", "phone", "email", "transaction_id")
    readonly_fields = (
        "created_at", "updated_at", "fraud_check_result",
        "steadfast_consignment_id", "steadfast_tracking_code", "steadfast_status",
        "cod_amount", "confirm_link",
    )
    inlines = [CartItemInline]
    actions = ["mark_payment_verified", "action_in_production", "action_shipped", "action_delivered"]

    @admin.display(description="Total")
    def total_display(self, obj):
        return obj.total

    @admin.display(description="Confirm & book courier")
    def confirm_link(self, obj):
        if not obj.pk:
            return "Save first"
        if obj.courier_submitted:
            return format_html(
                "Booked. Consignment {} / tracking {}",
                obj.steadfast_consignment_id, obj.steadfast_tracking_code or "-",
            )
        url = reverse("admin:app_order_confirm", args=[obj.pk])
        return format_html('<a class="button" href="{}">Confirm order + book Steadfast</a>', url)

    # -- custom URL for the confirm flow -- #
    def get_urls(self):
        urls = super().get_urls()
        custom = [
            path(
                "<int:order_id>/confirm/",
                self.admin_site.admin_view(self.confirm_view),
                name="app_order_confirm",
            ),
        ]
        return custom + urls

    def confirm_view(self, request, order_id):
        order = self.get_object(request, order_id)
        if order is None:
            self.message_user(request, "Order not found.", level=messages.ERROR)
            return redirect("admin:app_order_changelist")

        if order.courier_submitted:
            self.message_user(request, "Order already booked to Steadfast.", level=messages.WARNING)
            return redirect("admin:app_order_change", order_id)

        if request.method == "POST":
            form = ConfirmOrderForm(request.POST)
            if form.is_valid():
                order.advance_received = form.cleaned_data["advance_received"]
                order.cod_amount = order.compute_cod()
                try:
                    result = create_consignment(order)
                except SteadfastError as exc:
                    # Do NOT confirm on failure. Show the admin the error.
                    self.message_user(
                        request,
                        f"Steadfast booking failed, order NOT confirmed: {exc}",
                        level=messages.ERROR,
                    )
                    return redirect("admin:app_order_change", order_id)

                order.steadfast_consignment_id = result["consignment_id"]
                order.steadfast_tracking_code = result["tracking_code"]
                order.steadfast_status = result["status"]
                order.courier_submitted = True
                order.status = Order.Status.CONFIRMED
                order.save()
                notifications.notify_order_status(order)
                self.message_user(
                    request,
                    f"Order confirmed. Consignment {result['consignment_id']}, "
                    f"COD {result['cod_amount']}.",
                    level=messages.SUCCESS,
                )
                return redirect("admin:app_order_change", order_id)
        else:
            form = ConfirmOrderForm(initial={"advance_received": order.advance_received})

        context = {
            **self.admin_site.each_context(request),
            "title": f"Confirm order #{order.pk}",
            "order": order,
            "form": form,
            "opts": self.model._meta,
        }
        return render(request, "admin/app/order/confirm.html", context)

    # -- bulk status actions (email on change) -- #
    @admin.action(description="Mark payment verified")
    def mark_payment_verified(self, request, queryset):
        updated = queryset.update(payment_verified=True)
        self.message_user(request, f"{updated} order(s) marked payment verified.")

    def _set_status(self, request, queryset, status):
        count = 0
        for order in queryset:
            order.status = status
            order.save(update_fields=["status", "updated_at"])
            notifications.notify_order_status(order)
            count += 1
        self.message_user(request, f"{count} order(s) set to {status}.")

    @admin.action(description="Set status: In production")
    def action_in_production(self, request, queryset):
        self._set_status(request, queryset, Order.Status.IN_PRODUCTION)

    @admin.action(description="Set status: Shipped")
    def action_shipped(self, request, queryset):
        self._set_status(request, queryset, Order.Status.SHIPPED)

    @admin.action(description="Set status: Delivered")
    def action_delivered(self, request, queryset):
        self._set_status(request, queryset, Order.Status.DELIVERED)


@admin.register(GalleryTag)
class GalleryTagAdmin(admin.ModelAdmin):
    list_display = ("title", "slug", "active", "is_bot_default", "order")
    list_filter = ("active", "is_bot_default")
    search_fields = ("title", "slug")
    filter_horizontal = ("photos",)


@admin.register(GalleryPhoto)
class GalleryPhotoAdmin(admin.ModelAdmin):
    list_display = ("__str__", "caption", "order", "created_at")
    search_fields = ("caption", "alt")


class ChatMessageInline(admin.TabularInline):
    model = ChatMessage
    extra = 0
    readonly_fields = ("role", "text", "image", "upload", "album_url", "created_at")
    can_delete = False


@admin.register(ChatSession)
class ChatSessionAdmin(admin.ModelAdmin):
    list_display = ("id", "customer_name", "phone", "status", "updated_at")
    list_filter = ("status",)
    inlines = [ChatMessageInline]


# --------------------------------------------------------------------------- #
# Dashboard (Phase 12): inject quick metrics into the admin home page.
# --------------------------------------------------------------------------- #

from django.utils import timezone  # noqa: E402

_orig_admin_index = admin.site.index


def _dashboard_index(request, extra_context=None):
    today = timezone.localdate()
    extra_context = extra_context or {}
    extra_context.update({
        "dash_orders_today": Order.objects.filter(created_at__date=today).count(),
        "dash_pending_payment": Order.objects.filter(
            payment_verified=False, status=Order.Status.PENDING_PAYMENT,
        ).exclude(transaction_id="").count(),
        "dash_pending_custom": CustomOrderRequest.objects.filter(
            status=CustomOrderRequest.Status.PENDING,
        ).count(),
    })
    return _orig_admin_index(request, extra_context=extra_context)


admin.site.index = _dashboard_index
admin.site.index_template = "admin/dashboard_index.html"
admin.site.site_header = "Zaujain Nikah Point — Admin"
admin.site.site_title = "Zaujain Admin"
admin.site.index_title = "Dashboard"
