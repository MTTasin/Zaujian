"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  adminGet, adminPost, adminForm,
  type AdminChatMessage, type AdminChatSession,
} from "@/lib/adminApi";
import { Card, AdminButton, AdminEmpty } from "@/components/admin/ui";
import { Icon } from "@/components/ui/Icon";
import { Lightbox } from "@/components/Lightbox";
import { cn } from "@/lib/cn";

export default function AdminChats() {
  const [sessions, setSessions] = useState<AdminChatSession[]>([]);
  const [active, setActive] = useState<number | null>(null);
  const [msgs, setMsgs] = useState<AdminChatMessage[]>([]);
  const [text, setText] = useState("");
  const [img, setImg] = useState<File | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const lastId = useRef(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const loadSessions = useCallback(() => {
    adminGet<AdminChatSession[]>("chats/").then(setSessions).catch(() => {});
  }, []);
  useEffect(() => {
    loadSessions();
    const iv = setInterval(loadSessions, 6000);
    return () => clearInterval(iv);
  }, [loadSessions]);

  // Poll messages of the open conversation.
  useEffect(() => {
    if (active == null) return;
    lastId.current = 0; setMsgs([]);
    const tick = async () => {
      const d = await adminGet<{ status: string; messages: AdminChatMessage[] }>(
        `chats/${active}/messages/?after=${lastId.current}`);
      setStatus(d.status);
      if (d.messages.length) {
        setMsgs((m) => [...m, ...d.messages]);
        lastId.current = d.messages[d.messages.length - 1].id;
        setTimeout(() => boxRef.current?.scrollTo(0, boxRef.current.scrollHeight), 50);
      }
    };
    tick().catch(() => {});
    const iv = setInterval(() => tick().catch(() => {}), 4000);
    return () => clearInterval(iv);
  }, [active]);

  async function reply(e: React.FormEvent) {
    e.preventDefault();
    if ((!text.trim() && !img) || active == null) return;
    const fd = new FormData();
    if (text.trim()) fd.append("text", text.trim());
    if (img) fd.append("image", img);
    setText(""); setImg(null);
    await adminForm<AdminChatMessage>(`chats/${active}/reply/`, fd);
  }

  function pickImage(f: File | null) {
    if (!f) { setImg(null); return; }
    if (!f.type.startsWith("image/") || f.size > 5 * 1024 * 1024) {
      alert("Images only, max 5MB.");
      return;
    }
    setImg(f);
  }

  async function setSessionStatus(s: string) {
    if (active == null) return;
    await adminPost(`chats/${active}/set_status/`, { status: s });
    setStatus(s); loadSessions();
  }

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold tracking-tight text-slate-900">Live Chats</h1>
      <div className="flex h-[calc(100vh-9rem)] flex-col gap-4 md:flex-row">
        {/* Session list — full width on mobile; hidden once a chat is open (conversation takes over) */}
        <Card className={cn(
          "shrink-0 overflow-y-auto md:w-64",
          active != null ? "hidden md:block" : "block",
        )}>
          {sessions.length === 0 ? (
            <p className="p-4 text-sm text-slate-400">No chats yet</p>
          ) : (
            sessions.map((s) => (
              <button key={s.id} onClick={() => setActive(s.id)}
                className={cn(
                  "block w-full border-b border-slate-100 p-3 text-left text-sm transition last:border-0",
                  active === s.id ? "bg-plum/10" : "hover:bg-slate-50",
                )}>
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-900">{s.customer_name || `#${s.id}`}</span>
                  {s.status === "waiting_admin" && (
                    <span className="rounded-full bg-red-500 px-2 text-xs font-bold text-white">!</span>
                  )}
                </div>
                <div className="truncate text-xs text-slate-500">{s.last_message}</div>
                <div className="text-[10px] text-slate-400">{s.status}</div>
              </button>
            ))
          )}
        </Card>

        {/* Conversation — hidden on mobile until a chat is picked */}
        <Card className={cn(
          "flex-1 flex-col overflow-hidden",
          active == null ? "hidden md:flex" : "flex",
        )}>
          {active == null ? (
            <AdminEmpty icon="chat" title="Select a chat" hint="Choose a conversation from the list to view messages." />
          ) : (
            <>
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 p-3">
                <div className="flex min-w-0 items-center gap-2">
                  <button
                    onClick={() => setActive(null)}
                    className="shrink-0 rounded-lg px-2 py-1 text-sm font-semibold text-plum hover:bg-plum/10 md:hidden"
                    aria-label="Back to chat list"
                  >
                    ←
                  </button>
                  <span className="truncate text-sm text-slate-600">Status: <b className="text-slate-900">{status}</b></span>
                </div>
                <div className="flex shrink-0 gap-2">
                  <AdminButton variant="secondary" className="min-h-8 px-3 text-xs" onClick={() => setSessionStatus("bot")}>Back to bot</AdminButton>
                  <AdminButton variant="secondary" className="min-h-8 px-3 text-xs" onClick={() => setSessionStatus("closed")}>Close</AdminButton>
                </div>
              </div>

              <div ref={boxRef} className="flex-1 space-y-2 overflow-y-auto p-3">
                {msgs.map((m) => (
                  <div key={m.id} className={`flex ${m.role === "customer" ? "justify-start" : "justify-end"}`}>
                    <div className={cn(
                      "max-w-[75%] rounded-2xl px-3 py-2 text-sm",
                      m.role === "customer" ? "bg-slate-100 text-slate-800"
                      : m.role === "bot" ? "bg-gold/15 text-slate-800" : "bg-plum text-white",
                    )}>
                      <div className="mb-0.5 text-[10px] opacity-70">{m.role}</div>
                      {m.text && <p className="whitespace-pre-wrap">{m.text}</p>}
                      {m.upload && (
                        <button type="button" onClick={() => setLightbox(m.upload)}
                          className="mt-1 block h-40 w-40 overflow-hidden rounded-lg">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={m.upload} alt="" className="h-full w-full object-cover" loading="lazy" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="border-t border-slate-100 p-3">
                {img && (
                  <div className="mb-2 flex items-center gap-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={URL.createObjectURL(img)} alt="" className="h-12 w-12 rounded object-cover" />
                    <button onClick={() => setImg(null)} className="text-xs text-red-600 underline">Remove</button>
                  </div>
                )}
                <form onSubmit={reply} className="flex gap-2">
                  <input ref={fileRef} type="file" accept="image/*" hidden
                    onChange={(e) => { pickImage(e.target.files?.[0] ?? null); e.target.value = ""; }} />
                  <button type="button" onClick={() => fileRef.current?.click()} aria-label="Attach image"
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-300 bg-white text-plum">
                    <Icon name="image" size={18} />
                  </button>
                  <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a reply…"
                    className="flex-1 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm text-slate-900 outline-none transition focus:border-plum focus:ring-2 focus:ring-plum/20" />
                  <button className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full bg-plum px-5 text-sm font-semibold text-white transition hover:bg-wine">
                    <Icon name="chat" size={16} /> Send
                  </button>
                </form>
              </div>
            </>
          )}
        </Card>
      </div>
      {lightbox && (
        <Lightbox images={[{ full: lightbox }]} startIndex={0} onClose={() => setLightbox(null)} />
      )}
    </div>
  );
}
