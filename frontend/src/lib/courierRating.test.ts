import { describe, expect, it } from "vitest";
import { ratingLabel, ratingTone, riskLabel, riskTone } from "./courierRating";

describe("ratingLabel", () => {
  it("turns the API bucket into a readable badge", () => {
    expect(ratingLabel("excellent_customer")).toBe("Excellent customer");
  });
});

describe("ratingTone", () => {
  it("greens only the buckets that actually mean good", () => {
    expect(ratingTone("excellent_customer")).toContain("emerald");
    expect(ratingTone("good_customer")).toContain("emerald");
  });

  it("reds the risky bucket", () => {
    expect(ratingTone("risky_customer")).toContain("red");
  });

  it("keeps a new customer neutral — unknown is not good", () => {
    expect(ratingTone("new_customer")).toContain("slate");
  });

  // The load-bearing rule: Pathao owns this enum and can add to it.
  it("degrades an unseen bucket to amber, never to green", () => {
    const tone = ratingTone("some_future_bucket");
    expect(tone).toContain("amber");
    expect(tone).not.toContain("emerald");
  });
});

describe("riskTone / riskLabel", () => {
  it("labels the level", () => {
    expect(riskLabel("low")).toBe("Low risk");
  });

  it("greens only an explicit low", () => {
    expect(riskTone("low")).toContain("emerald");
    expect(riskTone("medium")).toContain("amber");
    expect(riskTone("high")).toContain("red");
  });

  it("degrades an unseen level to neutral, never to green", () => {
    const tone = riskTone("unspecified");
    expect(tone).toContain("slate");
    expect(tone).not.toContain("emerald");
  });
});
