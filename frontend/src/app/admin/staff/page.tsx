"use client";

import { useCallback, useEffect, useState } from "react";
import { adminDelete, adminGet, adminPatch, adminPost } from "@/lib/adminApi";
import type { Level } from "@/lib/adminAuth";
import {
  PageHeader, Card, AdminButton, Field, TextInput, Select, Table, Th, Td,
  AdminEmpty, Loading,
} from "@/components/admin/ui";
import { Icon } from "@/components/ui/Icon";
import { describePresence, type PresenceState } from "@/lib/presence";

interface StaffRow {
  id: number;
  username: string;
  first_name: string;
  email: string;
  is_active: boolean;
  is_owner: boolean;
  last_login: string | null;
  last_seen: string | null;
  access: Record<string, Level>;
  note: string;
}

interface SectionMeta { key: string; label: string }

const LEVELS: { value: Level; label: string }[] = [
  { value: "none", label: "No access" },
  { value: "view", label: "View only" },
  { value: "full", label: "Full" },
];

function fmtDate(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "never" : d.toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dhaka",
  });
}

export default function AdminStaff() {
  const [rows, setRows] = useState<StaffRow[] | null>(null);
  const [sections, setSections] = useState<SectionMeta[]>([]);
  const [editing, setEditing] = useState<StaffRow | "new" | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await adminGet<StaffRow[] | { results: StaffRow[] }>("staff/");
      setRows(Array.isArray(data) ? data : data.results);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load staff");
    }
  }, []);

  useEffect(() => {
    load();
    adminGet<{ sections: SectionMeta[] }>("staff/sections/")
      .then((d) => setSections(d.sections))
      .catch(() => setSections([]));
  }, [load]);

  // "Active now" is only true if it keeps being checked — a stale table would
  // claim someone is online an hour after they left.
  useEffect(() => {
    const iv = setInterval(load, 30_000);
    return () => clearInterval(iv);
  }, [load]);

  async function toggleActive(row: StaffRow) {
    setError("");
    try {
      await adminPatch(`staff/${row.id}/`, { is_active: !row.is_active });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update");
    }
  }

  async function remove(row: StaffRow) {
    if (!confirm(`Delete ${row.username}? They lose access immediately.`)) return;
    setError("");
    try {
      await adminDelete(`staff/${row.id}/`);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete");
    }
  }

  if (!rows) return <Loading />;

  return (
    <div>
      <PageHeader
        title="Staff"
        subtitle="Moderator accounts and what each of them can reach."
        action={<AdminButton icon="plus" onClick={() => setEditing("new")}>Add moderator</AdminButton>}
      />

      {error && <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</p>}

      {editing && (
        <StaffForm
          row={editing === "new" ? null : editing}
          sections={sections}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}

      {rows.length === 0 ? (
        <AdminEmpty icon="user" title="No staff yet" hint="Add a moderator to share the workload." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>User</Th><Th>Role</Th><Th>Sections</Th><Th>Activity</Th><Th>Last login</Th><Th>Status</Th><Th></Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-slate-50">
                <Td>
                  <div className="font-medium text-slate-900">{row.username}</div>
                  {row.note && <div className="text-xs text-slate-400">{row.note}</div>}
                </Td>
                <Td>
                  {row.is_owner ? (
                    <span className="rounded-full bg-plum/10 px-2 py-0.5 text-xs font-semibold text-plum">
                      Owner
                    </span>
                  ) : (
                    <span className="text-xs text-slate-500">Moderator</span>
                  )}
                </Td>
                <Td>
                  {row.is_owner ? (
                    <span className="text-xs text-slate-400">Everything</span>
                  ) : (
                    <AccessSummary access={row.access} sections={sections} />
                  )}
                </Td>
                <Td className="whitespace-nowrap"><PresenceDot lastSeen={row.last_seen} /></Td>
                <Td className="whitespace-nowrap text-xs text-slate-500">{fmtDate(row.last_login)}</Td>
                <Td>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                    row.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
                  }`}>
                    {row.is_active ? "Active" : "Disabled"}
                  </span>
                </Td>
                <Td>
                  {/* The owner row is deliberately untouchable from the panel —
                      the backend refuses it too, this just doesn't offer it. */}
                  {!row.is_owner && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setEditing(row)}
                        className="text-slate-400 transition hover:text-plum"
                        aria-label={`Edit ${row.username}`}
                      >
                        <Icon name="edit" size={16} />
                      </button>
                      <button
                        onClick={() => toggleActive(row)}
                        className="text-xs font-medium text-slate-500 hover:text-slate-900"
                      >
                        {row.is_active ? "Disable" : "Enable"}
                      </button>
                      <button
                        onClick={() => remove(row)}
                        className="text-slate-400 transition hover:text-red-600"
                        aria-label={`Delete ${row.username}`}
                      >
                        <Icon name="trash" size={16} />
                      </button>
                    </div>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}

const DOT: Record<PresenceState, string> = {
  online: "bg-emerald-500",
  idle: "bg-amber-400",
  away: "bg-slate-300",
  never: "bg-slate-200",
};

/** Messenger-style presence: a coloured dot plus how long ago, live-refreshed. */
function PresenceDot({ lastSeen }: { lastSeen: string | null }) {
  const { state, label } = describePresence(lastSeen);
  return (
    <span className="flex items-center gap-2 text-xs text-slate-500">
      <span className="relative flex h-2.5 w-2.5">
        {state === "online" && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
        )}
        <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${DOT[state]}`} />
      </span>
      <span className={state === "online" ? "font-semibold text-emerald-600" : ""}>{label}</span>
    </span>
  );
}

function AccessSummary({
  access, sections,
}: { access: Record<string, Level>; sections: SectionMeta[] }) {
  const granted = sections.filter((s) => access?.[s.key] && access[s.key] !== "none");
  if (granted.length === 0) return <span className="text-xs text-slate-400">Nothing yet</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {granted.map((s) => (
        <span
          key={s.key}
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            access[s.key] === "full"
              ? "bg-emerald-100 text-emerald-700"
              : "bg-slate-100 text-slate-600"
          }`}
        >
          {s.label}{access[s.key] === "view" ? " · view" : ""}
        </span>
      ))}
    </div>
  );
}

function StaffForm({
  row, sections, onClose, onSaved,
}: {
  row: StaffRow | null;
  sections: SectionMeta[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [username, setUsername] = useState(row?.username ?? "");
  const [note, setNote] = useState(row?.note ?? "");
  const [password, setPassword] = useState("");
  const [access, setAccess] = useState<Record<string, Level>>(row?.access ?? {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setBusy(true);
    setError("");
    try {
      if (row) {
        await adminPatch(`staff/${row.id}/`, { username, note, access });
        if (password) await adminPost(`staff/${row.id}/set_password/`, { password });
      } else {
        await adminPost("staff/", { username, note, access, password });
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-5 p-5">
      <h2 className="mb-4 text-lg font-semibold text-slate-900">
        {row ? `Edit ${row.username}` : "New moderator"}
      </h2>

      {error && <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</p>}

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Username">
          <TextInput value={username} onChange={(e) => setUsername(e.target.value)} />
        </Field>
        <Field label="Note" hint="What they do — packing desk, accounts…">
          <TextInput value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Field label={row ? "New password" : "Password"} hint={row ? "Leave blank to keep it. Changing it signs them out." : undefined}>
          <TextInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
      </div>

      <div className="mt-5">
        <div className="mb-2 text-sm font-semibold text-slate-700">Sections</div>
        <div className="grid gap-2 sm:grid-cols-2">
          {sections.map((s) => (
            <div
              key={s.key}
              className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2"
            >
              <span className="text-sm text-slate-700">{s.label}</span>
              <Select
                className="w-36"
                value={access[s.key] ?? "none"}
                onChange={(e) =>
                  setAccess({ ...access, [s.key]: e.target.value as Level })
                }
              >
                {LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
              </Select>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Bot Instructions, Site Settings, Staff, the audit log and deleting an order
          stay with the owner and cannot be granted.
        </p>
      </div>

      <div className="mt-5 flex gap-2">
        <AdminButton onClick={save} disabled={busy || !username}>
          {busy ? "Saving…" : "Save"}
        </AdminButton>
        <AdminButton variant="ghost" onClick={onClose}>Cancel</AdminButton>
      </div>
    </Card>
  );
}
