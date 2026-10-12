import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { branches, ingredients, inventory, ingredientBranches } from "#/db/schema";
import { db } from "./db";
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

/**
 * Of the given ingredient ids, the ones that are NOT in one branch's catalog,
 * each named so a warning can be read.
 *
 * The write-side counterpart of the read-time marker. Every creation point
 * (Mutasi transfer, delivery note) calls this before stock lands, so the
 * disagreement is reported while it is still free to fix. A Central destination
 * has no catalog gate and returns nothing.
 *
 * WARN, NEVER BLOCK: every production case of this shape was a legitimate
 * movement ("stock awal"), so a gate would have stopped real work.
 */
export async function outsideBranchCatalogItems(
  branchId: string,
  ingredientIds: string[],
): Promise<Array<{ ingredientId: string; ingredientName: string }>> {
  const uniqueIds = [...new Set(ingredientIds)];
  if (uniqueIds.length === 0) return [];

  const [branch] = await db
    .select({ type: branches.type })
    .from(branches)
    .where(eq(branches.id, branchId))
    .limit(1);
  // Not an Outlet, or an unknown branch: no catalog gate to fall outside of.
  if (branch?.type !== "Outlet") return [];

  const catalogRows = await db
    .select({ id: ingredients.id })
    .from(ingredients)
    .where(branchCatalogClause({ branchId, isOutlet: true }));
  const inCatalog = new Set(catalogRows.map((r) => r.id));

  const outsideIds = uniqueIds.filter((id) => !inCatalog.has(id));
  if (outsideIds.length === 0) return [];

  const nameRows = await db
    .select({ id: ingredients.id, name: ingredients.name })
    .from(ingredients)
    .where(inArray(ingredients.id, outsideIds));
  const nameById = new Map(nameRows.map((r) => [r.id, r.name]));

  return outsideIds.map((id) => ({
    ingredientId: id,
    ingredientName: nameById.get(id) ?? id,
  }));
}
