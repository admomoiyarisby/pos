import { describe, expect, it } from "vitest";
import { assertAdjustmentBranchScope, STOCK_ADJUSTMENT_ROLES } from "./stock-adjustment-scope";

const CENTRAL = "branch-central";
const OUTLET = "branch-outlet";
const OTHER = "branch-other";

describe("assertAdjustmentBranchScope", () => {
  it("lists exactly the roles the UI exposes the button to", () => {
    expect(STOCK_ADJUSTMENT_ROLES).toEqual(["super_admin", "admin_pusat", "area_manager"]);
  });

  it("lets super_admin adjust any branch", () => {
    expect(() =>
      assertAdjustmentBranchScope({ role: "super_admin" }, [CENTRAL, OUTLET], [CENTRAL]),
    ).not.toThrow();
  });

  it("scopes area_manager to assigned branches", () => {
    const actor = { role: "area_manager" as const, assignedBranches: [OUTLET, OTHER] };
    expect(() => assertAdjustmentBranchScope(actor, [OUTLET], [CENTRAL])).not.toThrow();
    expect(() => assertAdjustmentBranchScope(actor, [OUTLET, OTHER], [CENTRAL])).not.toThrow();
    expect(() => assertAdjustmentBranchScope(actor, [OUTLET, CENTRAL], [CENTRAL])).toThrow(
      "hanya bisa menyesuaikan stok cabang yang ditugaskan",
    );
  });

  it("rejects area_manager with no assignments", () => {
    expect(() =>
      assertAdjustmentBranchScope(
        { role: "area_manager", assignedBranches: [] },
        [OUTLET],
        [CENTRAL],
      ),
    ).toThrow("belum ditugaskan");
  });

  it("scopes admin_pusat to Central branches", () => {
    const actor = { role: "admin_pusat" as const };
    expect(() => assertAdjustmentBranchScope(actor, [CENTRAL], [CENTRAL])).not.toThrow();
    expect(() => assertAdjustmentBranchScope(actor, [CENTRAL, OUTLET], [CENTRAL])).toThrow(
      "hanya bisa menyesuaikan stok Central Warehouse",
    );
    expect(() => assertAdjustmentBranchScope(actor, [OUTLET], [])).toThrow(
      "Belum ada Central Warehouse",
    );
  });

  it("rejects roles outside the allow-list", () => {
    expect(() =>
      assertAdjustmentBranchScope(
        { role: "branch_admin", assignedBranches: [OUTLET] },
        [OUTLET],
        [CENTRAL],
      ),
    ).toThrow('role "branch_admin"');
    expect(() =>
      assertAdjustmentBranchScope({ role: "central_kitchen" }, [CENTRAL], [CENTRAL]),
    ).toThrow('role "central_kitchen"');
  });
});
