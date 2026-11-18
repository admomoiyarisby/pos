# 0035 — Every Status Column Has an Explicit Lifecycle

## Context

Commit `5f9edc4` introduced the small-lifecycle helper and the order, shift,
stock-opname, invoice, voucher, recipe, ingredient, user, supplier-delivery
and return machines. A follow-up audit of every `*_status` column and every
status-writing server core found ten still-implicit machines:

| Entity                        | Statuses                                                          | Where it lived                                          |
| ----------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------- |
| Waste entry                   | Active → Cancelled                                                | `waste.ts` hardcoded string                             |
| Production (yield conversion) | Active → Cancelled                                                | `yield.ts` hardcoded string                             |
| Production cancel request     | Pending → Rejected / Executed                                     | `yield.ts` ad-hoc checks; `Approved` written on execute |
| Stock opname                  | Triggered → Submitted → Under Investigation → Approved → Realized | `inventory.ts` ad-hoc status lists                      |
| Accounting period             | Open → Closed                                                     | `finance.ts` hardcoded string                           |
| Brand                         | Active ⇄ Inactive                                                 | `brands.ts` hardcoded string                            |
| Purchase requisition (legacy) | Draft/Pending/Approved/Processed/Rejected/Fulfilled               | `scm.ts` target-status allow-lists only                 |
| Purchase order (legacy)       | Draft/Sent/Partial/Completed/Cancelled                            | `scm.ts` hardcoded strings                              |
| Delivery note (legacy)        | Draft/Picking/In Transit/Partial Received/Received/Cancelled      | `scm.ts` hardcoded strings                              |
| Stock transfer (legacy)       | Pending Approval/Approved/Rejected/In Transit/Completed/Cancelled | `scm.ts` hardcoded strings                              |

The ad-hoc checks were not equivalent to a table: several allowed jumps the
screens never offered, and several transitions that moved stock were not
atomic.

## Decision

Register each row above in `src/lib/lifecycles.ts` and make the server cores
call `.assert(...)` before writing. The generic invariant test in
`lifecycles.test.ts` now walks all nineteen machines (reachability, terminal
states, declared initial states, used events).

The stock opname table records the one deliberate backwards edge: a recount
saves counts while `Under Investigation`, which returns the sheet to
`Submitted` for re-review. Approval still never moves stock (ADR 0021);
`Realize` is the only stock-writing edge and is reachable only from
`Approved`.

## Bugs found and fixed

1. **Reject could overwrite a concurrent approval.** `rejectYieldCancelRequestCore`
   updated by id only. It now claims `status = Pending` in the same conditional
   update as approve, so an approval that already executed the request cannot
   be rewritten as Rejected.
2. **Duplicate pending production-cancel requests.** Two simultaneous requests
   both saw no Pending row and both inserted. The check and insert now share a
   transaction with `FOR UPDATE` on the production row.
3. **Approval recorded the wrong terminal state.** Approving a production
   cancel executes the cancellation, but the request was left at `Approved`
   even though the enum also has `Executed`. It now writes `Executed`, matching
   the cancel-request rule (migration 0067). The legacy `Approved` value remains
   in the enum for old rows but is never written.
4. **Double realize could apply the variance twice.** `realizeStockOpnameCore`
   read `Approved`, applied inventory/ledger rows, then flipped the status. Two
   concurrent realizes both succeeded. The whole realization now runs in one
   transaction whose first statement claims `Approved` + `realized_at IS NULL`;
   the loser gets "already realized" before touching stock.
5. **Stock-opname supervisors could cross branches.** Submit had no role check
   at all, and investigation/approval/count-update only checked branch admins.
   All transitions now share `assertStockOpnameBranchAccess`: branch admins
   their own branch, area managers assigned branches, Admin Pusat the central
   warehouse, super admins any.
6. **Soft-deleted documents kept moving.** Stock opnames and productions now
   refuse every transition once `deleted_at` is set.
7. **Non-atomic stock moves in legacy shipping.** Delivery-note ship/cancel and
   legacy stock-transfer ship/receive/cancel wrote inventory, the ledger, the
   in-transit row and the status in separate statements. Each is now one
   transaction with a `FOR UPDATE` document row, so a retry or double tap
   cannot deduct or restore the same quantity twice.
8. **Purchase-requisition jumps.** `updatePurchaseRequisitionCore` only
   allow-listed target statuses, so a Rejected or Fulfilled PR could be moved
   back into the flow. The target is now parsed as the real status enum and the
   PR lifecycle supplies the only legal event.
9. **Purchase orders could be cancelled twice.** Cancel now follows the
   lifecycle (`Draft/Sent/Partial → Cancelled`, once), instead of only refusing
   `Completed`.
10. **Opening/closing a period was not atomic.** The header and its opening or
    closing balances now commit together; close claims `Open` before inserting
    closing balances, so two admins cannot both create a closing set.
11. **Brand deactivation was silently idempotent.** A second deactivate now
    reports the illegal edge instead of writing `Inactive` again.

## Consequences

- Every status write in the audited modules now names the event it is firing;
  an illegal jump fails with the lifecycle's readable error.
- The two legacy document flows (PR/PO/SJ/stock transfer) still exist, so their
  tables are kept honest even though the sidebar points at the newer SCM
  procurements and Mutasi Stok.
- No schema change is required. The yield `Approved` enum value is retained for
  historical rows but is outside the live machine.
- Item-level decisions inside a procurement/transfer (`caDecision`,
  `baDecision`, received/rejected quantities) are intentionally not independent
  machines: the parent document FSM owns when they may be edited, and the item
  update is recorded as an `item-update` audit event.

## References

- `src/lib/lifecycles.ts`, `src/lib/lifecycles.test.ts`, `src/lib/lifecycle.ts`.
- `src/lib/server/waste.ts`, `yield.ts`, `inventory.ts`, `finance.ts`,
  `brands.ts`, `scm.ts`.
- ADR 0012 (production cancellation), ADR 0015 (user-parameterized cores),
  ADR 0021 (stock-opname realize), ADR 0002/0006 (document FSMs).
