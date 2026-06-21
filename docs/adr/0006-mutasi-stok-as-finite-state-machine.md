# Mutasi Stok as a Finite State Machine

## Context

The current `stock_transfers` mechanism (in `src/lib/server/scm.ts` and `src/routes/_layout/stock-transfers/`) models branch-to-branch stock movement as a **flat 5-state document** with a single quantity column, no per-item review, no invoice, and no per-state audit trail:

- States: `Pending Approval → Approved → In Transit → Completed`, plus `Rejected` and `Cancelled`.
- 1 row per transfer = 1 ingredient. No item table.
- No `Delivered` intermediate, no `ReviewingSJ`, no `WaitingForPayment`, no `Finished`.
- The "Surat Jalan" exists only as a status string (`Approved` / `In Transit`); there is no formal document.
- Authorization is scattered: AM approves, Admin Pusat ships, BA receives, Admin Pusat cancels — with no central transition table.

The client clarified the desired business flow (recorded in the original conversation, summarised in ADR scope):

1. Negotiation between two branches + Area Manager happens off-system (WhatsApp / F2F).
2. The **Sender Branch** (the branch that agreed to give up stock) creates the Surat Jalan. There is no "request" step; the SJ itself is the initiating action.
3. The **Area Manager** of the Sender+Receiver pair **approves** the SJ.
4. The **Receiver Branch** sees the SJ only after AM approval. They mark it `Delivered` when goods physically arrive, then perform **per-item review** (accept/reject each line).
5. An **Invoice** is generated from the receiver's review, visible to Sender, Receiver, and AM.
6. The Receiver pays the Sender; the SJ ends in `Finished`.
7. The Area Manager can only oversee transfers where both endpoints are in their `assignedBranches`.

This flow is structurally similar to the SCM Procurement (Pengadaan) flow (ADR 0002) — same FSM shape, same item-level review, same invoice snapshot — but with branch-level actors and an AM-as-approver (rather than CA-as-approver). It deserves the same **single-root-document + 10-state FSM** treatment, not a status-enum patch on the existing `stock_transfers` table.

## Decision

Model **Mutasi Stok** as a **single unified document** (`scm_transfers`) with a **formal 10-state Finite State Machine (FSM)**, parallel to (and structurally similar to) the Pengadaan FSM in ADR 0002. The new table lives alongside `scm_procurements` — not a shared table with a discriminator (per Q1). The legacy `stock_transfers` table is frozen as legacy (hidden from menu, accessible via direct URL).

### The 10 states

```
[*] → SuratJalanDraft → PendingAMReview → Approved → InTransit
    → Delivered → ReviewingSJ → WaitingForPayment → Finished
                                                                   ↓
        SuratJalanDraft / PendingAMReview / Approved                ↓
              → Cancelled (no stock to reverse)                    ↓
                                                                   ↓
        InTransit / Delivered / ReviewingSJ / WaitingForPayment    ↓
              → Cancelled (stock reversed per stage)               ↓
                                                                   ↓
        PendingAMReview → Rejected (terminal)                      ↓
                                                                   ↓
        PendingAMReview / Approved                                  ↓
              → SuratJalanDraft (Sender BA withdraw)               ↓
```

State names mirror Pengadaan where the semantics match (`InTransit`, `Delivered`, `ReviewingSJ`, `WaitingForPayment`, `Finished`, `Rejected`, `Cancelled`). The two early states diverge because Mutasi has no PR phase: `SuratJalanDraft` replaces Pengadaan's `Draft`, and `PendingAMReview` collapses Pengadaan's `Pending` + `UnderReview` into one (the AM sees the SJ immediately on submit). A new `Approved` state is introduced because approval and shipping are *separate* steps in Mutasi (AM is not the one with the goods).

### The actors

- `branch_admin` (BA) at the **Sender** branch — creates the SJ draft, submits to AM, ships, marks invoice paid, can withdraw back to draft.
- `branch_admin` (BA) at the **Receiver** branch — sees the SJ from `Approved` onward, marks Delivered, opens receive, finishes receive (sets per-line received/rejected qty).
- `area_manager` (AM) — approves or rejects from `PendingAMReview`; cancels from late states (`InTransit` onwards); sees all SJs touching at least one of their `assignedBranches`, but can *act* on an SJ only if **both** branches are in their `assignedBranches`.
- `super_admin` — emergency override on every transition.
- `admin_pusat` — **not an actor** in Mutasi. They have no business relationship with branch-to-branch transfers (Q1, Q4).

### The transition table

| #  | From                                                                | Event              | To                  | Primary actor                | Effects                                                                                            |
| -- | ------------------------------------------------------------------- | ------------------ | ------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------- |
| 1  | `[*]`                                                               | `create`           | `SuratJalanDraft`   | `branch_admin` (sender)      | Insert transfer + items; snapshot `unitPrice` from `inventory.averageCost` at `fromBranchId`      |
| 2  | `SuratJalanDraft`                                                   | `submit`           | `PendingAMReview`   | `branch_admin` (sender)      | Set `submittedAt`; soft stock check (warn if any line exceeds sender's current inventory)          |
| 3  | `SuratJalanDraft`                                                   | `cancel`           | `Cancelled`         | `branch_admin` (sender)      | Audit log + reason; no stock reversal                                                              |
| 4  | `PendingAMReview`                                                   | `approve`          | `Approved`          | `area_manager`               | Set `reviewingById`, `approvedAt`                                                                  |
| 5  | `PendingAMReview`                                                   | `reject`           | `Rejected`          | `area_manager`               | Set `rejectedAt`, `rejectionReason`                                                                |
| 6  | `PendingAMReview`                                                   | `withdraw`         | `SuratJalanDraft`   | `branch_admin` (sender)      | Audit log; `withdrawnAt` timestamp                                                                 |
| 7  | `PendingAMReview`                                                   | `cancel`           | `Cancelled`         | `branch_admin` (sender) OR `area_manager` | Audit log + reason; no stock reversal                                                  |
| 8  | `Approved`                                                          | `ship`             | `InTransit`         | `branch_admin` (sender)      | **Strict** stock check; decrement sender's `inventory`; write `in_transit_inventory` (with `scmTransferId` set); set `shippedAt` |
| 9  | `Approved`                                                          | `withdraw`         | `SuratJalanDraft`   | `branch_admin` (sender)      | Audit log; `withdrawnAt`; AM must re-approve                                                       |
| 10 | `Approved`                                                          | `cancel`           | `Cancelled`         | `branch_admin` (sender) OR `area_manager` | Audit log + reason; no stock reversal (goods not yet moved)                              |
| 11 | `InTransit`                                                         | `mark-delivered`   | `Delivered`         | `branch_admin` (receiver)    | Move `in_transit_inventory` → `pending_review_inventory` (with `scmTransferId` set); set `deliveredAt` |
| 12 | `InTransit`                                                         | `cancel`           | `Cancelled`         | `area_manager`               | Reverse `in_transit_inventory` → sender's `inventory`                                              |
| 13 | `Delivered`                                                         | `open-receive`     | `ReviewingSJ`       | `branch_admin` (receiver)    | Set `receivingById`                                                                                |
| 14 | `Delivered`                                                         | `cancel`           | `Cancelled`         | `area_manager`               | Reverse `pending_review_inventory` → sender's `inventory`                                          |
| 15 | `ReviewingSJ`                                                       | `finish-receive`   | `WaitingForPayment` | `branch_admin` (receiver)    | Set per-line `receivedQuantity`, `rejectedQuantity`, `reason`; move `pending_review_inventory` → receiver's `inventory` (received) or `waste_entries` (rejected); generate invoice snapshot; set `receivedAt` |
| 16 | `ReviewingSJ`                                                       | `cancel`           | `Cancelled`         | `area_manager`               | Reverse `pending_review_inventory` → sender's `inventory`                                          |
| 17 | `WaitingForPayment`                                                 | `mark-paid`        | `Finished`          | `branch_admin` (sender)      | Set `invoice.paidAt`, `invoice.paidById`; set `transfer.paidAt`, `paidById`                        |
| 18 | `WaitingForPayment`                                                 | `cancel`           | `Cancelled`         | `area_manager`               | Reverse receiver's `inventory` → sender's `inventory`; mark invoice as cancelled                   |
| -  | `Rejected`, `Finished`, `Cancelled`                                 | (terminal)         | -                   | -                            | -                                                                                                  |

`super_admin` is allowed on every transition (emergency override). The `create` event (transition #1) is implemented as a separate `createMutasiTransfer()` server function that inserts a row in `SuratJalanDraft` state, not via `transition()`.

### The data model

**4 new tables:**

- `scm_transfers` — the root, 1 row per Mutasi transfer. Holds the 10-state enum and lifecycle timestamps.
- `scm_transfer_items` — the items, 1 row per ingredient per transfer. Holds `quantity` (sender-set), `receivedQuantity`/`rejectedQuantity` (receiver-set at `finish-receive`), `unitPrice` (snapshot from sender's `inventory.averageCost` at item-creation time), and `reason` (per-line rejection reason, required iff `rejectedQuantity > 0`).
- `scm_transfer_audit_log` — 1 row per state transition and per in-state item edit. Mirrors `scm_procurement_audit_log`.
- `scm_transfer_invoices` — the frozen invoice snapshot, generated at the `finish-receive` transition. 1:1 with `scm_transfers`. Holds `totalAmount` (= sum of `receivedQuantity × unitPrice` across all items), `paidAt`, `paidById`, and creation metadata.

**2 schema updates to existing tables:**

- `in_transit_inventory` gains a nullable `scmTransferId` FK column. A check constraint enforces: exactly one of `deliveryNoteId`, `scmProcurementId`, `scmTransferId` is set per row.
- `pending_review_inventory` gains a nullable `scmTransferId` FK column, with the same pattern.

**1 frozen table:**

- `stock_transfers` is frozen as legacy. Existing rows remain readable via direct URL (`/stock-transfers/$trId`), but the menu hides them. No new rows are created in this table.

### The FSM module

A transition table (the "spec" of the FSM) lives in `src/lib/server/scm-transfer-fsm.ts`. A thin `transition(transferId, event, payload, actor)` function dispatches to effect handlers in `src/lib/server/scm-transfer-effects.ts`. The module is **structurally identical to `scm-fsm.ts`** (ADR 0002), so the same `transition()` shape and same authorization-pattern code can be reused — only the table name, the event names, and the actor list differ.

In-state item edits (e.g., Receiver BA setting `receivedQuantity` per item during `ReviewingSJ`) are handled by a separate `updateItem(transferId, itemId, patch, actor)` function. The audit log records these as `item-update` events.

**Effect handler reuse:** the stock-reversal helpers from Pengadaan (`reverseInTransitOnCancel`, `reversePendingReviewOnCancel`) can be **parameterized** over the root FK column (`scmProcurementId` vs `scmTransferId`) and reused verbatim. The `writeInTransitInventory` and `moveStockToPendingReview` effects can be shared with a thin wrapper that supplies the right FK. The `generateInvoiceSnapshot` and `markInvoicePaid` effects can be copied with table-name swaps (the `totalAmount` formula is identical).

### The UI

A single detail page (`/scm-transfers/$transferId`) reads the transfer's `status` and the current actor's `role + branchId + assignedBranches`, then renders the appropriate sub-component from a `state × actor` matrix (parallel to the Pengadaan 16-component matrix). The "giant interactive table" pattern is reused at `ReviewingSJ` (Receiver BA sets per-line `receivedQuantity` / `rejectedQuantity` / `reason`).

The list page (`/scm-transfers/`) splits SJs into two visual buckets for AMs:
- **Actionable** (`canAmAct`): shown with action buttons (Approve, Reject).
- **View-only** (`canAmSee && !canAmAct`): shown without action buttons, with a "cross-jurisdiction" badge.

### Authorization helpers

Two pure functions, used by `transition()` and by the UI:

```
canAmAct(am, transfer)  = transfer.fromBranchId ∈ am.assignedBranches
                       AND transfer.toBranchId   ∈ am.assignedBranches

canAmSee(am, transfer)  = transfer.fromBranchId ∈ am.assignedBranches
                       OR  transfer.toBranchId   ∈ am.assignedBranches
```

The `transition()` function refuses to apply an `approve` / `reject` / late-`cancel` event from an AM who fails `canAmAct`. A super_admin bypasses both.

## Considered Options

### Option A — Reuse `scm_procurements` with a discriminator column (rejected)

Add a `kind` enum (`"Pengadaan" | "Mutasi"`) to `scm_procurements` and use the same table for both flows.

**Why rejected:** The two flows have genuinely different actor maps, different state semantics (Mutasi has no PR phase, has an `Approved` state Pengadaan doesn't), and different pricing sources (Central's `averageCost` vs Sender's `inventory.averageCost`). Forcing them into a single row type means either (i) lots of nullable columns (`caDecision`, `readyQuantity`, `pickedQuantity` are Pengadaan-only) and a check constraint that "if kind=Mutasi then those are null", which is fragile, or (ii) a sparse "polymorphic" table where the meaning of each column depends on the discriminator, which is harder to read and harder to index.

### Option B — Parallel root tables, shared FSM module (chosen)

Two tables (`scm_procurements`, `scm_transfers`), two transition tables in two files, but the *shape* of the FSM module is the same. Effect handlers are shared via parameterization over the root FK.

**Why chosen:** The two flows share *structural* concepts (FSM, audit log, item-level review, invoice snapshot) but *diverge* in actors, state names, and effect details. Two tables + two transition tables + shared effect helpers captures this exactly. The cost (one extra file, one extra migration) is small.

### Option C — Status-enum patch on `stock_transfers` (rejected)

Keep the existing `stock_transfers` table; graft the missing states (`Delivered`, `ReviewingSJ`, `WaitingForPayment`, `Finished`) onto the existing `stockTransferStatusEnum`; add an `scm_transfer_items` table and an invoice column.

**Why rejected:** This is the "extend the three enums in place" pattern that ADR 0002 explicitly rejected for Pengadaan. The same problems reappear: the `stockTransferStatusEnum` carries vocabulary that doesn't belong (`ReviewingSJ` on a `stock_transfers` row, where the existing row was 1-ingredient-per-row, is awkward); the audit trail is implicit (no `audit_log` table for the existing flow); the FSM is enforced in scattered `if (status === X)` checks, not in a transition table.

## Consequences

### Positive

- **Single source of truth for the lifecycle.** The transition table replaces scattered `if (status === X)` checks with one function, just like Pengadaan.
- **Per-item review is now possible.** The 1-ingredient-per-row legacy model is replaced with an item table that carries `quantity`, `receivedQuantity`, `rejectedQuantity`, and `unitPrice` per line.
- **AM as approver is formalised.** The "AM only oversees transfers between branches of their jurisdiction" rule is enforced server-side in `transition()` (Q8).
- **Audit trail is automatic.** One `scm_transfer_audit_log` row per transition.
- **Effect handlers are shared with Pengadaan.** The stock-reversal helpers, the in-transit writer, the invoice generator, the mark-paid writer — all reused with parameterization, no logic duplication.
- **The "Invoice" the client mentioned is now a real document**, with `totalAmount`, `paidAt`, `paidById`, and visibility on all three dashboards.

### Negative

- **Old code paths stay reachable.** The `stock_transfers` routes, the old server functions, and the old table remain in the codebase (hidden from menu, accessible via direct URL). This is technical debt we accept, mirroring the Pengadaan legacy decision.
- **Two transition tables to maintain.** The two FSMs are similar but not identical. Future changes to "the SCM FSM" need to be considered against "the Mutasi FSM" — but the differences are documented in the per-flow ADR.
- **Cross-jurisdiction SJs have no AM action path.** They go straight from `PendingAMReview` to `Cancelled` (or wait for `super_admin`). This is the cost of the strict-act jurisdiction rule (Q8).
- **AM's notes channel is a free-text `notes` field, not a structured "request changes" action.** If the AM wants the Sender to revise, they either (a) edit the `notes` field directly, or (b) `reject` with a `rejectionReason` and let the Sender create a new SJ. There is no in-between transition (deliberate — Q7 keeps the state count to 10).

## Sub-decision: Pricing snapshot source (option b — sender's inventory)

The `unitPrice` on each `scm_transfer_items` row is snapshotted from `inventory.averageCost` at the **Sender's branch** (`fromBranchId`), not from the global `ingredients.averageCost`. This is the opposite of Pengadaan (where ADR 0003 sources from `ingredients.averageCost`).

**Why sender's `inventory.averageCost`:**

- The Pengadaan source (`ingredients.averageCost`) is a global per-ingredient value updated by stock movements across *all* branches. It reflects Central's "weighted average acquisition cost" — appropriate for a Central→Branch restocking process.
- The Mutasi source needs to reflect what the **Sender's branch** paid for the stock. Different branches may have acquired the same ingredient at different prices, so the snapshot must be per-branch, not global.
- The `inventory` table already carries `averageCost` per (branch, ingredient) — see how `recalculateRecipeCostsForIngredient` reads it. We just read it at item-creation time and freeze it on the item row.

**Snapshot timing:** at item-creation time (during `createMutasiTransfer`), not at `submit` and not at `ship`. This matches Pengadaan's snapshot timing (ADR 0003) and ensures the price the Sender "quoted" in the SJ is what the invoice is generated against. Subsequent changes to `inventory.averageCost` (e.g., the Sender receives a new supplier shipment) do **not** affect existing transfers.

### Alternatives considered

- **(a) Snapshot from `ingredients.averageCost` (global, like Pengadaan):** rejected — this would mean a Sender with a higher local cost still gets paid at the global average, which is unfair to them.
- **(c) Re-snapshot at each transition (e.g., re-snapshot at `ship` or `finish-receive`):** rejected — the Sender's quoted price is part of the contract; changing it mid-flight would surprise the Receiver (who's expecting to pay the originally-quoted price).

## Sub-decision: Stock check timing (option c — strict at `ship`, soft at `create`)

The strict check is at the **`ship`** transition only. The `create` action produces a soft warning (a yellow indicator next to each line that exceeds current sender inventory) but does not block creation. The `submit` action performs no check.

**Why strict at `ship`:**

- This is the only moment when stock actually moves. If the sender's `inventory.quantity < transfer_item.quantity` at this moment, the effect handler would write a negative balance. Strict here is a correctness invariant.
- Sender's inventory can change between `create` and `ship` (sales, waste, other transfers), so a check at `create` is stale by the time of `ship`.
- The `create` warning is a UX nudge: the Sender can see "you only have 50 kg of flour right now, but you're promising 100 kg" and decide whether to wait for an incoming shipment before submitting.

## Sub-decision: In-transit and pending-review ledger schema (option a — add columns)

Add a nullable `scmTransferId` FK column to the existing `in_transit_inventory` and `pending_review_inventory` tables, with a check constraint enforcing that exactly one of `deliveryNoteId`, `scmProcurementId`, `scmTransferId` is set per row.

**Why extend rather than duplicate:**

- The ledger *meaning* is identical across all three flows: stock that has left a source branch but not yet settled at the destination. There's no semantic reason to split the table.
- Pengadaan's `scmProcurementId` column was added in ADR 0002 with this same pattern ("shared `in_transit_inventory` ledger... with `scmProcurementId` set"). The Mutasi addition is the natural next step.
- Queries that aggregate in-transit or pending-review stock across all flows can do so without UNIONs.

## Sub-decision: Printable documents (option b — separate `scm-transfer-print.ts`)

A new `src/lib/server/scm-transfer-print.ts` module, parallel to the existing `scm-print.ts`, hosts `printSuratJalan` and `printInvoice` for Mutasi. Both functions return HTML strings with an embedded `window.print()` script (matching the Pengadaan module's low-tech approach — no PDF library, no headless browser).

**Why separate rather than extend `scm-print.ts`:**

- The two document templates have *different* data sources: Pengadaan's `proc.branchId` (destination-only) + `b.type === "Central"` (source) vs Mutasi's `transfer.fromBranchId` + `transfer.toBranchId`. Forcing both into one function means conditional logic that obscures both flows.
- The signature blocks differ: Pengadaan's SJ is "Pengirim: Central / Penerima: Branch"; Mutasi's is "Pengirim: Sender Branch / Penerima: Receiver Branch". Each can evolve independently.
- The Mutasi SJ shows `quantity` (the Sender's promise) on print, with the receiver's signature line for "Diterima" filled in by hand. The Invoice is where `receivedQuantity` is final.

## Sub-decision: Rejected stock disposition (option a — waste at receiver)

When the Receiver rejects some quantity at `finish-receive`, the rejected qty is written to `waste_entries` at the **receiver's** branch. The receiver is responsible for physical disposition. The invoice does not include the rejected qty (it's `receivedQuantity × unitPrice`), so the receiver doesn't pay for stock they rejected.

**Why waste at receiver (not return to sender, not AM-decides):**

- The Pengadaan code already does this. Reusing the same `writeRejectedWaste` effect (parameterized over the root FK) means zero new logic.
- The accounting story is clean: `waste_entries` at the receiver captures the "this is gone" fact; the sender's books reflect what was shipped and paid for; both sides are made whole on the *invoice* dimension.
- Physical return of rejected stock is a *separate* concern handled out-of-band. If the receiver wants to return goods to the sender, they can create a *new* Mutasi Stok with the actor roles reversed.
- AM-decides-per-SJ is over-engineered for what should be SOP.

## References

- ADR 0002: `docs/adr/0002-scm-as-finite-state-machine.md` — the Pengadaan FSM that this ADR mirrors.
- ADR 0003: `docs/adr/0003-procurement-unit-price-sourcing.md` — the pricing snapshot model; this ADR extends it to a per-branch source.
- Lesson 0003: `learning-records/0003-scm-finite-state-machine.md` — the foundational FSM lesson.
- CONTEXT.md: "Stock Transfer" (parent concept), "Mutasi Stok" (subtype), "Mutasi Unit Price" (pricing term), "In-Transit Inventory" (now shared across 3 flows).
</content>
</invoke>