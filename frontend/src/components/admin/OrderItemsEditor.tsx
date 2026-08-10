"use client";

import { useState } from "react";
import {
  editOrderItems,
  type AdminOrder, type AdminOrderItem, type CatalogueEntry, type OrderItemEdit,
} from "@/lib/adminApi";
import { CataloguePicker } from "@/components/admin/CataloguePicker";
import { AdminButton, TextInput } from "@/components/admin/ui";
import { Icon } from "@/components/ui/Icon";

/**
 * Change what a placed order actually contains.
 *
 * Customers change their minds after ordering: swap the pen for a mirror, add a
 * second book, agree a different price on the phone. Every one of those was
 * previously either impossible or a delete-and-retype.
 *
 * A line that came from the website keeps its `id`, so editing its text or price
 * leaves the colour/design config — and therefore its photo and its "Change
 * design" editor — exactly as the customer left it. Only swapping the linked
 * item drops that config, because it described a product no longer being bought.
 */

type Detail = { label: string; value: string };

type Line = {
  key: number;
  /** Present = an existing order line being edited in place. */
  id?: number;
  title: string;
  price: string;
  note: string;
  details: Detail[];
  product: number | null;
  combo: number | null;
  linked: string;
  /** True once the link is changed here — the backend then drops the old options. */
  relinked: boolean;
};

let nextKey = 1;

function lineFromItem(it: AdminOrderItem): Line {
  return {
    key: nextKey++,
    id: it.id,
    // The stored title wins where there is one, exactly as the order list reads it.
    title: String(it.config?.title ?? it.product_name ?? ""),
    price: it.price_snapshot,
    note: it.config?.note ?? "",
    details: (it.config?.fields ?? []).map((f) => ({ label: f.label, value: f.value })),
    product: it.product,
    combo: it.combo,
    linked: it.product || it.combo ? it.product_name : "",
    relinked: false,
  };
}

function lineFromEntry(entry: CatalogueEntry, kind: "listing" | "product"): Line {
  return {
    key: nextKey++,
    title: entry.name,
    price: entry.price,
    note: "",
    details: entry.fields.map((label) => ({ label, value: "" })),
    combo: kind === "listing" ? entry.id : null,
    product: kind === "product" ? entry.id : null,
    linked: entry.name,
    relinked: true,
  };
}

export function OrderItemsEditor({ order, onSaved, onCancel }: {
  order: AdminOrder;
  onSaved: (updated: AdminOrder) => void;
  onCancel: () => void;
}) {
  const [lines, setLines] = useState<Line[]>(() => order.items.map(lineFromItem));
  const [picking, setPicking] = useState<number | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const patch = (i: number, p: Partial<Line>) =>
    setLines((a) => a.map((l, idx) => (idx === i ? { ...l, ...p } : l)));
  const patchDetail = (i: number, di: number, p: Partial<Detail>) =>
    setLines((a) => a.map((l, idx) => idx !== i ? l : {
      ...l, details: l.details.map((d, dIdx) => (dIdx === di ? { ...d, ...p } : d)),
    }));

  function pick(entry: CatalogueEntry, kind: "listing" | "product") {
    const fresh = lineFromEntry(entry, kind);
    setLines((a) => {
      if (picking === "new") return [...a, fresh];
      return a.map((l, idx) => idx !== picking ? l : {
        // Swapping keeps the line (and its id, so nothing is deleted and
        // re-created) but takes the new item's name, price and detail labels.
        ...l,
        title: fresh.title, price: fresh.price, linked: fresh.linked,
        product: fresh.product, combo: fresh.combo, relinked: true,
        details: l.details.length ? l.details : fresh.details,
      });
    });
    setPicking(null);
  }

  const subtotal = lines.reduce((s, l) => s + (Number(l.price) || 0), 0);
  const delivery = Number(order.delivery_charge) || 0;

  async function save() {
    const payload: OrderItemEdit[] = lines
      .filter((l) => l.title.trim() || l.product || l.combo)
      .map((l) => {
        const out: OrderItemEdit = {
          title: l.title.trim(),
          price: l.price,
          note: l.note.trim(),
          fields: l.details
            .map((d) => ({ label: d.label.trim(), value: d.value.trim() }))
            .filter((d) => d.label || d.value),
        };
        if (l.id != null) out.id = l.id;
        // Only sent when it actually changed: an untouched website line must not
        // look like a relink, or it would lose its colour/design config.
        if (l.relinked) { out.product = l.product; out.combo = l.combo; }
        return out;
      });

    if (payload.length === 0) {
      setError("An order must keep at least one item.");
      return;
    }
    setBusy(true); setError("");
    try {
      onSaved(await editOrderItems(order.id, payload));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the items");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</p>}

      {lines.map((l, i) => (
        <div key={l.key} className="rounded-xl border border-slate-200 p-3">
          <div className="flex gap-3">
            <div className="flex-1">
              <TextInput placeholder="Item name" value={l.title}
                         onChange={(e) => patch(i, { title: e.target.value })} />
            </div>
            <div className="w-32">
              <TextInput placeholder="Price ৳" type="number" step="0.01" value={l.price}
                         onChange={(e) => patch(i, { price: e.target.value })} />
            </div>
            <button type="button" onClick={() => setLines((a) => a.filter((_, idx) => idx !== i))}
              aria-label="Remove item"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600">
              <Icon name="trash" size={16} />
            </button>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            {l.linked ? (
              <span className="rounded-full bg-plum/10 px-2 py-0.5 font-semibold text-plum">
                {l.combo ? "Listing" : "Product"}: {l.linked}
              </span>
            ) : (
              <span className="text-slate-400">Free line — not linked to the shop</span>
            )}
            <button type="button" onClick={() => setPicking(picking === i ? null : i)}
              className="font-medium text-plum hover:underline">
              {picking === i ? "close" : l.linked ? "change item" : "link an item"}
            </button>
            {l.linked && (
              <button type="button"
                onClick={() => patch(i, { product: null, combo: null, linked: "", relinked: true })}
                className="text-slate-400 hover:text-red-600">
                unlink
              </button>
            )}
            {l.relinked && l.id != null && (
              <span className="text-amber-600">
                item changed — the old colour/design picks are dropped
              </span>
            )}
          </div>

          {picking === i && <div className="mt-3"><CataloguePicker onPick={pick} /></div>}

          <div className="mt-3 space-y-2">
            {l.details.map((d, di) => (
              <div key={di} className="flex gap-2">
                <div className="w-1/3">
                  <TextInput placeholder="Detail (e.g. বরের নাম)" value={d.label}
                             onChange={(e) => patchDetail(i, di, { label: e.target.value })} />
                </div>
                <div className="flex-1">
                  <TextInput placeholder="What the customer wants" value={d.value}
                             onChange={(e) => patchDetail(i, di, { value: e.target.value })} />
                </div>
                <button type="button" aria-label="Remove detail"
                  onClick={() => setLines((a) => a.map((x, idx) => idx !== i ? x
                    : { ...x, details: x.details.filter((_, dIdx) => dIdx !== di) }))}
                  className="flex h-10 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600">
                  <Icon name="trash" size={14} />
                </button>
              </div>
            ))}
            <button type="button"
              onClick={() => setLines((a) => a.map((x, idx) => idx !== i ? x
                : { ...x, details: [...x.details, { label: "", value: "" }] }))}
              className="text-sm font-medium text-plum hover:underline">
              + Add detail
            </button>
          </div>

          <div className="mt-3">
            <TextInput placeholder="Special instruction for this item (optional)"
                       value={l.note} onChange={(e) => patch(i, { note: e.target.value })} />
          </div>
        </div>
      ))}

      <div className="flex flex-wrap gap-2">
        <AdminButton type="button" variant="secondary" icon="cart"
          onClick={() => setPicking(picking === "new" ? null : "new")}>
          {picking === "new" ? "Close picker" : "Add from shop"}
        </AdminButton>
        <AdminButton type="button" variant="secondary" icon="plus"
          onClick={() => setLines((a) => [...a, {
            key: nextKey++, title: "", price: "", note: "", details: [],
            product: null, combo: null, linked: "", relinked: false,
          }])}>
          Free line
        </AdminButton>
      </div>

      {picking === "new" && <CataloguePicker onPick={pick} />}

      <div className="rounded-lg bg-slate-50 p-3 text-sm">
        <div className="flex justify-between text-slate-500">
          <span>New subtotal</span><span className="tabular-nums">৳ {subtotal.toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-slate-500">
          <span>Delivery</span><span className="tabular-nums">৳ {delivery.toFixed(2)}</span>
        </div>
        <div className="mt-1 flex justify-between border-t border-slate-200 pt-1 font-bold text-slate-900">
          <span>Total</span><span className="tabular-nums">৳ {(subtotal + delivery).toFixed(2)}</span>
        </div>
      </div>

      <div className="flex gap-3">
        <AdminButton icon="check" disabled={busy} onClick={save}>
          {busy ? "Saving…" : "Save items"}
        </AdminButton>
        <AdminButton variant="secondary" disabled={busy} onClick={onCancel}>Cancel</AdminButton>
      </div>
    </div>
  );
}
