# Manual Stock Adjustment (Penyesuaian Stok Manual)

A Super Admin-only tool for directly adjusting a branch's stock outside the
Stock Opname and Procurement/Mutasi flows. Reached via the “Sesuaikan Stok”
button on `/inventory` (opens a modal worksheet); it is not a separate route.

## Context

Stock at a branch is `inventory` rows keyed by `(branchId, ingredientId)`.
Today stock only changes via **Stock Opname** (supervisor-approved absolute
set) or **Procurement/Mutasi** (FSM delivery). The client (as super_admin)
asked for a direct CRUD path to put ingredients and stock into a branch, from
a sub-page of `/inventory`.

Two facts shaped the design:

- `inventory` has **no** `averageCost` column. `averageCost` is on
  `ingredients` and is **global per ingredient** across all branches (ADR 0003:
  "Per-branch inventory.averageCost is a future migration"). Procurement
  snapshots this global value; receiving recalculates it.
- Every stock movement is already mirrored in `stockLedger` for audit.

## Decision

1. **Scope is branch stock lines only.** No ingredient-catalog CRUD is bundled
   in. The tool manages `inventory` rows, not `ingredients`.
2. **Delta + mandatory reason, in batches, across one or many branches.** An
   adjustment is a worksheet of many lines: Super Admin selects one or more
   branches (multi-select), then adds as many ingredient lines as needed, each
   with a direction (`IN`/`OUT`), a positive quantity, and a live preview of the
   resulting stock. One **shared reason** and one **shared `reference`** apply to
   the whole batch (one adjustment event, many ledger rows across every selected
   branch), so it stays fully auditable and matches the existing ledger model.
   The whole batch is applied **atomically** in a single DB transaction that
   loops over each selected branch; if any branch fails (e.g. an `OUT` on a
   missing line), the entire adjustment rolls back for all branches.
3. **`averageCost` is never touched.** This is a stock-control/correction tool,
   not a costing event. A branch-level manual entry must NOT silently rewrite
   the _global_ COGS cost basis that every other branch depends on. If cost-
   bearing receipts are ever needed, that is a separate effort (and would
   require per-branch cost tracking, which does not yet exist).
4. **Super Admin only.** Both the page (RoleGuard) and the server functions
   (`requireRole("super_admin")`) restrict write access to `super_admin`, per
   the request.
5. **CRUD completeness, guarded.** Read = the branch stock table. Create/Update
   = the adjustment worksheet — for each selected branch, an `IN` on an
   ingredient that branch has never stocked **auto-creates the line** (so
   new-to-branch items are allowed); an `OUT` on a missing line in _any_ selected
   branch is rejected (you cannot remove stock that does not exist). Duplicate
   ingredients within one batch are blocked. Delete = a row can only be removed
   when its quantity is already `0`, so stock can never be silently destroyed.
6. **Negative stock allowed** (the system already supports it, see the
   `negative` filter on the inventory list) but the form previews the resulting
   quantity and warns when an adjustment would go negative.
7. **Clean Slate (destructive reset), Super Admin only.** A separate “Clean
   Slate” button deletes `inventory` **rows** for the currently-viewed branch
   (or _every_ branch when the page filter is “Semua Cabang”) — not just zeroing
   quantities. It is guarded behind a confirm checkbox, runs in a transaction,
   and is logged. `stockLedger` and `ingredients.averageCost` are deliberately
   preserved (audit history stays; global COGS is not touched).

## Considered Options

- **Absolute set (like a fast Opname):** Rejected — it overwrites reality
  silently and conflicts with the signed-ledger design.
- **Recalculate `averageCost` on IN with an optional unit cost:** Rejected
  because `averageCost` is global; a single-branch manual entry would corrupt
  COGS for every other branch. Surfaced here as the key trade-off.
- **Allow deleting any stock line:** Rejected — destructive and unauditable
  without first zeroing; the guarded delete preserves the audit trail.

## Consequences

- Super Admin can correct or seed branch stock directly, with every change
  explainable in `stockLedger` and `auditLogs`.
- COGS (`ingredients.averageCost`) is insulated from ad-hoc manual entries.
- The tool is intentionally narrow (no catalog management, no cost entry);
  those remain separate efforts if requested later.
