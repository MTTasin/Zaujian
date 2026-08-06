"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { adminGet, clearToken, getToken, getPushKey, pushSubscribe } from "@/lib/adminApi";
import {
  applyTheme, clearTheme, getStoredTheme, nextTheme, storeTheme, type AdminTheme,
} from "@/lib/adminTheme";
import { Icon, type IconName } from "@/components/ui/Icon";
import { AdminAuthProvider, useAdminAuth } from "@/components/admin/AdminAuthProvider";
import { firstAllowedPath, sectionForPath } from "@/lib/adminAuth";

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

// Every entry carries the section that guards it — the sidebar renders only the
// ones this account can read (owner-only items appear for the owner alone).
const NAV: { href: string; label: string; icon: IconName; section: string }[] = [
  { href: "/admin", label: "Dashboard", icon: "grid", section: "dashboard" },
  { href: "/admin/orders", label: "Orders", icon: "cart", section: "orders" },
  { href: "/admin/analytics", label: "Analytics", icon: "chart", section: "analytics" },
  { href: "/admin/finance", label: "Finance", icon: "wallet", section: "finance" },
  { href: "/admin/fraud-check", label: "Fraud Check", icon: "phone", section: "fraud" },
  { href: "/admin/leads", label: "Leads", icon: "mail", section: "leads" },
  { href: "/admin/capi-events", label: "CAPI Events", icon: "star", section: "capi" },
  { href: "/admin/chats", label: "Live Chats", icon: "chat", section: "chats" },
  { href: "/admin/custom", label: "Custom Requests", icon: "edit", section: "custom" },
  { href: "/admin/products", label: "Products", icon: "box", section: "products" },
  { href: "/admin/customization", label: "Customization", icon: "sliders", section: "products" },
  { href: "/admin/combos", label: "Listings", icon: "gift", section: "combos" },
  { href: "/admin/homepage", label: "Homepage", icon: "home", section: "homepage" },
  { href: "/admin/gallery", label: "Gallery", icon: "image", section: "gallery" },
  { href: "/admin/bot", label: "Bot Instructions", icon: "sparkles", section: "bot" },
  { href: "/admin/staff", label: "Staff", icon: "user", section: "staff" },
  { href: "/admin/audit", label: "Audit Log", icon: "clock", section: "audit" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminAuthProvider>
      <AdminShell>{children}</AdminShell>
    </AdminAuthProvider>
  );
}

function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isLogin = pathname === "/admin/login";
  const [ready, setReady] = useState(false);
  const [waiting, setWaiting] = useState(0);
  const [newOrders, setNewOrders] = useState(0);
  const [mobileOpen, setMobileOpen] = useState(false);
  // Lazy initializer, not an effect: on the server it resolves to "light" and
  // the toggle isn't rendered until `ready` flips post-mount, so there is
  // nothing for hydration to mismatch on.
  const [theme, setTheme] = useState<AdminTheme>(getStoredTheme);
  const prevWaiting = useRef(0);
  const prevOrders = useRef<number | null>(null);
  const { me, loading: authLoading, can, readOnly } = useAdminAuth();

  useEffect(() => {
    if (isLogin) { setReady(true); return; }
    if (!getToken()) { router.replace("/admin/login"); return; }
    setReady(true);
  }, [isLogin, pathname, router]);

  // Route guard. Landing on a section you don't hold bounces you to one you do
  // — cosmetic only, since the API refuses the data either way.
  const section = sectionForPath(pathname);
  const allowed = isLogin || authLoading || !me || can(section ?? "");
  useEffect(() => {
    if (allowed) return;
    const fallback = firstAllowedPath(me);
    if (fallback && fallback !== pathname) router.replace(fallback);
  }, [allowed, me, pathname, router]);

  useEffect(() => setMobileOpen(false), [pathname]);

  // Dark mode is the admin's own setting, not the OS's — the storefront has no
  // dark theme, so the attribute is stripped the moment this layout unmounts.
  useEffect(() => {
    applyTheme(theme);
    return clearTheme;
  }, [theme]);

  function toggleTheme() {
    const next = nextTheme(theme);
    setTheme(next);
    storeTheme(next);
  }

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
  if (!ready || authLoading) {
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

  const visibleNav = NAV.filter((n) => can(n.section));

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
          <nav className="flex flex-1 flex-col gap-1">{visibleNav.map(navItem)}</nav>
          <button
            onClick={toggleTheme}
            className="mt-4 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
          >
            <Icon name={theme === "dark" ? "sun" : "moon"} size={18} />
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
          <button
            onClick={logout}
            className="mt-1 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-red-500 transition hover:bg-red-50"
          >
            <Icon name="logout" size={18} /> Log out
          </button>
        </aside>

        {/* Main */}
        <div className="min-w-0 flex-1">
          {/* Mobile top bar */}
          <div className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 md:hidden print:hidden">
            {brand}
            <div className="flex items-center gap-1">
              <button
                onClick={toggleTheme}
                aria-label={theme === "dark" ? "Light mode" : "Dark mode"}
                className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"
              >
                <Icon name={theme === "dark" ? "sun" : "moon"} size={20} />
              </button>
              <button
                onClick={() => setMobileOpen((v) => !v)}
                aria-label="Menu"
                className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"
              >
                <Icon name={mobileOpen ? "x" : "menu"} size={22} />
              </button>
            </div>
          </div>
          {mobileOpen && (
            <div className="border-b border-slate-200 bg-white p-3 md:hidden">
              <nav className="flex flex-col gap-1">{visibleNav.map(navItem)}</nav>
              <button
                onClick={logout}
                className="mt-2 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-red-500 hover:bg-red-50"
              >
                <Icon name="logout" size={18} /> Log out
              </button>
            </div>
          )}

          <main className="p-4 md:p-8 print:p-0">
            <div className="mx-auto max-w-6xl print:max-w-none">
              {/* One banner covers every page: a read-only moderator is told
                  once, at the top, instead of discovering it by getting a 403
                  from a button. Pages additionally disable their own controls. */}
              {allowed && section && readOnly(section) && (
                <div className="mb-4 flex items-center gap-2 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800 print:hidden">
                  <Icon name="x" size={16} />
                  <span>
                    <strong>View only.</strong> You can read this section but not change
                    anything here. Ask the owner if you need to edit.
                  </span>
                </div>
              )}
              {allowed ? children : <NoAccess hasAny={visibleNav.length > 0} />}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

/** Shown while the guard redirects, and permanently for an account with nothing
    granted — better than a blank screen or a wall of failed requests. */
function NoAccess({ hasAny }: { hasAny: boolean }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-6 py-16 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm">
        <Icon name="x" size={24} />
      </span>
      <p className="font-semibold text-slate-700">No access to this section</p>
      <p className="text-sm text-slate-400">
        {hasAny
          ? "Pick a section from the menu, or ask the owner to grant this one."
          : "Your account has no sections yet. Ask the owner to grant access."}
      </p>
    </div>
  );
}
