// Self-hosted storefront analytics client.
//
// Built for the audience: slow 2G, low-end Android. So it never blocks a render,
// never fetches on the critical path, and batches everything into rare, tiny
// beacons. Identity is a random id in localStorage — no cookies, no PII, so
// nothing here needs a consent banner.
//
// Server contract: POST {API_BASE}/api/t/ with short keys, always answers 204.

import { API_BASE } from "./api";

const VISITOR_KEY = "za_vid";
const SESSION_KEY = "za_sid";
const NEW_KEY = "za_seen";        // set once ever → distinguishes new vs returning

// Flush when either trigger hits, whichever comes first.
const MAX_BUFFER = 12;
const FLUSH_MS = 15_000;
// Presence heartbeat. Only fires while the tab is VISIBLE, so a backgrounded tab
// costs nothing and "visitors right now" stays honest.
const HEARTBEAT_MS = 45_000;

type Event = {
  n: string;                       // event name (server whitelists it)
  p?: string;                      // path
  c?: number;                      // combo id
  pr?: number;                     // product id
  v?: number | string;             // value (money)
  x?: Record<string, unknown>;     // small props
};

let buffer: Event[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeat: ReturnType<typeof setInterval> | null = null;
let started = false;
let lastPath = "";

function rid(): string {
  try {
    return crypto.randomUUID().replace(/-/g, "");
  } catch {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

function store(kind: "local" | "session", key: string): string {
  try {
    const box = kind === "local" ? localStorage : sessionStorage;
    let id = box.getItem(key);
    if (!id) {
      id = rid();
      box.setItem(key, id);
    }
    return id;
  } catch {
    return "";   // private mode: the visit simply goes untracked
  }
}

const visitorId = () => store("local", VISITOR_KEY);
const sessionId = () => store("session", SESSION_KEY);

function isNewVisitor(): boolean {
  try {
    if (localStorage.getItem(NEW_KEY)) return false;
    localStorage.setItem(NEW_KEY, "1");
    return true;
  } catch {
    return false;
  }
}

function context() {
  const url = typeof window === "undefined" ? null : new URL(window.location.href);
  return {
    r: typeof document === "undefined" ? "" : document.referrer,
    u: url?.searchParams.get("utm_source") || "",
    f: url?.searchParams.get("fbclid") ? 1 : 0,
  };
}

/** Send whatever is buffered. `beacon` is used on page-hide, where fetch dies. */
function flush(beacon = false): void {
  if (!buffer.length || typeof window === "undefined") return;
  const v = visitorId();
  const s = sessionId();
  if (!v || !s) return;

  const body = JSON.stringify({ v, s, n: 0, ...context(), e: buffer });
  buffer = [];
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  const url = `${API_BASE}/api/t/`;
  try {
    // sendBeacon survives the page being closed — the only way to capture the
    // last pageview of a session. text/plain avoids a CORS preflight.
    if (beacon && navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([body], { type: "text/plain" }));
      return;
    }
    void fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Tracking must never surface an error to a customer.
  }
}

/** Queue one event. Safe to call anywhere, including before init(). */
export function track(name: string, event: Omit<Event, "n"> = {}): void {
  if (typeof window === "undefined") return;
  buffer.push({
    n: name,
    p: event.p ?? window.location.pathname,
    ...event,
  });
  if (buffer.length >= MAX_BUFFER) {
    flush();
  } else if (!flushTimer) {
    flushTimer = setTimeout(() => flush(), FLUSH_MS);
  }
}

/** Route change → one pageview. Deduped, because the App Router can re-fire. */
export function trackPageview(path?: string): void {
  if (typeof window === "undefined") return;
  const p = path ?? window.location.pathname;
  if (p === lastPath) return;
  lastPath = p;
  track("pageview", { p });
  // First event of a brand-new visitor carries the "new" flag + referrer, which
  // is what the server uses to open the session row.
  flush();
}

/** Called once from the mounted <Analytics/> component. */
export function init(): void {
  if (started || typeof window === "undefined") return;
  started = true;

  const fresh = isNewVisitor();
  const v = visitorId();
  const s = sessionId();
  if (v && s && fresh) {
    // Announce the new visitor immediately so `new_visitors` is accurate even if
    // they bounce before the first flush.
    try {
      void fetch(`${API_BASE}/api/t/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ v, s, n: 1, ...context(), e: [] }),
        keepalive: true,
      }).catch(() => {});
    } catch { /* ignore */ }
  }

  const beat = () => {
    if (document.visibilityState !== "visible") return;
    buffer.push({ n: "ping", p: window.location.pathname });
    flush();
  };
  heartbeat = setInterval(beat, HEARTBEAT_MS);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush(true);
    else beat();
  });
  window.addEventListener("pagehide", () => flush(true));

  trackScrollDepth();
}

/** Scroll milestones, once each per page. Cheap signal for "did they read it". */
function trackScrollDepth(): void {
  let hit = new Set<number>();
  let ticking = false;

  const reset = () => { hit = new Set(); };
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const doc = document.documentElement;
      const max = doc.scrollHeight - window.innerHeight;
      if (max <= 0) return;
      const pct = Math.min(Math.round((window.scrollY / max) * 100), 100);
      for (const mark of [25, 50, 75, 100]) {
        if (pct >= mark && !hit.has(mark)) {
          hit.add(mark);
          track("scroll", { x: { d: mark } });
        }
      }
    });
  };

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("za:pageview", reset);
}

export function stop(): void {
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = null;
  started = false;
}

// ---- Named helpers, so call sites read as intent, not as event strings ---- //

export const trackComboView = (comboId: number, name?: string) =>
  track("view_combo", { c: comboId, x: name ? { name } : undefined });

export const trackProductView = (productId: number, name?: string) =>
  track("view_product", { pr: productId, x: name ? { name } : undefined });

export const trackAddToCart = (opts: { comboId?: number; productId?: number; value?: number }) =>
  track("add_to_cart", { c: opts.comboId, pr: opts.productId, v: opts.value });

export const trackBeginCheckout = (value?: number) => track("begin_checkout", { v: value });

export const trackPurchase = (value?: number) => {
  track("purchase", { v: value });
  flush();                                  // never risk losing the conversion
};

export const trackSearch = (term: string, results: number) => {
  track(results > 0 ? "search" : "search_empty", { x: { q: term, n: results } });
};

export const trackWizardStep = (step: number, productName?: string) =>
  track("wizard_step", { x: { step, name: productName } });

export const trackWizardAbandon = (step: number) => {
  track("wizard_abandon", { x: { step } });
  flush(true);
};

export const trackChatOpen = () => track("chat_open");
