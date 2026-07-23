import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "./Button";

describe("Button", () => {
  it("renders its children", () => {
    render(<Button>কার্টে যোগ করুন</Button>);
    expect(screen.getByRole("button", { name: "কার্টে যোগ করুন" })).toBeInTheDocument();
  });
  it("calls onClick when pressed", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>ঠিক আছে</Button>);
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledOnce();
  });
  it("does not fire onClick when disabled", async () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>ঠিক আছে</Button>);
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });
  it("applies the secondary variant classes", () => {
    render(<Button variant="secondary">x</Button>);
    expect(screen.getByRole("button").className).toContain("border");
  });
});
