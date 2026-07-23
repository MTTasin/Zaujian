import { describe, it, expect } from "vitest";
import { applyExclusive, exclusiveGroups } from "./exclusive";
import type { ProductListItem } from "./api";

const p = (slug: string, exclusive_group = "", name = slug) =>
  ({ slug, name, exclusive_group, customize_order: 0 } as unknown as ProductListItem);

const book = p("book", "nikahnama", "বই");
const frame = p("frame", "nikahnama", "ফ্রেম");
const thumb = p("thumb", "nikahnama", "থাম্ব");
const pen = p("pen");
const all = [book, frame, thumb, pen];

describe("applyExclusive", () => {
  it("swaps a same-group selection", () => {
    const out = applyExclusive(new Set(["book"]), frame, all);
    expect(out.has("frame")).toBe(true);
    expect(out.has("book")).toBe(false);
  });

  it("keeps products from other groups", () => {
    const out = applyExclusive(new Set(["pen"]), book, all);
    expect(out.has("pen")).toBe(true);
    expect(out.has("book")).toBe(true);
  });

  it("deselects when tapping an already-selected product", () => {
    const out = applyExclusive(new Set(["book"]), book, all);
    expect(out.has("book")).toBe(false);
  });

  it("never restricts products with a blank group", () => {
    const box = p("box");
    const out = applyExclusive(new Set(["pen"]), box, [...all, box]);
    expect(out.has("pen")).toBe(true);
    expect(out.has("box")).toBe(true);
  });

  it("does not mutate the input set", () => {
    const input = new Set(["book"]);
    applyExclusive(input, frame, all);
    expect(input.has("book")).toBe(true);
  });
});

describe("exclusiveGroups", () => {
  it("returns names for groups with 2+ members", () => {
    expect(exclusiveGroups(all)).toEqual([["বই", "ফ্রেম", "থাম্ব"]]);
  });

  it("ignores lone members and blank groups", () => {
    expect(exclusiveGroups([pen, p("solo", "alone")])).toEqual([]);
  });
});
