"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { chatPoll, chatSend, getAlbum, type ChatMsg } from "@/lib/api";
import { Icon } from "@/components/ui/Icon";

const QUICK = [
  "কিভাবে অর্ডার করব?",
  "দাম কত?",
  "ডেলিভারি চার্জ কত?",
  "আমার অর্ডার কই?",
];

export default function ChatWidget() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [text, setText] = useState("");
  const [img, setImg] = useState<File | null>(null);
  const [imgError, setImgError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  // The bot can't see images, so customers may attach only once a human took over.
  const [chatStatus, setChatStatus] = useState("bot");
  const canAttach = chatStatus === "admin" || chatStatus === "waiting_admin";
  // Lightbox gallery: all images for a message + current index.
  const [gallery, setGallery] = useState<{ images: string[]; index: number } | null>(null);
  const busyRef = useRef(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const scroll = () => setTimeout(() => boxRef.current?.scrollTo(0, boxRef.current.scrollHeight), 50);

  // Temp id for the in-flight (optimistic) bubble — huge so it sorts to the bottom.
  const TEMP = Number.MAX_SAFE_INTEGER;

  // Merge by id, keep sorted. Real ids are small; TEMP stays last until reconciled.
  function merge(prev: ChatMsg[], incoming: ChatMsg[]) {
    const map = new Map<number, ChatMsg>();
    for (const m of prev) map.set(m.id, m);
    for (const m of incoming) map.set(m.id, m);
    return [...map.values()].sort((a, b) => a.id - b.id);
  }
  const maxId = (list: ChatMsg[]) =>
    list.reduce((mx, m) => (m.id < TEMP && m.id > mx ? m.id : mx), 0);

  // Keep latest messages in a ref so polling doesn't restart on every change.
  const msgsRef = useRef<ChatMsg[]>([]);
  useEffect(() => { msgsRef.current = msgs; }, [msgs]);

  // Reflect open state onto the body so other UI (e.g. HelpNudge) can detect it.
  useEffect(() => {
    document.body.dataset.chatOpen = open ? "true" : "false";
  }, [open]);

  // On open: load existing chat immediately, then poll for new replies.
  useEffect(() => {
    if (!open) return;
    let active = true;
    const tick = async () => {
      if (busyRef.current) return;
      try {
        const s = await chatPoll(maxId(msgsRef.current));
        if (active) {
          setChatStatus(s.status);
          if (s.messages.length) {
            setMsgs((m) => merge(m, s.messages));
            scroll();
          }
        }
      } catch { /* ignore poll errors */ }
    };
    tick(); // instant load, no 4s wait
    const iv = setInterval(tick, 4000);
    return () => { active = false; clearInterval(iv); };
  }, [open]);

  function pickImage(f: File | null) {
    setImgError("");
    if (!f) { setImg(null); return; }
    if (!f.type.startsWith("image/")) { setImgError("শুধু ছবি পাঠানো যাবে।"); return; }
    if (f.size > 5 * 1024 * 1024) { setImgError("ছবিটি ৫MB এর কম হতে হবে।"); return; }
    setImg(f);
  }

  async function send(message: string, image?: File | null) {
    const t = message.trim();
    if ((!t && !image) || busyRef.current) return;
    setText(""); setImg(null); setImgError(""); setBusy(true); busyRef.current = true;
    const previewUrl = image ? URL.createObjectURL(image) : "";
    // optimistic bubble at the bottom (TEMP id), reconciled on response
    setMsgs((m) => merge(m, [{ id: TEMP, role: "customer", text: t, image: "", images: [], more_count: 0, album_url: "", upload: previewUrl, created_at: "" }]));
    scroll();
    try {
      const s = await chatSend(t, image ?? undefined);
      setChatStatus(s.status);
      setMsgs((m) => merge(m.filter((x) => x.id !== TEMP), s.messages));
      scroll();
    } catch { /* keep optimistic */ }
    finally { setBusy(false); busyRef.current = false; }
  }

  // Open the full-screen gallery. If the message links our own album page, load
  // ALL its images; otherwise just browse the inline previews.
  async function openGallery(m: ChatMsg, start: number) {
    let images = m.images?.length ? m.images : (m.image ? [m.image] : []);
    if (m.album_url && m.album_url.includes("/album/")) {
      try {
        const key = m.album_url.split("/album/")[1].split(/[?#]/)[0];
        const a = await getAlbum(key);
        if (a.images?.length) images = a.images;
      } catch { /* fall back to previews */ }
    }
    if (images.length === 0) return;
    setGallery({ images, index: Math.min(Math.max(start, 0), images.length - 1) });
  }

  // Don't show the customer widget inside the admin panel.
  if (pathname.startsWith("/admin")) return null;

  // On pages with a full-width sticky bottom CTA (configurator/checkout), lift the
  // launcher above it so the bubble never covers the primary action button.
  const onCtaPage =
    pathname.startsWith("/customize") ||
    pathname.startsWith("/product/") ||
    pathname === "/checkout";

  return (
    <>
      {!open && (
        <div className={`fixed right-4 z-30 sm:bottom-6 ${onCtaPage ? "bottom-40" : "bottom-20"}`}>
          <button
            onClick={() => setOpen(true)}
            aria-label="চ্যাট করুন"
            className="group flex items-center gap-2.5 rounded-full bg-plum py-3 pl-3 pr-3 text-white shadow-xl ring-1 ring-plum/20 transition hover:bg-wine active:scale-95 sm:pr-5"
          >
            <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-gold text-wine">
              <Icon name="chat" size={18} />
              {/* subtle 'online' dot — premium, not noisy */}
              <span className="absolute right-0 top-0 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-plum" />
            </span>
            <span className="hidden text-sm font-semibold sm:inline">চ্যাট করুন</span>
          </button>
        </div>
      )}

      {open && (
        <div className="fixed inset-x-0 bottom-0 z-40 mx-auto flex h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl border border-border bg-background shadow-2xl sm:inset-auto sm:bottom-4 sm:right-4 sm:h-[72vh] sm:rounded-3xl">
          <div className="flex items-center gap-3 border-b border-gold/25 bg-plum px-4 py-3 text-white">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white ring-1 ring-gold/40">
              <Image src="/logo.jpg" alt="Zaujain Nikah Point" width={40} height={40} className="h-full w-full object-contain" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-display text-base font-semibold leading-tight">Zaujain Nikah Point</p>
              <p className="flex items-center gap-1.5 text-xs text-white/70">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> সাধারণত দ্রুত উত্তর দেওয়া হয়
              </p>
            </div>
            <button onClick={() => setOpen(false)} aria-label="বন্ধ করুন"
              className="flex h-8 w-8 items-center justify-center rounded-full text-white/80 transition hover:bg-white/10">✕</button>
          </div>

          <div ref={boxRef} className="flex-1 space-y-2.5 overflow-y-auto px-3 py-4">
            {msgs.length === 0 && (
              <div className="mt-6 text-center">
                <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-gold/15 text-gold">
                  <Icon name="chat" size={26} />
                </span>
                <p className="font-display text-lg text-plum">আসসালামু আলাইকুম</p>
                <p className="mt-1 text-sm text-muted">কীভাবে সাহায্য করতে পারি?</p>
              </div>
            )}
            {msgs.map((m) => (
              <div key={m.id} className={`flex ${m.role === "customer" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[82%] px-3.5 py-2.5 text-sm shadow-sm ${m.role === "customer"
                  ? "rounded-2xl rounded-br-md bg-plum text-white"
                  : "rounded-2xl rounded-bl-md border border-border bg-surface text-foreground"}`}>
                  {m.text && <p className="whitespace-pre-wrap">{m.text}</p>}
                  {(() => {
                    const imgs = m.images?.length ? m.images : (m.image ? [m.image] : []);
                    if (imgs.length === 0) return null;
                    if (imgs.length === 1) {
                      return (
                        <button type="button" onClick={() => openGallery(m, 0)}
                          className="relative mt-1 block h-44 w-44 overflow-hidden rounded-lg active:scale-95">
                          <Image src={imgs[0]} alt="" fill sizes="176px" className="object-cover" />
                        </button>
                      );
                    }
                    return (
                      <div className="mt-1 grid w-52 grid-cols-2 gap-1">
                        {imgs.map((src, i) => {
                          const isLast = i === imgs.length - 1;
                          const showMore = isLast && m.more_count > 0;
                          return (
                            <button key={i} type="button" onClick={() => openGallery(m, i)}
                              className="relative block aspect-square overflow-hidden rounded-lg active:scale-95">
                              <Image src={src} alt="" fill sizes="104px" className="object-cover" />
                              {showMore && (
                                <span className="absolute inset-0 flex items-center justify-center bg-black/60 text-lg font-bold text-white">
                                  +{m.more_count}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    );
                  })()}
                  {m.upload && (
                    <button type="button" onClick={() => setGallery({ images: [m.upload], index: 0 })}
                      className="relative mt-1 block h-44 w-44 overflow-hidden rounded-lg active:scale-95">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={m.upload} alt="" className="h-full w-full object-cover" loading="lazy" />
                    </button>
                  )}
                  {m.album_url && (m.album_url.startsWith("/") ? (
                    <Link href={m.album_url} onClick={() => setOpen(false)}
                      className="mt-2 inline-flex items-center justify-center gap-2 rounded-full bg-gold px-4 py-2 text-sm font-semibold text-wine shadow active:scale-95">
                      <Icon name="image" size={16} /> ডিজাইন দেখুন
                    </Link>
                  ) : (
                    <a href={m.album_url} target="_blank" rel="noreferrer"
                      className={`mt-2 inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold active:scale-95 ${
                        m.role === "customer" ? "bg-white text-plum" : "bg-gold text-wine shadow"}`}>
                      <Icon name="image" size={16} /> সব ছবি দেখুন
                    </a>
                  ))}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex justify-start">
                <div className="flex items-center gap-1 rounded-2xl rounded-bl-md border border-border bg-surface px-3.5 py-3 shadow-sm">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted [animation-delay:-0.3s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted [animation-delay:-0.15s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted" />
                </div>
              </div>
            )}
          </div>

          {msgs.length === 0 && (
            <div className="flex flex-wrap gap-2 px-3 pb-2">
              {QUICK.map((q) => (
                <button key={q} onClick={() => send(q)}
                  className="rounded-full border border-gold/40 bg-gold/10 px-3.5 py-1.5 text-xs font-medium text-plum transition hover:bg-gold/20 active:scale-95">
                  {q}
                </button>
              ))}
            </div>
          )}

          <div className="border-t border-border bg-surface/60 p-3">
            {canAttach && img && (
              <div className="mb-2 flex items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={URL.createObjectURL(img)} alt="" className="h-14 w-14 rounded-lg object-cover ring-1 ring-border" />
                <button onClick={() => setImg(null)} className="text-xs text-red-600 underline">
                  সরান
                </button>
              </div>
            )}
            {canAttach && imgError && <p className="mb-2 text-xs text-red-600">{imgError}</p>}
            <form onSubmit={(e) => { e.preventDefault(); send(text, canAttach ? img : null); }}
              className="flex items-center gap-2 rounded-full border border-border bg-background py-1 pl-1 pr-1 focus-within:border-plum/40">
              {canAttach && (
                <>
                  <input ref={fileRef} type="file" accept="image/*" hidden
                    onChange={(e) => { pickImage(e.target.files?.[0] ?? null); e.target.value = ""; }} />
                  <button type="button" onClick={() => fileRef.current?.click()} aria-label="ছবি যুক্ত করুন"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-surface-2 hover:text-plum active:scale-95">
                    <Icon name="image" size={18} />
                  </button>
                </>
              )}
              <input value={text} onChange={(e) => setText(e.target.value)} placeholder="মেসেজ লিখুন..."
                className={`flex-1 bg-transparent text-sm outline-none ${canAttach ? "px-1" : "pl-4"}`} />
              <button disabled={busy || (!text.trim() && !img)} aria-label="পাঠান"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold text-wine transition hover:bg-gold-soft disabled:opacity-40">
                <Icon name="arrowRight" size={18} />
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Fullscreen swipeable gallery (WhatsApp-style) */}
      {gallery && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/90">
          <div className="flex items-center justify-between p-3 text-white">
            <span className="text-sm">{gallery.index + 1} / {gallery.images.length}</span>
            <button onClick={() => setGallery(null)} className="text-3xl leading-none">✕</button>
          </div>

          <div className="relative flex flex-1 items-center justify-center px-2">
            {gallery.index > 0 && (
              <button onClick={() => setGallery((g) => g && { ...g, index: g.index - 1 })}
                className="absolute left-2 flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-2xl text-white">‹</button>
            )}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={gallery.images[gallery.index]} alt=""
              className="max-h-[75vh] max-w-full rounded-lg object-contain" />
            {gallery.index < gallery.images.length - 1 && (
              <button onClick={() => setGallery((g) => g && { ...g, index: g.index + 1 })}
                className="absolute right-2 flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-2xl text-white">›</button>
            )}
          </div>

          <div className="flex gap-2 overflow-x-auto p-3">
            {gallery.images.map((src, i) => (
              <button key={i} onClick={() => setGallery((g) => g && { ...g, index: i })}
                className={`relative h-14 w-14 shrink-0 overflow-hidden rounded border-2 ${i === gallery.index ? "border-rose" : "border-transparent"}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" />
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
