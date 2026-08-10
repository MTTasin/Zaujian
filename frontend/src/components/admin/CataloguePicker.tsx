"use client";

import { useEffect, useState } from "react";
import { getOrderCatalogue, type CatalogueEntry, type OrderCatalogue } from "@/lib/adminApi";
import { TextInput } from "@/components/admin/ui";
import { Icon } from "@/components/ui/Icon";

/**
 * Everything the shop sells, searchable. Listings first (that IS the catalogue);
 * plain products below, because over WhatsApp the owner does sell them one-off
 * even though the storefront only offers them inside the customizer.
 *
 * Shared by "new manual order" and the order-detail item editor: picking an item
 * has to mean the same thing in both places, or a swapped line would end up
 * shaped differently from the line it replaced.
 */
export function CataloguePicker({ onPick }: {
  onPick: (entry: CatalogueEntry, kind: "listing" | "product") => void;
}) {
  const [data, setData] = useState<OrderCatalogue | null>(null);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");

  useEffect(() => {
    getOrderCatalogue()
      .then(setData)
      .catch((e) => setErr(e instanceof Error ? e.message : "Could not load the catalogue"));
  }, []);

  const match = (e: CatalogueEntry) => {
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    return `${e.name} ${e.category}`.toLowerCase().includes(needle);
  };

  const listings = (data?.listings ?? []).filter(match);
  const products = (data?.products ?? []).filter(match);

  return (
    <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <TextInput placeholder="Search the shop…" value={q} onChange={(e) => setQ(e.target.value)} />
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      {!data && !err && <p className="mt-2 text-sm text-slate-500">Loading…</p>}
      {data && (
        <div className="mt-3 max-h-80 space-y-4 overflow-y-auto">
          <PickGroup title="Listings" hint="What the storefront sells"
                     rows={listings} onPick={(e) => onPick(e, "listing")} />
          <PickGroup title="Products" hint="Customizer items — sold one-off over chat"
                     rows={products} onPick={(e) => onPick(e, "product")} />
          {!listings.length && !products.length && (
            <p className="text-sm text-slate-500">Nothing matches that.</p>
          )}
        </div>
      )}
    </div>
  );
}

function PickGroup({ title, hint, rows, onPick }: {
  title: string; hint: string; rows: CatalogueEntry[];
  onPick: (entry: CatalogueEntry) => void;
}) {
  if (!rows.length) return null;
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title} <span className="font-normal normal-case tracking-normal">· {hint}</span>
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {rows.map((e) => (
          <button key={`${title}-${e.id}`} type="button" onClick={() => onPick(e)}
            className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-2 text-left hover:border-plum">
            {e.image
              ? <img src={e.image} alt="" className="h-10 w-10 shrink-0 rounded object-cover" />
              : <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-slate-100 text-slate-400">
                  <Icon name="gift" size={16} />
                </span>}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-slate-900">{e.name}</span>
              <span className="block truncate text-xs text-slate-500">
                ৳ {e.price}{e.category ? ` · ${e.category}` : ""}
                {e.fields.length ? ` · ${e.fields.length} detail${e.fields.length > 1 ? "s" : ""}` : ""}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
