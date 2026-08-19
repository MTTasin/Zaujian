import type { OrderProfit } from "@/lib/financeApi";

/**
 * Rough profit on this one order. The backend does the maths (services/profit.py);
 * this only renders it, and it renders WHERE each number came from — a share of
 * ads that Meta has not billed yet is not the same kind of number as a cost you
 * typed, and the panel must not present them as if they were.
 */
export function ProfitEstimate({ p }: { p: OrderProfit }) {
  const money = (n: number) => `৳ ${Math.round(n).toLocaleString("en-US")}`;
  const loss = p.profit < 0;

  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Rough profit
        </span>
        <span className="text-[11px] text-slate-400">estimate · last {p.window_days} days</span>
      </div>

      <ProfitLine label="Customer paid" value={money(p.collected)} />
      <ProfitLine
        label="Cost of this order"
        value={`− ${money(p.cost)}`}
        note={p.cost_marked ? undefined : "nothing marked against this order yet"}
        warn={!p.cost_marked}
      />
      <ProfitLine
        label="Share of other costs"
        value={`− ${money(p.shared)}`}
        note={p.shared_basis === "not_billed"
          ? "ads for these days not billed by Meta yet — last known rate"
          : "ads and overheads of this period, split between its orders"}
      />
      <ProfitLine
        label="Courier kept"
        value={p.courier_basis === "none" ? "—" : `− ${money(p.courier)}`}
        note={
          p.courier_basis === "none"
            ? "no parcel booked — nothing went through Steadfast"
            : p.courier_basis === "derived"
              ? "what customers paid minus what Steadfast sent"
              : "not enough delivered orders yet — using this order's delivery charge"
        }
      />

      <div className="mt-2 flex items-center justify-between border-t border-slate-200 pt-2">
        <span className="text-sm font-semibold text-slate-700">
          {loss ? "Loss" : "Profit"}
        </span>
        <span className={`text-lg font-bold tabular-nums ${
          loss ? "text-red-600" : "text-emerald-600"
        }`}>
          {money(p.profit)}
        </span>
      </div>
    </div>
  );
}

function ProfitLine({ label, value, note, warn }: {
  label: string; value: string; note?: string; warn?: boolean;
}) {
  return (
    <div className="py-0.5">
      <div className="flex justify-between gap-4 text-sm">
        <span className="text-slate-500">{label}</span>
        <span className="whitespace-nowrap tabular-nums text-slate-800">{value}</span>
      </div>
      {note && (
        <p className={`text-[11px] ${warn ? "text-amber-600" : "text-slate-400"}`}>{note}</p>
      )}
    </div>
  );
}
