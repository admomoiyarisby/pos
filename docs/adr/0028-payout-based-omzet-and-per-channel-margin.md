# 0028 — Reporting Omzet Is the Channel Payout, POS Net as Fallback

## Context

The `Ledger Harian` on `/finance` reported omzet as Σ `orders.netSales`
(ADR 0017 #1) unless a hand-typed `daily_overrides` row with field `omzet`
replaced the whole day. Meanwhile `channel_revenues` — the payout finance types
into "Input Revenue (Per Channel)" — was shown only in a separate sub-tab and
never fed the headline row.

Two consequences the client hit in production:

- The day row matched the manual nominal **only because someone had typed a day
  override equal to it**. On every other day the Omzet column showed the POS
  figure, so the margin looked far better than the money actually received.
- The margin was one global number. When one channel earned 40% and another 9%,
  the row could not say which channel carried the result.

`daily_overrides.omzet` also had no channel, so it could not answer "which
channel is weak" — the exact question being asked. The modelled `mdrFee`
(`platformFees.feePercentage` at sale time, `pos.ts:948`) is not the real
deduction: on 2026-09-26 the configured 20% differed from the payout by 18–41
percentage points per channel (Shopee 864,160 POS net vs 512,509 payout).

## Decision

1. **Omzet per channel/day = the payout input when one exists, otherwise
   Σ `orders.netSales` for that channel.** A payout is the money actually
   received — after commission, promos, vouchers and delivery — so MDR is
   **never** subtracted from it again. POS net remains the modelled audit
   column and the fallback, not a second omzet.
2. **HPP stays POS COGS** per channel (`Σ orders.totalCogs`, ADR 0017 #1).
3. **Margin is per channel**: `(omzet − hpp) / omzet`. It is null when omzet is
   not positive, and also when the channel has no POS orders — a payout-only
   row has no recorded HPP and must not read as a 100% margin. The same rule
   applies to a day/period with no POS orders at all: its gross profit is
   arithmetically equal to omzet, but its margin is shown as `—`. Day and
   period margins are weighted totals (`Σ gross / Σ omzet`) and are labelled
   "Margin (total)", never as a channel margin.
4. **The ledger day row is a parent; the expansion is the channel table.**
   Each line shows Omzet POS (net), the payout input, HPP, Gross Profit,
   Margin and Selisih (payout − net POS, i.e. the unmodelled deduction). The
   day total is Σ channel omzet plus any channel-less adjustment.
5. **The day-level `omzet` override is retired.** Channelless history is kept
   as a signed `daily_overrides` row with field `omzet_adjustment`, computed by
   migration `0064_omzet_override_to_adjustment.sql` so no day total moves:
   `adjustment = override − (Σ channel payouts + Σ POS net of channels without
a payout)`. An adjustment of exactly 0 is deleted — clearing the cell writes
   0 through `upsertDailyOverrideCore`, which removes the row. A channel filter
   never includes the adjustment: it cannot be attributed to one channel.
6. **The "Per Channel" sub-tab keeps ADR 0024 semantics** — Omzet Real is only
   the typed input, empty with a null margin until then. Its POS column is
   renamed "Penjualan POS" because it is `Σ totalAmount` (gross), not the net
   figure the ledger now calls Omzet POS.
7. **The printed report uses the same basis**: per-channel Omzet, HPP, Gross
   Profit and Margin, plus the adjustment row and the POS-net audit line.

This supersedes ADR 0017 #2 **for reporting omzet** (a `channel_revenues` payout
is a manual entry that now enters omzet). ADR 0017 remains true for POS-derived
figures, void handling, and memo-only `manual_revenues`/expenses.

## Migration cases

| case | state before                                  | migration result                                                              |
| ---- | --------------------------------------------- | ----------------------------------------------------------------------------- |
| A    | override equals Σ channel inputs (± rounding) | adjustment 0 → row dropped; day total unchanged and now explained per channel |
| B    | channel inputs exist but their sum differs    | adjustment = the unexplained remainder, on a channel-less row                 |
| C    | no channel inputs that day                    | adjustment = override − POS net of unpayout-ed channels                       |

No pro-rata distribution: inventing a channel split would manufacture the
attribution the report exists to provide. Dropping overrides would silently
change historical day totals; freezing them as a second display-only omzet
would recreate the two-numbers confusion.

## Consequences

- Day totals before and after the migration are identical (verified against the
  production probe query in the migration header).
- The gap between POS net and payout is now visible **per channel**; a positive
  gap (payout above modelled net) is highlighted because it usually means a
  typo or a platform subsidy.
- Days from case B/C still carry a channel-less adjustment. Finance can
  re-enter the split per channel later; until then those days' margins reflect
  only the channels that were input.
- Channels without a payout input silently use POS net. This is deliberate
  (client decision: keep the current fallback), and the `POS` badge on the row
  makes the basis visible.
- Payout-only channels (manual/offline sales) count toward omzet but show no
  margin, so the total margin can be overstated on those days. The row shows
  their HPP as 0 and their margin as `—`.
- `platform_fees` is now demonstrably stale (20% configured vs much higher
  effective deductions). Updating it is a separate operational task; it no
  longer affects reported omzet, only the POS-net audit column.

## References

- ADR 0017 — canonical finance definitions (superseded #2 for reporting omzet)
- ADR 0024 — per-channel Omzet Real from Input Revenue (retained)
- `src/lib/finance-pnl.ts` — pure aggregation shared by ledger, breakdown, print
- `drizzle/0064_omzet_override_to_adjustment.sql` — data migration
