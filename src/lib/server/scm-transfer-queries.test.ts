import { describe, expect, it } from "vite-plus/test";
import { assertTransferAccess, canAmAct, canAmSee } from "#/lib/server/scm-transfer-queries";

const BRANCH_A = "11111111-1111-4111-8111-111111111111";
const BRANCH_B = "22222222-2222-4222-8222-222222222222";
const BRANCH_C = "33333333-3333-4333-8333-333333333333";

const transfer = {
  fromBranchId: BRANCH_A,
  toBranchId: BRANCH_B,
};

describe("Mutasi Stok branch permissions", () => {
  it("allows an area manager to act only when both branches are assigned", () => {
    expect(canAmAct({ assignedBranches: [BRANCH_A, BRANCH_B] }, transfer)).toBe(true);
    expect(canAmAct({ assignedBranches: [BRANCH_A, BRANCH_C] }, transfer)).toBe(false);
  });

  it("allows an area manager to see a transfer when either branch is assigned", () => {
    expect(canAmSee({ assignedBranches: [BRANCH_A] }, transfer)).toBe(true);
    expect(canAmSee({ assignedBranches: [BRANCH_C] }, transfer)).toBe(false);
  });

  it("restricts branch admins to transfers involving their branch", () => {
    expect(() =>
      assertTransferAccess(
        { id: "ba-1", role: "branch_admin", branchId: BRANCH_A },
        transfer,
        "view",
      ),
    ).not.toThrow();
    expect(() =>
      assertTransferAccess(
        { id: "ba-2", role: "branch_admin", branchId: BRANCH_C },
        transfer,
        "view",
      ),
    ).toThrow(/their branch/);
  });

  it("enforces the stricter area-manager action rule", () => {
    expect(() =>
      assertTransferAccess(
        { id: "am-1", role: "area_manager", assignedBranches: [BRANCH_A] },
        transfer,
        "view",
      ),
    ).not.toThrow();
    expect(() =>
      assertTransferAccess(
        { id: "am-1", role: "area_manager", assignedBranches: [BRANCH_A] },
        transfer,
        "act",
      ),
    ).toThrow(/cross-jurisdiction/);
  });

  it("rejects admin pusat and unrelated roles", () => {
    expect(() =>
      assertTransferAccess({ id: "ca-1", role: "admin_pusat" }, transfer, "view"),
    ).toThrow(/admin_pusat/);
    expect(() =>
      assertTransferAccess({ id: "cashier-1", role: "central_kitchen" }, transfer, "view"),
    ).toThrow(/not authorized/);
  });

  it("allows super admin to access every transfer", () => {
    expect(() =>
      assertTransferAccess({ id: "sa-1", role: "super_admin" }, transfer, "act"),
    ).not.toThrow();
  });
});
