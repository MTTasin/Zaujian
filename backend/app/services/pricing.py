"""
Pricing engine. Base price + selected option modifiers, except dupatta which is a
direct DupattaOption lookup (not additive). See plan §6, §15.7.

All arithmetic is Decimal. Returns (price, config_snapshot). Raises ValueError on
invalid selections so the caller can 400.
"""

from decimal import Decimal

from ..models import (
    ColorOption,
    DupattaOption,
    InsideDesign,
    Product,
    StaticDesign,
    ToppingDesign,
)


def price_bounds(product):
    """
    Return (min_price, max_price) a product can reach across its options, for the
    "total price range" shown on the item-selection step. Optional overlays
    contribute 0 to the minimum. See plan §6.
    """
    from django.db.models import Max, Min  # local import to avoid cycles

    base = Decimal(product.base_price)

    if product.kind == Product.Kind.DUPATTA:
        agg = product.dupatta_options.filter(active=True).aggregate(
            lo=Min("price"), hi=Max("price"))
        return agg["lo"] or Decimal("0"), agg["hi"] or Decimal("0")

    if product.kind in (Product.Kind.GALLERY, Product.Kind.SIMPLE):
        agg = product.static_designs.filter(active=True).aggregate(
            lo=Min("price_modifier"), hi=Max("price_modifier"))
        # Simple with no designs = fixed base price. Gallery lo starts at cheapest.
        return base + (agg["lo"] or Decimal("0")), base + (agg["hi"] or Decimal("0"))

    # layered: color required (min/max), overlays + inside optional (+0 .. +max)
    lo = hi = base
    colors = product.colors.filter(active=True).aggregate(
        lo=Min("price_modifier"), hi=Max("price_modifier"))
    if colors["lo"] is not None:
        lo += colors["lo"]
        hi += colors["hi"]
    for placement in (ToppingDesign.Placement.CORNER, ToppingDesign.Placement.CENTER):
        top = product.toppings.filter(active=True, placement=placement).aggregate(
            hi=Max("price_modifier"))
        hi += top["hi"] or Decimal("0")
    ins = product.inside_designs.filter(active=True).aggregate(hi=Max("price_modifier"))
    hi += ins["hi"] or Decimal("0")
    return lo, hi


def _get_active(model, product, pk, label):
    if pk in (None, "", 0):
        return None
    try:
        return model.objects.get(pk=pk, product=product, active=True)
    except model.DoesNotExist as exc:
        raise ValueError(f"Invalid {label} selection: {pk}") from exc


def price_selection(product, selection):
    """
    `selection` is a dict of chosen option ids, e.g.:
      {"color": 3, "corner": 7, "center": 9, "inside": 2}      # book
      {"color": 3, "corner": 7, "center": 9}                    # box
      {"static": 5}                                             # pen / mirror
      {"dupatta": 4}                                            # dupatta

    Returns (Decimal price, dict config snapshot).
    """
    selection = selection or {}

    # Dupatta: direct lookup, not additive.
    if product.kind == Product.Kind.DUPATTA:
        opt = _get_active(DupattaOption, product, selection.get("dupatta"), "dupatta")
        if opt is None:
            raise ValueError("Dupatta option is required")
        config = {
            "dupatta": {
                "id": opt.id,
                "lace_type": opt.lace_type,
                "text_lines": opt.text_lines,
            }
        }
        return opt.price, config

    price = Decimal(product.base_price)
    config = {}

    # Gallery / simple: pick one static design. Simple with no designs = buy as-is.
    if product.kind in (Product.Kind.GALLERY, Product.Kind.SIMPLE):
        design = _get_active(StaticDesign, product, selection.get("static"), "design")
        if design is None:
            has_designs = product.static_designs.filter(active=True).exists()
            if has_designs:
                raise ValueError("A design selection is required")
            return price, config  # simple buy-as-is at base price
        price += Decimal(design.price_modifier)
        config["static"] = {"id": design.id}
        return price, config

    # Layered: color + corner + center + optional inside.
    color = _get_active(ColorOption, product, selection.get("color"), "color")
    if color is None:
        raise ValueError("A color selection is required")
    price += Decimal(color.price_modifier)
    config["color"] = {"id": color.id, "name": color.name}

    for key, placement in (("corner", ToppingDesign.Placement.CORNER),
                           ("center", ToppingDesign.Placement.CENTER)):
        topping = _get_active(ToppingDesign, product, selection.get(key), f"{key} design")
        if topping is not None:
            if topping.placement != placement:
                raise ValueError(f"Design {topping.id} is not a {key} design")
            price += Decimal(topping.price_modifier)
            config[key] = {"id": topping.id}

    inside = _get_active(InsideDesign, product, selection.get("inside"), "inside design")
    if inside is not None:
        price += Decimal(inside.price_modifier)
        config["inside"] = {"id": inside.id}

    return price, config
