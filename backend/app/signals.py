"""
Cache invalidation for the catalogue reads (`services/cache.py`).

Every model whose contents reach the homepage payload, `shop-info`, or the
chatbot's shop facts bumps the catalogue version when it changes. One bump
invalidates all of them at once — they are all derived from the same catalogue,
and getting a stale price in front of a customer is worse than a rebuild.
"""

from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

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


@receiver(post_save)
@receiver(post_delete)
def _invalidate_catalogue(sender, **kwargs):
    if sender in CATALOGUE_MODELS:
        bump_catalogue()
