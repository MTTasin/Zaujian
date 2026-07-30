import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  track, trackPageview, trackSearch, trackAddToCart, init,
} from "./analytics";

// Same workaround as HelpNudge.test.tsx: Node 22+ ships a global `localStorage`
// that needs --localstorage-file and shadows jsdom's, so stub a real in-memory one.
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

function bodies(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.map(([, opts]) =>
    JSON.parse((opts as RequestInit).body as string));
}

describe("analytics client", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubGlobal("localStorage", makeMemoryStorage());
    vi.stubGlobal("sessionStorage", makeMemoryStorage());
    fetchMock = vi.fn(() => Promise.resolve({ ok: true } as Response));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("mints a stable visitor id and a per-session id", () => {
    trackPageview("/products");
    const first = bodies(fetchMock)[0];
    expect(first.v).toBeTruthy();
    expect(first.s).toBeTruthy();

    trackPageview("/cart");
    expect(bodies(fetchMock)[1].v).toBe(first.v);   // same visitor across pages
  });

  it("sends a pageview with the path and drops the query string upstream", () => {
    trackPageview("/products");
    const [batch] = bodies(fetchMock);
    expect(batch.e).toEqual([{ n: "pageview", p: "/products" }]);
  });

  it("does not re-fire a pageview for the same path", () => {
    trackPageview("/cart");
    trackPageview("/cart");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("buffers ordinary events instead of sending one request each", () => {
    track("scroll", { x: { d: 25 } });
    track("scroll", { x: { d: 50 } });
    expect(fetchMock).not.toHaveBeenCalled();      // still buffered

    trackPageview("/gallery");                      // flushes the buffer with it
    const [batch] = bodies(fetchMock);
    expect(batch.e.map((e: { n: string }) => e.n)).toEqual(["scroll", "scroll", "pageview"]);
  });

  it("routes an empty result set to search_empty", () => {
    trackSearch("ঘড়ি", 0);
    trackSearch("বই", 3);
    trackPageview("/products");
    const names = bodies(fetchMock)[0].e.map((e: { n: string }) => e.n);
    expect(names).toContain("search_empty");
    expect(names).toContain("search");
  });

  it("carries the cart value", () => {
    trackAddToCart({ value: 1700 });
    trackPageview("/cart");
    const cart = bodies(fetchMock)[0].e.find((e: { n: string }) => e.n === "add_to_cart");
    expect(cart.v).toBe(1700);
  });

  it("flags only the first-ever visit as new", () => {
    init();
    expect(bodies(fetchMock)[0].n).toBe(1);
    localStorage.setItem("za_seen", "1");
    trackPageview("/");
    expect(bodies(fetchMock).at(-1)?.n).toBe(0);
  });
});
