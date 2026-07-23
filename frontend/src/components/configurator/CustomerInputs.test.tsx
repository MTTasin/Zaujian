import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { CustomerInputs, missingRequired } from "./CustomerInputs";
import type { ProductInputField } from "@/lib/api";

const fields: ProductInputField[] = [
  { id: 1, label: "বরের নাম", placeholder: "পুরো নাম", required: true, order: 1 },
  { id: 2, label: "ডাকনাম", placeholder: "", required: false, order: 2 },
];

describe("missingRequired", () => {
  it("lists unfilled required labels", () => {
    expect(missingRequired(fields, {})).toEqual(["বরের নাম"]);
  });
  it("ignores optional and treats whitespace as unfilled", () => {
    expect(missingRequired(fields, { "বরের নাম": "Rahim" })).toEqual([]);
    expect(missingRequired(fields, { "বরের নাম": "   " })).toEqual(["বরের নাম"]);
  });
});

describe("CustomerInputs", () => {
  it("renders each field and the optional note", () => {
    render(
      <CustomerInputs fields={fields} values={{}} note="" errors={{}}
        onChange={() => {}} onNoteChange={() => {}} />,
    );
    expect(screen.getByLabelText(/বরের নাম/)).toBeInTheDocument();
    expect(screen.getByLabelText(/ডাকনাম/)).toBeInTheDocument();
    expect(screen.getByLabelText(/বিশেষ নির্দেশনা/)).toBeInTheDocument();
  });

  it("reports edits", () => {
    const onChange = vi.fn();
    render(
      <CustomerInputs fields={fields} values={{}} note="" errors={{}}
        onChange={onChange} onNoteChange={() => {}} />,
    );
    fireEvent.change(screen.getByLabelText(/বরের নাম/), { target: { value: "Rahim" } });
    expect(onChange).toHaveBeenCalledWith("বরের নাম", "Rahim");
  });

  it("shows an error under the offending field", () => {
    render(
      <CustomerInputs fields={fields} values={{}} note=""
        errors={{ "বরের নাম": "বরের নাম লিখুন" }}
        onChange={() => {}} onNoteChange={() => {}} />,
    );
    expect(screen.getByText("বরের নাম লিখুন")).toBeInTheDocument();
  });

  it("renders nothing but the note when there are no fields", () => {
    render(
      <CustomerInputs fields={[]} values={{}} note="" errors={{}}
        onChange={() => {}} onNoteChange={() => {}} />,
    );
    expect(screen.getByLabelText(/বিশেষ নির্দেশনা/)).toBeInTheDocument();
  });
});
