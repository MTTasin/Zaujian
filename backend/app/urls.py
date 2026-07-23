"""Storefront + admin API routes."""

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import admin_api, views

router = DefaultRouter()
router.register(r"products", views.ProductViewSet, basename="product")
router.register(r"combos", views.ComboViewSet, basename="combo")

# Admin (frontend panel) router
admin_router = DefaultRouter()
admin_router.register(r"products", admin_api.AdminProductViewSet, basename="admin-product")
admin_router.register(r"product-images", admin_api.AdminProductImageViewSet, basename="admin-product-image")
admin_router.register(r"product-specs", admin_api.AdminProductSpecViewSet, basename="admin-product-spec")
admin_router.register(r"product-fields", admin_api.AdminProductFieldViewSet, basename="admin-product-field")
admin_router.register(r"home-categories", admin_api.AdminHomeCategoryViewSet, basename="admin-home-category")
admin_router.register(r"leads", admin_api.AdminLeadViewSet, basename="admin-lead")
admin_router.register(r"capi-events", admin_api.AdminCapiEventViewSet, basename="admin-capi-event")
admin_router.register(r"colors", admin_api.AdminColorViewSet, basename="admin-color")
admin_router.register(r"toppings", admin_api.AdminToppingViewSet, basename="admin-topping")
admin_router.register(r"inside", admin_api.AdminInsideViewSet, basename="admin-inside")
admin_router.register(r"static", admin_api.AdminStaticViewSet, basename="admin-static")
admin_router.register(r"dupatta", admin_api.AdminDupattaViewSet, basename="admin-dupatta")
admin_router.register(r"config-images", admin_api.AdminConfigImageViewSet, basename="admin-configimage")
admin_router.register(r"combos", admin_api.AdminComboViewSet, basename="admin-combo")
admin_router.register(r"combo-images", admin_api.AdminComboImageViewSet, basename="admin-combo-image")
admin_router.register(r"combo-fields", admin_api.AdminComboFieldViewSet, basename="admin-combo-field")
admin_router.register(r"orders", admin_api.AdminOrderViewSet, basename="admin-order")
admin_router.register(r"custom-requests", admin_api.AdminCustomRequestViewSet, basename="admin-custom")
admin_router.register(r"gallery-photos", admin_api.AdminGalleryPhotoViewSet, basename="admin-gallery-photo")
admin_router.register(r"gallery-tags", admin_api.AdminGalleryTagViewSet, basename="admin-gallery-tag")
admin_router.register(r"chats", admin_api.AdminChatSessionViewSet, basename="admin-chat")

urlpatterns = [
    path("", include(router.urls)),
    path("products/<slug:slug>/price/", views.price_lookup, name="product-price"),
    path("home/", views.home_view, name="home"),
    path("shop-info/", views.shop_info, name="shop-info"),
    # Cart
    path("cart/", views.cart_view, name="cart"),
    path("cart/add/", views.cart_add, name="cart-add"),
    path("cart/<int:item_id>/", views.cart_item, name="cart-item"),
    # Checkout / orders / payment (public tracking by uid)
    path("checkout/", views.checkout, name="checkout"),
    path("orders/<str:uid>/", views.order_detail, name="order-detail"),
    path("orders/<str:uid>/payment/", views.order_payment, name="order-payment"),
    # Custom requests
    path("custom-request/", views.custom_request, name="custom-request"),
    # Chatbot (public)
    path("chat/send/", views.chat_send, name="chat-send"),
    path("chat/poll/", views.chat_poll, name="chat-poll"),
    # Gallery (public)
    path("gallery/", views.gallery_index, name="gallery-index"),
    path("gallery/<slug:slug>/", views.gallery_detail, name="gallery-detail"),
    # Visitor tracking + nudge (public)
    path("nudge-event/", views.nudge_event, name="nudge-event"),
    # ---- Admin panel API ----
    path("admin/login/", admin_api.admin_login, name="admin-login"),
    path("admin/me/", admin_api.admin_me, name="admin-me"),
    path("admin/dashboard/", admin_api.admin_dashboard, name="admin-dashboard"),
    path("admin/analytics/", admin_api.admin_analytics, name="admin-analytics"),
    path("admin/chat-unread/", admin_api.admin_chat_unread, name="admin-chat-unread"),
    path("admin/push-key/", admin_api.admin_push_key, name="admin-push-key"),
    path("admin/push-subscribe/", admin_api.admin_push_subscribe, name="admin-push-subscribe"),
    path("admin/bot-config/", admin_api.admin_bot_config, name="admin-bot-config"),
    path("admin/orders/manual/", admin_api.admin_create_order, name="admin-order-manual"),
    path("admin/fraud-check/", admin_api.admin_fraud_check, name="admin-fraud-check"),
    path("admin/site-settings/", admin_api.admin_site_settings, name="admin-site-settings"),
    path("admin/", include(admin_router.urls)),
]
