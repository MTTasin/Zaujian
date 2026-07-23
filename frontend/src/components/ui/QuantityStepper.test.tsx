import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QuantityStepper } from "./QuantityStepper";

describe("QuantityStepper", () => {
  it("increments and decrements within bounds", async () => {
    const onChange = vi.fn();
    render(<QuantityStepper value={2} onChange={onChange} />);
    await userEvent.click(screen.getByLabelText("বাড়ান"));
    expect(onChange).toHaveBeenLastCalledWith(3);
    await userEvent.click(screen.getByLabelText("কমান"));
    expect(onChange).toHaveBeenLastCalledWith(1);
  });
  it("does not go below min", async () => {
    const onChange = vi.fn();
    render(<QuantityStepper value={1} onChange={onChange} min={1} />);
    await userEvent.click(screen.getByLabelText("কমান"));
    expect(onChange).not.toHaveBeenCalled();
  });
});
