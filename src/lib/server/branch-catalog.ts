import { and, eq, sql, type SQL } from "drizzle-orm";
import { ingredients, inventory, ingredientBranches } from "#/db/schema";
import { branchVisibleClause } from "./branch-visibility";

/**
 * "Which ingredients are in ONE branch's catalog" — the ONE definition.
 *
 * Before this module the question was answered in four places: the stock
 * opname trigger (flag gate + allow-list), the opname detail and print markers
 * (flag only), and the ingredient-master gap report (flag only). They drifted,
 * which is how a transfer could deliver an item the receiver never counts.
 *
 * A **Central** branch has no catalog gate at all — every ingredient is in
 * scope — so `branchCatalogClause` returns `undefined` and callers drop it from
 * the WHERE clause. That is the same convention `branchVisibleClause` uses.
 *
 * An **Outlet**'s catalog is two conditions ANDed:
 *
 *   1. `ingredients.is_branch_visible = true` — the branch-level flag
 *   2. the `ingredient_branches` allow-list for this branch
 *
 * SCOPE NOTE — the one deliberate asymmetry. The allow-list half is only
 * evaluable in SQL. `isOutsideBranchCatalog` and the gap report use the FLAG
 * half alone, because each runs per row without a query. Consequence: an item
 * flagged TRUE but restricted away by the allow-list sits outside the catalog
 * while showing no marker (4 live lines at the time of writing). Closing that
 * needs a per-row link lookup; both call sites document it.
 */
export function branchCatalogClause(opts: {
  branchId: string;
  isOutlet: boolean;
}): SQL | undefined {
  if (!opts.isOutlet) return undefined;
  return and(
    eq(ingredients.isBranchVisible, true),
    branchVisibleClause({
      linkTable: ingredientBranches,
      linkRowId: ingredientBranches.ingredientId,
      rowId: ingredients.id,
      linkBranchId: ingredientBranches.branchId,
      currentBranchId: opts.branchId,
    }),
  );
}

/**
 * Read-time counterpart of `branchCatalogClause` for the flag half only — no
 * query, no link lookup. TRUE when the branch is an Outlet and the ingredient
 * is flagged out of the branch catalog, i.e. the line is here because the
 * branch holds it, not because the catalog names it.
 */
export function isOutsideBranchCatalog(
  branchType: string | null | undefined,
  isBranchVisible: boolean | null | undefined,
): boolean {
  return branchType === "Outlet" && isBranchVisible === false;
}

/**
 * "This branch holds stock for this ingredient." Stock records are written by a
 * sale, a delivery, a transfer, waste, yield, or a manual adjustment, and none
 * of those paths reads the catalog flag — so holding and catalog membership are
 * independent facts, and this is the predicate for the first one.
 */
export function heldAtBranchClause(branchId: string): SQL {
  return sql`exists (select 1 from ${inventory} where ${inventory.ingredientId} = ${ingredients.id} and ${inventory.branchId} = ${branchId})`;
}
