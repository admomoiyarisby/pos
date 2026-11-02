/**
 * Per-item HPP allocation behind the finance page's HPP drill-down.
 *
 * The ledger's HPP column is `SUM(orders.totalCogs)` — COGS frozen at sale
 * time. A breakdown built by re-resolving today's BOM does not sum to it, so
 * the parts were historically rescaled by one day-wide factor. That blurred
 * per-transaction differences: two lines of the same recipe with different
 * modifiers, or bought at different ingredient prices, shared a single factor.
 *
 * This module scales each line to its own frozen COGS instead
 * (`cogsAtTransaction × quantity`), then rounds with the largest-remainder
 * method so the rendered rupiah sum exactly to the per-item target total.
 * Whatever the day total still exceeds that sum is *not* smeared over
 * ingredients — the caller reports it separately as unallocated (manual sales
 * with no items, post-hoc `totalCogs` edits, unusable costs).
 *
 * Pure: no DB, no clock — unit-tested in `finance-hpp.test.ts`.
 */

export interface HppItemInput {
  /** Resolved composition of one order line (current ingredient costs). */
  ingredients: ReadonlyArray<{
    ingredientId: string;
    ingredientName: string;
    cost?: number;
  }>;
  /** Per-unit COGS frozen on the line at sale time. */
  cogsAtTransaction: number;
  /** Ordered quantity of the line. */
  quantity: number;
}

export interface HppShare {
  ingredientId: string;
  name: string;
  cost: number;
}

export interface HppAllocation {
  /** Sorted by cost, descending. Sums to `allocated` exactly. */
  rows: HppShare[];
  /** Σ `cogsAtTransaction × quantity` over lines that had a usable pool. */
  allocated: number;
}

/**
 * Scale each line's ingredient shares to that line's frozen COGS, aggregate
 * across lines, and round to whole rupiah.
 *
 * Lines with no resolved cost, or with a non-positive target, contribute
 * nothing — their COGS stays unallocated rather than inventing an ingredient
 * split. Costs are clamped at 0 because an exclusion can make a share negative.
 */
export function allocateHppShares(items: readonly HppItemInput[]): HppAllocation {
  const totals = new Map<string, { name: string; cost: number }>();
  let targetTotal = 0;

  for (const item of items) {
    const shares: HppShare[] = [];
    let pool = 0;
    for (const ing of item.ingredients) {
      const cost = Math.max(0, ing.cost ?? 0);
      if (cost === 0) continue;
      pool += cost;
      shares.push({ ingredientId: ing.ingredientId, name: ing.ingredientName, cost });
    }

    const target = Math.max(0, item.cogsAtTransaction * item.quantity);
    if (pool === 0 || target === 0) continue;

    const scale = target / pool;
    targetTotal += target;
    for (const share of shares) {
      const cost = share.cost * scale;
      const existing = totals.get(share.ingredientId);
      if (existing) {
        existing.cost += cost;
      } else {
        totals.set(share.ingredientId, { name: share.name, cost });
      }
    }
  }

  if (totals.size === 0) return { rows: [], allocated: 0 };

  const roundedTarget = Math.round(targetTotal);
  const cents = [...totals.entries()]
    .sort((a, b) => b[1].cost - a[1].cost)
    .map(([ingredientId, agg]) => ({
      ingredientId,
      name: agg.name,
      cost: Math.floor(agg.cost),
      frac: agg.cost - Math.floor(agg.cost),
    }));

  // Largest-remainder: floor everything, then give the leftover rupiah to the
  // biggest fractions. Dumping the difference into the largest row instead can
  // drive it negative when a heavily deflated scale produces many tiny shares.
  let leftover = roundedTarget - cents.reduce((s, c) => s + c.cost, 0);
  const byFraction = [...cents].sort((a, b) => b.frac - a.frac);
  for (let i = 0; leftover > 0; i++, leftover--) {
    byFraction[i % byFraction.length].cost += 1;
  }

  return {
    rows: cents.map((c) => ({ ingredientId: c.ingredientId, name: c.name, cost: c.cost })),
    allocated: roundedTarget,
  };
}
