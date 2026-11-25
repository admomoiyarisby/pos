import { eq, inArray, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { areaManagerBranches } from "#/db/schema";
import { db } from "#/lib/server/db";
import type { AppUser } from "./auth";

/**
 * Branch scope for read paths that can span branches.
 *
 * `undefined` means "all branches" (a central role with no filter); `[]` means
 * "none", so the caller can return an empty result without querying.
 * `branch_admin` is pinned to its session branch; `area_manager` and `auditor`
 * only see assigned branches and an out-of-scope request is ignored rather than
 * honored (the same rule as the Stok Keluar and stock-recommendation reports).
 */
export async function scopedBranchIds(
  user: AppUser,
  requestedBranchId?: string,
): Promise<string[] | undefined> {
  if (user.role === "super_admin" || user.role === "admin_pusat") {
    return requestedBranchId ? [requestedBranchId] : undefined;
  }
  if (user.role === "area_manager" || user.role === "auditor") {
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

/**
 * The branch predicate a read must apply, from the caller's scope rather than
 * from the `branchId` the client sent.
 *
 * Returns `undefined` only for a global role (no restriction). An empty
 * assignment becomes a false predicate instead of an unscoped query, so a
 * branch-scoped user with no branches sees nothing rather than everything —
 * the failure mode that matters when a read is opened to a new role.
 */
export async function scopedBranchCondition(
  user: AppUser,
  column: PgColumn,
  requestedBranchId?: string,
): Promise<SQL | undefined> {
  const branchIds = await scopedBranchIds(user, requestedBranchId);
  if (!branchIds) return undefined;
  if (branchIds.length === 0) return sql`false`;
  if (branchIds.length === 1) return eq(column, branchIds[0]);
  return inArray(column, branchIds);
}
