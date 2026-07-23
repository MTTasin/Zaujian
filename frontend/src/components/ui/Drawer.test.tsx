import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Drawer } from "./Drawer";

describe("Drawer", () => {
  it("renders nothing when closed", () => {
    render(
      <Drawer open={false} onClose={() => {}}>
        ভেতরে
      </Drawer>,
    );
    expect(screen.queryByText("ভেতরে")).not.toBeInTheDocument();
  });
  it("shows content and closes on Escape", async () => {
    const onClose = vi.fn();
    render(
      <Drawer open onClose={onClose} title="ফিল্টার">
        ভেতরে
      </Drawer>,
    );
    expect(screen.getByText("ভেতরে")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });
  it("closes on backdrop click", async () => {
    const onClose = vi.fn();
    render(
      <Drawer open onClose={onClose}>
        ভেতরে
      </Drawer>,
    );
    await userEvent.click(screen.getByTestId("drawer-backdrop"));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
