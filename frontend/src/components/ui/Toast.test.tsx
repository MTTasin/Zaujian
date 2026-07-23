import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider, useToast } from "./Toast";

function Trigger() {
  const { toast } = useToast();
  return <button onClick={() => toast("সংরক্ষিত হয়েছে")}>দেখাও</button>;
}

describe("Toast", () => {
  it("shows a message after the hook is called", async () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "দেখাও" }));
    expect(await screen.findByText("সংরক্ষিত হয়েছে")).toBeInTheDocument();
  });
});
