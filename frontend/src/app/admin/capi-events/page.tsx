"use client";

import { useEffect, useState } from "react";
import { adminGet } from "@/lib/adminApi";
import { PageHeader, Card, Table, Th, Td, AdminEmpty, Loading } from "@/components/admin/ui";

interface CapiEvent {
  id: number;
  event_name: string;
  event_id: string;
  action_source: string;
  value: string | null;
  currency: string;
  status: "pending" | "sent" | "failed";
  attempts: number;
  last_attempt_at: string | null;
  response: Record<string, unknown>;
  created_at: string;
}

const STATUS: Record<string, string> = {
  sent: "bg-emerald-100 text-emerald-700",
  failed: "bg-red-100 text-red-700",
  pending: "bg-amber-100 text-amber-700",
};

export default function AdminCapiEvents() {
  const [events, setEvents] = useState<CapiEvent[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    adminGet<CapiEvent[]>("capi-events/").then(setEvents).catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="rounded-lg bg-red-50 p-4 text-sm text-red-600">{error}</p>;
  if (!events) return <Loading />;

  return (
    <div>
      <PageHeader title="CAPI events" subtitle="Every Meta Conversions API event sent from this store (website + manual leads)." />

      {events.length === 0 ? (
        <AdminEmpty icon="chat" title="No events yet" hint="Events appear here as orders are placed and leads are qualified/converted." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Event</Th><Th>Source</Th><Th>Value</Th><Th>Status</Th><Th>Attempts</Th><Th>event_id</Th><Th>When</Th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id} className="hover:bg-slate-50">
                <Td className="font-medium text-slate-900">{e.event_name}</Td>
                <Td className="text-slate-500">{e.action_source}</Td>
                <Td className="tabular-nums">{e.value ? `৳${e.value}` : "—"}</Td>
                <Td>
                  <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS[e.status] ?? "bg-slate-100 text-slate-600"}`}>
                    {e.status}
                  </span>
                </Td>
                <Td className="tabular-nums">{e.attempts}</Td>
                <Td className="font-mono text-xs text-slate-500">{e.event_id}</Td>
                <Td className="text-xs text-slate-400">{new Date(e.created_at).toLocaleString()}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
