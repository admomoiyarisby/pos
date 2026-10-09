# Stock opname moves stock only on the 25th

## Context

The business rule, as stated by the owner:

1. Every stock opname **outside** the 25th of the month is a **note**. It can be
   triggered, counted, investigated, and approved, but it must not change stock.
2. Only the opname **dated the 25th** changes stock. Its counted values become
   the baseline for each item from that point on.

The system violated both halves:

- `approveStockOpnameCore` adjusted `inventory` and wrote an `SO Adjustment`
  ledger row for **every** opname, on any date (ADR 0001 made approval the
  stock-affecting step). A mid-month audit silently moved the books.
- `realizeStockOpnameCore` gated on **today's** wall-clock date being the 25th,
  not the opname's own date. So a mid-month opname that happened to be realized
  on the 25th _did_ change stock, while a 25th-dated opname realized on the 26th
  was refused.
- Because approve had already applied the correction, realize **re-applied** it.
  That is a no-op while nothing moves, but any movement between approve and
  realize (sales, deliveries, adjustments) was reverted to the day-of-count
  value — the double-application hazard discussed in review.

## Decision

**Approve is a review step. Realize is the only step that moves stock, and only
for an opname dated the 25th.**

1. `approveStockOpnameCore` writes no inventory change, no ledger row, and no
   negative-stock alert. It keeps the status transition, the blank-submit
   guard, the drift report, and the change **preview** (measured against current
   inventory, exactly what realize will apply — ADR 0001's measurement rule).
   The approval notification now says the stock has not changed yet.
2. `realizeStockOpnameCore` loads the opname and guards on its **own** date:
   `day-of-month === 25`, plus a **cycle** guard — the opname's `YYYY-MM` must
   not be in the future, since realizing next month's opname today would apply
   a count of a cycle that has not started. Within its own month a 25th opname
   may be realized **any day** (a branch that counts continuously realizes the
   month's opname on the 10th, not only on the 25th). Everything else is
   unchanged — the counted items are applied with the ADR 0020 upsert/clamp
   fixes, `SO Realization` ledger rows are written, `realizedAt`/`realizedBy`
   are stamped.
3. `getStockOpnameDetail`'s change summary now hinges on `realizedAt`, not the
   Approved status — "Sudah diterapkan ke stok" only after realize.
4. UI copy follows: the approve button is "Setujui Opname" (was "Setujui &
   Sesuaikan"), the approve modal states approval does not change stock, the
   realize button says it applies to stock and is shown only for 25th-dated
   opnames, non-25th opnames render a "hanya catatan" note, and the trigger
   modal explains the date rule before the opname is created.

## Consequences

- Mid-month opnames are now what the business already treats them as: pure
  audit records. Counting them can never move the books.
- The 25th opname is the single, visible stock correction of the month, written
  as `SO Realization` rows on Kartu Stok.
- Approve no longer produces ledger rows, so `SO Adjustment` is a legacy note
  text from historical rows only.
- Known residual (unchanged, flagged): realize still applies the counted value
  against the _live_ books (ADR 0001). If stock legitimately moves between the
  25th count and a later realize day, those movements are absorbed into the
  `SO Realization` row — the same "point-in-time value applied to later books"
  pattern as the drift discussion. The drift report at approve surfaces it; a
  realize-time drift guard is the natural follow-up.
- Revision (Oct 10): the first cut refused any opname dated later than
  _today_, which blocked the real workflow of realizing the month's 25th
  opname before the 25th arrives. The guard is now by **cycle**: any day
  inside the opname's own month is allowed; only a future month's opname is
  refused. The UI mirrors the same rule so the button is never shown for an
  opname the server would refuse.
- Tests in `stock-opname-flow.integration.test.ts` were rewritten to the new
  contract, including a new case asserting a non-25th opname changes nothing and
  its realize is refused.

## Supersedes

ADR 0001, decision 1 ("approval adjusts inventory") and the approval-time
stock effects described there. ADR 0001's _measurement_ rule (adjust against
current inventory, not the frozen trigger snapshot) still stands and is what
both the approve preview and the realize application use.
