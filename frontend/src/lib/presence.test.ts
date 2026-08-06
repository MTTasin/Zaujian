import { describe, it, expect } from "vitest";
import { describePresence } from "./presence";

const NOW = new Date("2026-08-06T12:00:00Z").getTime();
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("describePresence", () => {
  it("calls a never-seen account never signed in", () => {
    expect(describePresence(null, NOW)).toEqual({ state: "never", label: "Never signed in" });
  });

  it("treats junk as never rather than crashing the row", () => {
    expect(describePresence("not a date", NOW).state).toBe("never");
  });

  it("is online inside the window", () => {
    expect(describePresence(ago(30_000), NOW)).toEqual({ state: "online", label: "Active now" });
  });

  it("never reads the future as stale when the clocks disagree", () => {
    expect(describePresence(new Date(NOW + 60_000).toISOString(), NOW).state).toBe("online");
  });

  it("counts minutes, then hours, then days", () => {
    expect(describePresence(ago(20 * 60_000), NOW).label).toBe("Active 20m ago");
    expect(describePresence(ago(3 * 3_600_000), NOW).label).toBe("Active 3h ago");
    expect(describePresence(ago(2 * 86_400_000), NOW).label).toBe("Active 2d ago");
  });

  it("separates idle from away so the dot can differ", () => {
    expect(describePresence(ago(5 * 60_000), NOW).state).toBe("idle");
    expect(describePresence(ago(40 * 60_000), NOW).state).toBe("away");
  });

  it("falls back to a date past a week", () => {
    expect(describePresence(ago(30 * 86_400_000), NOW).label).toContain("Jul 2026");
  });
});
