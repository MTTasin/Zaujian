import { describe, expect, it } from "vitest";
import { feeFromRate, isoDate, longDate, rangeDates, taka, vatInside } from "./financeApi";

describe("longDate", () => {
  it("renders dd-Month-yyyy", () => {
    expect(longDate("2026-08-18")).toBe("18-August-2026");
    expect(longDate("2026-01-01")).toBe("01-January-2026");
    expect(longDate("2026-12-31")).toBe("31-December-2026");
  });

  it("does not shift the day in a timezone behind UTC", () => {
    // `new Date("2026-08-18")` is UTC midnight = Aug 17 locally in the Americas.
    expect(longDate("2026-08-18T00:00:00Z")).toBe("18-August-2026");
  });

  it("passes junk through instead of printing NaN", () => {
    expect(longDate("")).toBe("");
    expect(longDate("not a date")).toBe("not a date");
    expect(longDate("2026-13-01")).toBe("2026-13-01");
  });
});

describe("taka", () => {
  it("rounds and groups", () => {
    expect(taka(1250.4)).toBe("৳ 1,250");
    expect(taka("9815.50")).toBe("৳ 9,816");
  });
  it("survives junk instead of printing NaN", () => {
    expect(taka("abc")).toBe("৳ 0");
  });
});

describe("feeFromRate — a PRE-FILL only; flat charges are typed in taka", () => {
  it("computes a percentage of the amount", () => {
    expect(feeFromRate(1000, "1.85")).toBe(18.5);
    expect(feeFromRate("2000", 1.45)).toBe(29);
  });
  it("is zero when the account has no rate", () => {
    expect(feeFromRate(5000, "0")).toBe(0);
  });
  it("is zero for an empty amount", () => {
    expect(feeFromRate("", "1.85")).toBe(0);
  });
});

describe("vatInside — VAT is contained in the amount, never added to it", () => {
  it("extracts 15% from a VAT-inclusive figure", () => {
    // 1000 net + 150 VAT = 1150 billed.
    expect(vatInside(1150)).toBe(150);
  });
  it("returns 0 for nothing", () => {
    expect(vatInside(0)).toBe(0);
  });
});

describe("rangeDates", () => {
  const day = new Date(2026, 6, 27); // 27 Jul 2026, local

  it("this month starts on the 1st and ends today", () => {
    expect(rangeDates("this_month", day)).toEqual({ start: "2026-07-01", end: "2026-07-27" });
  });
  it("last month covers the whole previous month", () => {
    expect(rangeDates("last_month", day)).toEqual({ start: "2026-06-01", end: "2026-06-30" });
  });
  it("N days is inclusive of today", () => {
    expect(rangeDates("7", day)).toEqual({ start: "2026-07-21", end: "2026-07-27" });
  });
  it("crosses a year boundary", () => {
    expect(rangeDates("last_month", new Date(2026, 0, 15)).start).toBe("2025-12-01");
  });
  it("isoDate uses local parts, not UTC", () => {
    expect(isoDate(new Date(2026, 0, 1))).toBe("2026-01-01");
  });
});
