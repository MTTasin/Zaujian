"use client";

// Finance cash-book. Money in (Steadfast payouts + anything else), money out
// (ads with VAT, materials, credit purchases…), MFS/transfer charges on both
// sides, and what is still owed to suppliers.
//
// There is no per-order profit anywhere: an order link on an entry is a MARK,
// nothing is allocated back to the order. See app/finance_api.py.

import { useCallback, useEffect, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  RANGE_OPTIONS, createBuyer, createCreditPayment, createFinanceCategory,
  createSupplier, deleteBuyer, deleteCreditPayment, deleteExpense,
  deleteFinanceCategory, deleteIncome, deleteSupplier, getLedger, listBuyers,
  listExpenses, listFinanceCategories, listIncomes, listSuppliers,
  getFinanceMeta, getFinanceSummary, rangeDates, taka, updateBuyer,
  updateCreditPayment, updateFinanceCategory, updateSupplier,
  type Buyer, type CreditKind, type CreditPayment, type Expense,
  type FinanceCategory, type FinanceMeta, type FinanceSummary, type Income,
  type Ledger, type RangeKey, type Supplier,
} from "@/lib/financeApi";
import {
  AdminButton, AdminEmpty, Card, Field, Loading, PageHeader, Select, StatCard,
  Table, Td, TextInput, Th,
} from "@/components/admin/ui";
import { EntryForm } from "@/components/admin/finance/EntryForm";
import { Icon } from "@/components/ui/Icon";

const PLUM = "var(--chart-plum)";
const GOLD = "var(--chart-gold)";
const GREEN = "var(--chart-green)";
const RED = "var(--chart-red)";
const PIE_COLORS = [PLUM, GOLD, GREEN, "var(--chart-blue)", "var(--chart-violet)",
  "var(--chart-amber)", RED];

type Tab = "overview" | "expenses" | "income" | "credit" | "setup";
const TABS: { key: Tab; label: string; icon: Parameters<typeof Icon>[0]["name"] }[] = [
  { key: "overview", label: "Overview", icon: "chart" },
  { key: "expenses", label: "Expenses", icon: "cart" },
  { key: "income", label: "Income", icon: "wallet" },
  { key: "credit", label: "Credit", icon: "clock" },
  { key: "setup", label: "Categories", icon: "sliders" },
];

export default function AdminFinance() {
  const [tab, setTab] = useState<Tab>("overview");
  const [rangeKey, setRangeKey] = useState<RangeKey>("this_month");
  const [custom, setCustom] = useState<{ start: string; end: string } | null>(null);

  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [incomes, setIncomes] = useState<Income[]>([]);
  const [expenseCats, setExpenseCats] = useState<FinanceCategory[]>([]);
  const [incomeCats, setIncomeCats] = useState<FinanceCategory[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [buyers, setBuyers] = useState<Buyer[]>([]);
  const [meta, setMeta] = useState<FinanceMeta | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const [formKind, setFormKind] = useState<"expense" | "income" | null>(null);
  const [editing, setEditing] = useState<Expense | Income | null>(null);

  const range = custom ?? rangeDates(rangeKey);

  // Every setState lands in a promise callback, never synchronously in the
  // effect body — otherwise the first paint cascades.
  const reload = useCallback(
    () =>
      Promise.all([
        getFinanceSummary(range.start, range.end),
        listExpenses({ start: range.start, end: range.end }),
        listIncomes({ start: range.start, end: range.end }),
      ])
        .then(([s, ex, inc]) => {
          setSummary(s);
          setExpenses(ex);
          setIncomes(inc);
          setError("");
        })
        .catch((e) => setError(e instanceof Error ? e.message : "Could not load"))
        .finally(() => setLoading(false)),
    [range.start, range.end],
  );

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    Promise.all([
      listFinanceCategories("expense"),
      listFinanceCategories("income"),
      listSuppliers(),
      listBuyers(),
      getFinanceMeta(),
    ])
      .then(([e, i, s, b, m]) => {
        setExpenseCats(e); setIncomeCats(i); setSuppliers(s); setBuyers(b); setMeta(m);
      })
      .catch(() => {});
  }, []);

  // Both contact lists carry an outstanding balance, so they refresh together
  // whenever money moves.
  const refreshContacts = () => {
    listSuppliers().then(setSuppliers).catch(() => {});
    listBuyers().then(setBuyers).catch(() => {});
  };

  function openForm(kind: "expense" | "income", row: Expense | Income | null = null) {
    setEditing(row);
    setFormKind(kind);
    setTab(kind === "expense" ? "expenses" : "income");
  }

  async function removeEntry(kind: "expense" | "income", id: number) {
    if (!confirm("Delete this entry? This cannot be undone.")) return;
    try {
      if (kind === "expense") await deleteExpense(id); else await deleteIncome(id);
      reload();
      refreshContacts();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not delete");
    }
  }

  if (loading) return <Loading />;

  return (
    <div>
      <PageHeader
        title="Finance"
        subtitle="Cash-book — money in, money out, and what is still owed"
        action={
          <div className="flex flex-wrap gap-2">
            <AdminButton icon="plus" onClick={() => openForm("income")}>Add income</AdminButton>
            <AdminButton icon="plus" variant="secondary" onClick={() => openForm("expense")}>
              Add expense
            </AdminButton>
          </div>
        }
      />

      {error && <p className="mb-4 rounded-lg bg-red-50 p-4 text-red-600">{error}</p>}

      {/* Range */}
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <Field label="Range">
          <Select
            value={custom ? "custom" : rangeKey}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "custom") { setCustom({ start: range.start, end: range.end }); return; }
              setCustom(null);
              setRangeKey(v as RangeKey);
            }}
          >
            {RANGE_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
            <option value="custom">Custom…</option>
          </Select>
        </Field>
        {custom && (
          <>
            <Field label="From">
              <TextInput type="date" value={custom.start}
                         onChange={(e) => setCustom({ ...custom, start: e.target.value })} />
            </Field>
            <Field label="To">
              <TextInput type="date" value={custom.end}
                         onChange={(e) => setCustom({ ...custom, end: e.target.value })} />
            </Field>
          </>
        )}
        <span className="pb-2 text-sm text-slate-400">{range.start} → {range.end}</span>
      </div>

      {/* Tabs */}
      <div className="mb-6 flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setFormKind(null); }}
            className={`-mb-px flex cursor-pointer items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition ${
              tab === t.key
                ? "border-plum text-plum"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            <Icon name={t.icon} size={16} />
            {t.label}
            {t.key === "credit" && summary
              && (summary.dues_total > 0 || summary.receivable_total > 0) && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                {taka(summary.dues_total)} / {taka(summary.receivable_total)}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === "overview" && summary && <Overview s={summary} />}

      {(tab === "expenses" || tab === "income") && (
        <>
          {formKind && (
            <EntryForm
              kind={formKind}
              categories={formKind === "expense" ? expenseCats : incomeCats}
              suppliers={suppliers}
              buyers={buyers}
              meta={meta}
              editing={editing}
              onContactAdded={refreshContacts}
              onCancel={() => { setFormKind(null); setEditing(null); }}
              onSaved={() => {
                setFormKind(null); setEditing(null); reload(); refreshContacts();
              }}
            />
          )}
          {tab === "expenses" ? (
            <ExpenseTable
              rows={expenses}
              suppliers={suppliers}
              onEdit={(r) => openForm("expense", r)}
              onDelete={(id) => removeEntry("expense", id)}
            />
          ) : (
            <IncomeTable
              rows={incomes}
              buyers={buyers}
              onEdit={(r) => openForm("income", r)}
              onDelete={(id) => removeEntry("income", id)}
            />
          )}
        </>
      )}

      {tab === "credit" && (
        <Credit summary={summary} meta={meta}
                onChanged={() => { reload(); refreshContacts(); }} />
      )}

      {tab === "setup" && (
        <Setup
          expenseCats={expenseCats}
          incomeCats={incomeCats}
          suppliers={suppliers}
          buyers={buyers}
          onChanged={() => {
            listFinanceCategories("expense").then(setExpenseCats);
            listFinanceCategories("income").then(setIncomeCats);
            refreshContacts();
          }}
        />
      )}
    </div>
  );
}

// --------------------------------------------------------------------------- //
// Overview
// --------------------------------------------------------------------------- //

function Overview({ s }: { s: FinanceSummary }) {
  const chart = s.daily.map((d) => ({ ...d, day: d.date.slice(5) }));
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Income received" value={taka(s.income_total)} icon="wallet" tone="green"
                  hint={s.sales_total !== s.income_total
                    ? `${taka(s.sales_total)} sold — rest unpaid or charges`
                    : undefined} />
        <StatCard label="Spending" value={taka(s.expense_total)} icon="cart" tone="amber"
                  hint={s.expense_total !== s.expense_gross
                    ? `incl. ${taka(s.expense_total - s.expense_gross)} transfer charges`
                    : undefined} />
        <StatCard label="Net" value={taka(s.net)} icon="chart"
                  tone={s.net >= 0 ? "plum" : "amber"} />
        <StatCard label="Owed to me" value={taka(s.receivable_total)} icon="clock" tone="green"
                  hint={s.receivable_by_buyer.length
                    ? `${s.receivable_by_buyer.length} buyer(s)` : undefined} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SmallStat label="I owe (unpaid credit)" value={taka(s.dues_total)}
                   hint={s.dues_by_supplier.length
                     ? `${s.dues_by_supplier.length} supplier(s)` : "Nothing owed"} />
        <SmallStat label="Cash actually out" value={taka(s.cash_out_total)}
                   hint="Non-credit purchases + payments made" />
        <SmallStat label="MFS / transfer charges" value={taka(s.fee_total)}
                   hint="bKash, Nagad, bank — both directions" />
        <SmallStat label="VAT inside spending" value={taka(s.vat_total)}
                   hint="Already part of the amounts" />
      </div>

      <Card className="p-5">
        <h2 className="mb-4 font-bold text-slate-900">Money in vs money out</h2>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: "var(--chart-axis)" }} />
              <YAxis tick={{ fontSize: 11, fill: "var(--chart-axis)" }} />
              <Tooltip formatter={(v) => taka(Number(v))} />
              <Legend />
              <Bar dataKey="income" name="Income" fill={GREEN} radius={[3, 3, 0, 0]} />
              <Bar dataKey="expense" name="Spending" fill={PLUM} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <CategoryCard title="Where the money went" rows={s.expense_by_category} />
        <CategoryCard title="Where the money came from" rows={s.income_by_category} />
      </div>

      {(s.dues_by_supplier.length > 0 || s.receivable_by_buyer.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {s.dues_by_supplier.length > 0 && (
            <Card className="p-5">
              <h2 className="mb-4 font-bold text-slate-900">I owe — suppliers</h2>
              <ul className="divide-y divide-slate-100">
                {s.dues_by_supplier.map((d) => (
                  <li key={d.supplier_id ?? "none"} className="flex justify-between py-2 text-sm">
                    <span className="text-slate-700">{d.supplier} <span className="text-slate-400">({d.count})</span></span>
                    <span className="font-semibold tabular-nums text-amber-700">{taka(d.due)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {s.receivable_by_buyer.length > 0 && (
            <Card className="p-5">
              <h2 className="mb-4 font-bold text-slate-900">Owed to me — buyers</h2>
              <ul className="divide-y divide-slate-100">
                {s.receivable_by_buyer.map((r) => (
                  <li key={r.buyer_id ?? "none"} className="flex justify-between py-2 text-sm">
                    <span className="text-slate-700">{r.buyer} <span className="text-slate-400">({r.count})</span></span>
                    <span className="font-semibold tabular-nums text-emerald-700">{taka(r.receivable)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function SmallStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xl font-bold tabular-nums text-slate-900">{value}</div>
      <div className="text-sm text-slate-500">{label}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-400">{hint}</div>}
    </Card>
  );
}

function CategoryCard({ title, rows }: {
  title: string; rows: { category: string; total: number; count: number }[];
}) {
  if (!rows.length) {
    return (
      <Card className="p-5">
        <h2 className="mb-2 font-bold text-slate-900">{title}</h2>
        <p className="text-sm text-slate-400">Nothing in this range yet.</p>
      </Card>
    );
  }
  return (
    <Card className="p-5">
      <h2 className="mb-4 font-bold text-slate-900">{title}</h2>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="h-48 w-full sm:w-1/2">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={rows} dataKey="total" nameKey="category" innerRadius={35} outerRadius={70}>
                {rows.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(v) => taka(Number(v))} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <ul className="flex-1 space-y-1.5">
          {rows.map((r, i) => (
            <li key={r.category} className="flex items-center gap-2 text-sm">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
              <span className="min-w-0 flex-1 truncate text-slate-600">{r.category}</span>
              <span className="font-semibold tabular-nums text-slate-800">{taka(r.total)}</span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

// --------------------------------------------------------------------------- //
// Tables
// --------------------------------------------------------------------------- //

function MarkChips({ marks }: { marks: { id: number; uid: string }[] }) {
  if (!marks.length) return <span className="text-slate-300">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {marks.map((m) => (
        <span key={m.id} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-600">
          #{m.uid}
        </span>
      ))}
    </span>
  );
}

function RowActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  return (
    <span className="flex gap-1">
      <button onClick={onEdit} aria-label="Edit"
              className="cursor-pointer rounded p-1.5 text-slate-500 hover:bg-slate-100">
        <Icon name="edit" size={15} />
      </button>
      <button onClick={onDelete} aria-label="Delete"
              className="cursor-pointer rounded p-1.5 text-red-500 hover:bg-red-50">
        <Icon name="trash" size={15} />
      </button>
    </span>
  );
}

// What THIS row still owes, not what its contact owes in total. A payment is
// still never tied to one invoice (see finance_api.py) — the backend derives the
// row's share oldest-credit-first, so a payment settles the earliest purchase
// still owing and leftover money waits for the next one. Printing the contact's
// whole balance on every row, as this used to, made a purchase paid off weeks
// ago read as outstanding on every visit.
function CreditCell({ isCredit, contact, remaining, balance }: {
  isCredit: boolean; contact: string; remaining: number | null; balance: number | null;
}) {
  if (!isCredit) return <span className="text-slate-300">—</span>;
  if (remaining === null) {
    // No contact on the row (deleted supplier/buyer) — there is no running
    // account to place it in, so the deal is all we can honestly report.
    return <span className="font-semibold text-amber-700">on credit</span>;
  }
  const total = balance === null ? null
    : balance > 0 ? `${contact} owes ${taka(balance)} in total.`
    : balance < 0 ? `${contact} is fully settled and holding an advance of ${taka(-balance)}.`
    : `${contact} has no outstanding balance.`;
  if (remaining > 0) {
    return (
      <span className="font-semibold text-amber-700"
            title={`${taka(remaining)} of this entry is still unpaid. ${total ?? ""}`.trim()}>
        on credit · {taka(remaining)} left
      </span>
    );
  }
  return (
    <span className="font-semibold text-emerald-600"
          title={`This entry is covered by payments made. ${total ?? ""}`.trim()}>
      settled
    </span>
  );
}

function ExpenseTable({ rows, suppliers, onEdit, onDelete }: {
  rows: Expense[]; suppliers: Supplier[];
  onEdit: (r: Expense) => void; onDelete: (id: number) => void;
}) {
  if (!rows.length) {
    return <AdminEmpty icon="cart" title="No spending in this range"
                       hint="Add an expense to start tracking." />;
  }
  const dues = new Map(suppliers.map((s) => [s.id, Number(s.due)]));
  return (
    <Table>
      <thead>
        <tr>
          <Th>Date</Th><Th>Category</Th><Th>Description</Th>
          <Th className="text-right">Amount</Th>
          <Th className="text-right">Charge</Th>
          <Th className="text-right">Total out</Th>
          <Th>Account</Th><Th>Credit</Th><Th>Orders</Th><Th />
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <Td className="whitespace-nowrap">{r.date}</Td>
            <Td>{r.category_name}</Td>
            <Td>
              {r.description || <span className="text-slate-300">—</span>}
              {Number(r.vat_amount) > 0 && (
                <span className="ml-1 text-xs text-slate-400">(VAT {taka(r.vat_amount)})</span>
              )}
              {r.supplier_name && (
                <span className="ml-1 text-xs text-slate-400">· {r.supplier_name}</span>
              )}
            </Td>
            <Td className="text-right tabular-nums">{taka(r.amount)}</Td>
            <Td className="text-right tabular-nums text-slate-500">
              {Number(r.fee_amount) > 0 ? taka(r.fee_amount) : "—"}
            </Td>
            <Td className="text-right font-semibold tabular-nums">{taka(r.total_out)}</Td>
            <Td className="capitalize">{r.account}</Td>
            <Td>
              <CreditCell isCredit={r.is_credit} contact={r.supplier_name || "This supplier"}
                          remaining={r.credit_remaining === null ? null : Number(r.credit_remaining)}
                          balance={r.supplier != null && dues.has(r.supplier)
                            ? dues.get(r.supplier)! : null} />
            </Td>
            <Td><MarkChips marks={r.order_marks} /></Td>
            <Td><RowActions onEdit={() => onEdit(r)} onDelete={() => onDelete(r.id)} /></Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function IncomeTable({ rows, buyers, onEdit, onDelete }: {
  rows: Income[]; buyers: Buyer[];
  onEdit: (r: Income) => void; onDelete: (id: number) => void;
}) {
  if (!rows.length) {
    return <AdminEmpty icon="wallet" title="No income in this range"
                       hint="Record a Steadfast payout or any other money received." />;
  }
  const owed = new Map(buyers.map((b) => [b.id, Number(b.receivable)]));
  return (
    <Table>
      <thead>
        <tr>
          <Th>Date</Th><Th>Source</Th><Th>Description</Th>
          <Th className="text-right">Amount</Th>
          <Th className="text-right">Charge</Th>
          <Th className="text-right">Net in</Th>
          <Th>Account</Th><Th>Credit</Th><Th>Orders</Th><Th />
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <Td className="whitespace-nowrap">{r.date}</Td>
            <Td>{r.category_name}</Td>
            <Td>
              {r.description || <span className="text-slate-300">—</span>}
              {r.buyer_name && <span className="ml-1 text-xs text-slate-400">· {r.buyer_name}</span>}
            </Td>
            <Td className="text-right tabular-nums">{taka(r.amount)}</Td>
            <Td className="text-right tabular-nums text-slate-500">
              {Number(r.fee_amount) > 0 ? taka(r.fee_amount) : "—"}
            </Td>
            <Td className="text-right font-semibold tabular-nums">{taka(r.net_amount)}</Td>
            <Td className="capitalize">{r.account}</Td>
            <Td>
              <CreditCell isCredit={r.is_credit} contact={r.buyer_name || "This buyer"}
                          remaining={r.credit_remaining === null ? null : Number(r.credit_remaining)}
                          balance={r.buyer != null && owed.has(r.buyer)
                            ? owed.get(r.buyer)! : null} />
            </Td>
            <Td><MarkChips marks={r.order_marks} /></Td>
            <Td><RowActions onEdit={() => onEdit(r)} onDelete={() => onDelete(r.id)} /></Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

// --------------------------------------------------------------------------- //
// Credit — a running account per contact, both directions
// --------------------------------------------------------------------------- //
//
// A payment comes off the contact's TOTAL balance, never off one purchase or
// sale, so nothing is ever consumed or marked settled. Open a contact to see the
// full statement: every credit, every payment, and the balance after each.

function Credit({ summary, meta, onChanged }: {
  summary: FinanceSummary | null; meta: FinanceMeta | null; onChanged: () => void;
}) {
  if (!summary) return <Loading />;

  const owe = summary.dues_by_supplier.map((d) => ({
    id: d.supplier_id, name: d.supplier, balance: d.due, count: d.count,
  }));
  const owed = summary.receivable_by_buyer.map((r) => ({
    id: r.buyer_id, name: r.buyer, balance: r.receivable, count: r.count,
  }));

  return (
    <div className="space-y-8">
      <CreditSide
        title="I owe — suppliers" direction="payable" tone="amber"
        rows={owe} total={summary.dues_total} meta={meta} onChanged={onChanged}
        emptyTitle="Nothing owed"
        emptyHint="Credit purchases build up here until they are paid off."
      />
      <CreditSide
        title="Owed to me — buyers" direction="receivable" tone="emerald"
        rows={owed} total={summary.receivable_total} meta={meta} onChanged={onChanged}
        emptyTitle="Nobody owes you"
        emptyHint="A sale marked sold-on-credit stays here until the buyer pays."
      />
    </div>
  );
}

function CreditSide({
  title, direction, tone, rows, total, meta, onChanged, emptyTitle, emptyHint,
}: {
  title: string;
  direction: CreditKind;
  tone: "amber" | "emerald";
  rows: { id: number | null; name: string; balance: number; count: number }[];
  total: number;
  meta: FinanceMeta | null;
  onChanged: () => void;
  emptyTitle: string;
  emptyHint: string;
}) {
  const [openId, setOpenId] = useState<number | null>(null);
  const toneClass = tone === "emerald" ? "text-emerald-700" : "text-amber-700";

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-bold text-slate-900">{title}</h2>
        <span className={`font-bold tabular-nums ${toneClass}`}>{taka(total)}</span>
      </div>
      {rows.length === 0 ? (
        <AdminEmpty icon="check" title={emptyTitle} hint={emptyHint} />
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <Card key={r.id ?? r.name} className="p-5">
              <button
                onClick={() => setOpenId(openId === r.id ? null : r.id)}
                className="flex w-full cursor-pointer items-center gap-3 text-left"
              >
                <Icon name={openId === r.id ? "minus" : "plus"} size={16} />
                <span className="flex-1 font-semibold text-slate-900">{r.name}</span>
                <span className="text-xs text-slate-400">
                  {r.count} credit{r.count === 1 ? "" : "s"}
                </span>
                <span className={`font-bold tabular-nums ${toneClass}`}>{taka(r.balance)}</span>
              </button>
              {openId === r.id && r.id != null && (
                <ContactLedger
                  direction={direction} contactId={r.id} tone={tone} meta={meta}
                  onChanged={onChanged}
                />
              )}
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}

function ContactLedger({ direction, contactId, tone, meta, onChanged }: {
  direction: CreditKind;
  contactId: number;
  tone: "amber" | "emerald";
  meta: FinanceMeta | null;
  onChanged: () => void;
}) {
  const [data, setData] = useState<Ledger | null>(null);
  const [paying, setPaying] = useState(false);
  const [editing, setEditing] = useState<CreditPayment | null>(null);

  const load = useCallback(() => {
    getLedger(direction, contactId).then(setData).catch(() => setData(null));
  }, [direction, contactId]);
  useEffect(load, [load]);

  if (!data) return <p className="mt-3 text-sm text-slate-400">Loading statement…</p>;

  const payable = direction === "payable";
  const toneClass = tone === "emerald" ? "text-emerald-700" : "text-amber-700";

  async function removePayment(id: number) {
    if (!confirm("Delete this payment? The balance goes back up.")) return;
    await deleteCreditPayment(id);
    load();
    onChanged();
  }

  return (
    <div className="mt-4 border-t border-slate-100 pt-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Statement — every credit and payment, oldest first
        </p>
        <AdminButton
          variant="secondary"
          onClick={() => { setEditing(null); setPaying((v) => !v); }}
        >
          {payable ? "Record payment" : "Record receipt"}
        </AdminButton>
      </div>

      {(paying || editing) && (
        <CreditPaymentForm
          direction={direction}
          contactId={contactId}
          balance={data.balance}
          payment={editing}
          meta={meta}
          onCancel={() => { setPaying(false); setEditing(null); }}
          onSaved={() => { setPaying(false); setEditing(null); load(); onChanged(); }}
        />
      )}

      <ul className="divide-y divide-slate-100">
        {data.entries.map((e) => (
          <li key={`${e.kind}${e.id}`} className="flex flex-wrap items-center gap-3 py-2 text-sm">
            <span className="w-20 shrink-0 text-slate-400">{e.date}</span>
            <span className="min-w-0 flex-1 truncate text-slate-700">
              {e.kind === "credit" ? e.label : `Payment — ${e.label}`}
              {e.kind === "payment" && e.fee_amount > 0 && (
                <span className="ml-1 text-xs text-slate-400">+{taka(e.fee_amount)} charge</span>
              )}
            </span>
            <span className={`w-24 text-right tabular-nums ${
              e.kind === "credit" ? "text-slate-800" : "text-emerald-600"
            }`}>
              {e.kind === "credit" ? "+" : "−"} {taka(e.amount)}
            </span>
            <span className={`w-24 text-right font-semibold tabular-nums ${toneClass}`}>
              {taka(e.balance)}
            </span>
            {e.kind === "payment" ? (
              <span className="flex gap-1">
                <button
                  aria-label="Edit payment"
                  onClick={() => {
                    setPaying(false);
                    setEditing({
                      id: e.id, kind: direction,
                      supplier: payable ? contactId : null,
                      buyer: payable ? null : contactId,
                      contact_name: data.contact.name, date: e.date,
                      amount: String(e.amount), fee_amount: String(e.fee_amount),
                      account: (e.account || "cash") as CreditPayment["account"],
                      note: "", created_at: "",
                    });
                  }}
                  className="cursor-pointer rounded p-1 text-slate-500 hover:bg-slate-100"
                >
                  <Icon name="edit" size={13} />
                </button>
                <button
                  aria-label="Delete payment"
                  onClick={() => removePayment(e.id)}
                  className="cursor-pointer rounded p-1 text-red-500 hover:bg-red-50"
                >
                  <Icon name="trash" size={13} />
                </button>
              </span>
            ) : (
              <span className="w-[54px]" />
            )}
          </li>
        ))}
      </ul>

      <div className="mt-3 flex justify-between border-t border-slate-100 pt-3 text-sm">
        <span className="font-semibold text-slate-700">Balance</span>
        <span className={`font-bold tabular-nums ${toneClass}`}>{taka(data.balance)}</span>
      </div>
      {data.balance < 0 && (
        <p className="mt-1 text-xs text-slate-400">
          Negative = paid more than taken on credit; they are holding an advance.
        </p>
      )}
    </div>
  );
}

function CreditPaymentForm({
  direction, contactId, balance, payment, meta, onSaved, onCancel,
}: {
  direction: CreditKind;
  contactId: number;
  balance: number;
  /** Set when correcting a payment already recorded. */
  payment: CreditPayment | null;
  meta: FinanceMeta | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const payable = direction === "payable";
  const [date, setDate] = useState(payment?.date ?? new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState(payment?.amount ?? String(Math.max(balance, 0)));
  const [fee, setFee] = useState(payment?.fee_amount ?? "");
  const [account, setAccount] = useState<string>(payment?.account ?? "cash");
  const [note, setNote] = useState(payment?.note ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const amountNum = parseFloat(amount || "0") || 0;
  const after = balance - amountNum;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    const body = {
      kind: direction,
      supplier: payable ? contactId : null,
      buyer: payable ? null : contactId,
      date, amount, fee_amount: fee || "0", account, note,
    };
    try {
      if (payment) await updateCreditPayment(payment.id, body);
      else await createCreditPayment(body);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="mb-4 grid gap-3 rounded-lg bg-slate-50 p-4 md:grid-cols-5">
      <Field label="Date">
        <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <Field
        label={payable ? "Paid to them" : "Received from them"}
        hint={`${taka(balance)} outstanding`}
      >
        <TextInput type="number" step="0.01" min="0" value={amount}
                   onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <Field label="Transfer charge" hint="Real money, but it never moves the balance.">
        <TextInput type="number" step="0.01" min="0" placeholder="0" value={fee}
                   onChange={(e) => setFee(e.target.value)} />
      </Field>
      <Field label="Account">
        <Select value={account} onChange={(e) => setAccount(e.target.value)}>
          {(meta?.accounts ?? []).map((a) => (
            <option key={a.value} value={a.value}>{a.label}</option>
          ))}
        </Select>
      </Field>
      <Field label="Note">
        <TextInput value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div className="flex flex-wrap items-center gap-3 md:col-span-5">
        <AdminButton type="submit" disabled={saving}>
          {saving ? "Saving…" : payment ? "Save changes" : "Save"}
        </AdminButton>
        <AdminButton type="button" variant="ghost" onClick={onCancel}>Cancel</AdminButton>
        <span className="text-sm text-slate-500">
          Balance after: <b className="text-slate-800">{taka(after)}</b>
          {after < 0 && <span className="ml-2 text-slate-400">(advance held for you)</span>}
        </span>
        {error && <span className="text-sm font-semibold text-red-600">{error}</span>}
      </div>
    </form>
  );
}

// --------------------------------------------------------------------------- //
// Setup — categories + suppliers
// --------------------------------------------------------------------------- //

function Setup({ expenseCats, incomeCats, suppliers, buyers, onChanged }: {
  expenseCats: FinanceCategory[]; incomeCats: FinanceCategory[];
  suppliers: Supplier[]; buyers: Buyer[]; onChanged: () => void;
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <CategoryEditor title="Expense categories" kind="expense" rows={expenseCats} onChanged={onChanged} />
      <CategoryEditor title="Income sources" kind="income" rows={incomeCats} onChanged={onChanged} />
      <ContactEditor
        title="Suppliers" hint="People you buy from — they can be owed money."
        rows={suppliers} balanceOf={(s) => s.due} tone="amber"
        onAdd={(name, phone) => createSupplier({ name, phone })}
        onEdit={(id, name, phone) => updateSupplier(id, { name, phone })}
        onRemove={deleteSupplier}
        onChanged={onChanged}
      />
      <ContactEditor
        title="Buyers" hint="People who buy from you on credit — they can owe you."
        rows={buyers} balanceOf={(b) => b.receivable} tone="emerald"
        onAdd={(name, phone) => createBuyer({ name, phone })}
        onEdit={(id, name, phone) => updateBuyer(id, { name, phone })}
        onRemove={deleteBuyer}
        onChanged={onChanged}
      />
    </div>
  );
}

function CategoryEditor({ title, kind, rows, onChanged }: {
  title: string; kind: "income" | "expense"; rows: FinanceCategory[]; onChanged: () => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [editId, setEditId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");

  async function saveName(c: FinanceCategory) {
    const next = draft.trim();
    setEditId(null);
    if (!next || next === c.name) return;
    try {
      await updateFinanceCategory(c.id, { name: next });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not rename");
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setError("");
    try {
      await createFinanceCategory({ name: name.trim(), kind, order: rows.length });
      setName("");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add");
    }
  }

  async function remove(c: FinanceCategory) {
    try {
      await deleteFinanceCategory(c.id);
      onChanged();
    } catch {
      // In use — hide it instead, which is what the backend suggests.
      await updateFinanceCategory(c.id, { active: false });
      onChanged();
    }
  }

  return (
    <Card className="p-5">
      <h2 className="mb-3 font-bold text-slate-900">{title}</h2>
      <ul className="mb-3 divide-y divide-slate-100">
        {rows.map((c) => (
          <li key={c.id} className="flex items-center gap-2 py-2 text-sm">
            {editId === c.id ? (
              // Renaming is safe: entries point at the category by id, so past
              // rows follow the new name rather than being rewritten.
              <>
                <TextInput
                  autoFocus value={draft} maxLength={60}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") saveName(c); if (e.key === "Escape") setEditId(null); }}
                />
                <AdminButton className="shrink-0" onClick={() => saveName(c)}>Save</AdminButton>
                <AdminButton variant="ghost" className="shrink-0" onClick={() => setEditId(null)}>
                  Cancel
                </AdminButton>
              </>
            ) : (
              <>
                <span className={`flex-1 ${c.active ? "text-slate-700" : "text-slate-400 line-through"}`}>
                  {c.name}
                </span>
                {!c.active && (
                  <button onClick={() => updateFinanceCategory(c.id, { active: true }).then(onChanged)}
                          className="cursor-pointer text-xs font-semibold text-plum">restore</button>
                )}
                <button onClick={() => { setEditId(c.id); setDraft(c.name); }} aria-label="Rename"
                        className="cursor-pointer rounded p-1 text-slate-500 hover:bg-slate-100">
                  <Icon name="edit" size={14} />
                </button>
                <button onClick={() => remove(c)} aria-label="Remove"
                        className="cursor-pointer rounded p-1 text-red-500 hover:bg-red-50">
                  <Icon name="trash" size={14} />
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="flex gap-2">
        <TextInput value={name} placeholder="New name" maxLength={60}
                   onChange={(e) => setName(e.target.value)} />
        <AdminButton type="submit" className="shrink-0">Add</AdminButton>
      </form>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </Card>
  );
}

// One editor for both contact lists (owner keeps them separate on purpose):
// same fields, only the outstanding balance means the opposite thing.
function ContactEditor<T extends { id: number; name: string; phone: string }>({
  title, hint, rows, balanceOf, tone, onAdd, onEdit, onRemove, onChanged,
}: {
  title: string;
  hint: string;
  rows: T[];
  balanceOf: (row: T) => string;
  tone: "amber" | "emerald";
  onAdd: (name: string, phone: string) => Promise<unknown>;
  onEdit: (id: number, name: string, phone: string) => Promise<unknown>;
  onRemove: (id: number) => Promise<unknown>;
  onChanged: () => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [editId, setEditId] = useState<number | null>(null);
  const [draft, setDraft] = useState({ name: "", phone: "" });
  const [error, setError] = useState("");
  const toneClass = tone === "emerald" ? "text-emerald-700" : "text-amber-700";

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await onAdd(name.trim(), phone.trim());
    setName(""); setPhone("");
    onChanged();
  }

  async function save(id: number) {
    setEditId(null);
    if (!draft.name.trim()) return;
    await onEdit(id, draft.name.trim(), draft.phone.trim());
    onChanged();
  }

  async function remove(row: T) {
    const owing = Number(balanceOf(row)) > 0;
    const warn = owing
      ? `${row.name} still has an outstanding balance. Deleting only removes the contact — the entries stay, but stop being grouped under a name. Continue?`
      : `Delete ${row.name}?`;
    if (!confirm(warn)) return;
    setError("");
    try {
      await onRemove(row.id);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete");
    }
  }

  return (
    <Card className="p-5">
      <h2 className="font-bold text-slate-900">{title}</h2>
      <p className="mb-3 text-xs text-slate-400">{hint}</p>
      <ul className="mb-3 divide-y divide-slate-100">
        {rows.map((r) => (
          <li key={r.id} className="py-2 text-sm">
            {editId === r.id ? (
              <div className="flex flex-wrap items-center gap-2">
                <TextInput autoFocus value={draft.name} maxLength={120} className="flex-1"
                           onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                <TextInput value={draft.phone} maxLength={20} placeholder="Phone" className="w-32"
                           onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
                <AdminButton className="shrink-0" onClick={() => save(r.id)}>Save</AdminButton>
                <AdminButton variant="ghost" className="shrink-0" onClick={() => setEditId(null)}>
                  Cancel
                </AdminButton>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="flex-1 text-slate-700">{r.name}
                  {r.phone && <span className="ml-1 text-slate-400">{r.phone}</span>}
                </span>
                {Number(balanceOf(r)) > 0 && (
                  <span className={`font-semibold tabular-nums ${toneClass}`}>{taka(balanceOf(r))}</span>
                )}
                <button onClick={() => { setEditId(r.id); setDraft({ name: r.name, phone: r.phone }); }}
                        aria-label="Edit"
                        className="cursor-pointer rounded p-1 text-slate-500 hover:bg-slate-100">
                  <Icon name="edit" size={14} />
                </button>
                <button onClick={() => remove(r)} aria-label="Delete"
                        className="cursor-pointer rounded p-1 text-red-500 hover:bg-red-50">
                  <Icon name="trash" size={14} />
                </button>
              </div>
            )}
          </li>
        ))}
        {!rows.length && <li className="py-2 text-sm text-slate-400">None yet.</li>}
      </ul>
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      <form onSubmit={add} className="grid gap-2">
        <TextInput value={name} placeholder="Name" maxLength={120}
                   onChange={(e) => setName(e.target.value)} />
        <div className="flex gap-2">
          <TextInput value={phone} placeholder="Phone (optional)" maxLength={20}
                     onChange={(e) => setPhone(e.target.value)} />
          <AdminButton type="submit" className="shrink-0">Add</AdminButton>
        </div>
      </form>
    </Card>
  );
}
