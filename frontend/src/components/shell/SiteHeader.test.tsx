import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import SiteHeader from "./SiteHeader";

describe("SiteHeader", () => {
  it("shows the brand wordmark and cart link", () => {
    render(<SiteHeader />);
    expect(screen.getByText("Zaujain Nikah Point")).toBeInTheDocument();
    expect(screen.getByLabelText("কার্ট")).toBeInTheDocument();
  });
  it("navigates to shop with the search query", async () => {
    render(<SiteHeader />);
    await userEvent.type(screen.getByRole("searchbox"), "বই");
    await userEvent.click(screen.getByRole("button", { name: "খুঁজুন" }));
    expect(push).toHaveBeenCalledWith("/products?q=%E0%A6%AC%E0%A6%87");
  });
});
