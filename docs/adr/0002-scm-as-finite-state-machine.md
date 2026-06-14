# SCM as a Finite State Machine

## Context

The current SCM (Supply Chain Management) mechanism models the restocking lifecycle as 3 separate documents:

- `purchase_requisitions` (PR) — branch's request for stock
- `delivery_notes` (Surat Jalan, SJ) — central's shipment
- `scm_invoices` — central's bill for received stock

Each document has its own status enum:

- PR: `Draft, Pending, Approved, Processed, Rejected, Fulfilled`
- SJ: `Draft, Picking, In Transit, Partial Received, Received, Cancelled`
- Invoice: `Unpaid, Paid, Cancelled`

The lifecycle is **implicit**: a PR is created, "processed" (which may or may not create an SJ), the SJ is shipped, the branch receives it, the invoice is generated, and the invoice is paid. The transitions between these states are not formally defined anywhere — they exist as scattered `if (status === X)` checks in the server functions.

This leads to several problems:

1. **Skippable states.** A PR can go from `Draft` directly to `Processed` without going through `Approved`, because the code doesn't enforce the review step. Lesson 0002 §1 calls this out: "the PR can go from `Draft` directly to `Processed` without an `Approved` intermediate — because the code doesn't model the *review* step as a separate state."

2. **Inconsistent enum coverage.** The `prStatusEnum` includes a `Fulfilled` state, but no code path ever sets it, making it unreachable. Lesson 0001 §2 documents this gap.

3. **Cross-document invariants without enforcement.** The rule "invoice is based on received quantity" is implemented in `generateSCMInvoice` but only enforced by the call site, not by a schema or state machine. If a future code path forgets this, the invariant breaks silently.

4. **UI complexity.** Every state × actor combination requires its own component path, but the current code branches on status strings scattered across the UI. There is no single place to look up "what does the user see at state X?".

5. **No real-time consistency.** When CA reviews a PR, the BA is supposed to see CA's progress in real time. With the implicit state machine, this requires polling the relevant tables and reconciling three separate status enums. Lesson 0002 §3 makes this requirement explicit.

## Decision

Model the SCM restocking lifecycle as a **single unified document** (`scm_procurements`) with a **formal 10-state Finite State Machine (FSM)**. The current PR/SJ/Invoice tables are frozen as legacy (hidden from menu, accessible via direct URL).

### The 10 states

```
[*] → Draft → Pending → UnderReview → InTransit → Delivered → ReviewingSJ → WaitingForPayment → Finished
                                                                                              ↓
            Pending → Draft (BA withdraw)                          InTransit / Delivered /   ↓
                                                                  ReviewingSJ /              ↓
            UnderReview → Rejected (terminal)                     WaitingForPayment →        ↓
                                                                  Cancelled (terminal)       ↓
                                                                                             ↓
            Draft / Pending / UnderReview → Cancelled (no stock to reverse)
```

### The actors

- `branch_admin` (BA) — the destination branch's admin. Creates PRs, fills receiving forms, views invoice preview.
- `admin_pusat` (CA / Admin Pusat) — the central warehouse's admin. Reviews PRs, ships, marks delivered, generates invoices, marks paid.
- `super_admin` — emergency override, can do any transition.
- `area_manager` — read-only spectator (sees procurement state, cannot act on it).
- `central_kitchen` — does not interact with the procurement lifecycle.

### The transition table

| #  | From | Event | To | Primary actor | Effects |
|----|------|-------|----|--------------|---------|
| 1  | `[*]` | `create` | `Draft` | `branch_admin` | Insert procurement + items |
| 2  | `Draft` | `submit` | `Pending` | `branch_admin` | Set `submittedAt` |
| 3  | `Pending` | `open-review` | `UnderReview` | `admin_pusat` | Set `reviewingBy`, `reviewingAt` |
| 4  | `Pending` | `withdraw` | `Draft` | `branch_admin` | Audit log + reason |
| 5  | `UnderReview` | `reject` | `Rejected` | `admin_pusat` | Set `rejectedAt`, `rejectionReason` |
| 6  | `UnderReview` | `accept-and-ship` | `InTransit` | `admin_pusat` | Copy `readyQuantity` → `pickedQuantity`; write `in_transit_inventory`; set `shippedAt` |
| 7  | `InTransit` | `mark-delivered` | `Delivered` | `admin_pusat` | Move stock `in_transit_inventory` → `pending_review_inventory` |
| 8  | `Delivered` | `open-receive` | `ReviewingSJ` | `branch_admin` | Set `receivingBy`, `receivingAt` |
| 9  | `ReviewingSJ` | `finish-receive` | `WaitingForPayment` | `branch_admin` | Set `receivedQuantity`, `rejectedQuantity`, `reason`; generate invoice snapshot; set `receivedAt` |
| 10 | `WaitingForPayment` | `mark-paid` | `Finished` | `admin_pusat` | Set `invoice.paidAt`, `invoice.paidBy`; set `procurement.paidAt` |
| 11 | `InTransit` / `Delivered` / `ReviewingSJ` / `WaitingForPayment` | `cancel` | `Cancelled` | `admin_pusat` | Reverse stock per stage |
| 12 | `Draft` / `Pending` / `UnderReview` | `cancel` | `Cancelled` | `branch_admin` OR `admin_pusat` | Audit log; no stock reversal |

`super_admin` is allowed on every transition (emergency override). The `create` event (transition #1) is implemented as a separate `createProcurement()` server function that inserts a row in `Draft` state, not via `transition()`.

### The data model

5 new tables:

- `scm_procurements` — the root, 1 row per restocking process. Holds the 10-state enum and lifecycle timestamps.
- `scm_procurement_items` — the items, 1 row per ingredient per procurement. Holds the 5 quantity columns (`quantity`, `readyQuantity`, `pickedQuantity`, `receivedQuantity`, `rejectedQuantity`), the per-item decisions (`caDecision`, `baDecision`), price, and reason.
- `scm_procurement_audit_log` — 1 row per state transition and per in-state item edit.
- `scm_procurement_invoices` — the frozen invoice snapshot, generated at the `finish-receive` transition. 1:1 with `scm_procurements`.
- `pending_review_inventory` — a new ledger for stock that's been delivered to the branch but not yet received by the BA.

The 5 quantity columns live on a **single** `scm_procurement_items` row that travels through all 10 states. No splitting across PR-items and SJ-items.

The `in_transit_inventory` ledger is shared with the new flow (transition #6 writes to it; transition #11 may reverse it).

### The FSM module

A transition table (the "spec" of the FSM) lives in `src/lib/server/scm-fsm.ts`. A thin `transition(procurementId, event, payload, actor)` function dispatches to effect handlers in `src/lib/server/scm-effects.ts`. Authorization is enforced server-side inside `transition()` — the FSM is the security boundary, not the route guards.

In-state item edits (e.g., CA adjusting `readyQuantity` per item during `UnderReview`) are handled by a separate `updateItem(procurementId, itemId, patch, actor)` function. The audit log records these as `item-update` events.

### The UI

A single detail page (`/scm-procurements/$procurementId`) reads the procurement's `status` and the current actor's `role`, then renders the appropriate sub-component from a 16-component matrix (10 states × 3 actors, with many duplicates collapsed).

The "giant interactive table" pattern (lesson 0002 §5) is implemented as a single `<ScmItemTable mode={...} />` component where the `mode` prop determines columns, editability, and action buttons.

## Considered Options

### Option A — Coordination layer (rejected)

Keep the 3 tables and enums. Add a new aggregate status column/table that tracks the combined state. The FSM operates on the aggregate; each document keeps its own status for detail.

**Why rejected:** It keeps two state machines in sync (the aggregate FSM and each document's own status) and defeats the point of a formal FSM. The lesson 0002 §4 code example shows the explicit transition table — that's only possible with a unified model.

### Option B — Unified root document (chosen)

Make the `scm_procurements` table the root. Replace `prStatusEnum` with the new 10-state enum. SJ/Invoice become children of the procurement, created on specific transitions. Old PRs/SJs/Invoices stay frozen in legacy tables.

**Why chosen:** The transition table is a 1:1 map to lesson 0002 §2. The 5 quantity columns live on one row, not split across PR-items and SJ-items. The "giant interactive table" (lesson 0002 §5) is one component reading one item list. Audit trail is automatic.

### Option C — Extend the three enums in place (rejected)

Keep 3 separate documents, but graft new states onto each enum: PR gains `UnderReview`, SJ gains `Delivered` + `ReviewingSJ`, Invoice gains `WaitingForPayment` + `Finished`. The FSM is enforced in code that touches all three.

**Why rejected:** Each enum would carry vocabulary that doesn't belong to it (`UnderReview` on a PR is fine; `Delivered` on a SJ and `Finished` on an Invoice are awkward). Three separate enums means three separate state guards in every transition.

## Consequences

### Positive

- **Every state has one owner.** No "who's turn is it?" ambiguity.
- **The transition table is the single source of truth.** Replaces a hundred `if (status === X && role === Y)` checks with one function.
- **UI is derived from the FSM.** `actor × state → component`. Not the other way around.
- **Audit trail is automatic.** One `scm_procurement_audit_log` row per transition.
- **Adding new states is safe.** Add a row to the transition table, wire the effect, the rest doesn't change.
- **Real-time visibility is cheap.** BA seeing CA's review = client polls the procurement status and renders the read-only version of the same table.

### Negative

- **Old code paths stay reachable.** The PR/SJ/Invoice routes, `scm.ts` server functions, and old tables remain in the codebase (hidden from menu, accessible via direct URL). This is technical debt we accept.
- **Wider items table.** The 5 quantity columns mean `scm_procurement_items` is wider than the current `purchase_requisition_items` or `delivery_note_items`. Mitigated by the data flowing through one row, not two.
- **Reduced visibility for some roles.** `area_manager` and `central_kitchen` lose access to certain SCM routes (per the role mapping decision). Mitigated by direct URL access for `area_manager`.
- **Larger initial implementation.** 4 new tables, 16 new components, 7 build phases. This is a significant investment, justified by the architectural clarity.

## Sub-decision: Stock handling at `InTransit → Delivered` (option b)

When CA marks a procurement as "barang sudah dikirim" (transition #7, `mark-delivered`), the stock moves from `in_transit_inventory` to a new `pending_review_inventory` ledger at the destination branch. The stock is **not yet** in the Branch's main inventory; it is "at the Branch but awaiting BA's receiving review".

When BA completes the receiving review (transition #9, `finish-receive`), the `pending_review_inventory` is split:

- `receivedQuantity` moves to the Branch's main inventory.
- `rejectedQuantity` is written off as `waste` (or `return` if CA chooses to return to source).

### Alternatives considered

- **(a) Move optimistically**: at `mark-delivered`, the entire `pickedQuantity` is added to Branch inventory. Rejected qty later becomes `waste`. Simple but the Branch briefly has phantom stock.
- **(c) Hold until `finish-receive`**: at `mark-delivered`, the stock stays in `in_transit_inventory`. Cleanest ledger story but "Delivered" is a lie about physical reality.

### Why (b)

- Matches physical reality: stock IS at the Branch, just not yet inspected.
- Allows reporting on "stock pending review" — useful for the BA dashboard.
- Variance write-off at `finish-receive` is a clean `received → waste` ledger entry, not a retroactive correction.

### Ledger schema

`pending_review_inventory` columns: `id`, `scmProcurementId`, `branchId`, `ingredientId`, `quantity`, `createdAt`, `createdById`, `clearedAt`. One row per (procurement, ingredient), aggregated per branch/ingredient on read.

## References

- Lesson 0001: `lessons/0001-trace-scm-stock-flow.html` — the current implementation and its gaps.
- Lesson 0002: `lessons/0002-scm-as-finite-state-machine.html` — the proposed FSM model that this ADR implements.
- ADR 0001: `docs/adr/0001-stock-opname-inventory-adjustment.md` — an unrelated prior ADR for reference on the format.
