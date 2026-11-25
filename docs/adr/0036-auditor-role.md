# 0036 — Auditor: a read-only, branch-scoped role

## Context

Owners asked for an account that can see the money — Data Penjualan, Keuangan &
Rekonsiliasi, Dashboard, Dashboard Analitik — without touching operations, and
only for their own branch (or a group of branches).

Two properties of the existing code decide the design:

- **Writes are already deny-by-default.** Every mutation spells out its roles
  (`requireRole("super_admin", "admin_pusat")`), so a role that appears in none
  of those lists cannot write. The one exception was derived rather than
  listed: `order-fsm.ts` built its fulfilment actors from `USER_ROLE_VALUES`,
  so adding an enum label would have granted order-status writes.
- **Reads trusted their `branchId` argument.** Finance and sales reads passed
  the client's branch straight into the WHERE clause, safe only because the
  roles allowed to call them were global. A branch-scoped reader must not be
  able to name another branch.

## Decision

1. **One new role, `auditor`**, assigned branches in `area_manager_branches`
   (one row = one branch, several = a group). The same table expresses a
   single-branch auditor, so no second assignment concept was added.
2. **Reads resolve the branch from the assignment, never from the request.**
   `scopedBranchCondition(user, column, requestedBranchId)` returns the
   predicate a read must apply: `undefined` for a global role, a false predicate
   for an empty assignment, `eq`/`inArray` otherwise. A requested branch outside
   the assignment is narrowed to the assignment, matching `area_manager`
   semantics.
3. **The FSM actors exclude the role explicitly.** `ALL_ROLES` filters
   `auditor` out rather than treating the enum as the grant list, so a future
   label cannot inherit a write edge by accident.
4. **The UI is the same page with the write controls absent**, not a separate
   read-only surface: `canEdit = role !== "auditor"` hides Input Revenue,
   Input Pengeluaran, the inline Omzet Real/adjustment editors, and Data
   Penjualan's add/edit/verify/delete controls. The server refuses those calls
   regardless.
5. **A missing assignment is empty, not global.** An auditor with no branch
   rows sees nothing; failing closed is the only safe default for a new role.

## Consequences

- The role can read four surfaces and nothing else in the sidebar: Dashboard,
  Keuangan, Dashboard Analitik, Data Penjualan. Other pages redirect home, and
  their reads are not in the role's allow-lists.
- `getBranches` is scoped for auditors so a branch picker can never offer a
  branch whose read would be silently replaced.
- Read-only means **no writes**, not "only finance data": this repo has many
  `requireAuth`-only reads (ingredients, recipes with HPP, inventory). An
  auditor can call those RPCs directly. Closing that gap is a separate audit,
  not part of the role.
- `ALTER TYPE ... ADD VALUE` is one-way; removing the role later means a type
  rebuild (as migration 0067 did for `order_status`).
- Adding a branch-scoped role is now cheaper than adding a global one: the
  helper already carries the semantics, and the FSM no longer inherits grants
  from the enum.

## References

- ADR 0028 — omzet basis; the auditor's Finance read shows the same numbers
- ADR 0015 — core seam used by the auditor scope tests
- `src/lib/server/branch-scope.ts` — `scopedBranchIds` / `scopedBranchCondition`
- `src/lib/server/auditor-scope.integration.test.ts` — cross-branch and
  write-edge tests
