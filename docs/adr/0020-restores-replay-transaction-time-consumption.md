# Restores replay the transaction-time consumption, never the live BOM

## Context

A physical count at **Mulyorejo** put "Cup gelas PP 14Oz" at **59** while the
POS said **1** — 58 pcs the system owed back with nothing on Kartu Stok to
explain it. The ledger's own arithmetic showed the same hole at snapshot level:
rows whose stored `balance` jumped far beyond their movement, and restore rows
(`Edit Order (restore)`, `Delete Order (restore)`, `Void Order …`) whose
quantities could not be reconciled against the deductions they reversed.

Three distinct mechanisms let stock move — or fail to move — **without a
matching ledger row**, all failing silently:

1. **Live-BOM restores.** `createOrderCore` / `createSalesOrderCore` resolved
   the recipe BOM at sale time; every restore
   (`resolvePersistedItemIngredients`) re-resolved it _at restore time_. A
   recipe edited between sale and restore made the restored quantity differ
   from the deducted one — e.g. BOM corrected from 2 to 1 pcs/cup restores only
   1 for every −2 that went out. Removing a child-recipe link, toggling
   `isBOGO`, or editing a modifier ingredient does the same. Nothing compared
   restored vs deducted, so the difference vanished. This is the only mechanism
   that returns _less_ than was taken — the direction the audit found.
2. **`if (!inv) continue`.** Every stock path that found no `inventory` row for
   `(branch, ingredient)` skipped _both_ the quantity update and the ledger row
   — sale, void restore, edit restore, delete restore, and the stock-opname
   adjustment paths all had this guard. The UI reported success; Kardu Stok
   showed nothing. Waste, yield, and SCM already upserted-from-0 correctly;
   only these paths didn't.
3. **Opname corrections that adjusted nothing.** `realizeStockOpnameCore`
   wrapped its correction in `if (inv)`: an operator who counted an item whose
   inventory row didn't exist got a successful realization that changed no
   stock and wrote no `SO:` ADJ row — the system stayed at 1 forever. The Nasi
   branch additionally wrote the _unclamped_ `rawAmount` to the ledger while
   inventory only lost `min(stock, rawAmount)`, overstating the movement.

Also relevant (audited, not silently wrong): `updateSalesOrderCore` backdates
the _order_ but stamps its ledger rows at `NOW`, so a "revisi tanggal" order's
stock rows land on a different day than the order claims.

## Decision

**Restores replay the transaction-time consumption; a missing inventory row is
a setup gap to create, not a reason to drop a movement.**

1. `order_item_ingredients` (migration 0061) freezes each order item's resolved
   consumption — positive consumed / negative exclusion — inside the same
   transaction that deducts stock. Same freeze pattern as the existing
   `order_items.cogsAtTransaction`. Written by `createOrderCore` and
   `createSalesOrderCore`, re-frozen by `updateSalesOrderCore` when items are
   replaced, cascade-deleted with the order items.
2. `resolvePersistedItemIngredients` replays the snapshot when present, so
   "restored == deducted" holds by construction regardless of later recipe
   edits. Legacy order items (created before 0061) keep the live-BOM path and
   emit a `console.warn` per item so they can be reconciled manually — no
   backfill is attempted because order-time BOMs no longer exist.
3. `ensureInventoryRow` (exported from sales-data.ts) upserts the row at 0 and
   takes the lock; it replaces every silent skip in the POS sale/void, edit,
   delete, and opname paths. Movements either happen _and_ are recorded, or the
   transaction throws.
4. The SO realization paths record the _applied_ (clamped) quantity, and the
   Nasi conversion ledger row now matches what inventory actually lost.

## Consequences

- A recipe edited after a sale no longer leaks stock: void/edit/delete restore
  exactly what the sale deducted. Covered by
  `order-item-ingredients.integration.test.ts` (create → edit recipe → delete /
  update / void all net to zero on the item).
- The old "silent no-op" contract test in `sales-data-flow.integration.test.ts`
  was inverted: creating against an unseeded branch now produces an upserted
  row, a recorded OUT row, and a matching IN on delete.
- Pre-ADR-0061 orders remain drift-prone until manually reconciled; the
  resolver warns on every restore of one, which makes them findable via logs.
- Kartu Stok's `balance` column is still a write-time snapshot, not a
  recomputed series — unchanged, and still the right thing to print — but the
  quantities feeding it are now self-consistent per order.
- Follow-up this enables: a per-order "ledger IN vs OUT" drift audit
  (`SELECT … SUM(CASE WHEN type…) GROUP BY reference`) can finally be trusted to
  surface only real discrepancies, because asymmetric restores can no longer
  occur for post-0061 orders.
