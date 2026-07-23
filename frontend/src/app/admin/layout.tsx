"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { adminGet, clearToken, getToken, getPushKey, pushSubscribe } from "@/lib/adminApi";
import { Icon, type IconName } from "@/components/ui/Icon";

// VAPID public keys are base64url; PushManager needs a Uint8Array.
function urlBase64ToBuffer(base64: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const buf = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return buf;
}

// Register the service worker + subscribe this device to Web Push (once).
async function setupWebPush() {
  try {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const reg = await navigator.serviceWorker.register("/sw.js");
    const { public_key } = await getPushKey();
    if (!public_key) return;
    const existing = await reg.pushManager.getSubscription();
    const sub =
      existing ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToBuffer(public_key),
      }));
    await pushSubscribe(sub.toJSON());
  } catch {
    /* push is best-effort — never block the admin UI */
  }
}

// Two distinct alert tones so the admin can tell them apart by ear:
//  - "chat"  = single mid tone (a new handoff conversation)
//  - "order" = rising two-note "ti-ting" (a new order)
function beep(kind: "chat" | "order" = "chat") {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = "sine";
    const t = ctx.currentTime;
    if (kind === "order") {
      o.frequency.setValueAtTime(660, t);
      o.frequency.setValueAtTime(990, t + 0.15);   // second, higher note
      g.gain.setValueAtTime(0.18, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
      o.start(t); o.stop(t + 0.55);
    } else {
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.15, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      o.start(t); o.stop(t + 0.4);
    }
  } catch { /* no audio */ }
}

const NAV: { href: string; label: string; icon: IconName }[] = [
  { href: "/admin", label: "Dashboard", icon: "grid" },
  { href: "/admin/orders", label: "Orders", icon: "cart" },
  { href: "/admin/fraud-check", label: "Fraud Check", icon: "phone" },
  { href: "/admin/leads", label: "Leads", icon: "user" },
  { href: "/admin/capi-events", label: "CAPI Events", icon: "star" },
  { href: "/admin/chats", label: "Live Chats", icon: "chat" },
  { href: "/admin/custom", label: "Custom Requests", icon: "edit" },
  { href: "/admin/products", label: "Products", icon: "box" },
  { href: "/admin/customization", label: "Customization", icon: "sliders" },
  { href: "/admin/combos", label: "Listings", icon: "gift" },
  { href: "/admin/homepage", label: "Homepage", icon: "home" },
  { href: "/admin/gallery", label: "Gallery", icon: "image" },
  { href: "/admin/bot", label: "Bot Instructions", icon: "sparkles" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isLogin = pathname === "/admin/login";
  const [ready, setReady] = useState(false);
  const [waiting, setWaiting] = useState(0);
  const [newOrders, setNewOrders] = useState(0);
  const [mobileOpen, setMobileOpen] = useState(false);
  const prevWaiting = useRef(0);
  const prevOrders = useRef<number | null>(null);

  useEffect(() => {
    if (isLogin) { setReady(true); return; }
    if (!getToken()) { router.replace("/admin/login"); return; }
    setReady(true);
  }, [isLogin, pathname, router]);

  useEffect(() => setMobileOpen(false), [pathname]);

  useEffect(() => {
    if (isLogin || !getToken()) return;
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().then((perm) => {
        if (perm === "granted") setupWebPush();
      });
    } else if ("Notification" in window && Notification.permission === "granted") {
      setupWebPush();  // already allowed on a prior visit
    }
    const notify = (title: string, body: string) => {
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification(title, { body });
      }
    };
    const tick = async () => {
      try {
        const d = await adminGet<{ waiting: number; unread: number; new_orders: number }>("chat-unread/");
        setWaiting(d.waiting);
        setNewOrders(d.new_orders);
        if (d.waiting > prevWaiting.current) {
          beep("chat");
          notify("নতুন চ্যাট", "একজন গ্রাহক কথা বলতে চান");
        }
        // Skip the very first poll (prevOrders null) so a page load isn't an "alert".
        if (prevOrders.current !== null && d.new_orders > prevOrders.current) {
          beep("order");
          notify("নতুন অর্ডার", "একটি নতুন অর্ডার এসেছে");
        }
        prevWaiting.current = d.waiting;
        prevOrders.current = d.new_orders;
      } catch { /* ignore */ }
    };
    tick();
    const iv = setInterval(tick, 6000);
    return () => clearInterval(iv);
  }, [isLogin]);

  if (isLogin) return <>{children}</>;
  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-400">
        Loading…
      </div>
    );
  }

  function logout() {
    clearToken();
    router.replace("/admin/login");
  }

  const navItem = (n: (typeof NAV)[number]) => {
    const active =
      n.href === "/admin"
        ? pathname === n.href
        : pathname === n.href || pathname.startsWith(n.href + "/");
    return (
      <Link
        key={n.href}
        href={n.href}
        className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
          active
            ? "bg-plum/10 text-plum"
            : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
        }`}
      >
        <Icon name={n.icon} size={18} />
        <span className="flex-1">{n.label}</span>
        {n.href === "/admin/chats" && waiting > 0 && (
          <span className="rounded-full bg-red-500 px-2 py-0.5 text-xs font-bold text-white">
            {waiting}
          </span>
        )}
        {n.href === "/admin/orders" && newOrders > 0 && (
          <span className="rounded-full bg-red-500 px-2 py-0.5 text-xs font-bold text-white">
            {newOrders}
          </span>
        )}
      </Link>
    );
  };

  const brand = (
    <div className="flex items-center gap-2 px-2">
      <Image src="/logo.jpg" alt="" width={28} height={28} className="h-7 w-7 rounded-full object-cover ring-1 ring-slate-200" />
      <span className="text-base font-bold text-slate-900">
        Zaujain <span className="font-medium text-slate-400">Admin</span>
      </span>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <div className="flex">
        {/* Desktop sidebar */}
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-slate-200 bg-white p-4 md:flex print:!hidden">
          <div className="mb-6 pt-1">{brand}</div>
          <nav className="flex flex-1 flex-col gap-1">{NAV.map(navItem)}</nav>
          <button
            onClick={logout}
            className="mt-4 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-red-500 transition hover:bg-red-50"
          >
            <Icon name="logout" size={18} /> Log out
          </button>
        </aside>

        {/* Main */}
        <div className="min-w-0 flex-1">
          {/* Mobile top bar */}
          <div className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 md:hidden print:hidden">
            {brand}
            <button
              onClick={() => setMobileOpen((v) => !v)}
              aria-label="Menu"
              className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"
            >
              <Icon name={mobileOpen ? "x" : "menu"} size={22} />
            </button>
          </div>
          {mobileOpen && (
            <div className="border-b border-slate-200 bg-white p-3 md:hidden">
              <nav className="flex flex-col gap-1">{NAV.map(navItem)}</nav>
              <button
                onClick={logout}
                className="mt-2 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-red-500 hover:bg-red-50"
              >
                <Icon name="logout" size={18} /> Log out
              </button>
            </div>
          )}

          <main className="p-4 md:p-8 print:p-0">
            <div className="mx-auto max-w-6xl print:max-w-none">{children}</div>
          </main>
        </div>
      </div>
    </div>
  );
}
