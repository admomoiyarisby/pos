import { sql, type SQL } from "drizzle-orm";
import type { PgTable, PgColumn } from "drizzle-orm/pg-core";

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
 * from the WHERE clause (central users see everything). Otherwise returns:
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
