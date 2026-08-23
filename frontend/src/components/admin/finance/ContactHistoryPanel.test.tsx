import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/financeApi", async () => {
  const actual = await vi.importActual<typeof import("@/lib/financeApi")>("@/lib/financeApi");
  return { ...actual, getContactHistory: vi.fn() };
});

import { getContactHistory, type ContactHistory } from "@/lib/financeApi";
import { ContactHistoryPanel } from "./ContactHistoryPanel";

const fetchHistory = vi.mocked(getContactHistory);

const history: ContactHistory = {
  direction: "payable",
  contact: { id: 1, name: "Samim Orna Mirpur", phone: "", note: "" },
  balance: 1100,
  totals: { bought: 2750, paid: 1650, balance: 1100 },
  entries: [
    { kind: "credit", id: 1, date: "2026-08-01", time: "", label: "Akhi", amount: 900,
      fee_amount: 0, account: "", affects_balance: true, remaining: 0, balance: 900 },
    { kind: "cash", id: 2, date: "2026-08-03", time: "", label: "Dupatta cash", amount: 750,
      fee_amount: 0, account: "cash", affects_balance: false, remaining: 0, balance: 900 },
    { kind: "payment", id: 3, date: "2026-08-04", time: "16:05", label: "Paid", amount: 900,
      fee_amount: 0, account: "bank", affects_balance: true, remaining: 0, balance: 0 },
    { kind: "credit", id: 4, date: "2026-08-05", time: "", label: "Nazifa", amount: 1100,
      fee_amount: 0, account: "", affects_balance: true, remaining: 1100, balance: 1100 },
  ],
};

describe("ContactHistoryPanel", () => {
  beforeEach(() => {
    fetchHistory.mockReset();
    fetchHistory.mockResolvedValue(history);
  });

  it("shows the three totals", async () => {
    render(<ContactHistoryPanel direction="payable" contactId={1} tone="amber" />);

    expect(await screen.findByText("৳ 2,750")).toBeInTheDocument();   // bought
    expect(screen.getByText("৳ 1,650")).toBeInTheDocument();          // paid
    expect(screen.getAllByText("৳ 1,100").length).toBeGreaterThan(0); // balance
  });

  it("includes cash purchases and marks them as not owed", async () => {
    render(<ContactHistoryPanel direction="payable" contactId={1} tone="amber" />);

    expect(await screen.findByText("Dupatta cash")).toBeInTheDocument();
    expect(screen.getByText("paid at the time")).toBeInTheDocument();
  });

  it("says which credits are settled and which still owe", async () => {
    render(<ContactHistoryPanel direction="payable" contactId={1} tone="amber" />);

    expect(await screen.findByText("settled")).toBeInTheDocument();
    expect(screen.getByText("৳ 1,100 left")).toBeInTheDocument();
  });

  it("shows newest first", async () => {
    render(<ContactHistoryPanel direction="payable" contactId={1} tone="amber" />);
    await screen.findByText("Nazifa");

    const labels = screen.getAllByText(/Akhi|Dupatta cash|Nazifa/).map((n) => n.textContent);
    expect(labels[0]).toContain("Nazifa");
    expect(labels[labels.length - 1]).toContain("Akhi");
  });

  it("reads the other direction as money owed TO you", async () => {
    fetchHistory.mockResolvedValue({ ...history, direction: "receivable" });
    render(<ContactHistoryPanel direction="receivable" contactId={1} tone="emerald" />);

    expect(await screen.findByText("Sold to them")).toBeInTheDocument();
    expect(screen.getByText("Still owes you")).toBeInTheDocument();
  });

  it("says so when a contact has no transactions", async () => {
    fetchHistory.mockResolvedValue({
      ...history, entries: [], totals: { bought: 0, paid: 0, balance: 0 },
    });
    render(<ContactHistoryPanel direction="payable" contactId={9} tone="amber" />);

    await waitFor(() => expect(screen.getByText(/no transactions yet/i)).toBeInTheDocument());
  });

  it("shows when a payment was made, and no clock on a purchase", async () => {
    // Two payments to the same supplier on one day are only tellable apart by
    // the time; a purchase on credit is a day, so it gets none.
    render(<ContactHistoryPanel direction="payable" contactId={1} tone="amber" />);

    expect(await screen.findByText("4:05 PM")).toBeInTheDocument();
    expect(screen.queryByText(/AM|PM/)).toBe(screen.getByText("4:05 PM"));
  });
});
