# 0030 — HPP Breakdown Scales Per Order Line and Keeps the Residual Explicit

> **Superseded in part by ADR 0031.** Cost is now frozen per ingredient row at
> sale time, the residual is reconciled per order, and `unallocated` is limited
> to orders with no line items. The per-line (never per-day) scaling principle
> and the explicit residual line remain in force.

## Context

The finance page shows HPP as `Σ orders.totalCogs` (ADR 0017 #1, ADR 0028 #2). The
drill-down ("Rincian HPP per Bahan") has to explain that number as a list of
ingredients, and the parts must add up to the column — otherwise finance cannot
trust either figure.

`orders.totalCogs` is frozen at sale time. It cannot be recomputed from today's
BOM: BOGO doubling, add-on modifiers, exclusions, hand-edited totals and
ingredient-price drift all shaped it. The previous implementation re-resolved
each item's persisted composition (current ingredient costs) and then applied
**one day-wide scale** to every share:

```
scale = SUM(orders.totalCogs) / SUM(resolved item costs)
```

That reconciled the totals, but it flattened per-transaction differences: if
one line's ingredients had gone up in price and another's had not, both were
shrunk/grown by the same factor. And because manual sales
(`createSalesRecord`) carry a typed `totalCogs` with **no items at all**, their
HPP was silently smeared over other lines' ingredients — a manual Rp 500,000
entry could inflate "Rice" on an unrelated order.

## Decision

1. **Scale per order line, not per day.** For each line, re-resolve its
   persisted composition (`order_item_ingredients`, ADR 0020) at current
   ingredient cost, then scale those shares so they sum to that line's own
   frozen COGS (`cogsAtTransaction × quantity`). `cogsAtTransaction` is per unit
   in both write paths (POS rounds `itemCogs / quantity`; Data Penjualan stores
   `recipes.totalCogs`).
2. **Round with largest remainder.** Floor every share, then hand the leftover
   rupiah to the largest fractional parts. Dumping the difference into the
   biggest row can drive it negative when a deflated scale produces many tiny
   shares; largest-remainder cannot.
3. **The residual is a named line, not a hidden inflation.** Whatever
   `SUM(orders.totalCogs)` still exceeds the allocated rows is returned as
   `unallocated` and rendered as "Tidak teralokasi" — covering manual sales
   without items, post-hoc `totalCogs` edits, lines with no usable cost, and
   rupiah rounding. `rows + unallocated` always equals the ledger's HPP column.
4. **Lines with no pool or no target contribute nothing.** Their COGS stays in
   `unallocated`; the breakdown never invents a composition.

The arithmetic lives in `src/lib/finance-hpp.ts` (`allocateHpp`) so it is
unit-testable without a database; the server function only resolves items,
looks up categories, and computes the residual.

## Alternatives rejected

- **Keep the day-wide scale.** Simplest, and totals still reconcile, but it
  attributes one line's price drift to another and lets item-less sales inflate
  real ingredients. The client asked for per-channel/per-item fidelity.
- **Sum item-level HPP and stop there.** The breakdown would no longer equal the
  HPP column whenever an order has no items or its total was edited — the
  original bug (parts not summing to the column).
- **Spread the residual proportionally across ingredients.** Keeps the
  ingredient list "complete" but hides money that has no composition. An
  explicit line is the honest attribution.

## Consequences

- A day whose HPP comes entirely from manual sales shows no ingredient rows and
  a single "Tidak teralokasi" line — correct, and visibly so.
- Two lines of the same recipe with different modifiers, or sold at different
  ingredient prices, now allocate independently.
- The breakdown runs one resolver call per order line. Same cost as before;
  batching is a separate optimisation if a day ever gets large enough to hurt.
- Percentages in the modal are shares of the day/channel HPP column
  (`totalCogs`), so the "Tidak teralokasi" row gets a percentage too.

## References

- ADR 0017 — canonical finance definitions (HPP = `Σ orders.totalCogs`)
- ADR 0020 — restores replay transaction-time consumption (the frozen snapshot)
- ADR 0028 — payout-based omzet; HPP stays POS COGS
- `src/lib/finance-hpp.ts`, `src/lib/finance-hpp.test.ts` — allocation + tests
- `src/lib/server/finance.ts` — `getDailyHppBreakdown`
