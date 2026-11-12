import { describe, expect, it } from "vite-plus/test";
import { USER_ACCESS_MESSAGE, userAccessDenial } from "./user-access";

describe("userAccessDenial", () => {
  it("allows an active, non-deleted user", () => {
    expect(userAccessDenial({ status: "Active", deletedAt: null })).toBeNull();
    expect(userAccessDenial({ status: "Active" })).toBeNull();
  });

  it("denies a suspended user even though the row still exists", () => {
    expect(userAccessDenial({ status: "Inactive", deletedAt: null })).toBe("inactive");
  });

  it("reports a tombstone as deleted rather than inactive", () => {
    // 0070 makes tombstoned users Inactive as well; deleted is the clearer
    // message for the user, so it wins.
    expect(userAccessDenial({ status: "Inactive", deletedAt: new Date() })).toBe("deleted");
    expect(userAccessDenial({ status: "Active", deletedAt: new Date() })).toBe("deleted");
  });

  it("treats a missing status as active (legacy rows predate the column)", () => {
    expect(userAccessDenial({ status: null, deletedAt: null })).toBeNull();
    expect(userAccessDenial({})).toBeNull();
  });

  it("has a user-facing message for every denial", () => {
    expect(USER_ACCESS_MESSAGE.deleted).toMatch(/dihapus/i);
    expect(USER_ACCESS_MESSAGE.inactive).toMatch(/dinonaktifkan/i);
  });
});
