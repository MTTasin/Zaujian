"""
Seed demo catalog with generated placeholder images so the storefront is
viewable without real uploads. Idempotent-ish: pass --fresh to wipe first.

Run: python manage.py seed_demo [--fresh]
"""

import io
from decimal import Decimal

from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand
from PIL import Image, ImageDraw

from app.models import (
    ColorOption,
    ComboImage,
    DupattaOption,
    InsideDesign,
    PrebuiltCombo,
    Product,
    StaticDesign,
    ToppingDesign,
)

CANVAS = 600  # all base images same size so overlays line up (plan §15.1 / overlays)


def _png(draw_fn, size=CANVAS, transparent=False):
    mode = "RGBA" if transparent else "RGB"
    bg = (0, 0, 0, 0) if transparent else (245, 245, 244)
    img = Image.new(mode, (size, size), bg)
    draw_fn(ImageDraw.Draw(img))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return ContentFile(buf.getvalue())


def _solid(color):
    def fn(d):
        d.rounded_rectangle([40, 40, CANVAS - 40, CANVAS - 40], radius=30, fill=color)
    return fn


def _overlay(color, where):
    def fn(d):
        if where == "corner":
            d.ellipse([30, 30, 160, 160], fill=color)
        else:  # center
            d.regular_polygon((CANVAS // 2, CANVAS // 2, 90), n_sides=8, fill=color)
    return fn


def _label(text, color):
    def fn(d):
        d.rounded_rectangle([40, 40, CANVAS - 40, CANVAS - 40], radius=30, fill=color)
        d.text((CANVAS // 2 - 40, CANVAS // 2), text, fill=(255, 255, 255))
    return fn


class Command(BaseCommand):
    help = "Seed demo catalog with placeholder images"

    def add_arguments(self, parser):
        parser.add_argument("--fresh", action="store_true", help="Wipe catalog first")

    def handle(self, *args, **opts):
        if opts["fresh"]:
            Product.objects.all().delete()
            self.stdout.write("Wiped existing products.")

        self._seed_layered("book", "কাস্টম বই", Decimal("500"), inside=True)
        self._seed_layered("box", "গিফট বক্স", Decimal("400"), inside=False)
        self._seed_static("pen", "প্রিমিয়াম কলম", Decimal("150"))
        self._seed_static("mirror", "মিরর", Decimal("200"))
        self._seed_dupatta()
        self._seed_combos()

        self.stdout.write(self.style.SUCCESS("Demo catalog seeded."))

    def _seed_combos(self):
        PrebuiltCombo.objects.all().delete()
        combos = [
            ("Premium Combo", "প্রিমিয়াম কম্বো", Decimal("1500"), True,
             ["book", "box", "pen"], [(122, 31, 43), (212, 175, 55)]),
            ("Deluxe Combo", "ডিলাক্স কম্বো", Decimal("2200"), True,
             ["book", "box", "pen", "mirror", "dupatta"], [(90, 40, 120), (200, 80, 140)]),
            ("Simple Combo", "সিম্পল কম্বো", Decimal("900"), False,
             ["book", "pen"], [(30, 30, 30)]),
        ]
        for slug_base, name, price, featured, cats, colors in combos:
            slug = slug_base.lower().replace(" ", "-")
            combo = PrebuiltCombo.objects.create(
                name=name, slug=slug, price=price, featured=featured,
                description="সুন্দরভাবে সাজানো রেডিমেড কম্বো।",
            )
            combo.products.set(Product.objects.filter(slug__in=cats))
            for i, rgb in enumerate(colors):
                ComboImage.objects.create(
                    combo=combo, order=i,
                    image=ContentFile(_png(_label(name, rgb)).read(), name=f"{slug}_{i}.png"),
                )

    def _seed_layered(self, category, name, base, inside):
        p, _ = Product.objects.get_or_create(
            slug=category,
            defaults={"name": name, "kind": "layered", "category": category, "base_price": base},
        )
        p.colors.all().delete()
        p.toppings.all().delete()
        colors = [("মেরুন", (122, 31, 43)), ("আইভরি", (225, 220, 200)), ("কালো", (30, 30, 30))]
        for cname, rgb in colors:
            ColorOption.objects.create(
                product=p, name=cname, price_modifier=Decimal("0"),
                base_image=ContentFile(_png(_solid(rgb)).read(), name=f"{category}_{cname}.png"),
            )
        for i, rgb in enumerate([(212, 175, 55), (192, 192, 192)]):
            ToppingDesign.objects.create(
                product=p, placement="corner", pos_x=30, pos_y=30, scale=1.0,
                price_modifier=Decimal("50"),
                image=ContentFile(_png(_overlay(rgb, "corner"), transparent=True).read(),
                                  name=f"{category}_corner_{i}.png"),
            )
            ToppingDesign.objects.create(
                product=p, placement="center", pos_x=0, pos_y=0, scale=1.0,
                price_modifier=Decimal("70"),
                image=ContentFile(_png(_overlay(rgb, "center"), transparent=True).read(),
                                  name=f"{category}_center_{i}.png"),
            )
        if inside:
            p.inside_designs.all().delete()
            for i, rgb in enumerate([(180, 140, 90), (90, 120, 160)]):
                InsideDesign.objects.create(
                    product=p, price_modifier=Decimal("40"),
                    preview_image=ContentFile(_png(_label(f"Inside {i+1}", rgb)).read(),
                                              name=f"inside_{i}.png"),
                )

    def _seed_static(self, category, name, base):
        p, _ = Product.objects.get_or_create(
            slug=category,
            defaults={"name": name, "kind": "gallery", "category": category, "base_price": base},
        )
        p.static_designs.all().delete()
        for i, rgb in enumerate([(122, 31, 43), (30, 30, 30), (212, 175, 55)]):
            StaticDesign.objects.create(
                product=p, price_modifier=Decimal(str(i * 30)),
                image=ContentFile(_png(_label(f"{name} {i+1}", rgb)).read(),
                                  name=f"{category}_{i}.png"),
            )

    def _seed_dupatta(self):
        p, _ = Product.objects.get_or_create(
            slug="dupatta",
            defaults={"name": "ওড়না", "kind": "dupatta", "category": "dupatta", "base_price": Decimal("0")},
        )
        p.dupatta_options.all().delete()
        combos = [
            ("single", 1, Decimal("300")), ("single", 2, Decimal("350")),
            ("four", 1, Decimal("500")), ("four", 2, Decimal("600")),
        ]
        for lace, lines, price in combos:
            DupattaOption.objects.create(
                product=p, lace_type=lace, text_lines=lines, price=price,
                preview_image=ContentFile(
                    _png(_label(f"{lace} {lines}L", (140, 80, 120))).read(),
                    name=f"dupatta_{lace}_{lines}.png"),
            )
