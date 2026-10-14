# 0024 — Per-Channel Omzet Real Comes from Input Revenue

## Context

The Per Channel breakdown on `/finance` showed Omzet Real as Σ
`orders.netSales` (POS-derived net, ADR 0017 #1), so every channel with POS
orders always displayed a value. The business rule is different: Omzet Real
is the payout figure typed into Input Revenue (Per Channel). A channel/day
with no input must show an empty cell — and an empty Margin, since margin is
computed from Omzet Real.

## Decision

- `getChannelPnl` LEFT JOINs `channel_revenues` (same branch/date scope) and
  returns `omzetReal: number | null` — null when no input row exists for that
  tanggal+channel — plus `margin: number | null`, computed as
  `(omzetReal − hpp) / omzetReal` and null when there is no (positive) input.
- POS-derived `netSales` stays on the row as reference/audit data; it is no
  longer displayed as Omzet Real.
- Day subtotals and the period total sum only cells that have inputs; their
  margin uses the HPP of those cells only, so channels that were not input
  yet do not drag down the margin of channels that were. With no inputs at
  all, both cells render empty.
- This supersedes ADR 0017 #1 **for this column only**: everywhere else,
  manual/channel revenue stays memo-only and never enters omzet or profit
  figures. The Per Channel Omzet Real is explicitly an input-driven
  reconciliation column, not a P&L aggregate.

## Consequences

- Channels without Input Revenue show "—" for Omzet Real and Margin % until
  someone inputs the payout — the empty state is the signal to do the input.
- Margin % can now move when a late input arrives; day/period margins are
  partial (input-scoped) until every channel is input.
- Historical reading changes: previously displayed POS-net values in this
  column were estimates, not inputs.

## References

- ADR 0017 — canonical finance definitions (memo-only rule, still in force
  except for this column).
- `getChannelPnl` (`src/lib/server/finance.ts`), `ChannelPnlSection`
  (`src/routes/_layout/finance/index.tsx`).
