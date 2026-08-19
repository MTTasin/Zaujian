import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ProfitEstimate } from "./ProfitEstimate";
import type { OrderProfit } from "@/lib/financeApi";

const base: OrderProfit = {
  collected: 2430,
  cost: 1205,
  cost_marked: true,
  shared: 451,
  shared_basis: "slice",
  courier: 240,
  courier_basis: "derived",
  profit: 534,
  window_days: 90,
};

describe("ProfitEstimate", () => {
  it("shows the whole subtraction, not just the answer", () => {
    render(<ProfitEstimate p={base} />);

    expect(screen.getByText("৳ 2,430")).toBeInTheDocument();
    expect(screen.getByText("− ৳ 1,205")).toBeInTheDocument();
    expect(screen.getByText("− ৳ 451")).toBeInTheDocument();
    expect(screen.getByText("− ৳ 240")).toBeInTheDocument();
    expect(screen.getByText("৳ 534")).toBeInTheDocument();
  });

  it("calls a negative result a loss", () => {
    render(<ProfitEstimate p={{ ...base, profit: -310 }} />);

    expect(screen.getByText("Loss")).toBeInTheDocument();
    expect(screen.queryByText("Profit")).not.toBeInTheDocument();
  });

  it("warns when no cost was ever marked, so a fat profit is not misread", () => {
    render(<ProfitEstimate p={{ ...base, cost: 0, cost_marked: false }} />);

    expect(screen.getByText(/nothing marked against this order yet/i)).toBeInTheDocument();
  });

  it("says when Meta has not billed for the order's days yet", () => {
    render(<ProfitEstimate p={{ ...base, shared_basis: "not_billed" }} />);

    expect(screen.getByText(/not billed by Meta yet/i)).toBeInTheDocument();
  });

  it("says when the courier cut was derived rather than assumed", () => {
    render(<ProfitEstimate p={base} />);
    expect(screen.getByText(/minus what Steadfast sent/i)).toBeInTheDocument();

    render(<ProfitEstimate p={{ ...base, courier_basis: "fallback" }} />);
    expect(screen.getByText(/not enough delivered orders yet/i)).toBeInTheDocument();
  });

  it("never presents itself as exact", () => {
    render(<ProfitEstimate p={base} />);
    expect(screen.getByText(/estimate · last 90 days/i)).toBeInTheDocument();
  });
});

describe("ProfitEstimate — no courier", () => {
  it("shows a dash, not a zero deduction, when no parcel was booked", () => {
    render(<ProfitEstimate p={{
      ...base, courier: 0, courier_basis: "none", profit: 774,
    }} />);

    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText(/no parcel booked/i)).toBeInTheDocument();
  });
});
