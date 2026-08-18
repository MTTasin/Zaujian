// Finance cash-book API client (admin panel).
//
// Money rules mirrored from the backend (app/finance_api.py):
//   expense really costs  amount + fee_amount   (MFS/transfer charge on top)
//   income really keeps   amount - fee_amount   (charge deducted from what came in)
//   credit runs BOTH ways: Expense+Supplier = we owe (dues),
//                          Income+Buyer     = they owe us (receivable)
//   credit is a RUNNING ACCOUNT: a CreditPayment comes off the CONTACT's total,
//   never off one invoice, so no history is ever rewritten
//   a credit SALE is not income until paid — it counts through its payments
//   vat_amount is INSIDE amount — a breakdown, never added on top
//   order links are a MARK only: they change no total anywhere

import { adminDelete, adminGet, adminPatch, adminPost, adminForm } from "./adminApi";

export type FinanceKind = "income" | "expense";
export type FinanceAccountValue =
  | "cash" | "bank" | "bkash" | "nagad" | "card" | "other";

export interface FinanceCategory {
  id: number;
  name: string;
  kind: FinanceKind;
  order: number;
  active: boolean;
}

export interface Supplier {
  id: number;
  name: string;
  phone: string;
  note: string;
  active: boolean;
  /** What we still owe them. */
  due: string;
  created_at: string;
}

/** Someone who buys from us on credit — a separate list from Supplier. */
export interface Buyer {
  id: number;
  name: string;
  phone: string;
  note: string;
  active: boolean;
  /** What they still owe us. */
  receivable: string;
  created_at: string;
}

/** The light order shape used for marks + the picker typeahead. */
export interface OrderMark {
  id: number;
  uid: string;
  customer_name: string;
  phone: string;
  total: string;
  status: string;
  created_at: string;
}

export type CreditKind = "payable" | "receivable";

/** Money moved against a contact's running balance — not against one invoice. */
export interface CreditPayment {
  id: number;
  kind: CreditKind;
  supplier: number | null;
  buyer: number | null;
  contact_name: string;
  date: string;
  amount: string;
  fee_amount: string;
  account: FinanceAccountValue;
  note: string;
  created_at: string;
}

export interface Expense {
  id: number;
  date: string;
  category: number;
  category_name: string;
  description: string;
  amount: string;
  vat_amount: string;
  fee_amount: string;
  total_out: string;
  account: FinanceAccountValue;
  supplier: number | null;
  supplier_name: string;
  is_credit: boolean;
  /** What THIS credit row still owes, oldest-credit-first. Null when the row is
   *  not on credit, or its supplier was deleted. Display only — the money truth
   *  is still the contact's running balance. */
  credit_remaining: string | null;
  reference: string;
  receipt: string | null;
  orders: number[];
  order_marks: OrderMark[];
  created_at: string;
}

export interface Income {
  id: number;
  date: string;
  category: number;
  category_name: string;
  description: string;
  amount: string;
  fee_amount: string;
  /** Cash in hand from this row — 0 for an unpaid credit sale. */
  net_amount: string;
  account: FinanceAccountValue;
  reference: string;
  buyer: number | null;
  buyer_name: string;
  is_credit: boolean;
  /** What THIS credit row still owes — see the same field on Expense. */
  credit_remaining: string | null;
  orders: number[];
  order_marks: OrderMark[];
  created_at: string;
}

export interface FinanceSummary {
  start: string;
  end: string;
  /** Cash actually received, net of MFS charges. Excludes unpaid credit sales. */
  income_total: number;
  /** Everything earned in the range, credit sales included even if unpaid. */
  sales_total: number;
  income_gross: number;
  /** Purchases plus the charges paid to move the money. */
  expense_total: number;
  expense_gross: number;
  net: number;
  cash_out_total: number;
  fee_total: number;
  vat_total: number;
  dues_total: number;
  dues_by_supplier: { supplier_id: number | null; supplier: string; due: number; count: number }[];
  receivable_total: number;
  receivable_by_buyer: { buyer_id: number | null; buyer: string; receivable: number; count: number }[];
  income_by_category: { category: string; total: number; count: number }[];
  expense_by_category: { category: string; total: number; count: number }[];
  daily: { date: string; income: number; expense: number; net: number }[];
  income_count: number;
  expense_count: number;
}

export interface FinanceMeta {
  accounts: { value: FinanceAccountValue; label: string; fee_rate: string }[];
}

// ---- reads ----
export const getFinanceSummary = (start: string, end: string) =>
  adminGet<FinanceSummary>(`finance/summary/?start=${start}&end=${end}`);
export const getFinanceMeta = () => adminGet<FinanceMeta>("finance/meta/");

/** A contact's statement: every credit, every payment, running balance. */
export interface LedgerEntry {
  kind: "credit" | "payment";
  id: number;
  date: string;
  label: string;
  amount: number;
  fee_amount: number;
  account: string;
  balance: number;
}
export interface Ledger {
  direction: CreditKind;
  contact: { id: number; name: string; phone: string };
  balance: number;
  entries: LedgerEntry[];
}
export const getLedger = (direction: CreditKind, contact: number) =>
  adminGet<Ledger>(`finance/ledger/?direction=${direction}&contact=${contact}`);
export const searchOrders = (q: string) =>
  adminGet<OrderMark[]>(`finance/order-search/?q=${encodeURIComponent(q)}`);
export const getOrderFinance = (orderId: number) =>
  adminGet<{ expenses: Expense[]; incomes: Income[]; expense_total: number; income_total: number }>(
    `finance/order/${orderId}/`,
  );

// ---- categories ----
export const listFinanceCategories = (kind?: FinanceKind) =>
  adminGet<FinanceCategory[]>(`finance-categories/${kind ? `?kind=${kind}` : ""}`);
export const createFinanceCategory = (body: Partial<FinanceCategory>) =>
  adminPost<FinanceCategory>("finance-categories/", body);
export const updateFinanceCategory = (id: number, body: Partial<FinanceCategory>) =>
  adminPatch<FinanceCategory>(`finance-categories/${id}/`, body);
export const deleteFinanceCategory = (id: number) => adminDelete(`finance-categories/${id}/`);

// ---- suppliers ----
export const listSuppliers = () => adminGet<Supplier[]>("suppliers/");
export const createSupplier = (body: Partial<Supplier>) => adminPost<Supplier>("suppliers/", body);
export const updateSupplier = (id: number, body: Partial<Supplier>) =>
  adminPatch<Supplier>(`suppliers/${id}/`, body);
export const deleteSupplier = (id: number) => adminDelete(`suppliers/${id}/`);

// ---- buyers (people who owe us) ----
export const listBuyers = () => adminGet<Buyer[]>("buyers/");
export const createBuyer = (body: Partial<Buyer>) => adminPost<Buyer>("buyers/", body);
export const updateBuyer = (id: number, body: Partial<Buyer>) =>
  adminPatch<Buyer>(`buyers/${id}/`, body);
export const deleteBuyer = (id: number) => adminDelete(`buyers/${id}/`);

// ---- expenses ----
export interface ExpenseFilters {
  start?: string;
  end?: string;
  category?: number | "";
  supplier?: number | "";
  account?: string;
  unpaid?: boolean;
  order?: number;
  q?: string;
}

function qs(filters: Record<string, unknown>): string {
  const p = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v === undefined || v === null || v === "" || v === false) return;
    p.set(k, v === true ? "1" : String(v));
  });
  const s = p.toString();
  return s ? `?${s}` : "";
}

export const listExpenses = (f: ExpenseFilters = {}) =>
  adminGet<Expense[]>(`expenses/${qs(f as Record<string, unknown>)}`);
export const createExpense = (body: Record<string, unknown>) =>
  adminPost<Expense>("expenses/", body);
export const updateExpense = (id: number, body: Record<string, unknown>) =>
  adminPatch<Expense>(`expenses/${id}/`, body);
export const deleteExpense = (id: number) => adminDelete(`expenses/${id}/`);
/** Receipt upload needs multipart; everything else goes as JSON. */
export const uploadReceipt = (id: number, file: File) => {
  const fd = new FormData();
  fd.append("receipt", file);
  return adminForm<Expense>(`expenses/${id}/`, fd, "PATCH");
};

// ---- credit payments (both directions, contact-level) ----
export const listCreditPayments = (f: { kind?: CreditKind; supplier?: number; buyer?: number } = {}) =>
  adminGet<CreditPayment[]>(`credit-payments/${qs(f as Record<string, unknown>)}`);
export const createCreditPayment = (body: Record<string, unknown>) =>
  adminPost<CreditPayment>("credit-payments/", body);
export const updateCreditPayment = (id: number, body: Record<string, unknown>) =>
  adminPatch<CreditPayment>(`credit-payments/${id}/`, body);
export const deleteCreditPayment = (id: number) => adminDelete(`credit-payments/${id}/`);

// ---- income ----
export const listIncomes = (f: ExpenseFilters = {}) =>
  adminGet<Income[]>(`incomes/${qs(f as Record<string, unknown>)}`);
export const createIncome = (body: Record<string, unknown>) => adminPost<Income>("incomes/", body);
export const updateIncome = (id: number, body: Record<string, unknown>) =>
  adminPatch<Income>(`incomes/${id}/`, body);
export const deleteIncome = (id: number) => adminDelete(`incomes/${id}/`);



// ---- helpers (pure — unit-tested in financeApi.test.ts) ----

/** Money for the admin panel: `৳ 1,250` (English UI, so English digits). */
export function taka(v: number | string): string {
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (!isFinite(n)) return "৳ 0";
  return `৳ ${Math.round(n).toLocaleString("en-US")}`;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * `2026-08-18` → `18-August-2026`. Split by hand rather than `new Date(iso)`:
 * an ISO date string parses as UTC midnight, so a browser behind UTC renders
 * the previous day — a statement row dated one day off is a real reading error.
 * Anything that is not a plain ISO date is returned untouched.
 */
export function longDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  if (!m) return iso || "";
  const month = MONTHS[parseInt(m[2], 10) - 1];
  if (!month) return iso;
  return `${m[3]}-${month}-${m[1]}`;
}

/**
 * Default MFS/transfer charge for an amount, from the account's percentage rate.
 * Only a PRE-FILL: flat charges (NPSB, agent fees) are typed in taka and stored
 * verbatim, so this never runs unless the admin presses the % button.
 */
export function feeFromRate(amount: number | string, ratePercent: string | number): number {
  const a = typeof amount === "string" ? parseFloat(amount) : amount;
  const r = typeof ratePercent === "string" ? parseFloat(ratePercent) : ratePercent;
  if (!isFinite(a) || !isFinite(r) || a <= 0 || r <= 0) return 0;
  return Math.round(a * r) / 100;
}

/** VAT already contained in a VAT-inclusive amount (BD ads = 15%). */
export function vatInside(amount: number | string, ratePercent = 15): number {
  const a = typeof amount === "string" ? parseFloat(amount) : amount;
  if (!isFinite(a) || a <= 0) return 0;
  return Math.round((a * ratePercent) / (100 + ratePercent) * 100) / 100;
}

export type RangeKey = "this_month" | "last_month" | "7" | "30" | "90";

export const RANGE_OPTIONS: { value: RangeKey; label: string }[] = [
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
];

export const isoDate = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Range key -> inclusive [start, end] in local (Asia/Dhaka on the server) dates. */
export function rangeDates(key: RangeKey, today = new Date()): { start: string; end: string } {
  if (key === "this_month") {
    return { start: isoDate(new Date(today.getFullYear(), today.getMonth(), 1)), end: isoDate(today) };
  }
  if (key === "last_month") {
    const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const last = new Date(today.getFullYear(), today.getMonth(), 0);
    return { start: isoDate(first), end: isoDate(last) };
  }
  const days = parseInt(key, 10);
  const start = new Date(today);
  start.setDate(start.getDate() - (days - 1));
  return { start: isoDate(start), end: isoDate(today) };
}
