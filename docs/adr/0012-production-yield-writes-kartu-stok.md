# Production (Yield Tracking) writes Kartu Stok

## Context

Production records (`createYieldConversion`, `/yield-tracking`) have been **documentation-only** since inception: recording a production stores the Barang Keluar (out) and Barang Dihasilkan (produced) items as history but does **not** change `inventory` and does **not** write `stock_ledger` (Kartu Stok). `CONTEXT.md` defined Production accordingly, and the integration matrix (`docs/report/integration-paths-kartu-stok.md`) lists row **Y1** as "NO-WRITE".

A prior wayfinder effort deliberately kept it that way: grilling #116 ruled Yield Tracking documentation-only, citing (a) the CONTEXT.md definition, (b) the missing insufficient-stock guard and HPP owner, and (c) a perceived duplicate-writer risk with `assignRecipeStock` (R1). Users who needed a stock effect were told to use Stock Opname or manual adjustment instead.

The business has now decided the opposite: recording a production **must mutate stock** — deduct the consumed ingredients and add the produced ingredients, in the branch where the production happens. This ADR records that reversal and the write-path contract.

The old counterarguments are answered:

- **Duplicate-writer risk dissolves.** R1 (`assignRecipeStock`, recipes.ts) produces **recipes** — it writes `recipeInventory` and `stockLedger.recipeId`. Yield tracking (Y1) produces **ingredients** — it writes `inventory` and `stockLedger.ingredientId`. Distinct surfaces; the two coexist without double-counting the same physical movement.
- **HPP owner is not needed.** Costing stays manual (see Decision 4), mirroring ADR 0010's caution about the global `ingredients.averageCost`.
- **The guardrail gap becomes a warning, not a block.** Negative stock is the system's standing policy (POS deductions, manual adjustment, the `negative` inventory filter), so insufficient OUT stock warns in the UI rather than rejecting the record.

## Decision

1. **Recording applies the stock effect atomically.** `createYieldConversion` inserts the production record and applies the mutation in one transaction: each Barang Keluar deducts the record branch's `inventory` (upserting from 0 when no row exists) and each Barang Dihasilkan adds it (upsert). Every movement mirrors to `stockLedger`: `type` IN/OUT, `quantity`, `balance` equal to the post-write `inventory.quantity`, `branchId` equal to the record's branch, a shared reference `YIELD-<conversionId>`, and notes describing the production.
2. **Negative resulting stock is allowed.** An OUT that exceeds current stock is recorded anyway; the UI warns on the form. This matches POS and manual-adjustment behavior — a stale stock card must not block recording a production that physically happened.
3. **Cancellation reverses the mutation.** When a record's status flips to `Cancelled` — via the request → approval flow (super_admin / area_manager) or a super_admin direct cancel — the mutation is reversed with opposite-type ledger rows on the same `YIELD-<conversionId>` reference. A **pending** cancel request leaves stock untouched (reversal happens at approval, not at request). Reversal applies only to records that wrote stock: records created before this change have no ledger rows and are not reversed.
4. **HPP stays manual.** Production never touches `ingredients.averageCost`; produced-item cost remains set manually on the ingredient master. Production is a stock movement, not a costing event.
5. **New records only.** Historical documentation-only records are not backfilled — current stock already reflects reality via SO and adjustments; retro-mutation would create phantom movements.
6. **Scope unchanged.** The mutation applies at the record's branch: `branch_admin` records at their own branch, other roles record at Central branches. Nasi ingredients remain excluded from the pickers (`excludeNasi: true`), so no Nasi-conversion interaction arises.

## Considered Options

- **Keep documentation-only** (rejected). The user request explicitly asks for stock mutation; requiring SO/manual adjustment for every production was the operational pain point this reversal removes.
- **Draft → Confirm gate** (rejected). A separate confirmation step before stock moves adds friction; recording one-click and reversing via cancellation is simpler and matches the existing flow.
- **Hard-fail on insufficient OUT stock** (rejected). Negative stock is the standing policy; a hard guard would block legitimate records when the stock card is stale. The UI warns instead.
- **Backfill historical records** (rejected). Retro-mutation would corrupt current stock, which has moved on since each record was made.
- **Recompute HPP from OUT inputs** (rejected). `averageCost` is global (ADR 0003/0010); a production-derived cost would silently rewrite COGS for every branch. Costing stays manual.

## Consequences

- Kartu Stok now shows production movements; row Y1 of the integration matrix flips from no-write to write-path, and the Y1 test contract is updated to assert the new behavior.
- Production is now a first-class stock event alongside Stock Opname, SCM deliveries, waste, and manual adjustment. The "adjust separately via SO / manual adjustment" guidance is removed from the domain docs.
- Cancelling a production is now a compensating ledger movement, not just a status change.
- Stock can go negative as a result of production; this is visible via the inventory `negative` filter and accepted as policy.
- COGS / `ingredients.averageCost` is unaffected (HPP manual).
- Existing documentation-only records remain as-is; only newly recorded productions write stock.

## References

- Wayfinder map: "Map: Yield tracking mutates stock (Kartu Stok write-path)" (#138) — this reversal's chart; standing decisions in its Notes.
- Grilling #116 — the prior decision this ADR reverses (kept Y1 documentation-only).
- Map #114 — the earlier inventory ↔ Kartu Stok integration effort; its matrix lists Y1 as NO-WRITE.
- `CONTEXT.md` — Production / Barang Keluar / Barang Dihasilkan glossary entries (rewritten by this reversal).
- ADR 0001 (Stock Opname adjustment), ADR 0010 (manual adjustment; global-`averageCost` caution).
- `docs/report/integration-paths-kartu-stok.md` row Y1 — the write contract this ADR pins.
