"use client";

import { useState } from "react";
import { adminPost } from "@/lib/adminApi";
import { PageHeader, Card, AdminButton, Field, TextInput, Table, Th, Td } from "@/components/admin/ui";
import { Icon } from "@/components/ui/Icon";

interface Stat { success?: number; cancel?: number; total?: number; success_ratio?: number; error?: string }
interface FraudResult {
  phone?: string;
  error?: string;
  steadfast?: Stat;
  pathao?: Stat;
  aggregate?: { total_success?: number; total_cancel?: number; total?: number; success_ratio?: number };
  advance_required?: boolean;
}

export default function AdminFraudCheck() {
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<FraudResult | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (!phone.trim()) return;
    setBusy(true); setError(""); setResult(null);
    try {
      setResult(await adminPost<FraudResult>("fraud-check/", { phone }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const couriers: [string, Stat][] = result
    ? [["Steadfast", result.steadfast ?? {}], ["Pathao", result.pathao ?? {}]]
    : [];
  const agg = result?.aggregate ?? {};

  return (
    <div>
      <PageHeader
        title="Fraud Check"
        subtitle="Check any customer's courier delivery history (Steadfast + Pathao)."
      />

      <Card className="mb-6 max-w-lg p-5">
        <form onSubmit={run} className="flex items-end gap-3">
          <div className="flex-1">
            <Field label="Phone number">
              <TextInput value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01XXXXXXXXX" />
            </Field>
          </div>
          <AdminButton type="submit" disabled={busy} icon="search">
            {busy ? "Checking…" : "Check"}
          </AdminButton>
        </form>
        {error && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</p>}
        {busy && <p className="mt-3 text-sm text-slate-400">Contacting couriers… this can take a few seconds.</p>}
      </Card>

      {result && !busy && (
        result.error ? (
          <div className="max-w-lg rounded-lg bg-amber-50 p-4 text-sm text-amber-700">{result.error}</div>
        ) : (
          <div className="space-y-4">
            <div
              className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold ${
                result.advance_required ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"
              }`}
            >
              <Icon name={result.advance_required ? "phone" : "check"} size={16} />
              {result.advance_required
                ? "Risky / little history — advance recommended"
                : "Safe — good delivery record"}
            </div>

            <Table>
              <thead>
                <tr><Th>Courier</Th><Th>Delivered</Th><Th>Cancelled</Th><Th>Success</Th></tr>
              </thead>
              <tbody>
                {couriers.map(([name, s]) => (
                  <tr key={name} className="hover:bg-slate-50">
                    <Td className="font-medium text-slate-900">{name}</Td>
                    {s.error ? (
                      <td colSpan={3} className="border-t border-slate-100 px-4 py-3 text-slate-400">{s.error}</td>
                    ) : (
                      <>
                        <Td className="tabular-nums">{s.success ?? 0}</Td>
                        <Td className="tabular-nums">{s.cancel ?? 0}</Td>
                        <Td className="tabular-nums">{s.success_ratio ?? 0}%</Td>
                      </>
                    )}
                  </tr>
                ))}
                <tr className="bg-slate-50 font-semibold text-slate-900">
                  <Td>Total</Td>
                  <Td className="tabular-nums">{agg.total_success ?? 0}</Td>
                  <Td className="tabular-nums">{agg.total_cancel ?? 0}</Td>
                  <Td className="tabular-nums">{agg.success_ratio ?? 0}%</Td>
                </tr>
              </tbody>
            </Table>

            <p className="text-sm text-slate-500">Checked: <b className="text-slate-800">{result.phone}</b></p>
          </div>
        )
      )}
    </div>
  );
}
