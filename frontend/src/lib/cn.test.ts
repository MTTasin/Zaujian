import { describe, expect, it } from "vitest";
import { cn } from "./cn";

describe("cn", () => {
  it("joins truthy class strings with single spaces", () => {
    expect(cn("a", "b")).toBe("a b");
  });
  it("drops falsy values", () => {
    expect(cn("a", false, null, undefined, "b")).toBe("a b");
  });
  it("returns empty string when nothing truthy", () => {
    expect(cn(false, null, undefined)).toBe("");
  });
});
