import { describe, it, expect, beforeEach } from "vitest";
import { markProgress, hasProgress } from "./progress";

describe("progress", () => {
  beforeEach(() => sessionStorage.clear());
  it("starts false, true after markProgress", () => {
    expect(hasProgress()).toBe(false);
    markProgress();
    expect(hasProgress()).toBe(true);
  });
});
