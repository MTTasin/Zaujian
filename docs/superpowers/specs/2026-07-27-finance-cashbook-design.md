# Finance / cash-book — Design

## Goal
A complete money system for the business: every taka that comes in (Steadfast
payouts + any other source) and every taka that goes out (ads, materials,
salary, credit purchases…), with a profit/loss view over any date range.

Replaces the per-order `cost_price` costing entirely — **profit is now a
business-level number, not an order-level one**.

## Locked decisions (owner, 2026-07-27)
1. **Cash basis.** Income is recorded when money is actually received —
   most of it as Steadfast payouts, but other sources exist and are first-class.
2. **No per-order cost allocation.** Linking an expense (or income) to orders is
   a **mark only** — a note of what the money was spent on. It has **zero**
   accounting effect: no split, no per-order profit, no allocation math.
3. **No courier fee arithmetic on orders.** Steadfast already pays after
   deducting the delivery charge and its 1% COD fee, so the payout amount the
   owner types in *is* the income. The system never recomputes it.
   (Consequence: the variable real delivery charge — 175/110/whatever — needs no
   field; the difference is already baked into the payout.)
4. **`Order.cost_price` + `Order.profit` are deleted**, values dropped, along
   with the profit/uncosted sorts and the dashboard profit card.
5. VAT on ad spend is recorded as part of the entry — the amount is what left
   the bank, with the VAT portion stored separately for reporting.
6. Credit runs **both ways, on two separate contact lists** (owner's call):
   - purchases on credit -> `Supplier` + `Expense.is_credit` -> **dues** (we owe)
   - sales on credit     -> `Buyer` + `Income.is_credit` -> **receivables** (they owe)
   A person who is both must be entered in both lists; in exchange the two
   directions can never be confused or netted against each other.
7. **A credit sale is not income until it is paid** — the cash basis again. The
   sale is recorded at once and shows as a receivable; only `IncomePayment` rows
   move Income/Net. Nothing inflates profit before the money exists.
8. **MFS/bank charges are their own field on every row.** bKash/Nagad/bank take
   a cut to move money, and it is often flat (NPSB), not a percentage — so the
   fee is stored as an exact taka figure the admin types. A per-account default
   percentage exists only as a pre-fill button.

## Models (`app/models.py`, "Finance" block)

```python
class FinanceCategory:      # one table for both sides, `kind` splits them
    name, kind (income|expense), order, active
    unique_together (name, kind)

class Supplier:
    name, phone, note, active, created_at

ACCOUNTS = cash | bank | bkash | nagad | card | other   # where the money moved

class Expense:
    date (indexed), category (FK, kind=expense), description,
    amount        # what the purchase cost, VAT included
    vat_amount    # informational portion of `amount` (ads = 15% VAT in BD)
    fee_amount    # MFS/bank charge paid ON TOP (exact taka)
    account, supplier (FK, null), is_credit, reference, receipt (image, null),
    orders (M2M Order, blank)        # MARK ONLY — no accounting effect
    created_at
    total_out    -> amount + fee_amount

class CreditPayment:        # money against a CONTACT's balance, not an invoice
    kind (payable|receivable), supplier (FK, null), buyer (FK, null),
    date, amount, fee_amount, account, note, created_at

class Buyer:                # separate list from Supplier, same fields
    name, phone, note, active, created_at

class Income:
    date (indexed), category (FK, kind=income), description,
    amount        # money received (or, on a credit sale, the amount sold for)
    fee_amount    # MFS charge DEDUCTED from it; always 0 on a credit sale
    account, reference, buyer (FK, null), is_credit,
    orders (M2M Order, blank)        # MARK ONLY
    created_at
    net_amount      -> cash in hand: amount - fee, or 0 while on credit

```

**Credit is a running account, not a pile of invoices to tick off:**

    balance = sum(everything taken on credit) - sum(everything paid)

A payment is never allocated to a particular purchase or sale. That is the whole
point: a supplier or reseller has several credits running at once and pays round
amounts against the total, so allocating would invent a mapping the real world
does not have — and would rewrite history every time an amount was corrected.
Both sides stay as they happened; `contact_ledger()` replays them with a running
balance. The balance may go **negative** (they hold an advance for us) and is
reported as-is: clamping it at zero would silently lose money.

`amount` is what changed hands between the two parties and is the only thing that
moves the balance; `fee_amount` is what the rails took and never touches it.

**Fee direction is the whole point.** On an expense the charge is paid on top
(`total_out = amount + fee`); on an income it comes out of what arrived
(`net = amount - fee`). Rolling either into the amount would quietly misstate
both the purchase price and the money received. A payment's fee is spent but is
**not** credited against the supplier's due.

`settings.FINANCE_FEE_RATES` (env `FINANCE_FEE_BKASH` 1.85, `FINANCE_FEE_NAGAD`
1.45, others 0) is only a UI pre-fill — nothing server-side ever computes a fee.

Seeded categories (data migration, `get_or_create` so re-running is safe):
- expense: Ads (Facebook), Materials, Courier, Packaging, Salary, Rent,
  Utilities, Transport, Refund, Other
- income: Steadfast payout, Other income

**Why one `FinanceCategory` with a `kind`** instead of two models: one CRUD
screen, one endpoint, one serializer. The two sides never mix because every
query filters on `kind`.

**Why `amount` is VAT-inclusive**: the owner enters what the bank actually
deducted. A number that must be added to another number to mean "money gone" is
the classic place to get a P&L wrong. `vat_amount` is a breakdown, never a
total.

## Two spend numbers, both shown
Cash basis is unambiguous for income, but a credit purchase is spent-now,
paid-later. Rather than pick one and hide the other, the summary reports both:

- **Spending** = `amount + fee` over expenses whose `date` is in range.
- **Cash out** = non-credit expenses (with fees) + credit-purchase fees +
  `ExpensePayment` rows (with fees) — what actually left an account.
- **Dues** = `sum(due)` over credit expenses — what is still owed, by supplier.
- **Income** = cash actually received: non-credit incomes + `IncomePayment` rows,
  each net of its own MFS charge. An unpaid credit sale contributes nothing.
- **Sales** = everything earned in the range, credit sales included even unpaid.
- **Receivables** = `sum(receivable)` over credit sales — owed to us, by buyer.
- **Fees** = every MFS/bank charge in the range, both directions, on its own line.

`Net = income received − spending` is the headline; sales, cash out, fees, VAT,
dues and receivables sit beside it. Dues and receivables are **never netted**
against each other — they are different people's money.

## API (`app/finance_api.py`, admin-only, token auth)
ViewSets (registered on the existing admin router):
- `admin/finance-categories/` — CRUD, `?kind=`
- `admin/suppliers/` — CRUD, with outstanding `due`
- `admin/buyers/` — CRUD, with outstanding `receivable`
- `admin/expenses/` — CRUD, filters `?start=&end=&category=&supplier=&account=&unpaid=1&order=&q=`
- `admin/expense-payments/` — CRUD, `?expense=`
- `admin/incomes/` — CRUD, same filters plus `?buyer=&credit=1&unpaid=1`
- `admin/income-payments/` — CRUD, `?income=`

- `admin/credit-payments/` — CRUD, `?kind=&supplier=&buyer=&start=&end=`

Statement:
- `admin/finance/ledger/?direction=&contact=` — that contact's credits and
  payments, oldest first, each with the running balance after it. A same-day
  credit sorts before a same-day payment, so "bought 1000, paid 1000 today"
  reads 1000 → 0 rather than −1000 → 0.

Function endpoints:
- `admin/finance/summary/?start=&end=` →
  `{start, end, income_total, expense_total, cash_out_total, net,
    income_by_category[], expense_by_category[], daily[{date, income, expense}],
    dues_total, dues_by_supplier[], counts}`
- `admin/finance/order-search/?q=` → light order rows `{id, uid, customer_name,
  total, status, created_at}` for the order-mark picker (the full order
  serializer is far too heavy for a typeahead).

Money in/out is aggregated with `Sum` over `DecimalField` — never float.
Dates are `DateField` in `Asia/Dhaka` local terms (the owner types a day, not an
instant), so ranges are plain `date__gte/lte`.

## Frontend `/admin/finance` (English admin, nav icon `wallet`)
Tabs on one route (local state, no sub-routes needed):
1. **Overview** — range picker (this month / last month / 7 / 30 / 90 / custom),
   stat cards (Income, Spending, Net, Cash out, Dues), income-vs-spend bar
   chart (recharts), spend-by-category and income-by-category breakdowns.
2. **Expenses** — filterable table + add/edit drawer form: date, category,
   description, amount, VAT helper (`+15% VAT` button computes it from a net
   figure), account, supplier, credit toggle, reference, receipt upload, order
   marks.
3. **Income** — same shape, simpler (no credit/VAT).
4. **Credit** — two sections on one screen, sharing a list component: *I owe*
   (unpaid credit expenses by supplier) and *Owed to me* (unpaid credit sales by
   buyer). Each row has a "Record payment" form writing the matching payment.
   Ignores the page date range on purpose: what is owed is owed.
5. **Categories** — CRUD for both category kinds + both contact lists.

Order marks use a typeahead over `finance/order-search/`; chips show `#UID —
name`. The order detail page gets a read-only "Money marked against this order"
list so the mark is visible from both ends.

Dashboard: the **Profit** card (`total_profit` / `uncosted_count`) is replaced
by **Net this month**, from the finance summary.

## Removals
`Order.cost_price` field + `Order.profit` property; `AdminOrderSerializer`
`cost_price`/`profit`; `_profit`/`_uncosted` annotations and the
`profit_high`/`profit_low`/`uncosted` sorts; the `edit` action's `cost_price`
branch; `total_profit`/`uncosted_count` on the dashboard; the cost input and
profit row on the order page; `ORDER_SORTS` profit entries;
`app/tests/test_order_profit.py`.

## Tests
- `app/tests/test_finance.py`: expense/income totals over a range, VAT stored
  but not double-counted, credit due maths + partial payments, cash-out vs
  spending, order marks having **no** effect on any total, category `kind`
  filtering, summary date-range edges, admin-only permissions.
- `app/tests/test_order_sorting.py`: drop the `uncosted` case.
- Frontend: `financeApi` range helpers + the VAT calculation unit-tested.
