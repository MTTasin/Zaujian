"""Redis cache keys + invalidation for the public gallery endpoints."""
from django.core.cache import cache

INDEX_KEY = "gallery:index"


def tag_key(slug):
    return f"gallery:tag:{slug}"


def invalidate(slugs=None):
    """Clear the index and (if given) specific tag caches."""
    if slugs:
        keys = [INDEX_KEY] + [tag_key(s) for s in slugs]
        cache.delete_many(keys)
    else:
        # Unknown scope: clear the index; tag keys expire via their TTL.
        cache.delete(INDEX_KEY)
