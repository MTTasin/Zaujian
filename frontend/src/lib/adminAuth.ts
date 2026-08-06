/**
 * Which admin sections the logged-in user may see, and at what level.
 *
 * This is UX only — it decides what the panel renders. Every rule is enforced
 * again server-side (`app/permissions.py`), so a tampered access map buys
 * nothing but a broken-looking page.
 */

export type Level = "none" | "view" | "full";
export type Access = Record<string, Level>;

export interface AdminMe {
  username: string;
  is_owner: boolean;
  access: Access;
}

/** Section keys, mirroring app/permissions.py SECTIONS. */
export const SECTION_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  orders: "Orders",
  analytics: "Analytics",
  finance: "Finance",
  fraud: "Fraud Check",
  leads: "Leads",
  capi: "CAPI Events",
  chats: "Live Chats",
  custom: "Custom Requests",
  products: "Products & Customization",
  combos: "Listings",
  homepage: "Homepage",
  gallery: "Gallery",
  bot: "Bot Instructions",
  settings: "Site Settings",
  staff: "Staff",
  audit: "Audit Log",
};

/** Sections only the owner ever holds — never present in an access map. */
export const OWNER_ONLY = ["bot", "settings", "staff", "audit"] as const;

/**
 * Longest-prefix path -> section. Order matters: `/admin` is last so it only
 * matches the dashboard itself.
 */
const PATH_SECTIONS: [string, string][] = [
  ["/admin/orders", "orders"],
  ["/admin/analytics", "analytics"],
  ["/admin/finance", "finance"],
  ["/admin/fraud-check", "fraud"],
  ["/admin/leads", "leads"],
  ["/admin/capi-events", "capi"],
  ["/admin/chats", "chats"],
  ["/admin/custom", "custom"],
  ["/admin/products", "products"],
  ["/admin/customization", "products"],
  ["/admin/combos", "combos"],
  ["/admin/homepage", "homepage"],
  ["/admin/gallery", "gallery"],
  ["/admin/bot", "bot"],
  ["/admin/staff", "staff"],
  ["/admin/audit", "audit"],
  ["/admin", "dashboard"],
];

/** The section a panel route belongs to, or null if it is not a panel route. */
export function sectionForPath(pathname: string): string | null {
  const clean = pathname.replace(/\/+$/, "") || "/admin";
  for (const [prefix, section] of PATH_SECTIONS) {
    if (clean === prefix || clean.startsWith(`${prefix}/`)) return section;
  }
  return null;
}

/**
 * Owner short-circuits. Anything not explicitly granted is denied — an unknown
 * or misspelled section must never read as access.
 */
export function can(
  me: AdminMe | null,
  section: string | null,
  mode: "read" | "write" = "read",
): boolean {
  if (!me || !section) return false;
  if (me.is_owner) return true;
  const level = me.access?.[section];
  if (level === "full") return true;
  return mode === "read" && level === "view";
}

/** True when the section is readable but not writable — drives the "View only" pill. */
export function isReadOnly(me: AdminMe | null, section: string): boolean {
  return can(me, section, "read") && !can(me, section, "write");
}

/** Where to send someone who lands on a page they cannot open. */
export function firstAllowedPath(me: AdminMe | null): string | null {
  if (!me) return null;
  for (const [prefix, section] of [...PATH_SECTIONS].reverse()) {
    if (can(me, section)) return prefix;
  }
  return null;
}
