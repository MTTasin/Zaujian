"use client";

// Marks an expense/income against orders. A MARK ONLY — the backend never
// splits or allocates the money, so this is purely "what was this money for".

import { useEffect, useRef, useState } from "react";
import { searchOrders, type OrderMark } from "@/lib/financeApi";
import { TextInput } from "@/components/admin/ui";
import { Icon } from "@/components/ui/Icon";

export function OrderPicker({
  selected,
  onChange,
}: {
  selected: OrderMark[];
  onChange: (next: OrderMark[]) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<OrderMark[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced: the admin types a phone number one digit at a time. Clearing on
  // an empty box happens in the change handler, so the effect only ever talks
  // to the network.
  useEffect(() => {
    const term = q.trim();
    if (!term) return;
    timer.current = setTimeout(() => {
      searchOrders(term)
        .then((rows) => {
          setResults(rows);
          setOpen(true);
        })
        .catch(() => setResults([]));
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q]);

  const add = (o: OrderMark) => {
    if (!selected.some((s) => s.id === o.id)) onChange([...selected, o]);
    setQ("");
    setResults([]);
    setOpen(false);
  };

  return (
    <div className="relative">
      <TextInput
        value={q}
        placeholder="Search order code, name or phone…"
        onChange={(e) => {
          setQ(e.target.value);
          if (!e.target.value.trim()) { setResults([]); setOpen(false); }
        }}
        onFocus={() => results.length && setOpen(true)}
      />
      {open && results.length > 0 && (
        <ul className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {results.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                onClick={() => add(o)}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50"
              >
                <span className="font-semibold text-slate-800">#{o.uid}</span>
                <span className="min-w-0 flex-1 truncate text-slate-600">{o.customer_name}</span>
                <span className="tabular-nums text-slate-400">৳{Math.round(Number(o.total))}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {selected.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {selected.map((o) => (
            <span
              key={o.id}
              className="inline-flex items-center gap-1.5 rounded-full bg-plum/10 px-2.5 py-1 text-xs font-semibold text-plum"
            >
              #{o.uid} — {o.customer_name}
              <button
                type="button"
                aria-label={`Remove ${o.uid}`}
                onClick={() => onChange(selected.filter((s) => s.id !== o.id))}
                className="cursor-pointer opacity-60 hover:opacity-100"
              >
                <Icon name="x" size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <p className="mt-1 text-xs text-slate-400">
        A note only — marked orders are not costed or split.
      </p>
    </div>
  );
}
