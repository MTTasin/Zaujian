"""
Finance cash-book API (admin panel, English, token auth, IsAdminUser).

Cash basis. Income = money actually received (Steadfast payouts + any other
source); the payout figure IS the income — Steadfast has already deducted the
delivery charge and its 1% COD fee, so nothing is recomputed here.

There is no per-order costing. Expense/Income may be linked to orders, but that
link is a MARK ONLY — it never splits, allocates, or changes any total.

Credit runs BOTH ways, on separate contact lists, as a RUNNING ACCOUNT:
  Expense.is_credit + Supplier -> dues        (we owe them)
  Income.is_credit  + Buyer    -> receivables (they owe us)
A CreditPayment moves the CONTACT's balance, never one invoice. Nothing is
allocated or rewritten: the credits stay as they happened, the payments stay as
they happened, and the balance is simply the difference.

Cash basis means a credit SALE contributes nothing until the buyer pays; until
then it sits in that buyer's balance. Numbers reported side by side:
  income    = cash actually received (non-credit incomes + receivable payments)
  sales     = everything earned in the range, credit included but unpaid
  spending  = Expense.amount + fee by expense date  (what was bought + cost to pay)
  cash_out  = non-credit expenses + payable payments, fees included
  dues      = balance owed to suppliers
  receivable= balance owed to us by buyers

MFS charges (bKash/Nagad/bank) live in `fee_amount` on every row, never folded
into a price: on money going out the fee is paid ON TOP of the amount, on money
coming in it is DEDUCTED from it. A charge never moves a credit balance — the
counterparty is credited with what they handed over, not with the bank's cut.

See docs/superpowers/specs/2026-07-27-finance-cashbook-design.md.
"""

from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.db.models import Count, DecimalField, F, Q, Sum, Value
from django.db.models.functions import Coalesce
from django.utils import timezone
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response

from .models import (
    Buyer,
    CreditPayment,
    Expense,
    FinanceCategory,
    Income,
    Order,
    Supplier,
)

ZERO = Decimal("0")
_MONEY = DecimalField(max_digits=14, decimal_places=2)


def _sum(qs, field="amount"):
    """Sum a money column (or expression), always a Decimal — never None/float."""
    return qs.aggregate(t=Coalesce(Sum(field), Value(ZERO), output_field=_MONEY))["t"]


# Money actually gone for an expense row = purchase + the charge to pay it.
OUT = F("amount") + F("fee_amount")
# Money actually kept from an income row = received - the MFS charge.
IN = F("amount") - F("fee_amount")


def fee_rates():
    """Default MFS/transfer rate per account, percent. Pre-fills the admin box."""
    return {
        k: str(v) for k, v in getattr(settings, "FINANCE_FEE_RATES", {}).items()
    }


def parse_date(value, default=None):
    """`YYYY-MM-DD` -> date. Anything else -> `default`."""
    from datetime import datetime

    if not value:
        return default
    try:
        return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()
    except ValueError:
        return default


def _range(request):
    """?start=&end= (inclusive). Defaults to the last 30 days, ending today."""
    today = timezone.localdate()
    end = parse_date(request.query_params.get("end"), today)
    start = parse_date(request.query_params.get("start"), end - timedelta(days=29))
    if start > end:
        start, end = end, start
    return start, end


# --------------------------------------------------------------------------- #
# Serializers
# --------------------------------------------------------------------------- #

class FinanceCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = FinanceCategory
        fields = ["id", "name", "kind", "order", "active"]


class SupplierSerializer(serializers.ModelSerializer):
    due = serializers.SerializerMethodField()

    class Meta:
        model = Supplier
        fields = ["id", "name", "phone", "note", "active", "due", "created_at"]

    def get_due(self, obj):
        return str(contact_balance("payable", obj))


class BuyerSerializer(serializers.ModelSerializer):
    """Someone who owes US. `receivable` is the mirror of Supplier.due."""
    receivable = serializers.SerializerMethodField()

    class Meta:
        model = Buyer
        fields = ["id", "name", "phone", "note", "active", "receivable", "created_at"]

    def get_receivable(self, obj):
        return str(contact_balance("receivable", obj))


class CreditPaymentSerializer(serializers.ModelSerializer):
    contact_name = serializers.SerializerMethodField()

    class Meta:
        model = CreditPayment
        fields = ["id", "kind", "supplier", "buyer", "contact_name",
                  "date", "amount", "fee_amount", "account", "note", "created_at"]

    def get_contact_name(self, obj):
        who = obj.supplier or obj.buyer
        return who.name if who else ""

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError("Amount must be greater than 0.")
        return value

    def validate(self, attrs):
        kind = attrs.get("kind", getattr(self.instance, "kind", None))
        supplier = attrs.get("supplier", getattr(self.instance, "supplier", None))
        buyer = attrs.get("buyer", getattr(self.instance, "buyer", None))
        if attrs.get("fee_amount", getattr(self.instance, "fee_amount", ZERO)) < 0:
            raise serializers.ValidationError({"fee_amount": "Fee cannot be negative."})
        # A payment with no counterparty could never be shown against a balance.
        if kind == CreditPayment.Kind.PAYABLE and not supplier:
            raise serializers.ValidationError({"supplier": "Pick the supplier being paid."})
        if kind == CreditPayment.Kind.RECEIVABLE and not buyer:
            raise serializers.ValidationError({"buyer": "Pick the buyer who paid."})
        # Keep the unused side blank so a row can never be double-counted.
        if kind == CreditPayment.Kind.PAYABLE:
            attrs["buyer"] = None
        else:
            attrs["supplier"] = None
        return attrs


class OrderMarkSerializer(serializers.ModelSerializer):
    """The light order shape used for marks + the picker typeahead."""
    total = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)

    class Meta:
        model = Order
        fields = ["id", "uid", "customer_name", "phone", "total", "status", "created_at"]


class ExpenseSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source="category.name", read_only=True)
    supplier_name = serializers.CharField(source="supplier.name", read_only=True, default="")
    total_out = serializers.SerializerMethodField()
    order_marks = OrderMarkSerializer(source="orders", many=True, read_only=True)

    class Meta:
        model = Expense
        fields = [
            "id", "date", "category", "category_name", "description",
            "amount", "vat_amount", "fee_amount", "total_out",
            "account", "supplier", "supplier_name",
            "is_credit", "reference", "receipt", "orders", "order_marks",
            "created_at",
        ]
        extra_kwargs = {"orders": {"required": False}}

    def get_total_out(self, obj):
        return str(obj.total_out)

    def validate_category(self, value):
        if value.kind != FinanceCategory.Kind.EXPENSE:
            raise serializers.ValidationError("Not an expense category.")
        return value

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError("Amount must be greater than 0.")
        return value

    def validate(self, attrs):
        # VAT is a slice of the amount; the transfer fee sits on top of it.
        amount = attrs.get("amount", getattr(self.instance, "amount", ZERO))
        vat = attrs.get("vat_amount", getattr(self.instance, "vat_amount", ZERO))
        fee = attrs.get("fee_amount", getattr(self.instance, "fee_amount", ZERO))
        if vat < 0:
            raise serializers.ValidationError({"vat_amount": "VAT cannot be negative."})
        if vat > amount:
            raise serializers.ValidationError(
                {"vat_amount": "VAT is part of the amount, so it cannot exceed it."}
            )
        if fee < 0:
            raise serializers.ValidationError({"fee_amount": "Fee cannot be negative."})
        credit = attrs.get("is_credit", getattr(self.instance, "is_credit", False))
        if credit and fee:
            # Nothing has moved yet, so no transfer charge can exist on the
            # purchase itself — it belongs to whichever payment settles it.
            # Same rule as the sales side.
            raise serializers.ValidationError(
                {"fee_amount": "A credit purchase has no charge yet — record it on the payment."}
            )
        supplier = attrs.get("supplier", getattr(self.instance, "supplier", None))
        if credit and not supplier:
            # The balance lives on the contact, so a credit row without one
            # could never be paid off.
            raise serializers.ValidationError(
                {"supplier": "Pick the supplier — credit is tracked per contact."}
            )
        return attrs


class IncomeSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source="category.name", read_only=True)
    buyer_name = serializers.CharField(source="buyer.name", read_only=True, default="")
    net_amount = serializers.SerializerMethodField()
    order_marks = OrderMarkSerializer(source="orders", many=True, read_only=True)

    class Meta:
        model = Income
        fields = [
            "id", "date", "category", "category_name", "description",
            "amount", "fee_amount", "net_amount", "account", "reference",
            "buyer", "buyer_name", "is_credit",
            "orders", "order_marks", "created_at",
        ]
        extra_kwargs = {"orders": {"required": False}}

    def get_net_amount(self, obj):
        return str(obj.net_amount)

    def validate_category(self, value):
        if value.kind != FinanceCategory.Kind.INCOME:
            raise serializers.ValidationError("Not an income category.")
        return value

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError("Amount must be greater than 0.")
        return value

    def validate(self, attrs):
        amount = attrs.get("amount", getattr(self.instance, "amount", ZERO))
        fee = attrs.get("fee_amount", getattr(self.instance, "fee_amount", ZERO))
        credit = attrs.get("is_credit", getattr(self.instance, "is_credit", False))
        if fee < 0:
            raise serializers.ValidationError({"fee_amount": "Fee cannot be negative."})
        if fee > amount:
            # The charge comes out of what was received, so it cannot exceed it.
            raise serializers.ValidationError(
                {"fee_amount": "Fee is deducted from the amount, so it cannot exceed it."}
            )
        if credit and fee:
            # No money moved yet, so no MFS charge can exist on the sale itself —
            # charges belong to the payments that clear it.
            raise serializers.ValidationError(
                {"fee_amount": "A credit sale has no charge yet — record it on the payment."}
            )
        buyer = attrs.get("buyer", getattr(self.instance, "buyer", None))
        if credit and not buyer:
            raise serializers.ValidationError(
                {"buyer": "Pick the buyer — credit is tracked per contact."}
            )
        return attrs


# --------------------------------------------------------------------------- #
# ViewSets
# --------------------------------------------------------------------------- #

class AdminFinanceCategoryViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAdminUser]
    serializer_class = FinanceCategorySerializer
    queryset = FinanceCategory.objects.all()

    def get_queryset(self):
        qs = super().get_queryset()
        kind = self.request.query_params.get("kind")
        if kind in dict(FinanceCategory.Kind.choices):
            qs = qs.filter(kind=kind)
        if self.request.query_params.get("active") == "1":
            qs = qs.filter(active=True)
        return qs

    def destroy(self, request, *args, **kwargs):
        # PROTECT would raise a 500; say what actually happened instead.
        cat = self.get_object()
        if cat.expenses.exists() or cat.incomes.exists():
            return Response(
                {"error": "Category is in use. Uncheck 'active' to hide it instead."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return super().destroy(request, *args, **kwargs)


class AdminSupplierViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAdminUser]
    serializer_class = SupplierSerializer
    queryset = Supplier.objects.all()

    def get_queryset(self):
        qs = super().get_queryset().prefetch_related("expenses")
        q = (self.request.query_params.get("q") or "").strip()
        if q:
            qs = qs.filter(Q(name__icontains=q) | Q(phone__icontains=q))
        return qs


class AdminBuyerViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAdminUser]
    serializer_class = BuyerSerializer
    queryset = Buyer.objects.all()

    def get_queryset(self):
        qs = super().get_queryset().prefetch_related("incomes")
        q = (self.request.query_params.get("q") or "").strip()
        if q:
            qs = qs.filter(Q(name__icontains=q) | Q(phone__icontains=q))
        return qs


class AdminExpenseViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAdminUser]
    serializer_class = ExpenseSerializer
    queryset = Expense.objects.all()

    def get_queryset(self):
        qs = (super().get_queryset()
              .select_related("category", "supplier")
              .prefetch_related("orders"))
        p = self.request.query_params
        start = parse_date(p.get("start"))
        end = parse_date(p.get("end"))
        if start:
            qs = qs.filter(date__gte=start)
        if end:
            qs = qs.filter(date__lte=end)
        for field in ("category", "supplier", "account"):
            val = p.get(field)
            if val:
                qs = qs.filter(**{field: val})
        if p.get("order"):
            qs = qs.filter(orders__id=p["order"])
        if p.get("credit") == "1":
            qs = qs.filter(is_credit=True)
        q = (p.get("q") or "").strip()
        if q:
            qs = qs.filter(
                Q(description__icontains=q)
                | Q(reference__icontains=q)
                | Q(supplier__name__icontains=q)
            )
        return qs.distinct()


class AdminCreditPaymentViewSet(viewsets.ModelViewSet):
    """Payments against a contact's running balance (both directions)."""
    permission_classes = [IsAdminUser]
    serializer_class = CreditPaymentSerializer
    queryset = CreditPayment.objects.all()

    def get_queryset(self):
        qs = super().get_queryset().select_related("supplier", "buyer")
        p = self.request.query_params
        for field in ("kind", "supplier", "buyer", "account"):
            val = p.get(field)
            if val:
                qs = qs.filter(**{field: val})
        start = parse_date(p.get("start"))
        end = parse_date(p.get("end"))
        if start:
            qs = qs.filter(date__gte=start)
        if end:
            qs = qs.filter(date__lte=end)
        return qs


class AdminIncomeViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAdminUser]
    serializer_class = IncomeSerializer
    queryset = Income.objects.all()

    def get_queryset(self):
        qs = (super().get_queryset()
              .select_related("category", "buyer")
              .prefetch_related("orders"))
        p = self.request.query_params
        start = parse_date(p.get("start"))
        end = parse_date(p.get("end"))
        if start:
            qs = qs.filter(date__gte=start)
        if end:
            qs = qs.filter(date__lte=end)
        for field in ("category", "account", "buyer"):
            val = p.get(field)
            if val:
                qs = qs.filter(**{field: val})
        if p.get("order"):
            qs = qs.filter(orders__id=p["order"])
        if p.get("credit") == "1":
            qs = qs.filter(is_credit=True)
        q = (p.get("q") or "").strip()
        if q:
            qs = qs.filter(Q(description__icontains=q) | Q(reference__icontains=q)
                           | Q(buyer__name__icontains=q))
        return qs.distinct()


# --------------------------------------------------------------------------- #
# Reporting
# --------------------------------------------------------------------------- #
#
# Credit is a RUNNING ACCOUNT per contact, not a pile of invoices to tick off:
#
#     balance = (everything taken on credit) - (everything paid)
#
# A payment is never allocated to a particular purchase or sale, so no history is
# ever rewritten — both sides stay exactly as they happened and the balance is
# the difference. `contact_ledger()` replays them in date order for the UI.


def contact_balance(direction, contact):
    """What this contact still owes us (receivable) or we owe them (payable).

    Can legitimately go NEGATIVE: paying a supplier more than the credit taken so
    far means they are holding an advance for us. Clamping that to zero would
    silently lose money, so it is reported as-is.
    """
    if contact is None:
        return ZERO
    if direction == "payable":
        taken = _sum(Expense.objects.filter(is_credit=True, supplier=contact))
        paid = _sum(CreditPayment.objects.filter(
            kind=CreditPayment.Kind.PAYABLE, supplier=contact))
    else:
        taken = _sum(Income.objects.filter(is_credit=True, buyer=contact))
        paid = _sum(CreditPayment.objects.filter(
            kind=CreditPayment.Kind.RECEIVABLE, buyer=contact))
    return taken - paid


def _balances(direction):
    """Every contact with a non-zero balance, biggest first."""
    if direction == "payable":
        contacts = Supplier.objects.all()
    else:
        contacts = Buyer.objects.all()
    rows = []
    for c in contacts:
        bal = contact_balance(direction, c)
        if bal == 0:
            continue
        rows.append({"id": c.id, "name": c.name, "balance": bal})
    rows.sort(key=lambda r: r["balance"], reverse=True)
    return rows


def dues_breakdown():
    """What we owe, per supplier. Total + rows (float for JSON)."""
    rows = _balances("payable")
    total = sum((r["balance"] for r in rows), ZERO)
    return total, [
        {"supplier_id": r["id"], "supplier": r["name"], "due": float(r["balance"]),
         "count": Expense.objects.filter(is_credit=True, supplier_id=r["id"]).count()}
        for r in rows
    ]


def receivables_breakdown():
    """What buyers owe us, per buyer. Mirror of dues_breakdown()."""
    rows = _balances("receivable")
    total = sum((r["balance"] for r in rows), ZERO)
    return total, [
        {"buyer_id": r["id"], "buyer": r["name"], "receivable": float(r["balance"]),
         "count": Income.objects.filter(is_credit=True, buyer_id=r["id"]).count()}
        for r in rows
    ]


def contact_ledger(direction, contact_id):
    """Full history for one contact, oldest first, with a running balance.

    Credits push the balance up, payments pull it down. Nothing is consumed or
    marked settled — the statement simply shows how the number got where it is.
    """
    entries = []
    if direction == "payable":
        for e in Expense.objects.filter(is_credit=True, supplier_id=contact_id
                                        ).select_related("category"):
            entries.append({
                "kind": "credit", "id": e.id, "date": e.date,
                "label": e.description or e.category.name, "amount": e.amount,
                "account": "", "fee_amount": ZERO, "note": "",
            })
        payments = CreditPayment.objects.filter(
            kind=CreditPayment.Kind.PAYABLE, supplier_id=contact_id)
    else:
        for i in Income.objects.filter(is_credit=True, buyer_id=contact_id
                                       ).select_related("category"):
            entries.append({
                "kind": "credit", "id": i.id, "date": i.date,
                "label": i.description or i.category.name, "amount": i.amount,
                "account": "", "fee_amount": ZERO, "note": "",
            })
        payments = CreditPayment.objects.filter(
            kind=CreditPayment.Kind.RECEIVABLE, buyer_id=contact_id)

    for p in payments:
        entries.append({
            "kind": "payment", "id": p.id, "date": p.date,
            "label": p.note or "Payment", "amount": p.amount,
            "account": p.account, "fee_amount": p.fee_amount, "note": p.note,
        })

    entries.sort(key=lambda r: (r["date"], 0 if r["kind"] == "credit" else 1, r["id"]))
    running = ZERO
    out = []
    for r in entries:
        running += r["amount"] if r["kind"] == "credit" else -r["amount"]
        out.append({
            "kind": r["kind"], "id": r["id"], "date": r["date"].isoformat(),
            "label": r["label"], "amount": float(r["amount"]),
            "fee_amount": float(r["fee_amount"]), "account": r["account"],
            "balance": float(running),
        })
    return out


def cash_out(start, end):
    """Money that actually left an account in the range, transfer fees included.

    Non-credit expenses count on their own date; a credit purchase counts only
    through the payments that reduce the supplier's balance.
    """
    plain = _sum(
        Expense.objects.filter(is_credit=False, date__gte=start, date__lte=end), OUT)
    paid = _sum(CreditPayment.objects.filter(
        kind=CreditPayment.Kind.PAYABLE, date__gte=start, date__lte=end), OUT)
    return plain + paid


def _spend(qs):
    """What a set of expenses really cost: purchase + charge to move the money."""
    return _sum(qs, OUT)


def cash_in(start, end):
    """Money actually received in the range, MFS charges netted off.

    Cash basis: a credit sale contributes nothing until the buyer pays, so it
    counts only through CreditPayment rows, on their own dates.
    """
    plain = _sum(
        Income.objects.filter(is_credit=False, date__gte=start, date__lte=end), IN)
    paid = _sum(CreditPayment.objects.filter(
        kind=CreditPayment.Kind.RECEIVABLE, date__gte=start, date__lte=end), IN)
    return plain + paid


def sales_total(start, end):
    """Everything earned in the range, credit sales included even if unpaid."""
    return _sum(Income.objects.filter(date__gte=start, date__lte=end))


def month_net(today=None):
    """This month's cash in/out + what is owed each way — the dashboard card."""
    today = today or timezone.localdate()
    start = today.replace(day=1)
    income = cash_in(start, today)
    expense = _spend(Expense.objects.filter(date__gte=start, date__lte=today))
    dues, _ = dues_breakdown()
    receivable, _ = receivables_breakdown()
    return {
        "income": float(income),
        "expense": float(expense),
        "net": float(income - expense),
        "dues": float(dues),
        "receivable": float(receivable),
    }


def _by_category(model, start, end, expr):
    return [
        {"category": r["category__name"] or "(none)", "total": float(r["total"] or 0),
         "count": r["count"]}
        for r in (model.objects.filter(date__gte=start, date__lte=end)
                  .values("category__name")
                  .annotate(total=Sum(expr, output_field=_MONEY), count=Count("id"))
                  .order_by("-total"))
    ]


def _income_by_category(start, end):
    """Cash received per source.

    Credit sales enter through CreditPayment rows, which belong to a buyer rather
    than to one sale, so they cannot be attributed to a category — they are
    grouped under "Credit repayments" instead of being guessed at.
    """
    totals, counts = {}, {}
    plain = (Income.objects.filter(is_credit=False, date__gte=start, date__lte=end)
             .values("category__name")
             .annotate(total=Sum(IN, output_field=_MONEY), count=Count("id")))
    paid = (CreditPayment.objects
            .filter(kind=CreditPayment.Kind.RECEIVABLE, date__gte=start, date__lte=end)
            .values("kind")
            .annotate(total=Sum(IN, output_field=_MONEY), count=Count("id")))
    for r in plain:
        name = r["category__name"] or "(none)"
        totals[name] = totals.get(name, ZERO) + (r["total"] or ZERO)
        counts[name] = counts.get(name, 0) + r["count"]
    for r in paid:
        name = "Credit repayments"
        totals[name] = totals.get(name, ZERO) + (r["total"] or ZERO)
        counts[name] = counts.get(name, 0) + r["count"]
    rows = [{"category": k, "total": float(v), "count": counts[k]} for k, v in totals.items()]
    return sorted(rows, key=lambda r: r["total"], reverse=True)


def _daily(start, end):
    """One row per day in the range — zero-filled so charts don't have gaps."""
    inc = {}
    for qs, expr in (
        (Income.objects.filter(is_credit=False, date__gte=start, date__lte=end), IN),
        (CreditPayment.objects.filter(kind=CreditPayment.Kind.RECEIVABLE,
                                      date__gte=start, date__lte=end), IN),
    ):
        for r in qs.values("date").annotate(t=Sum(expr, output_field=_MONEY)):
            inc[r["date"]] = inc.get(r["date"], ZERO) + (r["t"] or ZERO)
    exp = {r["date"]: r["t"] for r in (
        Expense.objects.filter(date__gte=start, date__lte=end)
        .values("date").annotate(t=Sum(OUT, output_field=_MONEY)))}
    out, day = [], start
    while day <= end:
        i = float(inc.get(day) or 0)
        e = float(exp.get(day) or 0)
        out.append({"date": day.isoformat(), "income": i, "expense": e, "net": i - e})
        day += timedelta(days=1)
    return out


@api_view(["GET"])
@permission_classes([IsAdminUser])
def finance_summary(request):
    start, end = _range(request)
    incomes = Income.objects.filter(date__gte=start, date__lte=end)
    expenses = Expense.objects.filter(date__gte=start, date__lte=end)
    payments = CreditPayment.objects.filter(date__gte=start, date__lte=end)

    income_received = cash_in(start, end)
    sales = sales_total(start, end)
    expense_gross = _sum(expenses)
    expense_total = _spend(expenses)
    # Every taka MFS/banks took, from either direction.
    fee_total = (_sum(incomes, "fee_amount") + _sum(expenses, "fee_amount")
                 + _sum(payments, "fee_amount"))
    vat_total = _sum(expenses, "vat_amount")
    dues_total, dues_by_supplier = dues_breakdown()
    receivable_total, receivable_by_buyer = receivables_breakdown()

    return Response({
        "start": start.isoformat(),
        "end": end.isoformat(),
        # Headline: money actually received minus money spent, fees both sides.
        # An unpaid credit sale is in `sales_total`, never in `income_total`.
        "income_total": float(income_received),
        "income_gross": float(sales),
        "sales_total": float(sales),
        "expense_total": float(expense_total),
        "expense_gross": float(expense_gross),
        "net": float(income_received - expense_total),
        "cash_out_total": float(cash_out(start, end)),
        "fee_total": float(fee_total),
        "vat_total": float(vat_total),
        "dues_total": float(dues_total),
        "dues_by_supplier": dues_by_supplier,
        "receivable_total": float(receivable_total),
        "receivable_by_buyer": receivable_by_buyer,
        "income_by_category": _income_by_category(start, end),
        "expense_by_category": _by_category(Expense, start, end, OUT),
        "daily": _daily(start, end),
        "income_count": incomes.count(),
        "expense_count": expenses.count(),
    })


@api_view(["GET"])
@permission_classes([IsAdminUser])
def finance_ledger(request):
    """One contact's full credit statement: every credit, every payment, running
    balance. `?direction=payable|receivable&contact=<id>`."""
    direction = request.query_params.get("direction")
    if direction not in ("payable", "receivable"):
        return Response({"error": "direction must be payable or receivable"},
                        status=status.HTTP_400_BAD_REQUEST)
    contact_id = request.query_params.get("contact")
    if not contact_id:
        return Response({"error": "contact is required"},
                        status=status.HTTP_400_BAD_REQUEST)
    model = Supplier if direction == "payable" else Buyer
    contact = model.objects.filter(pk=contact_id).first()
    if contact is None:
        return Response({"error": "Unknown contact"}, status=status.HTTP_404_NOT_FOUND)
    return Response({
        "direction": direction,
        "contact": {"id": contact.id, "name": contact.name, "phone": contact.phone},
        "balance": float(contact_balance(direction, contact)),
        "entries": contact_ledger(direction, contact.id),
    })


@api_view(["GET"])
@permission_classes([IsAdminUser])
def finance_meta(request):
    """Form options: accounts + their default fee rate (a pre-fill, never a rule —
    flat charges like NPSB are typed in taka)."""
    from .models import FinanceAccount

    rates = fee_rates()
    return Response({
        "accounts": [
            {"value": v, "label": label, "fee_rate": rates.get(v, "0")}
            for v, label in FinanceAccount.choices
        ],
    })


@api_view(["GET"])
@permission_classes([IsAdminUser])
def finance_order_search(request):
    """Typeahead for the order-mark picker. Deliberately light — the full admin
    order serializer carries items, config and consignments."""
    q = (request.query_params.get("q") or "").strip()
    qs = Order.objects.all()
    if q:
        qs = qs.filter(
            Q(uid__icontains=q) | Q(customer_name__icontains=q) | Q(phone__icontains=q)
        )
    return Response(OrderMarkSerializer(qs[:20], many=True).data)


@api_view(["GET"])
@permission_classes([IsAdminUser])
def order_finance(request, pk):
    """Everything marked against one order — read side of the order detail page."""
    expenses = (Expense.objects.filter(orders__id=pk)
                .select_related("category", "supplier").prefetch_related("orders"))
    incomes = (Income.objects.filter(orders__id=pk)
               .select_related("category").prefetch_related("orders"))
    return Response({
        "expenses": ExpenseSerializer(expenses, many=True, context={"request": request}).data,
        "incomes": IncomeSerializer(incomes, many=True, context={"request": request}).data,
        "expense_total": float(_spend(expenses)),
        # Cash received against this order's marked incomes (a credit sale
        # counts only as far as it has been paid).
        "income_total": float(sum((i.net_amount for i in incomes), ZERO)),
    })
