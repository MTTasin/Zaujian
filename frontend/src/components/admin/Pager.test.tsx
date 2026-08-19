import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Pager } from "./ui";

describe("Pager", () => {
  it("stays out of the way when everything fits on one page", () => {
    const { container } = render(
      <Pager page={1} count={12} pageSize={50} onPage={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("says which rows are on screen, not just which page", () => {
    render(<Pager page={2} count={130} pageSize={50} onPage={() => {}} />);
    expect(screen.getByText("51–100 of 130")).toBeInTheDocument();
    expect(screen.getByText("Page 2 of 3")).toBeInTheDocument();
  });

  it("counts the last, partial page", () => {
    render(<Pager page={3} count={130} pageSize={50} onPage={() => {}} />);
    expect(screen.getByText("101–130 of 130")).toBeInTheDocument();
  });

  it("cannot walk off either end", () => {
    const onPage = vi.fn();
    const { rerender } = render(
      <Pager page={1} count={130} pageSize={50} onPage={onPage} />,
    );
    expect(screen.getByText("Previous")).toBeDisabled();

    rerender(<Pager page={3} count={130} pageSize={50} onPage={onPage} />);
    expect(screen.getByText("Next")).toBeDisabled();
  });

  it("asks for the next page when pressed", () => {
    const onPage = vi.fn();
    render(<Pager page={2} count={130} pageSize={50} onPage={onPage} />);

    fireEvent.click(screen.getByText("Next"));
    expect(onPage).toHaveBeenCalledWith(3);

    fireEvent.click(screen.getByText("Previous"));
    expect(onPage).toHaveBeenCalledWith(1);
  });
});
