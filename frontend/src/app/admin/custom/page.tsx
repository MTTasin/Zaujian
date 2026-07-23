"use client";

import { useEffect, useState } from "react";
import { adminGet, adminPost, type AdminCustomRequest } from "@/lib/adminApi";
import { PageHeader, Card, AdminButton, TextInput, StatusPill, AdminEmpty } from "@/components/admin/ui";

export default function AdminCustom() {
  const [reqs, setReqs] = useState<AdminCustomRequest[]>([]);
  const [prices, setPrices] = useState<Record<number, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<number | null>(null);

  function load() {
    adminGet<AdminCustomRequest[]>("custom-requests/").then(setReqs).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  async function setPrice(id: number) {
    setBusy(id); setError("");
    try {
      await adminPost(`custom-requests/${id}/set_price/`, { price: prices[id] });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(null); }
  }

  async function reject(id: number) {
    setBusy(id); setError("");
    try {
      await adminPost(`custom-requests/${id}/reject/`);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(null); }
  }

  return (
    <div>
      <PageHeader title="Custom Requests" subtitle="Customer-submitted custom orders awaiting pricing" />
      {error && <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</p>}

      {reqs.length === 0 ? (
        <AdminEmpty icon="edit" title="No custom requests" />
      ) : (
        <div className="space-y-3">
          {reqs.map((r) => (
            <Card key={r.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold text-slate-900">#{r.id} — {r.customer_name} ({r.phone})</div>
                  <div className="mt-1 text-sm text-slate-500">{r.description}</div>
                </div>
                <StatusPill status={r.status} />
              </div>

              {r.reference_images.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {r.reference_images.map((u) => (
                    <a key={u} href={u} target="_blank">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={u} alt="ref" className="h-20 w-20 rounded-lg object-cover" />
                    </a>
                  ))}
                </div>
              )}

              {r.status === "pending" ? (
                <div className="mt-3 flex items-center gap-2">
                  <TextInput placeholder="Final price" value={prices[r.id] ?? ""}
                    onChange={(e) => setPrices({ ...prices, [r.id]: e.target.value })}
                    className="w-32" />
                  <AdminButton disabled={busy === r.id} onClick={() => setPrice(r.id)}>
                    Set price
                  </AdminButton>
                  <AdminButton variant="danger" disabled={busy === r.id} onClick={() => reject(r.id)}>
                    Reject
                  </AdminButton>
                </div>
              ) : (
                <div className="mt-2 text-sm text-slate-500">
                  Final price: {r.admin_final_price ? `৳ ${r.admin_final_price}` : "—"}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
