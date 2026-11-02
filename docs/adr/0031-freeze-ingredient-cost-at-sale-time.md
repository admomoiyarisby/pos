# 0031 — Freeze Ingredient Cost at Sale Time; Reconcile HPP per Order

## Context

ADR 0030 made the HPP breakdown scale each order line to its own frozen COGS
(`order_items.cogs_at_transaction × quantity`). That fixed the day-wide factor,
but three problems remained, all visible in the drill-down:

1. **Cost was never snapshotted.** ADR 0020 froze quantities in
   `order_item_ingredients` but left cost on the live `ingredients.average_cost`
   (`ingredient-resolver.ts`). Every report therefore re-priced history at
   today's price and compensated with a scale factor — an approximation that
   cannot be exact by construction.
2. **The residual line meant nothing.** `unallocated` was computed as
   `SUM(orders.total_cogs) − Σ line targets`. POS stores
   `cogs_at_transaction = round(itemCogs / quantity)` per unit, so
   `round(itemCogs / qty) × qty ≠ itemCogs` whenever `qty` does not divide the
   line COGS. A normal 3× line with `itemCogs = 1001` produced
   `unallocated = −1`. The line meant "rounding dust" on ordinary days, not
   "manual sales", so it could not be trusted.
3. **The residual was attributed a day late.** An order's own rounding or an
   edited `total_cogs` (`updateSalesRecord`) was pushed into the day-level
   residual even though the order did have a composition that could absorb it.

The breakdown also issued 4 queries per line (`resolvePersistedItemIngredients`
per item), which is ~800 round trips for a 200-line "Semua Cabang" day.

## Decision

1. **Snapshot cost per ingredient row.** `order_item_ingredients` gains
   `cost_at_transaction` (integer rupiah, nullable), written inside the sale
   transaction by both `createOrderCore` (POS) and
   `createSalesOrderCore` / `updateSalesOrderCore` (Data Penjualan). Null marks
   rows written before migration `0066`; those keep the current-cost path.
2. **Reconcile per order, not per day.** The breakdown groups lines by order.
   Frozen costs are used verbatim; legacy lines are rescaled to their own
   `cogs_at_transaction × quantity`; then the order's remaining gap
   (`orders.total_cogs − Σ line targets`) is absorbed into _that order's_
   shares. `unallocated` is therefore reserved for orders with **no line items
   at all** — the manual `createSalesRecord` path, and lines whose composition
   carries no usable cost.
3. **Signed netting, never clamping.** Snapshot quantities can be negative
   (exclusions). Per-ingredient costs are summed signed before scaling; a
   clamped negative would inflate every other share in the line.
4. **Batch resolution.** `resolvePersistedItemsIngredients(ids)` loads all
   snapshots, ingredient names and average costs in three queries and groups in
   memory. Items without a snapshot still fall back to the warned per-item live
   BOM path.
5. **The invariant survives rounding.** Rows are rounded with the
   largest-remainder method (never negative, sums exactly), and `rows +
unallocated === orders.total_cogs` still holds.

`allocateHpp(orders, dayTotalCogs)` in `src/lib/finance-hpp.ts` owns the
arithmetic and is unit-tested without a database.

## Consequences

- New sales produce an **exact** ingredient breakdown — no scaling at all.
- Pre-migration orders keep the ADR 0030 approximation (current cost rescaled
  to the line), now reconciled per order instead of per day.
- The "Tidak teralokasi" line now appears only when HPP genuinely has no
  composition (manual Data Penjualan entries, unusable costs). Ordinary POS
  days show Rp 0 residual.
- Cost of sale is now audit-stable: editing an ingredient's `average_cost`
  later no longer changes what a past sale is reported to have cost.
- Backfill is deliberately not attempted — the migration only adds the column.
  Historical rows stay null and keep the fallback.
- The JSON snapshots under `drizzle/meta/` are not tracked consistently in this
  repo; the journal + SQL pair is the source of truth
  (`scripts/check-migration-journal.mjs`).

## References

- ADR 0020 — transaction-time consumption snapshots (quantities)
- ADR 0030 — per-line scaling and the first `unallocated` line (superseded by
  #1–#3 here)
- `drizzle/0066_order_item_ingredient_cost.sql`
- `src/lib/finance-hpp.ts`, `src/lib/finance-hpp.test.ts`
- `src/lib/server/ingredient-resolver.ts` — snapshot + batch resolution
- `src/lib/server/finance.ts` — `getDailyHppBreakdown`
