import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyTheme, clearTheme, getStoredTheme, nextTheme, storeTheme,
} from "./adminTheme";

const ATTR = "data-admin-theme";

// Same workaround as analytics.test.ts: Node 22+ ships a global `localStorage`
// that needs --localstorage-file and shadows jsdom's, so stub an in-memory one.
function makeMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  } as Storage;
}

describe("adminTheme", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", makeMemoryStorage());
    document.documentElement.removeAttribute(ATTR);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("defaults to light when nothing is stored", () => {
    expect(getStoredTheme()).toBe("light");
  });

  it("round-trips through storage", () => {
    storeTheme("dark");
    expect(getStoredTheme()).toBe("dark");
    storeTheme("light");
    expect(getStoredTheme()).toBe("light");
  });

  it("treats junk in storage as light", () => {
    localStorage.setItem("zaujain_admin_theme", "purple");
    expect(getStoredTheme()).toBe("light");
  });

  it("sets the attribute for dark", () => {
    applyTheme("dark");
    expect(document.documentElement.getAttribute(ATTR)).toBe("dark");
  });

  it("REMOVES the attribute for light so the storefront never inherits it", () => {
    applyTheme("dark");
    applyTheme("light");
    expect(document.documentElement.hasAttribute(ATTR)).toBe(false);
  });

  it("clearTheme strips it — this runs when leaving /admin", () => {
    applyTheme("dark");
    clearTheme();
    expect(document.documentElement.hasAttribute(ATTR)).toBe(false);
  });

  it("toggles", () => {
    expect(nextTheme("light")).toBe("dark");
    expect(nextTheme("dark")).toBe("light");
  });
});
