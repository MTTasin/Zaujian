"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { adminPost, ORDER_STATUSES } from "@/lib/adminApi";
import { getShopInfo } from "@/lib/api";
import { BD_LOCATIONS } from "@/lib/bdLocations";
import { PageHeader, Card, Field, TextInput, TextArea, Select, AdminButton } from "@/components/admin/ui";
import { Icon } from "@/components/ui/Icon";

type Line = { title: string; price: string };

export default function NewManualOrder() {
  const router = useRouter();
  const [form, setForm] = useState({
    customer_name: "", phone: "", whatsapp: "", email: "",
    division: "", district: "", thana: "", address: "",
    delivery_charge: "", advance_received: "", status: "confirmed",
  });
  const [thanaOther, setThanaOther] = useState("");
  const [items, setItems] = useState<Line[]>([{ title: "", price: "" }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getShopInfo()
      .then((s) => setForm((f) => ({ ...f, delivery_charge: s.delivery_charge })))
      .catch(() => {});
  }, []);

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const setItem = (i: number, k: keyof Line, v: string) =>
    setItems((arr) => arr.map((it, idx) => (idx === i ? { ...it, [k]: v } : it)));
  const addItem = () => setItems((arr) => [...arr, { title: "", price: "" }]);
  const removeItem = (i: number) => setItems((arr) => arr.filter((_, idx) => idx !== i));

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
    const clean = items.filter((it) => it.title.trim());
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
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Items</h2>
            <AdminButton type="button" variant="secondary" icon="plus" onClick={addItem}>Add item</AdminButton>
          </div>
          <div className="space-y-3">
            {items.map((it, i) => (
              <div key={i} className="flex gap-3">
                <div className="flex-1">
                  <TextInput placeholder="Item name / description" value={it.title} onChange={(e) => setItem(i, "title", e.target.value)} />
                </div>
                <div className="w-32">
                  <TextInput placeholder="Price ৳" type="number" step="0.01" value={it.price} onChange={(e) => setItem(i, "price", e.target.value)} />
                </div>
                <button type="button" onClick={() => removeItem(i)} disabled={items.length === 1}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30">
                  <Icon name="trash" size={16} />
                </button>
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

function Row({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <div className={`flex justify-between py-0.5 ${bold ? "font-bold text-slate-900" : "text-slate-500"}`}>
      <span>{label}</span>
      <span className="tabular-nums">৳ {value.toFixed(2)}</span>
    </div>
  );
}
