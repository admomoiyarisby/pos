# 0018 — Rejected Stock Goes Home (Retur Barang), Not to the Waste Report

**Status**: accepted · **Supersedes**: ADR 0006 §"Rejected stock disposition (option a — waste at receiver)"

## Context

A branch receives goods from Central (Pengadaan) or from another branch (Mutasi Stok), inspects them, and rejects a line — wrong quantity, expired, broken. The receiver picks a disposition per line: **Return to Source** (send it back), **Scrap** (throw it away), or **Quarantine**.

ADR 0006 decided that the rejected quantity becomes a `waste_entries` row at the **receiver**, on the reasoning that the branch is the one physically sitting on the goods, and that a physical return was a separate concern to be handled out-of-band (the receiver would file a new Mutasi Stok with the roles reversed).

That decision was half-implemented and the half that was implemented is wrong.

1. **The stock was returned, but the label said Spoiled.** Issue #93 (2026-09-29) added the missing half: the rejected quantity is credited straight back to the source's `inventory`. But the `waste_entries` insert was left where it was — _unconditional, before the disposition check_. So every returned rejection produced a `category: 'Spoiled'` row at the receiver while the same units were simultaneously counted in the source's stock. One quantity, two places, and the receiver's Waste report claimed a loss that had not happened.
2. **The loss figure was Rp0.** The Pengadaan effect never set `valuation` on the waste row, so the report showed `Nilai Kerugian: Rp0` — a loss too small to be real and too large to be ignored. (The Mutasi effect did set it, so the two flows disagreed with each other.)
3. **Nothing distinguished the two cases.** `waste_entries` has no disposition field, so the report cannot tell a destroyed box from a box on its way home. A branch admin reviewing Waste had no way to know which rows were real losses.
4. **The out-of-band return never got built.** Nothing tracked the pickup, so nobody could act on it. The record was a permanent, unactionable `Spoiled` row.

The deeper problem is that "waste" and "return" are different facts wearing the same row. Waste is a **loss**: goods ceased to exist, and the loss belongs in Total Kerugian. A return is a **transfer in progress**: the goods still exist, are currently sitting on the wrong shelf, and the branch owes someone a truck ride. Only the first is a waste entry.

## Decision

A rejected line is a loss **only** when the goods are destroyed. Every other disposition is a **return**, tracked as its own thing.

**1. `scm_returns` — a new table for goods on their way home.**

```
scm_returns
  branchId           the receiver — physically holding the goods until pickup
  scmProcurementId   ┐ exactly one of these two (CHECK constraint)
  scmTransferId      ┘
  ingredientId, quantity (real), valuation
  disposition        'Return to Source' | 'Quarantine'
  status             'Pending' → 'PickedUp'
  createdById, createdAt, pickedUpBy, pickedUpAt
```

The source FK follows the shared-ledger pattern of `pending_review_inventory` (ADR 0002/0006): exactly one document FK, so a return always traces back to the delivery that produced it.

**2. The disposition effect splits three ways.** `writeRejectedDisposition` (Pengadaan) and `writeTransferRejectedDisposition` (Mutasi):

| Disposition                    | Stock                                | Record                                                                                    |
| ------------------------------ | ------------------------------------ | ----------------------------------------------------------------------------------------- |
| **Scrap**                      | none — goods gone                    | `waste_entries` at the receiver, `category: 'Spoiled'`, **valued** at `qty × averageCost` |
| **Return to Source** (default) | credited to the source's `inventory` | `scm_returns` at `Pending`                                                                |
| **Quarantine**                 | credited to the source's `inventory` | `scm_returns` at `Pending` (until a quarantine location exists)                           |

`Quarantine` is deliberately tracked as a return: the goods exist and are somewhere, so it is not a loss.

**3. Valuation, but not as loss.** `scm_returns.valuation` is `qty × averageCost` so the pickup list shows what is riding on the truck. It never reaches Total Kerugian, never creates an `operational_expenses` row, and is hidden from branch admins (same HPP rule as the Waste list). Conversely, a **Scrap** row is now valued — a real loss must carry a real number, which is why the Pengadaan effect sets `valuation` where it previously wrote 0.

**4. The loop is closed explicitly.** `Pending` means the branch still owes the pickup. The source confirms with `confirmScmReturnPickup` (`admin_pusat` / `super_admin` only) once the goods are physically back, which stamps `pickedUpAt` + `pickedUpBy` and closes the liability. `reopenScmReturn` is the inverse, for a confirmation made in error.

**This action moves no stock.** The quantity was credited to the source's inventory the instant the receiving was submitted. The confirmation only records that the box caught up with the number — which is the whole point: the number was always ahead of reality, and the gap is exactly what the return row exists to make visible.

**5. The Waste page now means "destroyed".** No `waste_entries` row is written for a non-Scrap rejection, so nothing needs filtering to make the report correct.

## Considered Options

- **Filter non-Scrap rows out of the Waste report** (a `disposition` column on `waste_entries`, rows excluded from totals). Rejected: it keeps modelling a transfer as a loss and then hiding it. Every future query against `waste_entries` — Total Kerugian, the branch report, the PDF, an export — becomes a place to forget the filter. The mistake was the record, not the report.
- **No list at all, just fix the report** (smallest change). Rejected: the branch still has a box on its shelf and no way to know it. The number would be home and the goods would not, silently, forever — the exact failure this ADR exists to close.
- **Record the return as a second, credit-side `stock_ledger` pair** instead of a new table. Rejected: the ledger is a stock movement log, and no movement happens on pickup. Overloading it would put a non-movement into the Kartu Stok invariant (`balance == inventory.quantity`) and make the ledger disagree with itself.
- **Let the branch confirm its own pickup** (rather than the source). Rejected: confirming asserts the goods reached the _source's_ warehouse, which is the source's fact to assert. A branch could otherwise discharge its liability by clicking a button.

## Consequences

- **The Waste report becomes trustworthy.** Every row is a real, valued loss. `Spoiled` at Rp0 is no longer a category, because a return no longer wears that label.
- **A new obligation exists, and it is visible.** A `Pending` return is an unpaid favour: Central's stock says the goods are home while they are on a branch shelf. The Retur Barang page (`/scm-returns`) lists it, per branch, with a value.
- **The physical gap is now somebody's job.** Nothing in the system can drive a truck, so the pickup stays a human task — but it is a task with a list, an owner, and a completion button, instead of a `Spoiled` row nobody reads.
- **History is backfilled conservatively** (migration 0057). Only procurement rejections whose notes carry the document code are migrated; rows with a free-text reason, and all Mutasi rejections, embed no reliable document link and are left alone rather than guessed at. Backfilled rows are seeded `PickedUp` because the source was already credited the quantity — opening every historical branch with a false debt would be its own kind of wrong. Anyone who knows a batch is still on a shelf reopens it in the UI.

## References

- ADR 0002 — `docs/adr/0002-scm-as-finite-state-machine.md` — the Pengadaan FSM and the `pending_review_inventory` ledger this table's FK pattern follows.
- ADR 0006 — `docs/adr/0006-mutasi-stok-as-finite-state-machine.md` — the superseded "waste at receiver" sub-decision and the Q13 question.
- ADR 0012 — `docs/adr/0012-production-yield-writes-kartu-stok.md` — the status-tombstone pattern (row preserved, effect reversed) reused by `reopenScmReturn`.
- CONTEXT.md: "Retur Barang", "Pending Review Inventory", "Waste (Waste Entry)".
