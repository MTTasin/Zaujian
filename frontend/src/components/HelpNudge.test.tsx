import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import HelpNudge from "./HelpNudge";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("@/lib/api", () => ({
  getShopInfo: () => Promise.resolve({ whatsapp_number: "01959976683" }),
  postNudgeEvent: () => Promise.resolve(null),
  getCart: () => Promise.resolve({ items: [], subtotal: "0", count: 0 }),
}));

// Node 22+ defines a global `localStorage` that requires a --localstorage-file
// flag to actually work, which shadows jsdom's implementation in this test
// environment. Stub a plain in-memory Storage so localStorage-dependent code
// under test behaves like it would in a real browser.
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

describe("HelpNudge", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("localStorage", makeMemoryStorage());
    sessionStorage.clear();
    document.body.dataset.chatOpen = "false";
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("shows the WhatsApp popup after the idle threshold", async () => {
    render(<HelpNudge />);
    await act(async () => { await Promise.resolve(); }); // resolve shop-info
    await act(async () => { vi.advanceTimersByTime(31000); });
    expect(screen.getByText(/সাহায্য/)).toBeTruthy();
    const link = screen.getByRole("link") as HTMLAnchorElement;
    expect(link.href).toContain("wa.me/8801959976683");
  });

  it("does not show while chat is open", async () => {
    document.body.dataset.chatOpen = "true";
    render(<HelpNudge />);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(31000); });
    expect(screen.queryByText(/সাহায্য/)).toBeNull();
  });

  it("dismissing hides the popup and the session gate prevents it showing again", async () => {
    const { unmount } = render(<HelpNudge />);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(31000); });
    expect(screen.getByText(/সাহায্য/)).toBeTruthy();

    fireEvent.click(screen.getByText("না, ধন্যবাদ"));
    expect(screen.queryByText(/সাহায্য/)).toBeNull();

    unmount();
    render(<HelpNudge />);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(31000); });
    expect(screen.queryByText(/সাহায্য/)).toBeNull();
  });
});
