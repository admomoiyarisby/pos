# Prevention guards for double-entry stock inflation

## Context

A stock-count audit of **Omoiyari Royal Plaza** on 2026-10-05 found the POS
disagreeing with physical stock on three items, with the system on the
**over-counting** side for the packaging:

| Item                               | POS   | Physical        | Gap    |
| ---------------------------------- | ----- | --------------- | ------ |
| Paper Bowl 650 ml                  | 434   | 404             | +30    |
| Roll Kertas Nota                   | 16    | 11              | +5     |
| Simple Syrup (found while tracing) | 4,000 | 3,000 delivered | +1,000 |

The ledger is internally consistent — `inventory.quantity` equals the last
`stock_ledger.balance` for every ingredient at that branch — so nothing was
corrupted. Two distinct defects both amount to **the same movement being
recorded twice**.

### Defect 1 — duplicate lines on a transfer, both credited

`MT/CENTRAL/041026/06` listed Simple Syrup on two separate item rows
(`sort_order` 15 qty 1,000 and `sort_order` 26 qty 3,000, both `unit_price` 16).
`finish-receive` iterates item rows and credits each one independently, so the
receiver branch received **4,000 ml against 3,000 ml delivered**. There was no
unique constraint on `(scm_transfer_id, ingredient_id)` and no application
check, so nothing stopped the second line.

### Defect 2 — a physical shortage was not representable

The receiving form pre-filled each line's `Diterima` input with the **promised**
quantity:

```ts
received: it.receivedQuantity ?? it.quantity,
```

Submitting the form without touching a field therefore always meant "received
everything, in full". Validation then required
`received + rejected === quantity`, so the only way to record a shortage was to
edit every line by hand — and the path of least resistance recorded a perfect
delivery. The database shows this was universal: **across all 22 transfers,
every received line is credited at 100% and `rejected_quantity` is 0
everywhere.** Not one partial receipt has ever been recorded.

The consequence is structural. A POS-vs-physical gap on any received item is
invisible to the system because the receiving path has nowhere to put it, and
`inventory` drifts above what actually arrived — at every outlet, indefinitely.

### The same shape in production records

While tracing the rice variance at the same branch, two cooking batches turned
out to be recorded twice:

| productionDate   | notes           | id         | created        | Nasi Putih |
| ---------------- | --------------- | ---------- | -------------- | ---------- |
| 2026-10-02 16:00 | Masak nasi pagi | `232cf7d4` | 10-03 00:50:41 | +6,900     |
| 2026-10-02 16:00 | Masak nasi pagi | `3b2682c3` | 10-03 00:51:32 | +6,900     |
| 2026-10-03 16:00 | Masak malam     | `5698667d` | 10-04 03:57:53 | +2,300     |
| 2026-10-03 16:00 | Masak malam     | `f89936b3` | 10-04 05:45:41 | +2,300     |

Inputs were identical in each pair. The second _Masak nasi pagi_ drove `Beras`
to **−72**, which is only possible if the same batch was submitted twice — you
cannot cook 2,646 g of rice from grain you do not have. Each duplicate credited
a whole phantom batch.

A separate finding from the same audit: Royal Plaza has **no realized Stock
Opname since 2026-09-28** (three SOs stuck at `Submitted`, `realized_at` null),
so the variance was recorded but never reconciled against a physical baseline.

## Decision

Four guards. Each blocks a specific observed mechanism, and none of them
changes the negative-stock policy.

### 1. One item line per ingredient per transfer (database-enforced)

`UNIQUE (scm_transfer_id, ingredient_id)` on `scm_transfer_items`
(`stxi_transfer_ingredient_unique`, migration 0060), plus an application check
in `createMutasiTransferCore` that names the offending ingredients so the sender
can merge the lines. The constraint is the real guarantee — an application-only
check is bypassable, which is how the Simple Syrup pair got in.

Migration 0060 merges any pre-existing duplicate lines, summing quantities into
the earliest-`sort_order` row, so every document total is unchanged. It
**refuses to run** if a duplicate group disagrees on `unit_price`, since
resolving that is a finance decision, not a migration decision. The already
generated `scm_transfer_invoices.line_items` snapshot is deliberately not
rewritten: an issued invoice is a frozen historical document.

### 2. Receiving starts at zero, and full acceptance is recorded

The `Diterima` default changes from `it.quantity` to `0`. A shortcut button
(_"Terima semua sesuai janji"_) fills every line with the promise, so the bulk
case stays one click — but it is now a decision the receiver makes in front of
them rather than a default they submit past.

Accepting every line in full with nothing rejected now requires an explicit
confirmation (mirroring the existing J-incident guard on the reject side), which
asks whether anything was actually counted. Answering "not counted" writes
`acceptedWholeWithoutCount`, which lands two places:

- the transfer's **own audit trail** (`scmTransferAuditLog.note`), committed
  atomically with the stock effect inside the transition;
- a **`Warning`** row in `systemLogs`, so a later POS-vs-physical gap on that
  delivery has a searchable cause instead of looking like a mystery.

The flag is never inferred server-side. A receiver who counts and finds the
count matches is not flagged.

### 3. Duplicate-production detection with confirmation

`createYieldConversionCore` refuses a submission that matches an existing
Active record on **all four** of: branch, `productionDate`, normalized notes,
and the full item multiset (fingerprinted on content, not row order, with float
noise trimmed). Throwing `DuplicateProductionError` re-opens the form with a
_"ini batch terpisah?"_ prompt; confirming re-sends the identical payload with
`confirmDuplicate: true`.

All four signals are required together so false positives stay near zero: two
outlets, or two genuine batches on one date, do not share free-text notes _and_
an identical input/output multiset. The guard **delays** a duplicate rather than
forbidding it, because refusing outright would contradict ADR 0012 — a stale
stock card must never block recording a production that physically happened.

The check runs before the transaction opens, so a refused duplicate leaves stock
untouched. A `Cancelled` record does not match, so re-recording a batch after
cancelling a mistaken one — the correct recovery — still works.

### 4. A supporting index

`yield_conversions_branch_date_idx`, partial on `status = 'Active' AND
deleted_at IS NULL`, since the lookup runs on every production submission.

## Explicitly not decided here

**Negative stock stays legal.** The audit found `Nasi Putih` at −103 and `Beras`
at −72 at Royal Plaza, and a hard block is tempting. But negative stock is
standing policy — ADR 0012 decision 2 rejects hard-fail on insufficient OUT
stock precisely so a stale card cannot block reality, and POS deductions and
manual adjustment behave the same way. The duplicate guard catches the _cause_
of the Beras −72 (it was a double-submission); changing the policy is a separate
decision with its own trade-offs.

## Consequences

- A transfer can no longer list the same ingredient twice, through any write path.
- A physical shortage at receiving is now a normal, cheap thing to record.
- "We didn't count" is attributable — the document says so.
- A duplicate production submission costs one extra click instead of silently
  inflating stock by a whole batch.
- The three existing Royal Plaza SO sheets still need to be realized, and the
  duplicate rice batches still need cancelling via the normal Yield
  Cancellation flow. This ADR prevents recurrence; it does not repair history.
- The Simple Syrup over-credit from `MT/CENTRAL/041026/06` is **not** corrected
  by migration 0060 — merging the item rows leaves the already-written `IN`
  ledger rows alone. Correcting that stock needs a separate, explicit data fix.

## References

- Audit of Royal Plaza, 2026-10-05 (`stock_ledger`, `waste_entries`,
  `audit_logs`, `scm_transfer_items`).
- ADR 0012 — production writes Kartu Stok; owns the negative-stock policy this
  ADR deliberately leaves alone.
- ADR 0018 — rejected-at-receiving stock returns to source; supplies the
  rejection path a real partial receipt now flows into.
- ADR 0006 — Mutasi Stok FSM; owns `finish-receive` and the document audit log.
- ADR 0015 — server-function core extraction; the guards live in the `*Core`
  functions so the flow tests drive the real logic.
- Migration `0060_prevention_guards.sql`.
