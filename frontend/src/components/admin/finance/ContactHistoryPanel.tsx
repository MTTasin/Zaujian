"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getContactHistory, taka, longDate,
  type ContactHistory, type CreditKind,
} from "@/lib/financeApi";

/**
 * Everything that ever passed between us and one contact.
 *
 * Deliberately NOT the same view as the Credit tab. That one answers "what do I
 * still owe for" and shows credit rows only; this answers "what is our history",
 * which includes the dupattas paid for in cash.
 *
 * A cash row is drawn as part of the story but marked as not touching the
 * balance — without that, the page reads as if the same money were owed twice.
 */
export function ContactHistoryPanel({ direction, contactId, tone }: {
  direction: CreditKind;
  contactId: number;
  tone: "amber" | "emerald";
}) {
  const [data, setData] = useState<ContactHistory | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    getContactHistory(direction, contactId)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load"));
  }, [direction, contactId]);
  useEffect(load, [load]);

  if (error) return <p className="mt-3 text-sm text-red-600">{error}</p>;
  if (!data) return <p className="mt-3 text-sm text-slate-400">Loading history…</p>;

  const payable = direction === "payable";
  const toneClass = tone === "emerald" ? "text-emerald-700" : "text-amber-700";

  return (
    <div className="mt-4 border-t border-slate-100 pt-4">
      <div className="mb-3 grid grid-cols-3 gap-3 text-sm">
        <Total label={payable ? "Bought from them" : "Sold to them"} value={taka(data.totals.bought)} />
        <Total label={payable ? "Paid them" : "Received"} value={taka(data.totals.paid)} />
        <Total
          label={payable ? "Still owed" : "Still owes you"}
          value={taka(data.totals.balance)}
          className={toneClass}
        />
      </div>

      {data.entries.length === 0 ? (
        <p className="py-3 text-sm text-slate-400">No transactions yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {[...data.entries].reverse().map((e) => (
            <li key={`${e.kind}${e.id}`}
                className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <span className="w-36 shrink-0 text-slate-400">{longDate(e.date)}</span>
              <span className="min-w-0 flex-1 truncate text-slate-700">
                {e.kind === "payment" ? `${payable ? "Payment" : "Received"} — ${e.label}` : e.label}
              </span>
              <span className={`w-24 text-right tabular-nums ${
                e.kind === "payment" ? "text-emerald-600" : "text-slate-800"
              }`}>
                {e.kind === "payment" ? "−" : "+"} {taka(e.amount)}
              </span>
              <span className="w-32 text-right text-xs">
                {e.kind === "cash" ? (
                  <span className="text-slate-400">paid at the time</span>
                ) : e.kind === "credit" ? (
                  e.remaining > 0
                    ? <span className="text-amber-600">{taka(e.remaining)} left</span>
                    : <span className="text-emerald-600">settled</span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Total({ label, value, className }: {
  label: string; value: string; className?: string;
}) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`font-bold tabular-nums ${className ?? "text-slate-800"}`}>{value}</p>
    </div>
  );
}
