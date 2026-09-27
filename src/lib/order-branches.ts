// ============================================================
// Order branch options — derived from the orders in view
// ============================================================

/**
 * The subset of an order row the branch options depend on.
 *
 * Structural so it accepts both the API row and a hand-built test fixture
 * without the caller having to construct a full order.
 */
export interface OrderBranchLike {
  branchId: string;
  branchName: string | null;
}

export interface BranchOption {
  id: string;
  name: string;
}

/**
 * Distinct branches present in a set of orders, labelled with their name and
 * sorted alphabetically.
 *
 * Derived from the orders already in view rather than from the full branch
 * list, so the dropdown only offers branches that actually have orders in the
 * current date range — and it needs no extra query.
 *
 * Keyed by `branchId` rather than by name so two branches sharing a name stay
 * distinct, and orders whose branch could not be resolved (a null name) are
 * skipped instead of appearing as an empty option. Sorted with the `id`
 * collation so Indonesian names order the way a reader expects, and so the
 * order does not shift between SSR and the browser.
 */
export function orderBranchOptions(orders: readonly OrderBranchLike[]): BranchOption[] {
  const byId = new Map<string, string>();
  for (const order of orders) {
    if (order.branchName && !byId.has(order.branchId)) {
      byId.set(order.branchId, order.branchName);
    }
  }
  return [...byId.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "id"));
}
