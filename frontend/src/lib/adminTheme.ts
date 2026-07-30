// Admin-only light/dark theme.
//
// The attribute lives on <html> so the page chrome (scrollbar, overscroll area)
// follows too, and AdminLayout removes it on unmount — that is what keeps the
// Bengali storefront, which has no dark theme, permanently light.

export type AdminTheme = "light" | "dark";

const KEY = "zaujain_admin_theme";
const ATTR = "data-admin-theme";

export function getStoredTheme(): AdminTheme {
  if (typeof window === "undefined") return "light";
  try {
    return localStorage.getItem(KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light"; // private mode / storage blocked
  }
}

export function storeTheme(theme: AdminTheme) {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* not worth breaking the panel over */
  }
}

/** Paint the theme. `light` removes the attribute rather than setting it, so
 *  nothing outside the admin ever inherits a dark override. */
export function applyTheme(theme: AdminTheme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (theme === "dark") root.setAttribute(ATTR, "dark");
  else root.removeAttribute(ATTR);
}

export function clearTheme() {
  if (typeof document === "undefined") return;
  document.documentElement.removeAttribute(ATTR);
}

export const nextTheme = (t: AdminTheme): AdminTheme => (t === "dark" ? "light" : "dark");
