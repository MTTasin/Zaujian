import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PriceTag } from "./PriceTag";

describe("PriceTag", () => {
  it("shows the price with a taka sign", () => {
    render(<PriceTag price="500.00" />);
    expect(screen.getByText("৳500")).toBeInTheDocument();
  });
  it("shows compare-at strike and discount percent when cheaper", () => {
    render(<PriceTag price="400" compareAt="500" />);
    expect(screen.getByText("৳500")).toBeInTheDocument();
    expect(screen.getByText("-20%")).toBeInTheDocument();
  });
  it("hides compare-at when it is not higher than price", () => {
    render(<PriceTag price="500" compareAt="500" />);
    expect(screen.queryByText("-0%")).not.toBeInTheDocument();
  });
});
