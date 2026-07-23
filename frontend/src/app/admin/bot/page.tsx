"use client";

import { useEffect, useState } from "react";
import { adminGet, adminPut } from "@/lib/adminApi";
import { PageHeader, Card, AdminButton, TextArea, Loading } from "@/components/admin/ui";

// Live-edit the chatbot persona/instructions. Saved to DB, applied immediately
// (no server restart). Seeded from bot_instructions.md on first load.
export default function AdminBot() {
  const [text, setText] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    adminGet<{ instructions: string }>("bot-config/")
      .then((d) => { setText(d.instructions); setLoaded(true); })
      .catch((e) => setError(e.message));
  }, []);

  async function save() {
    setBusy(true); setMsg(""); setError("");
    try {
      await adminPut("bot-config/", { instructions: text });
      setMsg("Saved — the bot uses this immediately.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(false); }
  }

  if (!loaded && !error) return <Loading />;

  return (
    <div>
      <PageHeader title="Bot Instructions" subtitle="Persona, pricing, delivery rules & media tags" />
      <p className="mb-4 text-sm text-slate-500">
        Edit the chatbot&apos;s persona, pricing, delivery rules, and media tags. Changes apply to new
        replies instantly. Use <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">[IMAGE: key]</code> /{" "}
        <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">[ALBUM: key]</code> (keys from Chat Media)
        and <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">[HANDOFF]</code> to pass a chat to a human.
      </p>
      {msg && <p className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{msg}</p>}
      {error && <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</p>}

      <Card className="p-4">
        <TextArea value={text} onChange={(e) => setText(e.target.value)} rows={26}
          className="font-mono" />
      </Card>

      <div className="mt-4">
        <AdminButton onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </AdminButton>
      </div>
    </div>
  );
}
