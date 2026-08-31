# Server-function core extraction for full-flow integration tests

## Context

The SCM / inventory modules expose their business logic exclusively through `createServerFn` endpoints. Each handler opens with `requireAuth()` / `requireRole()` (the better-auth HTTP session) and then runs the actual logic: role and branch guards, state-machine transitions, stock effects, ledger writes, notifications.

We wanted **full-flow integration tests** that walk a document through every state (e.g. a Mutasi transfer through all 10 FSM states) using the **real** business logic against the local dockerized test Postgres, with impersonated actors of each role — plus negative tests proving wrong-role / wrong-branch actors are rejected at every step with no side effects.

That turned out to be impossible through the transport layer:

- `createServerFn` endpoints are built for HTTP. Calling the returned reference directly (even in-process) runs the middleware chain, which reads the **Start AsyncLocalStorage request context** (`getStartContextServerOnly`) and throws `No Start context found in AsyncLocalStorage. Make sure you are using the function within the server runtime.` — a plain vitest process has no such context.
- Driving them over real HTTP would require booting the full Start server plus a better-auth session per role — heavy, brittle, and slow, and it would exercise the transport we are not trying to test.
- The validator middleware also runs inside that chain, so even validators cannot be reached without the context.

The tests need a seam between the session plumbing and the business logic. The seam must be **minimal**: the exported endpoints keep their exact behavior (same validators, same auth, same error messages), and the tests exercise the same code paths a real request would.

## Decision

In server modules that need flow tests, split each mutation endpoint into a thin transport wrapper and a **user-parameterized core**:

```ts
export const createMutasiTransfer = createServerFn({ method: "POST" })
  .validator(/* unchanged */)
  .handler(async ({ data }) => {
    const user = await requireAuth();
    return createMutasiTransferCore(user, data); // ← the whole former handler body
  });

export async function createMutasiTransferCore(user: AppUser, data: /* validator output type */) {
  // the exact former handler body — role checks, branch scoping, effects, logging
}
```

Rules for a core:

1. **It is the handler body, verbatim**, minus `requireAuth()` / `requireRole()` and the `data` unwrap. The wrapper keeps its validator and auth calls and delegates. Byte-for-byte behavior is preserved.
2. **It re-mirrors the wrapper's role guard.** Where the wrapper used `requireRole("super_admin", "admin_pusat")`, the core starts with the same check throwing the same message (`Forbidden: insufficient role (user … has role "…", required: super_admin | admin_pusat)`), so wrong-role rejection is exercised when the core is driven directly. Inline checks that already lived in the handler body (e.g. `if (user.role === "branch_admin" && branchId !== user.branchId) throw …`) stay as they were.
3. **The actor type is `AppUser`** (`#/lib/server/auth`), the same shape `requireAuth()` returns — `id`, `email`, `name`, `role`, `branchId?`, `assignedBranches?`, `status`.
4. **Only mutation/lifecycle functions get cores.** Read-only `GET` endpoints that just `requireAuth()` and query are left untouched (the tests don't drive them).
5. **Input contracts that live only in the wrapper's zod validator are re-checked in the core** if a direct caller could bypass them (e.g. `createWasteEntryCore` re-checks "exactly one of ingredientId/recipeId"). The wrapper's validator still runs first over HTTP.
6. **Core-only bug fixes are allowed and encouraged.** Extraction surfaced one latent bug (`paySCMInvoiceCore` lacked the not-found guard every sibling had, so paying a missing invoice threw a raw `TypeError`); it was fixed to throw `Invoice not found` like `cancelSCMInvoiceCore`.

### The test harness (`src/lib/server/integration-test-harness.ts`)

Every flow test file uses the same setup:

- `vi.mock("#/lib/server/db")` routes the module-level `db` to a drizzle instance (`holder.db`) over a connection to the **local test database** (`TEST_DATABASE_URL=postgresql://omoiyari_test:…@localhost:5433/omoiyari_pos_test`). `setupFlowHarness(holder)` connects in `beforeAll` and `TRUNCATE users, branches, ingredients, document_code_sequences CASCADE` in `beforeEach` — every other table is reached by cascade, so tests never observe each other's rows and document-code serials restart cleanly.
- `vi.mock("#/lib/server/auth")` makes `requireAuth` / `requireRole` throw ("should not be called — cores receive an explicit user"), proving the test drives real logic with explicit users rather than sessions.
- **No outer transaction is held open.** The cores' own `db.transaction()` calls manage their own transactions; a failing inner step rolls back only its own work. (A transaction-bound harness was tried and failed: drizzle's client-bound `transaction()` issues its own `BEGIN`/`COMMIT`, which collides with a manual outer `BEGIN` and rolls back the whole test on the first inner failure.)
- Impersonated actors are persisted as **real `users` rows** first (plus `area_manager_branches` links when needed), because the `*_by_id` columns are FK-constrained.
- Endpoints that return `{ success: false, error }` instead of throwing (e.g. Pengadaan's `transition()`) are asserted on the returned error; everything else throws.
- Date-dependent guards (e.g. `realizeStockOpname` only on the 25th) are pinned with `vi.useFakeTimers({ toFake: ["Date"] })` — the guard runs before the status checks, so the test must pin the date to reach them.

## Considered Options

### Option A — Call the `createServerFn` reference directly in-process (rejected)

The returned reference is a callable that runs the middleware chain. Empirically it throws `No Start context found in AsyncLocalStorage` before reaching the handler — the middleware chain unconditionally reads the Start request context. Providing a fake context via AsyncLocalStorage would couple the tests to Start internals.

### Option B — Drive the endpoints over real HTTP (rejected)

Boot the Start server and authenticate as each role. Heavy (server process, session cookie management per actor), brittle, slow, and it tests transport we don't own. The tests would also be unable to TRUNCATE between tests without a second connection.

### Option C — Mock `requireAuth` with a per-test holder and call the handler (rejected)

Bypasses the Start-context problem only if the middleware chain is bypassed too — but the handler is unreachable without it (Option A). Would also silently change what the tests exercise.

### Option D — Extract user-parameterized cores (chosen)

One seam, no HTTP, no Start context, no session mocking. The trade-off is that every endpoint gains a second entry point that must stay in sync with its wrapper.

## Consequences

### Positive

- **Real logic, impersonated actors.** Every state transition, stock effect, ledger row, notification, and audit entry is the production code path; only the session lookup is replaced by an explicit user argument.
- **Authorization is fully exercised.** Role guards (mirrored in cores) and branch guards (inline, e.g. `Unauthorized branch`, `branch_admin can only …`) run and are asserted — positive _and_ negative coverage, with "no side effects after rejection" checks.
- **Fast and isolated.** One process, real Postgres, per-test TRUNCATE. The whole 10-module matrix runs in ~60s.
- **The seam is broadly useful** — any future server-to-server caller gets the same entry point.

### Negative

- **Two entry points per endpoint.** Wrapper + core must stay in sync; a change to the handler body must land in the core (the wrapper is now just auth + delegate).
- **Role-guard messages are duplicated** between the wrapper's `requireRole(...)` and the core's mirror guard. If the message format changes, both places must change.
- **Validators live in the wrapper**, so core-only callers skip zod parsing; cores that care re-check their own input contract.
- **The exported surface of server modules grows** with `*Core` functions and `AppUser` imports.

### How to add a module (the pattern to follow)

1. Identify the mutation endpoints and their states/guards (read the module; most follow an FSM table or a status lifecycle).
2. Extract cores per the rules above; typecheck before writing tests.
3. Copy the harness setup from any existing `*-flow.integration.test.ts`; seed branches, ingredients, users (persisted rows), and inventory as the flow requires.
4. Write the positive walk (every state, asserting status + stock/ledger/notification side effects) and the negative suite (wrong role, wrong branch, wrong state, not-found — each asserting no side effects).
5. Run with `TEST_DATABASE_URL=postgresql://omoiyari_test:omoiyari_test@localhost:5433/omoiyari_pos_test DATABASE_URL= vp test run src/lib/server/<module>-flow.integration.test.ts`.

## References

- The flow-test suites: `scm-transfers-flow`, `scm-procurements-flow`, `yield-flow`, `waste-flow`, `supplier-deliveries-flow`, `stock-opname-flow`, `purchase-orders-flow`, `delivery-notes-flow`, `scm-invoices-flow`, `stock-transfers-flow`, `purchase-requisitions-flow`, `branches-flow`, `ingredients-flow`, `users-flow`, `brands-flow`, `categories-flow`, `vouchers-flow`, `modifier-groups-flow`, `recipes-flow`, `pos-flow`, `finance-flow` (all in `src/lib/server/`), plus the shared `integration-test-harness.ts`.
- Cores live in the modules that own the endpoints: `scm-transfers.ts`, `scm-queries.ts` (Pengadaan), `yield.ts`, `waste.ts`, `supplier-deliveries.ts`, `inventory.ts` (stock opname), `scm.ts` (PR / PO / delivery notes / SCM invoices / legacy stock transfers), `branches.ts`, `ingredients.ts`, `users.ts`, `brands.ts`, `categories.ts`, `vouchers.ts`, `modifier-groups.ts`, `recipes.ts`, `pos.ts` (shifts / orders / reprint / cancel approval flows), `finance.ts` (periods / manual revenue / expenses).
- ADR 0002 / 0006 — the FSM designs whose transition tables these tests walk.
- ADR 0012 — the ADR 0012 write-path (yield → Kartu Stok) that the yield flow tests pin.
