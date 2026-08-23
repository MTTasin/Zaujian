"""A credit payment records WHEN it happened, not just the day.

The owner hands over round money at a moment and wants the receipt to say so —
two payments to the same supplier on the same day are otherwise indistinguishable
in the statement. The time is stored on the payment itself; rows written before
the field existed have none, and the API falls back to when they were entered
rather than inventing one.

Nothing here touches how credit WORKS: the balance is still credits minus
payments, and no payment is tied to an invoice.
"""

from datetime import date, datetime, time
from decimal import Decimal

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from app.finance_api import contact_history, contact_ledger, payment_clock
from app.models import CreditPayment, Expense, FinanceCategory, Supplier


def client_for(user):
    api = APIClient()
    token, _ = Token.objects.get_or_create(user=user)
    api.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")
    return api


class PaymentTimeTests(TestCase):
    def setUp(self):
        self.cat, _ = FinanceCategory.objects.get_or_create(name="Materials", kind="expense")
        self.supplier = Supplier.objects.create(name="Samim Orna Mirpur")
        Expense.objects.create(
            category=self.cat, supplier=self.supplier, is_credit=True,
            amount=Decimal("2000"), date=date(2026, 8, 1), description="Akhi",
        )

    def pay(self, **kw):
        kw.setdefault("date", date(2026, 8, 4))
        kw.setdefault("amount", Decimal("900"))
        return CreditPayment.objects.create(
            kind=CreditPayment.Kind.PAYABLE, supplier=self.supplier, **kw)

    def test_a_new_payment_stamps_the_clock_without_being_asked(self):
        p = self.pay()
        self.assertIsNotNone(p.time)
        # Seconds are trimmed: nobody reads a payment to the second.
        self.assertEqual(p.time.microsecond, 0)

    def test_the_statement_shows_the_time_the_money_moved(self):
        self.pay(time=time(16, 5))

        row = next(r for r in contact_ledger("payable", self.supplier.id)
                   if r["kind"] == "payment")
        self.assertEqual(row["time"], "16:05")

    def test_a_purchase_on_credit_carries_no_time(self):
        # A purchase on credit is a day, not a moment — showing a clock on it
        # would be a number nobody recorded.
        row = next(r for r in contact_ledger("payable", self.supplier.id)
                   if r["kind"] == "credit")
        self.assertEqual(row["time"], "")

    def test_an_old_payment_falls_back_to_when_it_was_entered(self):
        p = self.pay(time=None)
        entered = timezone.make_aware(datetime(2026, 8, 4, 9, 30))
        CreditPayment.objects.filter(pk=p.pk).update(created_at=entered)

        row = next(r for r in contact_ledger("payable", self.supplier.id)
                   if r["kind"] == "payment")
        self.assertEqual(row["time"], "09:30")

    def test_a_payment_with_no_time_and_no_created_at_shows_nothing(self):
        # Never print a made-up clock. `created_at` is only unset on an unsaved
        # row, but the helper is called from two places and must not blow up.
        self.assertEqual(payment_clock(CreditPayment(time=None)), "")

    def test_the_contact_history_carries_the_time_too(self):
        self.pay(time=time(16, 5))

        row = next(r for r in contact_history("payable", self.supplier.id)["entries"]
                   if r["kind"] == "payment")
        self.assertEqual(row["time"], "16:05")


class PaymentTimeApiTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_superuser("owner", "o@x.com", "x")
        self.api = client_for(self.owner)
        self.supplier = Supplier.objects.create(name="Samim")

    def body(self, **kw):
        return {"kind": "payable", "supplier": self.supplier.id, "buyer": None,
                "date": "2026-08-04", "amount": "900", "fee_amount": "0",
                "account": "bkash", "note": "", **kw}

    def test_the_time_is_saved_and_returned(self):
        resp = self.api.post("/api/admin/credit-payments/",
                             self.body(time="16:05"), format="json")

        self.assertEqual(resp.status_code, 201)
        self.assertTrue(resp.json()["time"].startswith("16:05"))
        self.assertEqual(CreditPayment.objects.get().time, time(16, 5))

    def test_clearing_the_time_box_is_no_time_not_an_error(self):
        # <input type="time"> posts "" when emptied; that must not 400.
        resp = self.api.post("/api/admin/credit-payments/",
                             self.body(time=""), format="json")

        self.assertEqual(resp.status_code, 201)
        self.assertIsNone(CreditPayment.objects.get().time)

    def test_a_payment_posted_without_a_time_still_gets_the_clock(self):
        resp = self.api.post("/api/admin/credit-payments/", self.body(), format="json")

        self.assertEqual(resp.status_code, 201)
        self.assertIsNotNone(CreditPayment.objects.get().time)
