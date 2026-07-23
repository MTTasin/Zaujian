from django.db import migrations

# Map the old category values to the new behavior "kind".
CATEGORY_TO_KIND = {
    "book": "layered",
    "box": "layered",
    "pen": "gallery",
    "mirror": "gallery",
    "dupatta": "dupatta",
}


def backfill(apps, schema_editor):
    Product = apps.get_model("app", "Product")
    for p in Product.objects.all():
        p.kind = CATEGORY_TO_KIND.get(p.category, "simple")
        p.save(update_fields=["kind"])


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0003_product_kind_alter_product_category'),
    ]

    operations = [
        migrations.RunPython(backfill, noop),
    ]
