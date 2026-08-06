import { describe, expect, it } from "vitest";
import {
  can, firstAllowedPath, isReadOnly, sectionForPath, type AdminMe,
} from "./adminAuth";

const owner: AdminMe = { username: "owner", is_owner: true, access: {} };
const mod = (access: AdminMe["access"]): AdminMe =>
  ({ username: "mod", is_owner: false, access });

describe("sectionForPath", () => {
  it("maps a nested route to its section", () => {
    expect(sectionForPath("/admin/orders/12/challan")).toBe("orders");
  });

  it("maps the panel root to the dashboard, not to everything", () => {
    expect(sectionForPath("/admin")).toBe("dashboard");
    expect(sectionForPath("/admin/")).toBe("dashboard");
  });

  it("keeps Products and Customization on one section", () => {
    expect(sectionForPath("/admin/products")).toBe("products");
    expect(sectionForPath("/admin/customization")).toBe("products");
  });

  it("does not confuse a longer path with a shorter one", () => {
    expect(sectionForPath("/admin/combos/4")).toBe("combos");
    expect(sectionForPath("/admin/capi-events")).toBe("capi");
  });

  it("returns null off the panel", () => {
    expect(sectionForPath("/products")).toBeNull();
  });
});

describe("can", () => {
  it("lets the owner through every section, granted or not", () => {
    expect(can(owner, "finance", "write")).toBe(true);
    expect(can(owner, "bot", "write")).toBe(true);
  });

  it("splits read from write at view level", () => {
    const user = mod({ orders: "view" });
    expect(can(user, "orders", "read")).toBe(true);
    expect(can(user, "orders", "write")).toBe(false);
  });

  it("allows both at full level", () => {
    const user = mod({ orders: "full" });
    expect(can(user, "orders", "write")).toBe(true);
  });

  it("denies a section that is absent, none, or misspelled", () => {
    const user = mod({ orders: "full", finance: "none" });
    expect(can(user, "finance")).toBe(false);
    expect(can(user, "gallery")).toBe(false);
    expect(can(user, "order")).toBe(false);
  });

  it("denies when nobody is logged in", () => {
    expect(can(null, "orders")).toBe(false);
  });

  it("denies a null section rather than defaulting open", () => {
    expect(can(mod({ orders: "full" }), null)).toBe(false);
  });
});

describe("isReadOnly", () => {
  it("is true only when the section is readable but not writable", () => {
    expect(isReadOnly(mod({ orders: "view" }), "orders")).toBe(true);
    expect(isReadOnly(mod({ orders: "full" }), "orders")).toBe(false);
    expect(isReadOnly(mod({}), "orders")).toBe(false);   // no access at all
    expect(isReadOnly(owner, "orders")).toBe(false);
  });
});

describe("firstAllowedPath", () => {
  it("sends a moderator to a page they can actually open", () => {
    expect(firstAllowedPath(mod({ gallery: "view" }))).toBe("/admin/gallery");
  });

  it("prefers the dashboard when it is granted", () => {
    expect(firstAllowedPath(mod({ dashboard: "view", gallery: "view" })))
      .toBe("/admin");
  });

  it("returns null when nothing is granted", () => {
    expect(firstAllowedPath(mod({}))).toBeNull();
  });
});
