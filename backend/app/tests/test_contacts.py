"""The contact pages: what is still owed, and the full history with someone.

Two different questions, deliberately answered by two different views:

  Credit tab   — "what do I still owe for?"  Only rows still owing, and they
                 add up to the balance exactly.
  Contact page — "everything between us."    Credit purchases, CASH purchases
                 and payments in one timeline. A cash purchase belongs in the
                 history but must never move the balance: it was paid at the
                 time, nothing is owed on it.

Neither view changes how credit WORKS. A payment still moves the contact's
running balance and is never tied to one invoice.
"""

from datetime import date
from decimal import Decimal

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from app.finance_api import contact_history, contact_ledger
from app.models import (
    Buyer, CreditPayment, Expense, FinanceCategory, Income, Supplier,
)


def client_for(user):
    api = APIClient()
    token, _ = Token.objects.get_or_create(user=user)
    api.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")
    return api


class SupplierHistoryTests(TestCase):
    def setUp(self):
        self.cat, _ = FinanceCategory.objects.get_or_create(name="Materials", kind="expense")
        self.supplier = Supplier.objects.create(name="Samim Orna Mirpur")
        # Bought on credit twice, paid once, and bought one dupatta for cash.
        self.first = Expense.objects.create(
            category=self.cat, supplier=self.supplier, is_credit=True,
            amount=Decimal("900"), date=date(2026, 8, 1), description="Akhi",
        )
        self.second = Expense.objects.create(
            category=self.cat, supplier=self.supplier, is_credit=True,
            amount=Decimal("1100"), date=date(2026, 8, 5), description="Nazifa",
        )
        self.cash = Expense.objects.create(
            category=self.cat, supplier=self.supplier, is_credit=False,
            amount=Decimal("750"), date=date(2026, 8, 3), description="Dupatta cash",
        )
        CreditPayment.objects.create(
            kind=CreditPayment.Kind.PAYABLE, supplier=self.supplier,
            amount=Decimal("900"), date=date(2026, 8, 4),
        )

    def test_the_statement_says_what_each_row_still_owes(self):
        rows = contact_ledger("payable", self.supplier.id)
        credits = {r["id"]: r for r in rows if r["kind"] == "credit"}

        self.assertEqual(credits[self.first.id]["remaining"], 0)      # settled
        self.assertEqual(credits[self.second.id]["remaining"], 1100)  # still owed

    def test_what_is_still_owed_adds_up_to_the_balance(self):
        rows = contact_ledger("payable", self.supplier.id)
        owing = sum(r["remaining"] for r in rows if r["kind"] == "credit")

        self.assertEqual(owing, 1100)
        self.assertEqual(rows[-1]["balance"], 1100)

    def test_a_cash_purchase_stays_out_of_the_statement(self):
        """The Credit tab is about what is owed; a cash buy owes nothing."""
        rows = contact_ledger("payable", self.supplier.id)
        self.assertNotIn("Dupatta cash", [r["label"] for r in rows])

    def test_the_contact_page_shows_every_transaction(self):
        data = contact_history("payable", self.supplier.id)
        labels = [e["label"] for e in data["entries"]]

        self.assertIn("Akhi", labels)
        self.assertIn("Nazifa", labels)
        self.assertIn("Dupatta cash", labels)          # the cash one too
        self.assertEqual(len(data["entries"]), 4)      # 3 purchases + 1 payment

    def test_a_cash_purchase_does_not_move_the_balance(self):
        data = contact_history("payable", self.supplier.id)
        cash = next(e for e in data["entries"] if e["label"] == "Dupatta cash")

        self.assertFalse(cash["affects_balance"])
        self.assertEqual(data["balance"], 1100)        # 900 + 1100 − 900 paid

    def test_the_totals_answer_what_was_bought_and_what_was_paid(self):
        data = contact_history("payable", self.supplier.id)

        self.assertEqual(data["totals"]["bought"], 2750)   # 900 + 1100 + 750 cash
        self.assertEqual(data["totals"]["paid"], 1650)     # 900 payment + 750 cash
        self.assertEqual(data["totals"]["balance"], 1100)

    def test_the_timeline_is_in_date_order(self):
        data = contact_history("payable", self.supplier.id)
        dates = [e["date"] for e in data["entries"]]
        self.assertEqual(dates, sorted(dates))


class BuyerHistoryTests(TestCase):
    """The mirror side: someone who owes US."""

    def setUp(self):
        self.cat, _ = FinanceCategory.objects.get_or_create(name="Direct Sale", kind="income")
        self.buyer = Buyer.objects.create(name="Abir RHS")
        Income.objects.create(category=self.cat, buyer=self.buyer, is_credit=True,
                              amount=Decimal("2600"), date=date(2026, 8, 18),
                              description="Abir advance")
        Income.objects.create(category=self.cat, buyer=self.buyer, is_credit=False,
                              amount=Decimal("500"), date=date(2026, 8, 19),
                              description="Cash sale")
        CreditPayment.objects.create(
            kind=CreditPayment.Kind.RECEIVABLE, buyer=self.buyer,
            amount=Decimal("1000"), date=date(2026, 8, 18),
        )

    def test_the_buyer_balance_is_what_is_still_owed_to_us(self):
        data = contact_history("receivable", self.buyer.id)

        self.assertEqual(data["balance"], 1600)
        self.assertEqual(data["totals"]["bought"], 3100)   # sold to them
        self.assertEqual(data["totals"]["paid"], 1500)     # 1000 received + 500 cash

    def test_a_cash_sale_is_in_the_history_but_owes_nothing(self):
        data = contact_history("receivable", self.buyer.id)
        cash = next(e for e in data["entries"] if e["label"] == "Cash sale")
        self.assertFalse(cash["affects_balance"])


class ContactApiTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_superuser("owner", "o@x.com", "x")
        self.api = client_for(self.owner)
        self.supplier = Supplier.objects.create(name="Samim")
        cat, _ = FinanceCategory.objects.get_or_create(name="Materials", kind="expense")
        Expense.objects.create(category=cat, supplier=self.supplier, is_credit=True,
                               amount=Decimal("900"), date=date(2026, 8, 1))

    def test_the_endpoint_answers_with_the_history(self):
        resp = self.api.get(
            f"/api/admin/finance/contact/?direction=payable&contact={self.supplier.id}")

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["contact"]["name"], "Samim")
        self.assertEqual(resp.json()["balance"], 900)

    def test_an_unknown_contact_404s_rather_than_answering_with_nothing(self):
        resp = self.api.get("/api/admin/finance/contact/?direction=payable&contact=9999")
        self.assertEqual(resp.status_code, 404)

    def test_a_bad_direction_is_refused(self):
        resp = self.api.get(
            f"/api/admin/finance/contact/?direction=sideways&contact={self.supplier.id}")
        self.assertEqual(resp.status_code, 400)

    def test_it_needs_the_finance_section(self):
        from app.models import StaffProfile
        from app.permissions import FULL

        mod = User.objects.create_user("mod", password="x", is_staff=True)
        StaffProfile.objects.create(user=mod, access={"orders": FULL})

        resp = client_for(mod).get(
            f"/api/admin/finance/contact/?direction=payable&contact={self.supplier.id}")
        self.assertEqual(resp.status_code, 403)
