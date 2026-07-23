import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Container } from "./Container";
import { Section } from "./Section";
import { StickyActionBar } from "./StickyActionBar";

describe("layout primitives", () => {
  it("Container renders children", () => {
    render(<Container>ভেতরে</Container>);
    expect(screen.getByText("ভেতরে")).toBeInTheDocument();
  });
  it("Section renders a title and its children", () => {
    render(<Section title="জনপ্রিয়">কার্ড</Section>);
    expect(screen.getByRole("heading", { name: "জনপ্রিয়" })).toBeInTheDocument();
    expect(screen.getByText("কার্ড")).toBeInTheDocument();
  });
  it("StickyActionBar renders children", () => {
    render(<StickyActionBar>বার</StickyActionBar>);
    expect(screen.getByText("বার")).toBeInTheDocument();
  });
});
