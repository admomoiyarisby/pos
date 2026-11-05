/**
 * Per-order HPP allocation behind the finance page's HPP drill-down.
 *
 * The ledger's HPP column is `SUM(orders.total_cogs)` — COGS frozen at sale
 * time. The breakdown has to explain that figure with ingredients while never
 * disagreeing with it.
 *
 * Two sources of distortion are handled per order, not per day:
 *
 * 1. **Ingredient cost.** ADR 0031 stores each snapshot row's rupiah cost at
 *    sale time, so a new sale is exact. Rows written before that column keep
 *    their quantities but are re-priced at today's average cost; those lines
 *    are rescaled to their own `cogsAtTransaction × quantity`.
 * 2. **Order-level remainder.** Whatever `orders.total_cogs` still exceeds the
 *    order's item targets (per-unit rounding on POS lines, a hand-edited
 *    total) belongs to *that order*, so it is absorbed into that order's own
 *    ingredient shares. Only orders with no line items at all — the manual
 *    "Data Penjualan" path — remain unallocated.
 *
 * Scaling per item (never per day) is what keeps two lines of the same recipe,
 * with different modifiers or bought at different prices, from sharing one
 * factor. Signed quantities are preserved: an over-excluded ingredient nets
 * negative instead of being clamped, which would inflate every other share.
 *
 * Pure: no DB, no clock — unit-tested in `finance-hpp.test.ts`.
 */

export interface HppItemInput {
  /** Resolved composition of one order line. Costs may be negative (exclusions). */
  ingredients: ReadonlyArray<{
    ingredientId: string;
    ingredientName: string;
    cost?: number;
  }>;
  /** Per-unit COGS frozen on the line at sale time. */
  cogsAtTransaction: number;
  /** Ordered quantity of the line. */
  quantity: number;
  /** `"frozen"` = costs are already the sale-time values (ADR 0031). */
  costSource: "frozen" | "current";
}

export interface HppOrderInput {
  /** The order's frozen COGS (`orders.total_cogs`) — the reconciliation target. */
  totalCogs: number;
  items: readonly HppItemInput[];
}

export interface HppShare {
  ingredientId: string;
  name: string;
  cost: number;
}

export interface HppAllocation {
  /** Sorted by cost, descending. Sums to `allocated` exactly. */
  rows: HppShare[];
  /** Order COGS attributed to ingredients (after rounding). */
  allocated: number;
  /** Order COGS with no usable composition (manual sales, unusable costs). */
  unallocated: number;
}

interface MutableShare {
  name: string;
  cost: number;
}

function addShare(map: Map<string, MutableShare>, id: string, name: string, cost: number): void {
  const existing = map.get(id);
  if (existing) {
    existing.cost += cost;
  } else {
    map.set(id, { name, cost });
  }
}

/**
 * Net one line's signed ingredient costs. Returns `null` when the line carries
 * no cost at all (missing prices) so its COGS stays unallocated rather than
 * being invented.
 */
function netItemShares(item: HppItemInput): Map<string, MutableShare> | null {
  const net = new Map<string, MutableShare>();
  for (const ing of item.ingredients) {
    const cost = ing.cost ?? 0;
    if (cost === 0) continue;
    addShare(net, ing.ingredientId, ing.ingredientName, cost);
  }
  return net.size === 0 ? null : net;
}

const sumCosts = (map: Map<string, MutableShare>) => {
  let total = 0;
  for (const share of map.values()) total += share.cost;
  return total;
};

export function allocateHpp(orders: readonly HppOrderInput[], dayTotalCogs: number): HppAllocation {
  const totals = new Map<string, MutableShare>();
  let allocatedOrders = 0;

  for (const order of orders) {
    if (order.items.length === 0) continue; // item-less order -> unallocated

    const orderShares = new Map<string, MutableShare>();
    let orderResolved = 0;

    for (const item of order.items) {
      const net = netItemShares(item);
      if (!net) continue;

      const pool = sumCosts(net);
      if (pool === 0) continue;

      // Frozen costs are already the sale-time values; only legacy (re-priced)
      // lines need rescaling to the line's recorded COGS.
      let scale = 1;
      if (item.costSource === "current") {
        const target = Math.max(0, item.cogsAtTransaction * item.quantity);
        if (target === 0) continue;
        scale = target / pool;
      }

      orderResolved += pool * scale;
      for (const [id, share] of net) {
        addShare(orderShares, id, share.name, share.cost * scale);
      }
    }

    if (orderShares.size === 0 || orderResolved <= 0) continue;

    // Absorb the order's own remainder (rounding, edited total) here, before
    // it can leak into `unallocated`.
    const factor = order.totalCogs / orderResolved;
    for (const [id, share] of orderShares) {
      addShare(totals, id, share.name, share.cost * factor);
    }
    allocatedOrders += order.totalCogs;
  }

  if (totals.size === 0) {
    return { rows: [], allocated: 0, unallocated: dayTotalCogs };
  }

  const cents = [...totals.entries()]
    .filter(([, share]) => share.cost > 0)
    .sort((a, b) => b[1].cost - a[1].cost)
    .map(([ingredientId, share]) => ({
      ingredientId,
      name: share.name,
      cost: Math.floor(share.cost),
      frac: share.cost - Math.floor(share.cost),
    }));

  // Every ingredient netted non-positive (data anomaly, e.g. an exclusion
  // exceeding its BOM quantity). Nothing to render; the whole day is residual.
  if (cents.length === 0) {
    return { rows: [], allocated: 0, unallocated: dayTotalCogs };
  }

  // Largest-remainder rounding: floor every share, then give the leftover
  // rupiah to the biggest fractions. Dumping the difference into the largest
  // row instead can drive it negative when a deflated scale produces many tiny
  // shares.
  const roundedTarget = Math.round(allocatedOrders);
  let leftover = roundedTarget - cents.reduce((s, c) => s + c.cost, 0);
  const byFraction = [...cents].sort((a, b) => b.frac - a.frac);
  for (let i = 0; leftover > 0; i++, leftover--) {
    byFraction[i % byFraction.length].cost += 1;
  }

  const rows = cents.map((c) => ({ ingredientId: c.ingredientId, name: c.name, cost: c.cost }));
  const allocated = rows.reduce((s, r) => s + r.cost, 0);
  return { rows, allocated, unallocated: dayTotalCogs - allocated };
}

/**
 * One sold line, priced twice: what the ledger charged (`cogsAtTransaction`,
 * frozen at sale time) and what the same composition costs at today's ingredient
 * prices. Both are per ordered unit.
 */
export interface MenuCogsLine {
  recipeId: string;
  name: string;
  quantity: number;
  /** Per-unit COGS frozen on the line at sale time — the ledger's basis. */
  cogsAtTransaction: number;
  /** Per-unit COGS for the identical composition at today's average costs. */
  currentCogs: number;
}

export interface MenuCogsRow {
  recipeId: string;
  name: string;
  /** Units sold on the day. */
  quantity: number;
  /** Σ over the menu's lines of `cogsAtTransaction × quantity`. */
  cogsFrozen: number;
  /** The same lines at today's prices. */
  cogsCurrent: number;
  /** `cogsFrozen − cogsCurrent`: positive means the ledger charged more. */
  delta: number;
  /**
   * `delta / cogsCurrent`, or `null` when today's cost is zero/unknown — a
   * ratio against nothing is noise, and a menu that is now free is a different
   * bug than one that is 30× too expensive.
   */
  ratio: number | null;
}

/**
 * Per-menu reconciliation for the HPP drill-down: the ledger's frozen COGS next
 * to the same lines at today's prices.
 *
 * This is the view that answers "which menu is wrong" in one glance. A day whose
 * HPP was charged with a mispriced ingredient shows every menu containing that
 * ingredient with a large positive delta, while menus without it sit at ~0 — a
 * pattern no per-ingredient table can show, because the ingredient rows are
 * scaled to the (wrong) frozen total and therefore agree with it by
 * construction.
 *
 * Sorted by absolute delta: the biggest suspect first, then by name so equal
 * deltas keep a stable order between renders.
 *
 * Pure: no DB, no clock — unit-tested in `finance-hpp.test.ts`.
 */
export function compareMenuCogs(lines: readonly MenuCogsLine[]): MenuCogsRow[] {
  const byRecipe = new Map<string, MenuCogsRow>();

  for (const line of lines) {
    if (line.quantity <= 0) continue;
    const frozen = line.cogsAtTransaction * line.quantity;
    const current = line.currentCogs * line.quantity;
    const existing = byRecipe.get(line.recipeId);
    if (existing) {
      existing.quantity += line.quantity;
      existing.cogsFrozen += frozen;
      existing.cogsCurrent += current;
      continue;
    }
    byRecipe.set(line.recipeId, {
      recipeId: line.recipeId,
      name: line.name,
      quantity: line.quantity,
      cogsFrozen: frozen,
      cogsCurrent: current,
      delta: 0,
      ratio: null,
    });
  }

  const rows = [...byRecipe.values()].map((row) => {
    const cogsFrozen = Math.round(row.cogsFrozen);
    const cogsCurrent = Math.round(row.cogsCurrent);
    const delta = cogsFrozen - cogsCurrent;
    return {
      ...row,
      cogsFrozen,
      cogsCurrent,
      delta,
      ratio: cogsCurrent === 0 ? null : delta / cogsCurrent,
    };
  });

  return rows.sort((a, b) => {
    const byDelta = Math.abs(b.delta) - Math.abs(a.delta);
    return byDelta !== 0 ? byDelta : a.name.localeCompare(b.name);
  });
}
