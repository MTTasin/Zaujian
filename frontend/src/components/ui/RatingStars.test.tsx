import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { RatingStars } from "./RatingStars";

describe("RatingStars", () => {
  it("exposes an accessible label with the value", () => {
    render(<RatingStars value={4.5} />);
    expect(screen.getByLabelText("4.5 এর মধ্যে 5")).toBeInTheDocument();
  });
  it("shows the review count when provided", () => {
    render(<RatingStars value={4} count={12} />);
    expect(screen.getByText("(12)")).toBeInTheDocument();
  });
});
