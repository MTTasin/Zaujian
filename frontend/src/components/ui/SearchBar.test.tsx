import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SearchBar } from "./SearchBar";

describe("SearchBar", () => {
  it("submits the trimmed query", async () => {
    const onSubmit = vi.fn();
    render(<SearchBar onSubmit={onSubmit} />);
    await userEvent.type(screen.getByRole("searchbox"), "  বই  ");
    await userEvent.click(screen.getByRole("button", { name: "খুঁজুন" }));
    expect(onSubmit).toHaveBeenCalledWith("বই");
  });
  it("does not submit an empty query", async () => {
    const onSubmit = vi.fn();
    render(<SearchBar onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole("button", { name: "খুঁজুন" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
