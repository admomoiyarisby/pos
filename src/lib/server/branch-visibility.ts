import { sql, type SQL } from "drizzle-orm";
import type { PgTable, PgColumn } from "drizzle-orm/pg-core";

export type BranchVisibilityRole =
  | "super_admin"
  | "admin_pusat"
  | "area_manager"
  | "branch_admin"
  | "central_kitchen";

export interface EffectiveBranchOptions {
  role: BranchVisibilityRole;
  sessionBranchId: string | undefined;
  requestedBranchId: string | undefined;
}

/**
 * Resolve the branch used by a branch-aware read.
 *
 * Central admins can preview a selected branch from the POS. Branch-scoped
 * roles must remain bound to the branch in their authenticated session, even
 * if a client sends a different branch id.
 */
export function getEffectiveBranchId({
  role,
  sessionBranchId,
  requestedBranchId,
}: EffectiveBranchOptions): string | undefined {
  if (role === "super_admin" || role === "admin_pusat") {
    return requestedBranchId;
  }
  return sessionBranchId;
}

/**
 * Pure representation of the branch-link policy used by branchVisibleClause.
 * An empty link set means all branches; a non-empty set is an allow-list.
 */
export function isBranchVisible(
  linkedBranchIds: readonly string[],
  currentBranchId: string | undefined,
): boolean {
  if (!currentBranchId || linkedBranchIds.length === 0) return true;
  return linkedBranchIds.includes(currentBranchId);
}

export interface BranchVisibleOptions {
  /** The link table, e.g. `ingredientBranches` or `recipeBranches`. */
  linkTable: PgTable;
  /** The FK column on the link table pointing at the row, e.g. `ingredientBranches.ingredientId`. */
  linkRowId: PgColumn;
  /** The PK/reference on the main row, e.g. `ingredients.id`. */
  rowId: PgColumn;
  /** The branch column on the link table, e.g. `ingredientBranches.branchId`. */
  linkBranchId: PgColumn;
  /** The caller's branch id; falsy ⇒ no filtering (central users see all). */
  currentBranchId: string | undefined;
}

/**
 * Branch-visibility predicate for `ingredient_branches` / `recipe_branches`.
 *
 * Visibility model (ADR-0009 mirror / branch-visibility pattern used by
 * `getIngredients` and `getRecipes`): a row with ZERO link rows is visible
 * everywhere; otherwise it is visible only to the branches listed in its link
 * rows (NULL = all branches).
 *
 * Returns `undefined` when `currentBranchId` is falsy so callers can drop it
 * from the WHERE clause (an unscoped central read sees everything). Otherwise returns:
 *
 *   NOT EXISTS (no link rows for this row)
 *   OR EXISTS (a link row for this row AND that link's branch = currentBranchId)
 *
 * This is the canonical, drift-free replacement for the three duplicated
 * implementations that used to live inline in `ingredients.ts`, `pos.ts`, and
 * `recipes.ts`.
 */
export function branchVisibleClause(opts: BranchVisibleOptions): SQL | undefined {
  if (!opts.currentBranchId) return undefined;
  return sql`(NOT EXISTS (SELECT 1 FROM ${opts.linkTable} WHERE ${opts.linkRowId} = ${opts.rowId}) OR EXISTS (SELECT 1 FROM ${opts.linkTable} WHERE ${opts.linkRowId} = ${opts.rowId} AND ${opts.linkBranchId} = ${opts.currentBranchId}))`;
}
