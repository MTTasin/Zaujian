"use client";

import { useCallback, useEffect, useState } from "react";
import { adminGet } from "@/lib/adminApi";
import { SECTION_LABELS } from "@/lib/adminAuth";
import {
  PageHeader, Card, Field, TextInput, Select, Table, Th, Td, AdminEmpty, Loading,
} from "@/components/admin/ui";

interface AuditRow {
  id: number;
  username: string;
  method: string;
  path: string;
  section: string;
  status_code: number;
  payload: Record<string, unknown>;
  ip: string | null;
  created_at: string;
}

const METHOD_TONES: Record<string, string> = {
  POST: "bg-emerald-100 text-emerald-700",
  PATCH: "bg-blue-100 text-blue-700",
  PUT: "bg-blue-100 text-blue-700",
  DELETE: "bg-red-100 text-red-700",
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString("en-GB", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
    second: "2-digit", timeZone: "Asia/Dhaka",
  });
}

export default function AdminAudit() {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [user, setUser] = useState("");
  const [section, setSection] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (user) params.set("user", user);
    if (section) params.set("section", section);
    if (start) params.set("start", start);
    if (end) params.set("end", end);
    try {
      const data = await adminGet<AuditRow[] | { results: AuditRow[] }>(
        `audit-log/?${params.toString()}`,
      );
      setRows(Array.isArray(data) ? data : data.results);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the audit log");
    }
  }, [user, section, start, end]);

  useEffect(() => {
    const t = setTimeout(load, 300);   // debounce the text filter
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div>
      <PageHeader
        title="Audit Log"
        subtitle="Every change made through the admin panel. Read-only, even for you."
      />

      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="User">
            <TextInput
              value={user}
              onChange={(e) => setUser(e.target.value)}
              placeholder="username"
            />
          </Field>
          <Field label="Section">
            <Select value={section} onChange={(e) => setSection(e.target.value)}>
              <option value="">All sections</option>
              {Object.entries(SECTION_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </Select>
          </Field>
          <Field label="From">
            <TextInput type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="To">
            <TextInput type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>
      </Card>

      {error && <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</p>}

      {!rows ? (
        <Loading />
      ) : rows.length === 0 ? (
        <AdminEmpty icon="clock" title="Nothing logged" hint="Changes made through the panel will appear here." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>When</Th><Th>Who</Th><Th>Action</Th><Th>Section</Th><Th>Result</Th><Th></Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-slate-50">
                <Td className="whitespace-nowrap text-xs text-slate-500">{fmtDate(row.created_at)}</Td>
                <Td className="font-medium text-slate-900">{row.username}</Td>
                <Td>
                  <span className={`mr-2 rounded px-1.5 py-0.5 text-xs font-bold ${
                    METHOD_TONES[row.method] ?? "bg-slate-100 text-slate-600"
                  }`}>
                    {row.method}
                  </span>
                  <span className="font-mono text-xs text-slate-500">{row.path}</span>
                </Td>
                <Td className="text-xs text-slate-500">
                  {SECTION_LABELS[row.section] ?? row.section ?? "—"}
                </Td>
                <Td>
                  {/* A refused attempt is worth as much as a successful one. */}
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                    row.status_code >= 400
                      ? "bg-red-100 text-red-700"
                      : "bg-emerald-100 text-emerald-700"
                  }`}>
                    {row.status_code}
                  </span>
                </Td>
                <Td>
                  {Object.keys(row.payload || {}).length > 0 && (
                    <button
                      onClick={() => setOpen(open === row.id ? null : row.id)}
                      className="text-xs font-medium text-plum hover:underline"
                    >
                      {open === row.id ? "Hide" : "Details"}
                    </button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {open !== null && rows && (
        <Card className="mt-4 p-4">
          <div className="mb-2 text-sm font-semibold text-slate-700">Request body (secrets redacted)</div>
          <pre className="overflow-x-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
            {JSON.stringify(rows.find((r) => r.id === open)?.payload, null, 2)}
          </pre>
        </Card>
      )}
    </div>
  );
}
