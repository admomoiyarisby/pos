import { eq } from "drizzle-orm";
import { areaManagerBranches } from "#/db/schema";
import { db } from "#/lib/server/db";
import type { AppUser } from "./auth";

/**
 * Branch scope for read paths that can span branches.
 *
 * `undefined` means "all branches" (a central role with no filter); `[]` means
 * "none", so the caller can return an empty result without querying. `branch_admin`
 * is pinned to its session branch; `area_manager` only sees assigned branches and
 * an out-of-scope request is ignored rather than honored (the same rule as the
 * Stok Keluar and stock-recommendation reports).
 */
export async function scopedBranchIds(
  user: AppUser,
  requestedBranchId?: string,
): Promise<string[] | undefined> {
  if (user.role === "super_admin" || user.role === "admin_pusat") {
    return requestedBranchId ? [requestedBranchId] : undefined;
  }
  if (user.role === "area_manager") {
    const assigned = await db
      .select({ branchId: areaManagerBranches.branchId })
      .from(areaManagerBranches)
      .where(eq(areaManagerBranches.userId, user.id));
    const assignedIds = assigned.map((row) => row.branchId);
    if (assignedIds.length === 0) return [];
    return requestedBranchId && assignedIds.includes(requestedBranchId)
      ? [requestedBranchId]
      : assignedIds;
  }
  return user.branchId ? [user.branchId] : [];
}
