"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  adminPost, getOrderCatalogue, ORDER_STATUSES,
  type CatalogueEntry, type OrderCatalogue,
} from "@/lib/adminApi";
import { getShopInfo } from "@/lib/api";
import { BD_LOCATIONS } from "@/lib/bdLocations";
import { PageHeader, Card, Field, TextInput, TextArea, Select, AdminButton } from "@/components/admin/ui";
import { Icon } from "@/components/ui/Icon";

/**
 * A detail the customer sent in chat: বরের নাম / তারিখ / ডাকনাম… Stored in the same
 * config["fields"] shape the storefront uses, so the label is snapshotted with
 * the value and every existing screen (order detail, challan) renders it.
 */
type Detail = { label: string; value: string };

type Line = {
  key: number;
  title: string;
  price: string;
  note: string;
  details: Detail[];
  /** Set when picked from the catalogue — the order then carries its photo. */
  product: number | null;
  combo: number | null;
  linked: string;
};

let nextKey = 1;
const blankLine = (): Line => ({
  key: nextKey++, title: "", price: "", note: "", details: [],
  product: null, combo: null, linked: "",
});

/** A picked listing/product, with its detail labels ready to fill in. */
function lineFromEntry(entry: CatalogueEntry, kind: "listing" | "product"): Line {
  return {
    ...blankLine(),
    title: entry.name,
    price: entry.price,
    linked: entry.name,
    combo: kind === "listing" ? entry.id : null,
    product: kind === "product" ? entry.id : null,
    details: entry.fields.map((label) => ({ label, value: "" })),
  };
}

export default function NewManualOrder() {
  const router = useRouter();
  const [form, setForm] = useState({
    customer_name: "", phone: "", whatsapp: "", email: "",
    division: "", district: "", thana: "", address: "",
    delivery_charge: "", advance_received: "", status: "confirmed",
  });
  const [thanaOther, setThanaOther] = useState("");
  const [items, setItems] = useState<Line[]>([blankLine()]);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getShopInfo()
      .then((s) => setForm((f) => ({ ...f, delivery_charge: s.delivery_charge })))
      .catch(() => {});
  }, []);

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const patchItem = (i: number, patch: Partial<Line>) =>
    setItems((arr) => arr.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  const addItem = () => setItems((arr) => [...arr, blankLine()]);
  const removeItem = (i: number) => setItems((arr) => arr.filter((_, idx) => idx !== i));

  const addDetail = (i: number) =>
    setItems((arr) => arr.map((it, idx) =>
      idx === i ? { ...it, details: [...it.details, { label: "", value: "" }] } : it));
  const patchDetail = (i: number, di: number, patch: Partial<Detail>) =>
    setItems((arr) => arr.map((it, idx) => idx !== i ? it : {
      ...it,
      details: it.details.map((d, dIdx) => (dIdx === di ? { ...d, ...patch } : d)),
    }));
  const removeDetail = (i: number, di: number) =>
    setItems((arr) => arr.map((it, idx) => idx !== i ? it
      : { ...it, details: it.details.filter((_, dIdx) => dIdx !== di) }));

  function pick(entry: CatalogueEntry, kind: "listing" | "product") {
    const line = lineFromEntry(entry, kind);
    // The first line is usually still the empty one this page opens with.
    setItems((arr) => {
      const only = arr.length === 1 && !arr[0].title.trim() && !arr[0].price.trim();
      return only ? [line] : [...arr, line];
    });
    setPicking(false);
  }

  const divisions = useMemo(() => Object.keys(BD_LOCATIONS), []);
  const districts = form.division ? Object.keys(BD_LOCATIONS[form.division] ?? {}) : [];
  const thanas = form.division && form.district ? BD_LOCATIONS[form.division]?.[form.district] ?? [] : [];

  const subtotal = items.reduce((s, it) => s + (Number(it.price) || 0), 0);
  const delivery = Number(form.delivery_charge) || 0;
  const advance = Number(form.advance_received) || 0;
  const total = subtotal + delivery;
  const cod = Math.max(0, total - advance);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const clean = items
      .filter((it) => it.title.trim() || it.product || it.combo)
      .map((it) => ({
        title: it.title.trim(),
        price: it.price,
        product: it.product,
        combo: it.combo,
        note: it.note.trim(),
        // Half-typed detail rows are dropped, never sent as blanks.
        fields: it.details
          .map((d) => ({ label: d.label.trim(), value: d.value.trim() }))
          .filter((d) => d.label || d.value),
      }));
    if (!form.customer_name.trim() || !form.phone.trim()) {
      setError("Customer name and phone are required.");
      return;
    }
    if (clean.length === 0) {
      setError("Add at least one item with a name.");
      return;
    }
    setBusy(true);
    try {
      const res = await adminPost<{ id: number; uid: string }>("orders/manual/", {
        ...form,
        thana: form.thana === "Others" ? thanaOther.trim() : form.thana,
        items: clean,
      });
      router.push(`/admin/orders/${res.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create order");
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="New manual order"
        subtitle="For orders received off the website (phone, WhatsApp, in person)."
        action={<Link href="/admin/orders" className="text-sm font-medium text-plum hover:underline">← Orders</Link>}
      />

      {error && <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</p>}

      <form onSubmit={submit} className="space-y-5">
        {/* Customer */}
        <Card className="p-5">
          <h2 className="mb-4 font-semibold text-slate-900">Customer</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Name"><TextInput value={form.customer_name} onChange={(e) => set("customer_name", e.target.value)} required /></Field>
            <Field label="Phone"><TextInput value={form.phone} onChange={(e) => set("phone", e.target.value)} required /></Field>
            <Field label="WhatsApp"><TextInput value={form.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} /></Field>
            <Field label="Email"><TextInput type="email" value={form.email} onChange={(e) => set("email", e.target.value)} /></Field>
          </div>
        </Card>

        {/* Address */}
        <Card className="p-5">
          <h2 className="mb-4 font-semibold text-slate-900">Delivery address</h2>
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Division">
              <Select value={form.division} onChange={(e) => setForm((f) => ({ ...f, division: e.target.value, district: "", thana: "" }))}>
                <option value="">Select…</option>
                {divisions.map((d) => <option key={d} value={d}>{d}</option>)}
              </Select>
            </Field>
            <Field label="District">
              <Select value={form.district} disabled={!form.division} onChange={(e) => setForm((f) => ({ ...f, district: e.target.value, thana: "" }))}>
                <option value="">Select…</option>
                {districts.map((d) => <option key={d} value={d}>{d}</option>)}
              </Select>
            </Field>
            <Field label="Thana / Upazila">
              <Select value={form.thana} disabled={!form.district}
                onChange={(e) => { set("thana", e.target.value); setThanaOther(""); }}>
                <option value="">Select…</option>
                {thanas.map((t) => <option key={t} value={t}>{t}</option>)}
              </Select>
              {/* Unlisted area: the courier takes the address as free text anyway. */}
              {form.thana === "Others" && (
                <div className="mt-2">
                  <TextInput value={thanaOther} placeholder="Type the thana name"
                    onChange={(e) => setThanaOther(e.target.value)} />
                </div>
              )}
            </Field>
          </div>
          <div className="mt-4">
            <Field label="Street address"><TextArea rows={2} value={form.address} onChange={(e) => set("address", e.target.value)} /></Field>
          </div>
        </Card>

        {/* Items */}
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-slate-900">Items</h2>
              <p className="text-xs text-slate-500">
                Pick from the shop so the order carries the real photo and price, or type a free line.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap justify-end gap-2">
              <AdminButton type="button" icon="cart" onClick={() => setPicking((v) => !v)}>
                {picking ? "Close picker" : "Pick from shop"}
              </AdminButton>
              <AdminButton type="button" variant="secondary" icon="plus" onClick={addItem}>
                Free line
              </AdminButton>
            </div>
          </div>

          {picking && <CataloguePicker onPick={pick} />}

          <div className="space-y-4">
            {items.map((it, i) => (
              <div key={it.key} className="rounded-xl border border-slate-200 p-3">
                <div className="flex gap-3">
                  <div className="flex-1">
                    <TextInput placeholder="Item name / description" value={it.title}
                               onChange={(e) => patchItem(i, { title: e.target.value })} />
                  </div>
                  <div className="w-32">
                    <TextInput placeholder="Price ৳" type="number" step="0.01" value={it.price}
                               onChange={(e) => patchItem(i, { price: e.target.value })} />
                  </div>
                  <button type="button" onClick={() => removeItem(i)} disabled={items.length === 1}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30">
                    <Icon name="trash" size={16} />
                  </button>
                </div>

                {it.linked && (
                  <div className="mt-2 flex items-center gap-2 text-xs">
                    <span className="rounded-full bg-plum/10 px-2 py-0.5 font-semibold text-plum">
                      {it.combo ? "Listing" : "Product"}: {it.linked}
                    </span>
                    <button type="button"
                      onClick={() => patchItem(i, { product: null, combo: null, linked: "" })}
                      className="text-slate-400 hover:text-red-600">
                      unlink
                    </button>
                  </div>
                )}

                {/* Details off the WhatsApp/Messenger chat — any number, any label. */}
                <div className="mt-3 space-y-2">
                  {it.details.map((d, di) => (
                    <div key={di} className="flex gap-2">
                      <div className="w-1/3">
                        <TextInput placeholder="Detail (e.g. বরের নাম)" value={d.label}
                                   onChange={(e) => patchDetail(i, di, { label: e.target.value })} />
                      </div>
                      <div className="flex-1">
                        <TextInput placeholder="What the customer sent" value={d.value}
                                   onChange={(e) => patchDetail(i, di, { value: e.target.value })} />
                      </div>
                      <button type="button" onClick={() => removeDetail(i, di)}
                        className="flex h-10 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600">
                        <Icon name="trash" size={14} />
                      </button>
                    </div>
                  ))}
                  <button type="button" onClick={() => addDetail(i)}
                    className="text-sm font-medium text-plum hover:underline">
                    + Add detail
                  </button>
                </div>

                <div className="mt-3">
                  <TextInput placeholder="Special instruction for this item (optional)"
                             value={it.note}
                             onChange={(e) => patchItem(i, { note: e.target.value })} />
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Charges + status */}
        <Card className="p-5">
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Delivery charge (৳)"><TextInput type="number" step="0.01" value={form.delivery_charge} onChange={(e) => set("delivery_charge", e.target.value)} /></Field>
            <Field label="Advance received (৳)"><TextInput type="number" step="0.01" value={form.advance_received} onChange={(e) => set("advance_received", e.target.value)} /></Field>
            <Field label="Status">
              <Select value={form.status} onChange={(e) => set("status", e.target.value)}>
                {ORDER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </Field>
          </div>
          <div className="mt-4 rounded-lg bg-slate-50 p-4 text-sm">
            <Row label="Subtotal" value={subtotal} />
            <Row label="Delivery" value={delivery} />
            <Row label="Advance received" value={-advance} />
            <div className="my-2 border-t border-slate-200" />
            <Row label="COD to collect" value={cod} bold />
          </div>
        </Card>

        <div className="flex justify-end">
          <AdminButton type="submit" disabled={busy} icon="check">
            {busy ? "Creating…" : "Create order"}
          </AdminButton>
        </div>
      </form>
    </div>
  );
}

/**
 * Everything the shop sells, searchable. Listings first (that IS the catalogue);
 * plain products below, because over WhatsApp the owner does sell them one-off
 * even though the storefront only offers them inside the customizer.
 */
function CataloguePicker({ onPick }: {
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

function Row({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <div className={`flex justify-between py-0.5 ${bold ? "font-bold text-slate-900" : "text-slate-500"}`}>
      <span>{label}</span>
      <span className="tabular-nums">৳ {value.toFixed(2)}</span>
    </div>
  );
}
