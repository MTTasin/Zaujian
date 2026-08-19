"""URL configuration for the Zaujain backend."""

from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path, re_path

from app.media import serve_media

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("app.urls")),
]

# Serve uploaded media. In DEBUG the static() helper handles it; in production
# (cPanel/Passenger, no separate media web-server) serve it via Django directly —
# with a cache header, so a repeat visitor and the Cloudflare edge stop asking.
# Moving /media to a LiteSpeed alias retires this path entirely; see DEPLOY.md.
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
else:
    urlpatterns += [
        re_path(r"^media/(?P<path>.*)$", serve_media,
                {"document_root": settings.MEDIA_ROOT}),
    ]
