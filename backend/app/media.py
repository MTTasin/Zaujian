"""Serving uploaded media from Django, as cheaply as Django can do it.

The real answer is not to: on cPanel, LiteSpeed can serve `/media/` straight off
disk and Python never wakes up (see DEPLOY.md). Until that alias exists, every
photo on a page occupies a Passenger worker for the whole transfer — and on a 2G
line in a village that is seconds per image, per visitor.

What this module can do is make sure a browser or Cloudflare edge asks only
once. Django's `static.serve` sends no `Cache-Control` at all, so a revisit
re-downloads (or at best revalidates) every photo, and Cloudflare falls back to
whatever its default happens to be.
"""

from django.views.static import serve

# One day. Long enough that a customer browsing the catalogue re-fetches nothing,
# short enough that a replaced photo is not stuck in caches for a week. NOT
# `immutable`: media filenames are not content-hashed, so the same URL can get
# new bytes when an admin re-uploads.
MEDIA_MAX_AGE = 60 * 60 * 24


def serve_media(request, path, document_root=None, show_indexes=False):
    """`django.views.static.serve` plus a cache header."""
    response = serve(request, path, document_root=document_root,
                     show_indexes=show_indexes)
    response.headers["Cache-Control"] = f"public, max-age={MEDIA_MAX_AGE}"
    return response
