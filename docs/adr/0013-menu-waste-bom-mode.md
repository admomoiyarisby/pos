# Menu Waste BOM Mode (waste a recipe's BOM ingredients)

## Context

`/waste` records loss against exactly one stock surface per entry: `inventory` (ingredient) or `recipeInventory` (finished porsi). Menu waste ("Porsi jadi") deducts the porsi shelf only. The domain split follows ADR 0012's distinct-surfaces logic, but at outlets the porsi shelf is effectively empty — its only writers are production (`assignRecipeStock`, hard-restricted to Central Warehouse) and waste itself (upsert-from-0, negative). Operationally, the common outlet loss story around a menu ("the iced tea glass spilled while prepping") is a loss of the BOM ingredients that would have gone into the drink — ingredients POS would have consumed at sale time, but that were never sold. Recording this as porsi waste writes a negative porsi row and leaves the bahan shelf overstated.

## Decision

1. Menu waste gets a sub-mode: **"Porsi jadi"** (existing behavior — deduct `recipeInventory` only) and **"Bahan (BOM)"** (new — deduct checked BOM ingredients only). Both modes coexist; porsi mode remains the correct tool at Central Warehouse, where production actually stocks the porsi shelf.
2. **BOM mode does not touch `recipeInventory`.** Surfaces stay separate (same distinct-surface logic as ADR 0012's R1/Y1); no double-counting.
3. The flat per-porsi BOM is resolved by the same ingredient resolver POS order intake uses (`resolveNewItemIngredients`, porsiQty = 1): BOGO doubled, bundle children scaled by their link quantity. Waste-BOM therefore matches exactly what a sale of the same unit would have consumed.
4. The user picks which BOM lines were actually lost (checkboxes) with editable integer quantities (default: per-porsi requirement × porsi count). Partial losses ("only the cup broke") are first-class.
5. **Storage: one `wasteEntries` row per checked line** (the schema requires exactly one of `ingredientId`/`recipeId` per row), `recipeId` null, `notes` tagged `Waste BOM <recipe>` so the list groups them. Each row carries its own valuation (`quantity × averageCost`), its own OUT ledger row (reference = the entry id, balance = post-write quantity), and an `operationalExpenses` row when the category is `Biaya Operasional`.
6. Inventory deduction is **upsert-from-0, allow-negative** — mirrors `createWasteEntry` (decision #153 policy).
7. Cancellation reverses per entry through the existing `applyWasteCancellation` path (IN row on the same reference) — no new reversal logic.
8. `branch_admin` never sees HPP-derived numbers: `averageCost` is stripped from the BOM payload and the estimated-loss preview is hidden; the list already masks `valuation`.

## Considered Options

- **Deduct porsi + BOM together** (rejected) — double-counts the same physical event and writes negative porsi rows at outlets where the shelf never existed.
- **BOM-only, remove porsi mode** (rejected) — Central Warehouse stocks and wastes real finished porsi (`assignRecipeStock`); the porsi surface must stay wastable.
- **One entry with a JSON ingredient breakdown** (rejected) — requires a schema migration, reworks list/cancel/valuation, and breaks the exactly-one ingredient/recipe invariant that the list, filters, and Kartu Stok rely on.
- **Reuse `getPosMenu`'s UI-side aggregation for the BOM** (rejected) — it does not multiply bundle children by their link quantity; the order-intake resolver is the authoritative math.

## Consequences

- Outlets can finally record the real loss story around menus: the bahan shelf reflects it, Kartu Stok shows per-ingredient OUT rows, and the per-ingredient waste-percentage anomaly threshold keeps working.
- Waste entries for one incident appear as N rows (one per ingredient); grouping is by the `Waste BOM <recipe>` note tag, not a shared FK.
- New write path pinned by integration test **W4** in `docs/report/integration-paths-kartu-stok.md` (contract: per-ingredient entries, upsert-from-0 deduction, OUT ledger per entry, recipeInventory untouched, cancel restores).
- Kartu Stok (`/inventory/ledger`) gains a Waste BOM filter (`wasteBomOnly` / `wasteBomRecipeId` on `getStockLedger`, predicate in `wasteBomLedgerFilter`) to review per-ingredient losses by recipe; the exact-tag-match semantics are pinned by the same W4 test.
- UI follow-up: with no outlet ever stocking the porsi shelf, the porsi picker label ("belum pernah ada (0)") was noise — the porsi-mode toggle is hidden behind `ENABLE_PORSI_WASTE_MODE` in the waste UI (BOM is the default); the porsi write path and this ADR's dual-mode decision remain intact for Central Warehouse use.
- No schema migration required.

## References

- ADR 0012 — the two-surface write-path logic this feature mirrors.
- CONTEXT.md — Waste, Recipe Inventory, Ingredient Resolver.
- `docs/report/integration-paths-kartu-stok.md` — row W4.
- Decision #153 — allow-negative / upsert-from-0 policy.
