"""
Cache invalidation for the catalogue reads (`services/cache.py`).

Every model whose contents reach the homepage payload, `shop-info`, or the
chatbot's shop facts bumps the catalogue version when it changes. One bump
invalidates all of them at once — they are all derived from the same catalogue,
and getting a stale price in front of a customer is worse than a rebuild.
"""

from django.db.models.signals import post_delete, post_save

from .models import (
    ColorOption,
    ComboField,
    ComboImage,
    ConfigurationImage,
    DupattaOption,
    HomeCategory,
    InsideDesign,
    PrebuiltCombo,
    Product,
    ProductField,
    ProductImage,
    ProductSpec,
    SiteSettings,
    StaticDesign,
    ToppingDesign,
)
from .services.cache import bump_catalogue

CATALOGUE_MODELS = (
    Product, ProductImage, ProductSpec, ProductField,
    ColorOption, ToppingDesign, InsideDesign, StaticDesign, DupattaOption,
    ConfigurationImage,
    PrebuiltCombo, ComboImage, ComboField,
    HomeCategory, SiteSettings,
)


def _invalidate_catalogue(sender, **kwargs):
    bump_catalogue()


# Connected per model rather than as a bare `@receiver(post_save)`. A senderless
# receiver is called for EVERY write in the project — every chat message, every
# analytics session heartbeat, every audit row — just to discover it is not a
# catalogue model. Naming the senders means Django never dispatches to us at all.
for _model in CATALOGUE_MODELS:
    post_save.connect(
        _invalidate_catalogue, sender=_model,
        dispatch_uid=f"catalogue_bump_save_{_model.__name__}",
    )
    post_delete.connect(
        _invalidate_catalogue, sender=_model,
        dispatch_uid=f"catalogue_bump_delete_{_model.__name__}",
    )
