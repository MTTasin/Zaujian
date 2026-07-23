import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Lightbox } from "./Lightbox";

const imgs = [
  { full: "/a.jpg", caption: "A" },
  { full: "/b.jpg", caption: "B" },
];

describe("Lightbox", () => {
  it("shows the starting image and advances", () => {
    render(<Lightbox images={imgs} startIndex={0} onClose={() => {}} />);
    expect(screen.getByRole("img")).toHaveAttribute("src", "/a.jpg");
    fireEvent.click(screen.getByLabelText("Next"));
    expect(screen.getByRole("img")).toHaveAttribute("src", "/b.jpg");
  });

  it("calls onClose on the close button", () => {
    const onClose = vi.fn();
    render(<Lightbox images={imgs} startIndex={0} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalled();
  });
});
