"use client";

import { useEffect, useState } from "react";
import { adminGet, adminPost, adminPatch, adminDelete } from "@/lib/adminApi";
import { PageHeader, Card, AdminButton, Field, TextInput, TextArea, Select, Table, Th, Td, AdminEmpty } from "@/components/admin/ui";
import { Icon } from "@/components/ui/Icon";

interface Lead {
  id: number;
  email: string;
  phone: string;
  first_name: string;
  last_name: string;
  city: string;
  state: string;
  zip_code: string;
  gender: string;
  date_of_birth: string | null;
  country: string;
  external_id: string;
  source: string;
  note: string;
  is_qualified: boolean;
  is_converted: boolean;
  conversion_value: string | null;
  created_at: string;
}

const EMPTY = {
  phone: "", email: "", first_name: "", last_name: "", city: "", state: "",
  zip_code: "", gender: "", date_of_birth: "", country: "", external_id: "",
  source: "", note: "",
};

export default function AdminLeads() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [form, setForm] = useState({ ...EMPTY });
  const [values, setValues] = useState<Record<number, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function load() {
    adminGet<Lead[]>("leads/").then(setLeads).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!form.phone.trim() && !form.email.trim()) {
      setError("Phone or email is required for matching.");
      return;
    }
    setBusy(true); setError("");
    try {
      // Empty date breaks a DRF DateField — send null instead.
      await adminPost("leads/", { ...form, date_of_birth: form.date_of_birth || null });
      setForm({ ...EMPTY });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally { setBusy(false); }
  }

  async function patch(id: number, body: Record<string, unknown>) {
    try {
      const updated = await adminPatch<Lead>(`leads/${id}/`, body);
      setLeads((list) => list.map((l) => (l.id === id ? updated : l)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    }
  }

  async function del(id: number) {
    if (!confirm("Delete this lead? (Events already sent to Meta stay.)")) return;
    await adminDelete(`leads/${id}/`);
    load();
  }

  return (
    <div>
      <PageHeader
        title="Leads"
        subtitle="Manually-entered ad leads (messaging / walk-in) → PII-matched Meta CAPI. Tick Qualified to fire a Lead; Convert (with value) to fire a Purchase."
      />

      {error && <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</p>}

      <Card className="mb-6 p-5">
        <form onSubmit={create} className="grid gap-3 md:grid-cols-3">
          <Field label="Phone" hint="Highest-value match — e.g. 01712345678"><TextInput value={form.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
          <Field label="Email"><TextInput type="email" value={form.email} onChange={(e) => set("email", e.target.value)} /></Field>
          <Field label="Source"><TextInput value={form.source} onChange={(e) => set("source", e.target.value)} placeholder="Messenger / WhatsApp / walk-in" /></Field>
          <Field label="First name"><TextInput value={form.first_name} onChange={(e) => set("first_name", e.target.value)} /></Field>
          <Field label="Last name"><TextInput value={form.last_name} onChange={(e) => set("last_name", e.target.value)} /></Field>
          <Field label="City"><TextInput value={form.city} onChange={(e) => set("city", e.target.value)} /></Field>
          <Field label="State / division"><TextInput value={form.state} onChange={(e) => set("state", e.target.value)} /></Field>
          <Field label="Zip"><TextInput value={form.zip_code} onChange={(e) => set("zip_code", e.target.value)} /></Field>
          <Field label="Gender">
            <Select value={form.gender} onChange={(e) => set("gender", e.target.value)}>
              <option value="">—</option>
              <option value="m">Male</option>
              <option value="f">Female</option>
            </Select>
          </Field>
          <Field label="Date of birth" hint="Meta 'db' match key"><TextInput type="date" value={form.date_of_birth} onChange={(e) => set("date_of_birth", e.target.value)} /></Field>
          <Field label="Country" hint="2-letter ISO, e.g. bd. Blank = default."><TextInput value={form.country} onChange={(e) => set("country", e.target.value)} placeholder="bd" maxLength={2} /></Field>
          <Field label="External ID" hint="Your own customer/lead ID. Blank = phone/email."><TextInput value={form.external_id} onChange={(e) => set("external_id", e.target.value)} /></Field>
          <div className="md:col-span-3">
            <Field label="Note"><TextArea rows={2} value={form.note} onChange={(e) => set("note", e.target.value)} /></Field>
          </div>
          <div className="md:col-span-3">
            <AdminButton type="submit" disabled={busy} icon="plus">Add lead</AdminButton>
          </div>
        </form>
      </Card>

      {leads.length === 0 ? (
        <AdminEmpty icon="user" title="No leads yet" hint="Add a lead above, then tick Qualified / Converted to fire CAPI." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Lead</Th><Th>Source</Th><Th>Qualified</Th><Th>Converted</Th><Th></Th>
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => (
              <tr key={l.id} className="hover:bg-slate-50">
                <Td>
                  <div className="font-medium text-slate-900">
                    {l.phone || l.email || `${l.first_name} ${l.last_name}`.trim() || "—"}
                  </div>
                  <div className="text-xs text-slate-400">
                    {[`${l.first_name} ${l.last_name}`.trim(), l.city].filter(Boolean).join(" · ")}
                  </div>
                </Td>
                <Td className="text-slate-500">{l.source || "—"}</Td>
                <Td>
                  {l.is_qualified ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                      <Icon name="check" size={12} /> Qualified
                    </span>
                  ) : (
                    <AdminButton variant="secondary" className="min-h-8 px-3 text-xs" onClick={() => patch(l.id, { is_qualified: true })}>
                      Mark qualified
                    </AdminButton>
                  )}
                </Td>
                <Td>
                  {l.is_converted ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-plum/10 px-2.5 py-1 text-xs font-semibold text-plum">
                      <Icon name="check" size={12} /> ৳{l.conversion_value}
                    </span>
                  ) : (
                    <div className="flex items-center gap-2">
                      <input
                        type="number" step="0.01" placeholder="৳ value"
                        value={values[l.id] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [l.id]: e.target.value }))}
                        className="w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-plum"
                      />
                      <AdminButton
                        variant="secondary" className="min-h-8 px-3 text-xs"
                        disabled={!values[l.id]}
                        onClick={() => patch(l.id, { conversion_value: values[l.id], is_converted: true, is_qualified: true })}
                      >
                        Convert
                      </AdminButton>
                    </div>
                  )}
                </Td>
                <Td>
                  <button onClick={() => del(l.id)} className="text-red-600 hover:underline" aria-label="Delete">
                    <Icon name="trash" size={16} />
                  </button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
