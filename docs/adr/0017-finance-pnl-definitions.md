# 0017 — Canonical Finance Definitions (Omzet, Gross Profit, Operating Profit)

## Context

The finance numbers were computed with four different mental models that drifted apart:

1. **Daily ledger** (`getDailyFinanceSummary`) — `grossProfit = omzet − hpp`, with manual revenue _and_ expenses both ignored (manual entries lived in a memo-only "Manual" column).
2. **Period summary** (`getFinanceSummary`) — `grossProfit = netSales − cogs − manualExpenses`: subtracted opex (mislabeling operating profit as gross profit), included manual **expenses** but excluded manual **revenue**, and used `netSales` while the ledger used `totalAmount`.
3. **Dashboard** (`computeSalesByBranch`) — counted `manualRevenues` as revenue; `/finance` didn't.
4. **Void orders** — the ledger deliberately summed _all_ orders including `Void` (to match shift-cash math), inflating omzet; the dashboard filtered to `Completed`.

**Manual entries are notes, not sales.** Initially this ADR proposed an `includeInPnl` intent flag on `manual_revenues`/`channel_revenues` so entries could count toward omzet. That was reverted before merging: the business confirmed manual inputs are **memo notes only** — records of payouts, adjustments, and observations — and never represent sales the POS missed. They must never enter omzet or any profit figure.

## Decision

All finance surfaces (daily ledger, period summary, PDF report, dashboard) derive from **one canonical set of definitions**:

```
gross_sales     = Σ orders.totalAmount          (status ≠ 'Void', not deleted)
discount        = Σ orders.merchantDiscount
mdr             = Σ orders.mdrFee
omzet           = Σ orders.netSales             (net of discount + MDR)
                — OR the daily_overrides omzet value when present (replaces, not adds)
hpp             = Σ orders.totalCogs            (same non-void filter)
GROSS PROFIT    = omzet − hpp
opex            = Σ operationalExpenses         (all rows, waste-derived included)
OPERATING PROFIT= GROSS PROFIT − opex
```

1. **Omzet is net.** The headline "Omzet" is what the branch actually nets after merchant discount and MDR. The omzet breakdown shows the derivation: Gross → − Diskon Merchant → − MDR → Net, so the gross components are visible but never the headline.
2. **Manual entries are memo-only.** `manual_revenues`, `channel_revenues`, and button-entered `operational_expenses` never enter omzet, Gross Profit, or Operating Profit. Manual **expenses** DO count as opex in Operating Profit (they are real cash out); manual **revenue** is a pure memo line, shown in the Manual column and the omzet breakdown for reference only. No intent flag exists — if a sale happens, it belongs in the POS as an order.
3. **Voids are excluded but visible.** `Void` orders are excluded from every finance aggregate. The omzet breakdown shows the void count and amount so the "why is this lower than the POS journal" question stays answerable. Shift-cash math keeps its own rules — it must continue counting cash that physically entered the drawer, void or not.
4. **Gross Profit = omzet − HPP. Opex never touches it.** What the old summary computed (subtracting expenses) is now **Operating Profit**, shown alongside Gross Profit. This restores the standard P&L layering.
5. **One waste policy.** Waste-derived `operationalExpenses` rows count as opex everywhere. The Manual breakdown column may still distinguish "input via buttons" from "system-generated (waste)" visually, but the P&L aggregates use the full table.
6. **Single source.** The daily ledger query (`getDailyFinanceSummary`) computes the canonical per-day rows; the period summary and PDF consume the same definitions. Per-day rows must sum to the period summary.

## Considered Options

- **Keep omzet = `totalAmount` (gross) everywhere** (rejected) — the summary's net basis was correct for a multi-channel restaurant: MDR and merchant discounts are real cash leaks, and platform payout reconciliation only works against net.
- **Include manual revenue in omzet via an `includeInPnl` flag** (superseded) — implemented, then reverted before merge: the business clarified manual inputs are notes, not sales. Folding them in would double-count or invent revenue.
- **Add manual revenue unconditionally** (rejected) — double-counts payout-reconciliation memos.
- **Include voids, as before** (rejected) — omzet inflated by cancelled sales; the "deliberate" rationale only ever served shift-cash reconciliation, which keeps its own math.
- **A SQL view shared by all queries** (deferred) — the right long-term home, but the definitions live in one TypeScript module today and a view adds migration surface without changing the contract; revisit when a third consumer needs the exact aggregate.

## Consequences

- Gross Profit on `/finance` is exactly `omzet − HPP` from orders; entering a manual revenue note never moves it. The Manual column is honestly a memo column.
- The period summary/PDF change shape: Gross Profit loses the opex subtraction, and Operating Profit appears. Historical reports printed before this ADR used the old (misnamed) formula.
- Omzet numbers drop wherever merchant discounts/MDR existed, and drop further by excluding voids — comparisons with pre-ADR daily rows are not apples-to-apples.
- The dashboard still counts `manualRevenues` in "sales" (pre-existing behavior); it should be aligned to this ADR — treat that as a known follow-up, not a license to change `/finance`.
- `getOmzetBreakdown` shows the discount/MDR derivation, the memo manual revenue, and the void count so the headline stays auditable.
- The `include_in_pnl` columns and migration 0051 were removed before merge; no deployed database ever carried them.

## References

- ADR 0015 — server-function core pattern used by the finance functions.
- ADR 0013 — waste → `operationalExpenses` linkage (the "waste-derived opex" rows).
- CONTEXT.md — Waste (categories), Shift (cash reconciliation stays separate).
