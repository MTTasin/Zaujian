import { describe, it, expect } from "vitest";
import { validId, matchDupatta } from "./preset";

describe("validId", () => {
  it("keeps the preset id when the option still exists", () => {
    expect(validId(7, [3, 7, 9])).toBe(7);
  });

  it("drops an id whose option was deleted after the combo was built", () => {
    expect(validId(7, [3, 9])).toBeNull();
  });

  it("returns null when there is no preset", () => {
    expect(validId(undefined, [1, 2])).toBeNull();
  });
});

describe("matchDupatta", () => {
  const opts = [
    { id: 1, lace_type: "single", text_lines: 2 },
    { id: 2, lace_type: "four", text_lines: 3 },
  ];

  it("matches by option id", () => {
    expect(matchDupatta({ id: 2 }, opts)?.id).toBe(2);
  });

  it("falls back to lace + lines when the id is gone", () => {
    expect(matchDupatta({ id: 99, lace_type: "single", text_lines: 2 }, opts)?.id).toBe(1);
  });

  it("returns undefined when nothing matches", () => {
    expect(matchDupatta({ id: 99, lace_type: "single", text_lines: 8 }, opts)).toBeUndefined();
  });

  it("returns undefined with no preset", () => {
    expect(matchDupatta(undefined, opts)).toBeUndefined();
  });
});
