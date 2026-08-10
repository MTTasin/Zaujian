"use client";

// Add/edit form for both sides of the cash-book. One component because the
// money rules are the same shape on both: an amount, an MFS/transfer charge
// (typed in taka; the % button is only a pre-fill), an account, order marks.
//
//   expense: fee is paid ON TOP     -> total out = amount + fee
//   income:  fee is DEDUCTED        -> net in    = amount - fee

import { useState } from "react";
import {
  createBuyer, createCreditPayment, createExpense, createIncome, createSupplier,
  feeFromRate, taka, updateExpense, updateIncome, uploadReceipt, vatInside,
  type Buyer, type Expense, type FinanceAccountValue, type FinanceCategory,
  type FinanceMeta, type Income, type OrderMark, type Supplier,
} from "@/lib/financeApi";
import { AdminButton, Card, Field, Select, TextInput } from "@/components/admin/ui";
import { OrderPicker } from "./OrderPicker";

type Kind = "expense" | "income";

const todayISO = () => new Date().toISOString().slice(0, 10);

export function EntryForm({
  kind,
  categories,
  suppliers,
  buyers,
  meta,
  editing,
  initialMarks,
  onSaved,
  onCancel,
  onContactAdded,
}: {
  kind: Kind;
  categories: FinanceCategory[];
  suppliers: Supplier[];
  buyers: Buyer[];
  meta: FinanceMeta | null;
  editing: Expense | Income | null;
  /** Pre-marked orders for a NEW entry — used when the form is opened from an
      order, where the mark is the whole reason the admin is here. */
  initialMarks?: OrderMark[];
  onSaved: () => void;
  onCancel: () => void;
  /** A contact created from inside this form — refresh the page's lists. */
  onContactAdded: () => void;
}) {
  const isExpense = kind === "expense";
  const ex = isExpense ? (editing as Expense | null) : null;
  const inc = isExpense ? null : (editing as Income | null);

  const [date, setDate] = useState(editing?.date ?? todayISO());
  const [category, setCategory] = useState<string>(String(editing?.category ?? ""));
  const [description, setDescription] = useState(editing?.description ?? "");
  const [amount, setAmount] = useState(editing?.amount ?? "");
  const [fee, setFee] = useState(editing?.fee_amount ?? "");
  const [vat, setVat] = useState(isExpense ? ex?.vat_amount ?? "" : "");
  const [account, setAccount] = useState<FinanceAccountValue>(editing?.account ?? "cash");
  const [supplier, setSupplier] = useState<string>(String(ex?.supplier ?? ""));
  const [buyer, setBuyer] = useState<string>(String(inc?.buyer ?? ""));
  const [isCredit, setIsCredit] = useState<boolean>(
    (ex?.is_credit ?? inc?.is_credit) ?? false);
  const [reference, setReference] = useState(editing?.reference ?? "");
  const [marks, setMarks] = useState<OrderMark[]>(
    editing?.order_marks ?? initialMarks ?? []);
  const [receipt, setReceipt] = useState<File | null>(null);
  // Part payment made at the moment of the deal — saved as the first instalment
  // so the admin never has to add the entry and then go find it again.
  const [downPayment, setDownPayment] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const usable = categories.filter((c) => c.active || String(c.id) === category);
  // Derived, not an effect: the categories arrive after first paint, so the
  // first usable one stands in until the admin picks something.
  const categoryId = category || String(usable[0]?.id ?? "");

  const rate = meta?.accounts.find((a) => a.value === account)?.fee_rate ?? "0";
  const amountNum = parseFloat(amount || "0") || 0;
  const feeNum = parseFloat(fee || "0") || 0;
  const downNum = parseFloat(downPayment || "0") || 0;
  // On credit, nothing has moved except whatever was handed over on the spot,
  // and any transfer charge belongs to that payment — not to the deal itself.
  const onCredit = isCredit && !editing;
  const effect = onCredit
    ? (isExpense ? downNum + feeNum : downNum - feeNum)
    : isExpense ? amountNum + feeNum : amountNum - feeNum;
  const outstanding = onCredit ? Math.max(amountNum - downNum, 0) : 0;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!categoryId) return setError("Pick a category.");
    if (!(amountNum > 0)) return setError("Amount must be greater than 0.");
    if (onCredit && downNum > amountNum) {
      return setError("Paid now cannot be more than the amount.");
    }
    if (isCredit && (isExpense ? !supplier : !buyer)) {
      // The balance lives on the contact, so a nameless credit could never be paid.
      return setError(isExpense ? "Pick the supplier." : "Pick the buyer.");
    }
    setSaving(true);
    const body: Record<string, unknown> = {
      date,
      category: Number(categoryId),
      description,
      // On credit the row holds the FULL deal value; the charge (if any) moves
      // to the down payment below.
      amount,
      fee_amount: isCredit ? "0" : fee || "0",
      account,
      reference,
      orders: marks.map((m) => m.id),
      is_credit: isCredit,
    };
    if (isExpense) {
      body.vat_amount = vat || "0";
      body.supplier = supplier ? Number(supplier) : null;
    } else {
      body.buyer = buyer ? Number(buyer) : null;
    }
    try {
      let saved: Expense | Income;
      if (editing) {
        saved = isExpense
          ? await updateExpense(editing.id, body)
          : await updateIncome(editing.id, body);
      } else {
        saved = isExpense ? await createExpense(body) : await createIncome(body);
      }
      if (isExpense && receipt) await uploadReceipt(saved.id, receipt);
      if (onCredit && downNum > 0) {
        // Goes against the CONTACT's balance, like every other payment — the
        // deal itself is never marked part-settled.
        await createCreditPayment({
          kind: isExpense ? "payable" : "receivable",
          supplier: isExpense ? Number(supplier) : null,
          buyer: isExpense ? null : Number(buyer),
          date, amount: String(downNum), fee_amount: fee || "0", account,
          note: "Paid at the time of the deal",
        });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="mb-6 p-5">
      <form onSubmit={save} className="grid gap-4 md:grid-cols-2">
        <Field label="Date">
          <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Category">
          <Select value={categoryId} onChange={(e) => setCategory(e.target.value)}>
            {usable.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </Field>

        <Field
          label={isExpense ? "Amount (VAT included)" : "Amount received"}
          hint={isExpense
            ? "What the purchase cost — the VAT is inside this number."
            : "For a Steadfast payout: the amount they actually sent."}
        >
          <TextInput
            type="number" step="0.01" min="0" inputMode="decimal"
            value={amount} onChange={(e) => setAmount(e.target.value)}
          />
        </Field>

        {isCredit && editing ? (
          <Field label="MFS charge" hint="Charges live on the payments — edit them in the Credit tab.">
            <TextInput disabled value="—" />
          </Field>
        ) : (
          <Field
            label={onCredit
              ? "Charge on that payment"
              : isExpense ? "Transfer / MFS charge (paid on top)" : "MFS charge (deducted)"}
            hint={`Type the exact taka. Rate button uses ${rate}% for this account.`}
          >
            <div className="flex gap-2">
              <TextInput
                type="number" step="0.01" min="0" inputMode="decimal"
                placeholder="0"
                value={fee} onChange={(e) => setFee(e.target.value)}
              />
              <AdminButton
                type="button" variant="secondary" className="shrink-0"
                title={`Fill ${rate}% of the amount`}
                onClick={() => setFee(String(feeFromRate(onCredit ? downNum : amountNum, rate)))}
              >
                {rate}%
              </AdminButton>
            </div>
          </Field>
        )}

        {onCredit && (
          <Field
            label={isExpense ? "Paid now (rest on credit)" : "Received now (rest on credit)"}
            hint="Leave blank if nothing changed hands yet. Saved as the first instalment."
          >
            <TextInput
              type="number" step="0.01" min="0" inputMode="decimal" placeholder="0"
              value={downPayment} onChange={(e) => setDownPayment(e.target.value)}
            />
          </Field>
        )}

        {isExpense && (
          <Field label="VAT inside the amount" hint="Ads are billed with 15% VAT in BD.">
            <div className="flex gap-2">
              <TextInput
                type="number" step="0.01" min="0" inputMode="decimal"
                placeholder="0"
                value={vat} onChange={(e) => setVat(e.target.value)}
              />
              <AdminButton
                type="button" variant="secondary" className="shrink-0"
                title="Extract 15% VAT from the amount"
                onClick={() => setVat(String(vatInside(amountNum)))}
              >
                15%
              </AdminButton>
            </div>
          </Field>
        )}

        <Field label="Account">
          <Select
            value={account}
            onChange={(e) => setAccount(e.target.value as FinanceAccountValue)}
          >
            {(meta?.accounts ?? []).map((a) => (
              <option key={a.value} value={a.value}>{a.label}</option>
            ))}
          </Select>
        </Field>

        <Field label="Description">
          <TextInput
            value={description} maxLength={200}
            placeholder={isExpense ? "e.g. Dupatta lot from Chawkbazar" : "e.g. Steadfast payout"}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>

        <Field label="Reference" hint="Invoice number, trx id, payout id — optional.">
          <TextInput value={reference} maxLength={80}
                     onChange={(e) => setReference(e.target.value)} />
        </Field>

        {isExpense && (
          <>
            <Field label="Supplier" hint="Needed to track credit.">
              <ContactSelect
                value={supplier}
                onChange={setSupplier}
                rows={suppliers}
                placeholder="Supplier name"
                onCreate={(name, phone) => createSupplier({ name, phone })}
                onCreated={onContactAdded}
              />
            </Field>
            <Field label="Receipt photo" hint="Optional.">
              <TextInput
                type="file" accept="image/*"
                onChange={(e) => setReceipt(e.target.files?.[0] ?? null)}
              />
            </Field>
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 md:col-span-2">
              <input
                type="checkbox" checked={isCredit}
                onChange={(e) => setIsCredit(e.target.checked)}
                className="h-4 w-4 accent-plum"
              />
              Taken on credit — pay later (shows up in Dues)
            </label>
          </>
        )}

        {!isExpense && (
          <>
            <Field label="Buyer" hint="Needed to track who owes you.">
              <ContactSelect
                value={buyer}
                onChange={setBuyer}
                rows={buyers}
                placeholder="Buyer name"
                onCreate={(name, phone) => createBuyer({ name, phone })}
                onCreated={onContactAdded}
              />
            </Field>
            <label className="flex items-center gap-2 self-end pb-2 text-sm font-semibold text-slate-700">
              <input
                type="checkbox" checked={isCredit}
                onChange={(e) => setIsCredit(e.target.checked)}
                className="h-4 w-4 accent-plum"
              />
              Sold on credit — not paid yet (shows up in Owed to me)
            </label>
          </>
        )}

        <div className="md:col-span-2">
          <span className="mb-1.5 block text-sm font-semibold text-slate-700">
            Spent on / received for these orders
          </span>
          <OrderPicker selected={marks} onChange={setMarks} />
        </div>

        <div className="flex flex-wrap items-center gap-3 md:col-span-2">
          <AdminButton type="submit" disabled={saving}>
            {saving ? "Saving…" : editing ? "Save changes" : `Add ${kind}`}
          </AdminButton>
          <AdminButton type="button" variant="ghost" onClick={onCancel}>Cancel</AdminButton>
          <span className="text-sm text-slate-500">
            {onCredit ? "Cash now" : isExpense ? "Total out" : "Net in hand"}:{" "}
            <b className="text-slate-800">{taka(effect)}</b>
            {onCredit && outstanding > 0 && (
              <span className={`ml-2 ${isExpense ? "text-amber-700" : "text-emerald-700"}`}>
                {taka(outstanding)} {isExpense ? "left owing" : "still owed to you"}
              </span>
            )}
          </span>
          {error && <span className="text-sm font-semibold text-red-600">{error}</span>}
        </div>
      </form>
    </Card>
  );
}


/** A contact dropdown that can create a new one without leaving the form —
 *  a supplier's name usually only becomes known while typing the purchase. */
function ContactSelect<T extends { id: number; name: string }>({
  value, onChange, rows, placeholder, onCreate, onCreated,
}: {
  value: string;
  onChange: (id: string) => void;
  rows: T[];
  placeholder: string;
  onCreate: (name: string, phone: string) => Promise<T>;
  onCreated: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Locally added rows show up immediately; the parent refetches in parallel.
  const [extra, setExtra] = useState<T[]>([]);
  const all = [...rows.filter((r) => !extra.some((e) => e.id === r.id)), ...extra];

  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    setError("");
    try {
      const created = await onCreate(name.trim(), phone.trim());
      setExtra((prev) => [...prev, created]);
      onChange(String(created.id));
      setName(""); setPhone(""); setAdding(false);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add");
    } finally {
      setBusy(false);
    }
  }

  if (adding) {
    return (
      <div className="grid gap-2">
        <TextInput
          autoFocus value={name} placeholder={placeholder} maxLength={120}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            // Enter must not submit the whole expense form behind this input.
            if (e.key === "Enter") { e.preventDefault(); save(); }
            if (e.key === "Escape") setAdding(false);
          }}
        />
        <div className="flex gap-2">
          <TextInput
            value={phone} placeholder="Phone (optional)" maxLength={20}
            onChange={(e) => setPhone(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(); } }}
          />
          <AdminButton type="button" className="shrink-0" disabled={busy} onClick={save}>
            {busy ? "…" : "Save"}
          </AdminButton>
          <AdminButton
            type="button" variant="ghost" className="shrink-0"
            onClick={() => { setAdding(false); setError(""); }}
          >
            Cancel
          </AdminButton>
        </div>
        {error && <span className="text-xs font-semibold text-red-600">{error}</span>}
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">— none —</option>
        {all.map((r) => (
          <option key={r.id} value={r.id}>{r.name}</option>
        ))}
      </Select>
      <AdminButton
        type="button" variant="secondary" className="shrink-0" icon="plus"
        onClick={() => setAdding(true)}
      >
        New
      </AdminButton>
    </div>
  );
}
