# 0017 — Canonical Finance Definitions (Omzet, Gross Profit, Operating Profit)

## Context

The finance numbers were computed with four different mental models that drifted apart:

1. **Daily ledger** (`getDailyFinanceSummary`) — `grossProfit = omzet − hpp`, with manual revenue _and_ expenses both ignored (manual entries lived in a memo-only "Manual" column).
2. **Period summary** (`getFinanceSummary`) — `grossProfit = netSales − cogs − manualExpenses`: subtracted opex (mislabeling operating profit as gross profit), included manual **expenses** but excluded manual **revenue**, and used `netSales` while the ledger used `totalAmount`.
3. **Dashboard** (`computeSalesByBranch`) — counted `manualRevenues` as revenue; `/finance` didn't.
4. **Void orders** — the ledger deliberately summed _all_ orders including `Void` (to match shift-cash math), inflating omzet; the dashboard filtered to `Completed`.

Additionally, nobody could say whether a manual/channel revenue entry was _incremental sales the POS never captured_ or _a memo of a payout the POS already recorded_ — so manual revenue was safely (but wrongly) excluded everywhere on `/finance`.

## Decision

All finance surfaces (daily ledger, period summary, PDF report, dashboard) derive from **one canonical set of definitions**:

```
gross_sales     = Σ orders.totalAmount          (status ≠ 'Void', not deleted)
discount        = Σ orders.merchantDiscount
mdr             = Σ orders.mdrFee
omzet           = Σ orders.netSales             (net of discount + MDR)
                + Σ manual revenue where includeInPnl
                — OR the daily_overrides omzet value when present (replaces, not adds)
hpp             = Σ orders.totalCogs            (same non-void filter)
GROSS PROFIT    = omzet − hpp
opex            = Σ operationalExpenses         (all rows, waste-derived included)
OPERATING PROFIT= GROSS PROFIT − opex
```

1. **Omzet is net.** The headline "Omzet" is what the branch actually nets after merchant discount and MDR. The omzet breakdown shows the derivation: Gross → − Diskon Merchant → − MDR → Net, so the gross components are visible but never the headline.
2. **Manual revenue counts, with intent.** `manual_revenues` and `channel_revenues` gain an `includeInPnl boolean NOT NULL DEFAULT true` flag. Entries are _incremental sales_ by default (per the FRD's "manual omzet" concept); a memo-only entry (e.g. Gofood payout reconciliation duplicating POS orders) can be flipped off. Only `includeInPnl` entries enter omzet; all entries always appear in the Manual breakdown column.
3. **Voids are excluded but visible.** `Void` orders are excluded from every finance aggregate. The omzet breakdown shows the void count and amount so the "why is this lower than the POS journal" question stays answerable. Shift-cash math keeps its own rules — it must continue counting cash that physically entered the drawer, void or not.
4. **Gross Profit = omzet − HPP. Opex never touches it.** What the old summary computed (subtracting expenses) is now **Operating Profit**, shown alongside Gross Profit. This restores the standard P&L layering.
5. **One waste policy.** Waste-derived `operationalExpenses` rows count as opex everywhere. The Manual breakdown column may still distinguish "input via buttons" from "system-generated (waste)" visually, but the P&L aggregates use the full table.
6. **Single source.** The daily ledger query (`getDailyFinanceSummary`) computes the canonical per-day rows; the period summary and PDF consume the same definitions. Per-day rows must sum to the period summary.

## Considered Options

- **Keep omzet = `totalAmount` (gross) everywhere** (rejected) — the summary's net basis was correct for a multi-channel restaurant: MDR and merchant discounts are real cash leaks, and platform payout reconciliation only works against net.
- **Exclude manual revenue from omzet permanently, memo-only** (rejected) — understates gross profit by every incremental sale the POS never captured, which is the common case for TikTok/phone orders.
- **Add manual revenue unconditionally** (rejected) — double-counts payout-reconciliation memos; without an intent flag there is no way to distinguish the two entry kinds.
- **Include voids, as before** (rejected) — omzet inflated by cancelled sales; the "deliberate" rationale only ever served shift-cash reconciliation, which keeps its own math.
- **A SQL view shared by all queries** (deferred) — the right long-term home, but the definitions live in one TypeScript module today and a view adds migration surface without changing the contract; revisit when a third consumer needs the exact aggregate.

## Consequences

- Gross Profit on `/finance` now moves with manual revenue entries flagged `includeInPnl` — the "Manual" column is no longer a lie by omission; it feeds the headline.
- The period summary/PDF change shape: Gross Profit loses the opex subtraction, and Operating Profit appears. Historical reports printed before this ADR used the old (misnamed) formula.
- Omzet numbers drop wherever merchant discounts/MDR existed, and drop further by excluding voids — comparisons with pre-ADR daily rows are not apples-to-apples.
- The dashboard and `/finance` now agree on what counts as revenue (flag-filtered manual included, voids excluded).
- `getOmzetBreakdown` gains the discount/MDR derivation lines and void count so the headline stays auditable.

## References

- ADR 0015 — server-function core pattern used by the finance functions.
- ADR 0013 — waste → `operationalExpenses` linkage (the "waste-derived opex" rows).
- CONTEXT.md — Waste (categories), Shift (cash reconciliation stays separate).
