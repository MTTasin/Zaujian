"use client";

// Detects a stuck/confused storefront visitor (idle, long dwell with no progress,
// route looping, or a repeat visit with an empty cart) and offers a one-tap
// WhatsApp contact. Fires at most once per browser session, and never while the
// chat widget is open. All storage/network access is best-effort — a failure here
// must never break the page.

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { getShopInfo, getCart, postNudgeEvent } from "@/lib/api";
import { hasProgress } from "@/lib/progress";

export const IDLE_MS = 30000;
export const DWELL_MS = 60000;
export const LOOP_LIMIT = 5;

const SHOWN_KEY = "hn_shown";
const LOOP_KEY = "hn_loop_paths";
const VISITED_KEY = "hn_visited";
const COUNTED_PREFIX = "hn_counted_";

function todayKey(): string {
  return `${COUNTED_PREFIX}${new Date().toISOString().slice(0, 10)}`;
}

export default function HelpNudge() {
  const pathname = usePathname();
  const isAdmin = pathname.startsWith("/admin");
  const [visible, setVisible] = useState(false);
  const [whatsapp, setWhatsapp] = useState("");
  const shownRef = useRef(false);

  // Fetch shop info once, for the WhatsApp number.
  useEffect(() => {
    if (isAdmin) return;
    let active = true;
    getShopInfo()
      .then((info) => { if (active) setWhatsapp(info.whatsapp_number || ""); })
      .catch(() => {});
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Count a visit once per calendar day.
  useEffect(() => {
    if (isAdmin) return;
    try {
      const key = todayKey();
      if (!localStorage.getItem(key)) {
        localStorage.setItem(key, "1");
        postNudgeEvent("visit");
      }
    } catch {
      // storage unavailable — skip the counter, never block the page.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const trigger = useCallback(() => {
    try {
      if (document.body.dataset.chatOpen === "true") return;
      if (shownRef.current || sessionStorage.getItem(SHOWN_KEY) === "1") return;
      shownRef.current = true;
      sessionStorage.setItem(SHOWN_KEY, "1");
    } catch {
      return;
    }
    postNudgeEvent("shown");
    setVisible(true);
  }, []);

  // Idle timer: reset on any real interaction.
  useEffect(() => {
    if (isAdmin) return;
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(trigger, IDLE_MS);
    };
    reset();
    const events: (keyof WindowEventMap)[] = ["pointerdown", "keydown", "scroll", "touchstart"];
    events.forEach((e) => window.addEventListener(e, reset));
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);

  // Dwell timer: stuck on the same visit for a long time with no real progress.
  useEffect(() => {
    if (isAdmin) return;
    const timer = setTimeout(() => {
      if (!hasProgress()) trigger();
    }, DWELL_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);

  // Loop detection: bouncing between a couple of pages without progressing.
  useEffect(() => {
    if (isAdmin) return;
    try {
      const raw = sessionStorage.getItem(LOOP_KEY);
      const paths: string[] = raw ? JSON.parse(raw) : [];
      paths.push(pathname);
      const trimmed = paths.slice(-20);
      sessionStorage.setItem(LOOP_KEY, JSON.stringify(trimmed));
      const distinct = new Set(trimmed);
      if (trimmed.length >= LOOP_LIMIT && distinct.size <= 2 && !hasProgress()) {
        trigger();
      }
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, trigger]);

  // Repeat visit with an empty cart.
  useEffect(() => {
    if (isAdmin) return;
    let visitedBefore = false;
    try {
      visitedBefore = localStorage.getItem(VISITED_KEY) === "1";
      localStorage.setItem(VISITED_KEY, "1");
    } catch {
      // ignore
    }
    if (!visitedBefore || hasProgress()) return;
    getCart()
      .then((cart) => { if (cart.items.length === 0) trigger(); })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);

  // Close on Escape while visible.
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setVisible(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [visible]);

  if (isAdmin || !visible) return null;

  const digits = whatsapp.replace(/\D/g, "");

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-end sm:justify-end"
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-nudge-title"
    >
      <div
        className="absolute inset-0 bg-foreground/50 backdrop-blur-sm"
        onClick={() => setVisible(false)}
      />
      <div className="relative w-full max-w-sm rounded-2xl border border-border bg-surface p-5 shadow-2xl sm:mb-2 sm:mr-2">
        <h3 id="help-nudge-title" className="font-display text-lg font-bold text-plum">
          সাহায্য দরকার?
        </h3>
        <p className="mt-1.5 text-sm text-muted">
          কোনো প্রশ্ন থাকলে সরাসরি হোয়াটসঅ্যাপে আমাদের জিজ্ঞাসা করুন।
        </p>
        <div className="mt-4 flex flex-col gap-2.5">
          <a
            href={`https://wa.me/88${digits}`}
            target="_blank"
            rel="noreferrer"
            onClick={() => postNudgeEvent("clicked")}
            className="flex h-12 items-center justify-center rounded-full bg-plum text-base font-semibold text-white shadow transition hover:bg-wine active:scale-95"
          >
            হোয়াটসঅ্যাপে কথা বলুন
          </a>
          <button
            type="button"
            onClick={() => setVisible(false)}
            className="flex h-12 items-center justify-center rounded-full border border-border text-base font-semibold text-muted transition hover:bg-surface-2 active:scale-95"
          >
            না, ধন্যবাদ
          </button>
        </div>
      </div>
    </div>
  );
}
