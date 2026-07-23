import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("renders title and hint", () => {
    render(<EmptyState title="কিছু পাওয়া যায়নি" hint="আবার চেষ্টা করুন" />);
    expect(screen.getByText("কিছু পাওয়া যায়নি")).toBeInTheDocument();
    expect(screen.getByText("আবার চেষ্টা করুন")).toBeInTheDocument();
  });
  it("fires the action", async () => {
    const onClick = vi.fn();
    render(
      <EmptyState title="খালি" action={{ label: "শপে যান", onClick }} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "শপে যান" }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
