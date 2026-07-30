"""Seed the starter finance categories.

get_or_create so re-running (or running after the admin added their own) is
safe. The reverse is a no-op: deleting categories the admin may already have
posted expenses against would be destructive, and PROTECT would block it anyway.
"""

from django.db import migrations

EXPENSE = [
    "Ads (Facebook)", "Materials", "Courier", "Packaging", "Salary",
    "Rent", "Utilities", "Transport", "Refund", "Other",
]
INCOME = ["Steadfast payout", "Other income"]


def seed(apps, schema_editor):
    FinanceCategory = apps.get_model("app", "FinanceCategory")
    for i, name in enumerate(EXPENSE):
        FinanceCategory.objects.get_or_create(
            name=name, kind="expense", defaults={"order": i},
        )
    for i, name in enumerate(INCOME):
        FinanceCategory.objects.get_or_create(
            name=name, kind="income", defaults={"order": i},
        )


class Migration(migrations.Migration):
    dependencies = [("app", "0032_supplier_remove_order_cost_price_expense_and_more")]
    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
