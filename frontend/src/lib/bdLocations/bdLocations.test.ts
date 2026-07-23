import { describe, it, expect } from "vitest";
import { BD_LOCATIONS } from "./index";

const districts = Object.values(BD_LOCATIONS).flatMap((d) => Object.entries(d));

describe("BD_LOCATIONS", () => {
  it("covers all 8 divisions and all 64 districts", () => {
    expect(Object.keys(BD_LOCATIONS)).toHaveLength(8);
    expect(districts).toHaveLength(64);
  });

  it("has no empty district", () => {
    for (const [name, thanas] of districts) {
      expect(thanas.length, `${name} is empty`).toBeGreaterThan(1);
    }
  });

  it("has no duplicate thana within a district", () => {
    for (const [name, thanas] of districts) {
      const lower = thanas.map((t) => t.toLowerCase());
      expect(new Set(lower).size, `${name} has duplicates`).toBe(lower.length);
    }
  });

  it("offers an Others escape hatch in every district", () => {
    for (const [name, thanas] of districts) {
      expect(thanas, `${name} has no Others`).toContain("Others");
    }
  });

  it("keys Chattogram exactly as INSIDE_DISTRICT expects", () => {
    // The backend prices delivery off this string; a rename silently overcharges.
    expect(BD_LOCATIONS.Chattogram.Chattogram).toBeDefined();
  });

  it("includes districts that were previously missing entirely", () => {
    expect(BD_LOCATIONS.Chattogram.Brahmanbaria?.length ?? 0).toBeGreaterThan(5);
    expect(BD_LOCATIONS.Dhaka.Tangail?.length ?? 0).toBeGreaterThan(5);
  });

  it("includes metro thanas, not just administrative upazilas", () => {
    // The real complaint: a Sylhet-city customer found no entry naming their area.
    expect(BD_LOCATIONS.Sylhet.Sylhet).toContain("Shahparan");
    expect(BD_LOCATIONS.Dhaka.Dhaka).toContain("Dhanmondi");
    expect(BD_LOCATIONS.Chattogram.Chattogram).toContain("Panchlaish");
  });

  it("drops entries that were filed under the wrong district", () => {
    // Parshuram is a Feni upazila; a bad dataset had it under Rangpur.
    expect(BD_LOCATIONS.Rangpur.Rangpur).not.toContain("Parshuram");
    expect(BD_LOCATIONS.Chattogram.Feni).toContain("Parshuram");
  });
});
