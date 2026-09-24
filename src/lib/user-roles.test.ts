import { describe, expect, it } from "vite-plus/test";
import { canManageUser, roleRank } from "./user-roles";

describe("role hierarchy", () => {
  it("ranks super_admin above every other role", () => {
    expect(roleRank("super_admin")).toBeGreaterThan(roleRank("admin_pusat"));
    expect(roleRank("admin_pusat")).toBeGreaterThan(roleRank("area_manager"));
    expect(roleRank("area_manager")).toBeGreaterThan(roleRank("central_kitchen"));
    expect(roleRank("central_kitchen")).toBeGreaterThan(roleRank("branch_admin"));
  });

  it("ranks unknown roles at 0", () => {
    expect(roleRank("owner")).toBe(0);
    expect(roleRank("")).toBe(0);
  });

  it("lets super_admin manage everyone including peers", () => {
    for (const target of [
      "super_admin",
      "admin_pusat",
      "area_manager",
      "central_kitchen",
      "branch_admin",
    ]) {
      expect(canManageUser("super_admin", target)).toBe(true);
    }
  });

  it("blocks managing strictly higher roles", () => {
    expect(canManageUser("admin_pusat", "super_admin")).toBe(false);
    expect(canManageUser("area_manager", "admin_pusat")).toBe(false);
    expect(canManageUser("area_manager", "super_admin")).toBe(false);
    expect(canManageUser("branch_admin", "area_manager")).toBe(false);
  });

  it("allows peers and lower roles", () => {
    expect(canManageUser("admin_pusat", "admin_pusat")).toBe(true);
    expect(canManageUser("admin_pusat", "area_manager")).toBe(true);
    expect(canManageUser("area_manager", "branch_admin")).toBe(true);
  });

  it("blocks promotions above the actor", () => {
    expect(canManageUser("admin_pusat", "area_manager", "super_admin")).toBe(false);
    expect(canManageUser("admin_pusat", "area_manager", "admin_pusat")).toBe(true);
    expect(canManageUser("super_admin", "admin_pusat", "super_admin")).toBe(true);
  });

  it("fails closed on unknown roles", () => {
    expect(canManageUser("owner", "branch_admin")).toBe(false);
    expect(canManageUser("super_admin", "owner")).toBe(false);
    expect(canManageUser("super_admin", "branch_admin", "owner")).toBe(false);
  });
});
