"""Finance cash-book: totals, MFS/transfer fees, VAT, credit balances, marks.

The load-bearing rules under test:
  - an expense costs `amount + fee_amount`; an income keeps `amount - fee_amount`
  - VAT is INSIDE the amount and must never be added on top
  - order links are a MARK: they must not change a single total
  - credit is a RUNNING ACCOUNT per contact — a payment reduces the balance and
    is never allocated to one purchase or sale, so no history is rewritten
  - a credit sale is not income until the buyer actually pays
"""

from datetime import timedelta
from decimal import Decimal

from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from app.finance_api import (
    cash_in,
    cash_out,
    contact_balance,
    contact_ledger,
    dues_breakdown,
    month_net,
    receivables_breakdown,
    sales_total,
)
from app.models import (
    Buyer,
    CreditPayment,
    Expense,
    FinanceCategory,
    Income,
    Order,
    Supplier,
)

D = Decimal
PAYABLE = CreditPayment.Kind.PAYABLE
RECEIVABLE = CreditPayment.Kind.RECEIVABLE


class FinanceBase(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.today = timezone.localdate()
        # get_or_create: migration 0033 already seeded the starter categories.
        cls.ads, _ = FinanceCategory.objects.get_or_create(
            name="Ads (Facebook)", kind="expense")
        cls.mats, _ = FinanceCategory.objects.get_or_create(
            name="Materials", kind="expense")
        cls.payout, _ = FinanceCategory.objects.get_or_create(
            name="Steadfast payout", kind="income")
        cls.supplier = Supplier.objects.create(name="Dupatta House", phone="0171")
        cls.buyer = Buyer.objects.create(name="Reseller Bhai", phone="0172")
        cls.order = Order.objects.create(
            customer_name="Rahim", phone="01700000000",
            subtotal=D("1500"), delivery_charge=D("120"),
        )

    def expense(self, **kw):
        kw.setdefault("category", self.ads)
        kw.setdefault("date", self.today)
        kw.setdefault("amount", D("1000"))
        if kw.get("is_credit"):
            kw.setdefault("supplier", self.supplier)
        return Expense.objects.create(**kw)

    def income(self, **kw):
        kw.setdefault("category", self.payout)
        kw.setdefault("date", self.today)
        kw.setdefault("amount", D("2000"))
        if kw.get("is_credit"):
            kw.setdefault("buyer", self.buyer)
        return Income.objects.create(**kw)

    def pay_supplier(self, amount, **kw):
        kw.setdefault("date", self.today)
        kw.setdefault("supplier", self.supplier)
        return CreditPayment.objects.create(kind=PAYABLE, amount=D(amount), **kw)

    def buyer_pays(self, amount, **kw):
        kw.setdefault("date", self.today)
        kw.setdefault("buyer", self.buyer)
        return CreditPayment.objects.create(kind=RECEIVABLE, amount=D(amount), **kw)


class ExpenseMathTests(FinanceBase):
    def test_vat_is_inside_the_amount(self):
        # 1150 left the bank, of which 150 was VAT — spending is 1150, not 1300.
        e = self.expense(amount=D("1150"), vat_amount=D("150"))
        self.assertEqual(e.total_out, D("1150"))

    def test_transfer_fee_is_on_top(self):
        e = self.expense(amount=D("1000"), fee_amount=D("18.50"), account="bkash")
        self.assertEqual(e.total_out, D("1018.50"))

    def test_flat_fee_is_stored_verbatim(self):
        # NPSB and similar are flat, not a percentage — nothing recomputes them.
        e = self.expense(amount=D("5000"), fee_amount=D("10"), account="bank")
        self.assertEqual(e.fee_amount, D("10"))
        self.assertEqual(e.total_out, D("5010"))


class IncomeMathTests(FinanceBase):
    def test_mfs_charge_comes_out_of_the_amount(self):
        i = self.income(amount=D("10000"), fee_amount=D("185"), account="bkash")
        self.assertEqual(i.net_amount, D("9815"))

    def test_courier_payout_is_taken_as_given(self):
        # Steadfast already deducted delivery + its 1% COD fee before paying;
        # nothing here recomputes the figure.
        i = self.income(amount=D("1355"))
        self.assertEqual(i.net_amount, D("1355"))


class SupplierBalanceTests(FinanceBase):
    """What we owe: credits taken minus payments made, on the contact."""

    def test_credit_purchase_raises_the_balance(self):
        self.expense(amount=D("3000"), is_credit=True)
        self.assertEqual(contact_balance("payable", self.supplier), D("3000"))

    def test_several_credits_accumulate(self):
        self.expense(amount=D("3000"), is_credit=True)
        self.expense(amount=D("1200"), is_credit=True)
        self.assertEqual(contact_balance("payable", self.supplier), D("4200"))

    def test_a_payment_comes_off_the_total_not_one_purchase(self):
        self.expense(amount=D("3000"), is_credit=True, description="lot A")
        self.expense(amount=D("1200"), is_credit=True, description="lot B")
        self.pay_supplier("2000")
        self.assertEqual(contact_balance("payable", self.supplier), D("2200"))
        # Both purchases are untouched — nothing was marked settled.
        self.assertEqual(Expense.objects.filter(is_credit=True).count(), 2)

    def test_instalments_add_up(self):
        self.expense(amount=D("5000"), is_credit=True)
        self.pay_supplier("1000")
        self.pay_supplier("1500")
        self.pay_supplier("500")
        self.assertEqual(contact_balance("payable", self.supplier), D("2000"))

    def test_transfer_charge_never_moves_the_balance(self):
        # The supplier is credited with what they received, not with the bank's cut.
        self.expense(amount=D("1000"), is_credit=True)
        self.pay_supplier("400", fee_amount=D("7.40"), account="bkash")
        self.assertEqual(contact_balance("payable", self.supplier), D("600"))

    def test_overpaying_shows_as_a_negative_balance(self):
        # They are holding an advance for us. Clamping to 0 would lose the money.
        self.expense(amount=D("500"), is_credit=True)
        self.pay_supplier("800")
        self.assertEqual(contact_balance("payable", self.supplier), D("-300"))

    def test_non_credit_purchases_never_touch_the_balance(self):
        self.expense(amount=D("900"), supplier=self.supplier)
        self.assertEqual(contact_balance("payable", self.supplier), D("0"))

    def test_dues_breakdown_lists_contacts_with_a_balance(self):
        other = Supplier.objects.create(name="Box Wala")
        self.expense(amount=D("1000"), is_credit=True)
        self.expense(amount=D("500"), is_credit=True, supplier=other)
        self.pay_supplier("300")
        total, rows = dues_breakdown()
        self.assertEqual(total, D("1200"))
        self.assertEqual([r["supplier"] for r in rows], ["Dupatta House", "Box Wala"])
        self.assertEqual(rows[0]["due"], 700.0)

    def test_a_settled_contact_drops_out_of_the_breakdown(self):
        self.expense(amount=D("1000"), is_credit=True)
        self.pay_supplier("1000")
        total, rows = dues_breakdown()
        self.assertEqual(total, D("0"))
        self.assertEqual(rows, [])


class BuyerBalanceTests(FinanceBase):
    """Mirror of the supplier side: what buyers owe us."""

    def test_credit_sale_is_not_income_until_paid(self):
        self.income(amount=D("4000"), is_credit=True)
        self.assertEqual(cash_in(self.today, self.today), D("0"))
        self.assertEqual(month_net(self.today)["income"], 0.0)

    def test_credit_sale_still_counts_as_a_sale(self):
        self.income(amount=D("4000"), is_credit=True)
        self.assertEqual(sales_total(self.today, self.today), D("4000"))
        self.assertEqual(contact_balance("receivable", self.buyer), D("4000"))

    def test_part_payment_becomes_income_and_lowers_the_balance(self):
        self.income(amount=D("4000"), is_credit=True)
        self.buyer_pays("1500")
        self.assertEqual(contact_balance("receivable", self.buyer), D("2500"))
        self.assertEqual(cash_in(self.today, self.today), D("1500"))

    def test_one_payment_covers_several_sales(self):
        self.income(amount=D("1000"), is_credit=True, description="sale 1")
        self.income(amount=D("2000"), is_credit=True, description="sale 2")
        self.income(amount=D("3000"), is_credit=True, description="sale 3")
        self.buyer_pays("2500")
        self.assertEqual(contact_balance("receivable", self.buyer), D("3500"))
        # All three sales still exist, untouched.
        self.assertEqual(Income.objects.filter(is_credit=True).count(), 3)

    def test_mfs_charge_reduces_cash_but_not_the_balance(self):
        self.income(amount=D("4000"), is_credit=True)
        self.buyer_pays("2000", fee_amount=D("37"), account="bkash")
        self.assertEqual(contact_balance("receivable", self.buyer), D("2000"))
        self.assertEqual(cash_in(self.today, self.today), D("1963"))

    def test_payment_counts_on_its_own_date_not_the_sale_date(self):
        old = self.today - timedelta(days=10)
        self.income(amount=D("1000"), is_credit=True, date=old)
        self.buyer_pays("1000")
        self.assertEqual(cash_in(old, old), D("0"))
        self.assertEqual(cash_in(self.today, self.today), D("1000"))

    def test_receivables_breakdown_groups_by_buyer(self):
        other = Buyer.objects.create(name="Shop Two")
        self.income(amount=D("1000"), is_credit=True)
        self.income(amount=D("500"), is_credit=True)
        self.income(amount=D("200"), is_credit=True, buyer=other)
        self.income(amount=D("900"))                      # cash sale
        total, rows = receivables_breakdown()
        self.assertEqual(total, D("1700"))
        self.assertEqual(rows[0]["buyer"], "Reseller Bhai")
        self.assertEqual(rows[0]["receivable"], 1500.0)
        self.assertEqual(rows[0]["count"], 2)

    def test_the_two_directions_are_independent(self):
        # Owing a supplier must never net against what a buyer owes us.
        self.expense(amount=D("3000"), is_credit=True)
        self.income(amount=D("2000"), is_credit=True)
        net = month_net(self.today)
        self.assertEqual(net["dues"], 3000.0)
        self.assertEqual(net["receivable"], 2000.0)


class LedgerTests(FinanceBase):
    """The statement: full history, oldest first, with a running balance."""

    def test_running_balance_walks_credits_and_payments(self):
        self.income(amount=D("1000"), is_credit=True,
                    date=self.today - timedelta(days=10), description="sale 1")
        self.income(amount=D("2000"), is_credit=True,
                    date=self.today - timedelta(days=5), description="sale 2")
        self.buyer_pays("1200", date=self.today - timedelta(days=2))
        rows = contact_ledger("receivable", self.buyer.id)
        self.assertEqual([r["kind"] for r in rows], ["credit", "credit", "payment"])
        self.assertEqual([r["balance"] for r in rows], [1000.0, 3000.0, 1800.0])

    def test_nothing_is_consumed_so_history_survives_a_payment(self):
        self.expense(amount=D("800"), is_credit=True, description="dupattas")
        self.pay_supplier("800")
        rows = contact_ledger("payable", self.supplier.id)
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["label"], "dupattas")
        self.assertEqual(rows[-1]["balance"], 0.0)

    def test_a_credit_on_the_same_day_is_counted_before_the_payment(self):
        # Otherwise a same-day "buy 1000, pay 1000" would read as -1000 then 0.
        self.expense(amount=D("1000"), is_credit=True)
        self.pay_supplier("1000")
        rows = contact_ledger("payable", self.supplier.id)
        self.assertEqual([r["balance"] for r in rows], [1000.0, 0.0])


class CashFlowTests(FinanceBase):
    def test_cash_out_counts_non_credit_expenses_with_fees(self):
        self.expense(amount=D("1000"), fee_amount=D("20"))
        self.assertEqual(cash_out(self.today, self.today), D("1020"))

    def test_a_credit_purchase_alone_moves_no_cash(self):
        self.expense(amount=D("2000"), is_credit=True)
        self.assertEqual(cash_out(self.today, self.today), D("0"))

    def test_credit_purchase_hits_cash_out_when_paid(self):
        self.expense(amount=D("2000"), is_credit=True)
        self.pay_supplier("2000", fee_amount=D("30"))
        self.assertEqual(cash_out(self.today, self.today), D("2030"))

    def test_month_net_uses_fees_on_both_sides(self):
        self.income(amount=D("5000"), fee_amount=D("100"))     # keeps 4900
        self.expense(amount=D("1000"), fee_amount=D("50"))     # costs 1050
        net = month_net(self.today)
        self.assertEqual(net["income"], 4900.0)
        self.assertEqual(net["expense"], 1050.0)
        self.assertEqual(net["net"], 3850.0)

    def test_month_net_ignores_last_month(self):
        first = self.today.replace(day=1)
        self.income(amount=D("999"), date=first - timedelta(days=1))
        self.assertEqual(month_net(self.today)["income"], 0.0)


class OrderMarkTests(FinanceBase):
    """An order link is a note about what money was for — never an allocation."""

    def test_marks_do_not_change_totals(self):
        e = self.expense(amount=D("1000"))
        i = self.income(amount=D("2000"))
        before = month_net(self.today)
        e.orders.add(self.order)
        i.orders.add(self.order)
        self.assertEqual(month_net(self.today), before)

    def test_one_expense_can_mark_many_orders_without_splitting(self):
        other = Order.objects.create(customer_name="Karim", phone="01800000000",
                                     subtotal=D("500"))
        e = self.expense(amount=D("900"))
        e.orders.add(self.order, other)
        # No per-order share exists anywhere: the expense stays whole.
        self.assertEqual(e.amount, D("900"))
        self.assertEqual(e.orders.count(), 2)
        self.assertEqual(month_net(self.today)["expense"], 900.0)

    def test_order_has_no_cost_price_field(self):
        self.assertFalse(hasattr(self.order, "cost_price"))
        self.assertFalse(hasattr(self.order, "profit"))


class FinanceApiTests(FinanceBase):
    def setUp(self):
        self.client = APIClient()
        self.staff = User.objects.create_superuser("boss", password="x")
        self.client.force_authenticate(self.staff)

    # ---- summary ----

    def test_summary_requires_admin(self):
        res = APIClient().get(reverse("admin-finance-summary"))
        self.assertIn(res.status_code, (401, 403))

    def test_summary_totals(self):
        self.income(amount=D("5000"), fee_amount=D("100"))
        self.expense(amount=D("1150"), vat_amount=D("150"), fee_amount=D("50"))
        d = self.client.get(reverse("admin-finance-summary")).json()
        self.assertEqual(d["income_total"], 4900.0)     # net of the MFS charge
        self.assertEqual(d["sales_total"], 5000.0)
        self.assertEqual(d["expense_total"], 1200.0)    # 1150 + 50 fee
        self.assertEqual(d["vat_total"], 150.0)         # inside the 1150
        self.assertEqual(d["fee_total"], 150.0)
        self.assertEqual(d["net"], 3700.0)

    def test_summary_separates_a_credit_sale_from_received_money(self):
        self.income(amount=D("3000"), is_credit=True)
        self.income(amount=D("500"))
        d = self.client.get(reverse("admin-finance-summary")).json()
        self.assertEqual(d["income_total"], 500.0)        # only the cash sale
        self.assertEqual(d["sales_total"], 3500.0)
        self.assertEqual(d["receivable_total"], 3000.0)
        self.assertEqual(d["receivable_by_buyer"][0]["buyer"], "Reseller Bhai")

    def test_summary_range_excludes_outside_days(self):
        self.income(amount=D("1000"), date=self.today - timedelta(days=40))
        self.income(amount=D("300"))
        res = self.client.get(reverse("admin-finance-summary"), {
            "start": self.today.isoformat(), "end": self.today.isoformat(),
        })
        self.assertEqual(res.json()["income_total"], 300.0)

    def test_summary_daily_series_is_zero_filled(self):
        res = self.client.get(reverse("admin-finance-summary"), {
            "start": (self.today - timedelta(days=2)).isoformat(),
            "end": self.today.isoformat(),
        })
        self.assertEqual(len(res.json()["daily"]), 3)

    def test_bad_dates_fall_back_instead_of_500(self):
        res = self.client.get(reverse("admin-finance-summary"),
                              {"start": "banana", "end": "2026-13-45"})
        self.assertEqual(res.status_code, 200)

    def test_reversed_range_is_swapped(self):
        self.income(amount=D("77"))
        res = self.client.get(reverse("admin-finance-summary"), {
            "start": self.today.isoformat(),
            "end": (self.today - timedelta(days=5)).isoformat(),
        })
        self.assertEqual(res.json()["income_total"], 77.0)

    # ---- entries ----

    def test_create_expense_with_order_marks(self):
        res = self.client.post("/api/admin/expenses/", {
            "date": self.today.isoformat(), "category": self.mats.id,
            "description": "Dupatta lot", "amount": "1200", "fee_amount": "10",
            "account": "bkash", "orders": [self.order.id],
        }, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.json()["order_marks"][0]["uid"], self.order.uid)
        self.assertEqual(res.json()["total_out"], "1210.00")

    def test_expense_rejects_an_income_category(self):
        res = self.client.post("/api/admin/expenses/", {
            "date": self.today.isoformat(), "category": self.payout.id,
            "amount": "100",
        }, format="json")
        self.assertEqual(res.status_code, 400)

    def test_expense_rejects_vat_above_amount(self):
        res = self.client.post("/api/admin/expenses/", {
            "date": self.today.isoformat(), "category": self.ads.id,
            "amount": "100", "vat_amount": "150",
        }, format="json")
        self.assertEqual(res.status_code, 400)

    def test_income_rejects_fee_above_amount(self):
        res = self.client.post("/api/admin/incomes/", {
            "date": self.today.isoformat(), "category": self.payout.id,
            "amount": "100", "fee_amount": "150",
        }, format="json")
        self.assertEqual(res.status_code, 400)

    def test_zero_amount_rejected(self):
        res = self.client.post("/api/admin/incomes/", {
            "date": self.today.isoformat(), "category": self.payout.id, "amount": "0",
        }, format="json")
        self.assertEqual(res.status_code, 400)

    def test_credit_entry_needs_a_contact(self):
        # The balance lives on the contact, so a nameless credit could never be paid.
        res = self.client.post("/api/admin/incomes/", {
            "date": self.today.isoformat(), "category": self.payout.id,
            "amount": "500", "is_credit": True,
        }, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("buyer", res.json())

    def test_credit_entry_cannot_carry_its_own_mfs_fee(self):
        for path, extra in (("expenses", {"category": self.mats.id,
                                          "supplier": self.supplier.id}),
                            ("incomes", {"category": self.payout.id,
                                         "buyer": self.buyer.id})):
            with self.subTest(path=path):
                res = self.client.post(f"/api/admin/{path}/", {
                    "date": self.today.isoformat(), "amount": "1000",
                    "fee_amount": "18", "is_credit": True, **extra,
                }, format="json")
                self.assertEqual(res.status_code, 400)

    # ---- credit payments ----

    def test_record_a_payment_against_a_buyer(self):
        self.income(amount=D("2500"), is_credit=True)
        res = self.client.post("/api/admin/credit-payments/", {
            "kind": "receivable", "buyer": self.buyer.id,
            "date": self.today.isoformat(), "amount": "1000",
            "fee_amount": "18", "account": "bkash",
        }, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(contact_balance("receivable", self.buyer), D("1500"))
        self.assertEqual(cash_in(self.today, self.today), D("982"))

    def test_payment_needs_the_matching_contact(self):
        res = self.client.post("/api/admin/credit-payments/", {
            "kind": "receivable", "supplier": self.supplier.id,
            "date": self.today.isoformat(), "amount": "100",
        }, format="json")
        self.assertEqual(res.status_code, 400)

    def test_the_unused_side_is_blanked_so_nothing_double_counts(self):
        res = self.client.post("/api/admin/credit-payments/", {
            "kind": "payable", "supplier": self.supplier.id,
            "buyer": self.buyer.id, "date": self.today.isoformat(), "amount": "100",
        }, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertIsNone(res.json()["buyer"])

    def test_editing_a_payment_moves_the_balance(self):
        self.expense(amount=D("1000"), is_credit=True)
        pay = self.pay_supplier("400")
        res = self.client.patch(f"/api/admin/credit-payments/{pay.id}/",
                                {"amount": "250"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(contact_balance("payable", self.supplier), D("750"))

    def test_deleting_a_payment_puts_the_balance_back(self):
        self.income(amount=D("900"), is_credit=True)
        pay = self.buyer_pays("900")
        self.assertEqual(contact_balance("receivable", self.buyer), D("0"))
        res = self.client.delete(f"/api/admin/credit-payments/{pay.id}/")
        self.assertEqual(res.status_code, 204)
        self.assertEqual(contact_balance("receivable", self.buyer), D("900"))
        self.assertEqual(cash_in(self.today, self.today), D("0"))

    def test_payments_can_be_filtered_by_contact(self):
        self.expense(amount=D("500"), is_credit=True)
        self.income(amount=D("500"), is_credit=True)
        self.pay_supplier("100")
        self.buyer_pays("200")
        rows = self.client.get("/api/admin/credit-payments/",
                               {"kind": "payable"}).json()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["contact_name"], "Dupatta House")

    # ---- ledger ----

    def test_ledger_returns_statement_and_balance(self):
        self.income(amount=D("1000"), is_credit=True, description="sale")
        self.buyer_pays("400")
        d = self.client.get(reverse("admin-finance-ledger"),
                            {"direction": "receivable", "contact": self.buyer.id}).json()
        self.assertEqual(d["balance"], 600.0)
        self.assertEqual(len(d["entries"]), 2)
        self.assertEqual(d["contact"]["name"], "Reseller Bhai")

    def test_ledger_rejects_a_bad_direction(self):
        res = self.client.get(reverse("admin-finance-ledger"),
                              {"direction": "sideways", "contact": self.buyer.id})
        self.assertEqual(res.status_code, 400)

    def test_ledger_unknown_contact_is_404(self):
        res = self.client.get(reverse("admin-finance-ledger"),
                              {"direction": "payable", "contact": 999999})
        self.assertEqual(res.status_code, 404)

    # ---- contacts + categories ----

    def test_editing_an_entry_does_not_touch_the_payments(self):
        self.expense(amount=D("2000"), is_credit=True)
        self.pay_supplier("500")
        e = Expense.objects.filter(is_credit=True).first()
        res = self.client.patch(f"/api/admin/expenses/{e.id}/",
                                {"amount": "2400", "description": "corrected"},
                                format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(contact_balance("payable", self.supplier), D("1900"))

    def test_renaming_a_category_keeps_old_entries_attached(self):
        e = self.expense(category=self.mats, amount=D("300"))
        res = self.client.patch(f"/api/admin/finance-categories/{self.mats.id}/",
                                {"name": "Raw materials"}, format="json")
        self.assertEqual(res.status_code, 200)
        row = self.client.get(f"/api/admin/expenses/{e.id}/").json()
        self.assertEqual(row["category_name"], "Raw materials")

    def test_category_in_use_cannot_be_deleted(self):
        self.expense(category=self.mats)
        res = self.client.delete(f"/api/admin/finance-categories/{self.mats.id}/")
        self.assertEqual(res.status_code, 400)
        self.assertTrue(FinanceCategory.objects.filter(pk=self.mats.pk).exists())

    def test_supplier_row_reports_the_balance(self):
        self.expense(amount=D("1000"), is_credit=True)
        self.pay_supplier("250")
        rows = self.client.get("/api/admin/suppliers/").json()
        self.assertEqual(rows[0]["due"], "750.00")

    def test_buyer_row_reports_what_is_owed(self):
        self.income(amount=D("1200"), is_credit=True)
        rows = self.client.get("/api/admin/buyers/").json()
        self.assertEqual(rows[0]["receivable"], "1200.00")

    def test_deleting_a_supplier_takes_its_payments_with_it(self):
        # SET_NULL on the expense keeps the purchase (money spent is history),
        # but the payments are meaningless without a counterparty, so they cascade.
        self.expense(amount=D("700"), is_credit=True)
        self.pay_supplier("200")
        res = self.client.delete(f"/api/admin/suppliers/{self.supplier.id}/")
        self.assertEqual(res.status_code, 204)
        e = Expense.objects.filter(is_credit=True).first()
        self.assertIsNone(e.supplier)
        self.assertEqual(e.amount, D("700"))
        self.assertEqual(CreditPayment.objects.count(), 0)

    # ---- misc ----

    def test_order_search_is_light_and_matches_uid(self):
        res = self.client.get(reverse("admin-finance-order-search"),
                              {"q": self.order.uid})
        row = res.json()[0]
        self.assertEqual(row["uid"], self.order.uid)
        self.assertNotIn("items", row)

    def test_order_finance_lists_what_is_marked(self):
        e = self.expense(amount=D("300"), fee_amount=D("5"))
        e.orders.add(self.order)
        d = self.client.get(reverse("admin-finance-order", args=[self.order.id])).json()
        self.assertEqual(d["expense_total"], 305.0)
        self.assertEqual(len(d["expenses"]), 1)

    def test_meta_exposes_accounts_with_default_rates(self):
        res = self.client.get(reverse("admin-finance-meta"))
        accounts = {a["value"]: a["fee_rate"] for a in res.json()["accounts"]}
        self.assertIn("bkash", accounts)
        self.assertEqual(accounts["cash"], "0")

    def test_dashboard_reports_month_net_not_order_profit(self):
        self.income(amount=D("1000"))
        d = self.client.get(reverse("admin-dashboard")).json()
        self.assertEqual(d["month_income"], 1000.0)
        self.assertNotIn("total_profit", d)
        self.assertNotIn("uncosted_count", d)
