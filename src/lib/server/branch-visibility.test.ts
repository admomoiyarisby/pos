import { describe, expect, it } from "vite-plus/test";
import { getEffectiveBranchId, isBranchVisible } from "./branch-visibility";

const BRANCH_A = "11111111-1111-4111-8111-111111111111";
const BRANCH_B = "22222222-2222-4222-8222-222222222222";
const BRANCH_C = "33333333-3333-4333-8333-333333333333";
const UNKNOWN_BRANCH = "99999999-9999-4999-8999-999999999999";

describe("isBranchVisible", () => {
  it.each([
    {
      name: "central read without a branch scope",
      linkedBranchIds: [BRANCH_A],
      currentBranchId: undefined,
      expected: true,
    },
    {
      name: "menu configured for all branches",
      linkedBranchIds: [],
      currentBranchId: BRANCH_A,
      expected: true,
    },
    {
      name: "single-branch menu at its allowed branch",
      linkedBranchIds: [BRANCH_A],
      currentBranchId: BRANCH_A,
      expected: true,
    },
    {
      name: "single-branch menu at another branch",
      linkedBranchIds: [BRANCH_A],
      currentBranchId: BRANCH_B,
      expected: false,
    },
    {
      name: "multi-branch menu at its first allowed branch",
      linkedBranchIds: [BRANCH_A, BRANCH_B],
      currentBranchId: BRANCH_A,
      expected: true,
    },
    {
      name: "multi-branch menu at its second allowed branch",
      linkedBranchIds: [BRANCH_A, BRANCH_B],
      currentBranchId: BRANCH_B,
      expected: true,
    },
    {
      name: "multi-branch menu at an unlisted branch",
      linkedBranchIds: [BRANCH_A, BRANCH_B],
      currentBranchId: BRANCH_C,
      expected: false,
    },
    {
      name: "menu linked to an unknown branch at another branch",
      linkedBranchIds: [UNKNOWN_BRANCH],
      currentBranchId: BRANCH_A,
      expected: false,
    },
  ])("returns $expected for $name", ({ linkedBranchIds, currentBranchId, expected }) => {
    expect(isBranchVisible(linkedBranchIds, currentBranchId)).toBe(expected);
  });
});

describe("getEffectiveBranchId", () => {
  it.each([
    {
      role: "super_admin" as const,
      sessionBranchId: undefined,
      requestedBranchId: BRANCH_A,
      expected: BRANCH_A,
    },
    {
      role: "admin_pusat" as const,
      sessionBranchId: undefined,
      requestedBranchId: BRANCH_B,
      expected: BRANCH_B,
    },
    {
      role: "super_admin" as const,
      sessionBranchId: undefined,
      requestedBranchId: undefined,
      expected: undefined,
    },
    {
      role: "admin_pusat" as const,
      sessionBranchId: BRANCH_A,
      requestedBranchId: BRANCH_B,
      expected: BRANCH_B,
    },
    {
      role: "branch_admin" as const,
      sessionBranchId: BRANCH_A,
      requestedBranchId: BRANCH_B,
      expected: BRANCH_A,
    },
    {
      role: "branch_admin" as const,
      sessionBranchId: BRANCH_A,
      requestedBranchId: undefined,
      expected: BRANCH_A,
    },
    {
      role: "area_manager" as const,
      sessionBranchId: BRANCH_A,
      requestedBranchId: BRANCH_B,
      expected: BRANCH_A,
    },
    {
      role: "central_kitchen" as const,
      sessionBranchId: undefined,
      requestedBranchId: BRANCH_B,
      expected: undefined,
    },
  ])(
    "resolves $role to the expected branch scope",
    ({ role, sessionBranchId, requestedBranchId, expected }) => {
      expect(
        getEffectiveBranchId({
          role,
          sessionBranchId,
          requestedBranchId,
        }),
      ).toBe(expected);
    },
  );
});
