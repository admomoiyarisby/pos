# Stock opname item list is the branch catalog

## Context

The stock opname (SO) count sheet did not list every item a branch holds. The
reported symptom was "trigger SO cuma 35 item" and every branch was affected,
so it was a rule and not a data accident.

`triggerStockOpnameCore` built the item list `FROM inventory`:

```sql
FROM inventory
LEFT JOIN ingredients ON ingredients.id = inventory.ingredient_id
WHERE inventory.branch_id = $1
  AND ingredients.countable
  AND ingredients.status <> 'Deleted'
  AND (branch.type <> 'Outlet' OR ingredients.is_branch_visible)
```

`inventory` rows are created **lazily**, only by a movement:
`ensureInventoryRow` (sales, voids, restores), `adjustBranchStockBatch`,
supplier deliveries, SCM transfer-ins, waste, yield. An ingredient the branch
is responsible for but has never received therefore has no row, and so can
never appear on a count sheet — in any month.

Measured against production (read-only): the item master holds 152 active
ingredients, 93 of them flagged `isBranchVisible`. Each established outlet
listed only 59-67 items, i.e. **29-33 catalog items were silently absent**.
`Omoiyari Wiyung-01` and `Omoiyari Pucang` produced 0-1 lines.

A second filter made the same problem worse. `isBranchVisible` defaults to
`false` (`schema.ts:307`) and is a **global** flag, not a per-branch link. Any
ingredient created without it is invisible in the SO of _every_ outlet, even
when stocked: 6 real lines were in that state (e.g. _Tepung Panir Katsu
Kuning_, 666 kg at Darmo Permai and 333 kg at Rungkut; _Miso Pasta_, 30 at
Jambangan).

Three further inconsistencies sat on top:

- `getIngredients` gates `isBranchVisible` by **role** (`branch_admin`), while
  the SO gates by **branch type** (`Outlet`) — two definitions of "the branch
  catalog" that drift.
- The detail and print paths **re-applied the same filters at read time**, so
  an opname was not a snapshot: soft-deleting an ingredient, or flipping its
  flag off, removed its line from the page, the printout and the summary —
  while `realizeStockOpnameCore` (no such filter) still applied that counted
  row. A count the user cannot see moved stock.
- The SO ignored the per-branch `ingredientBranches` allow-list that
  `getIngredients` enforces, so 4 live lines belonged to ingredients
  link-restricted away from their branch.

Documented, intentional exclusions remain `countable = false` (ADR 0001
decision 6) and `status = 'Deleted'` (ADR 0009 tombstone). Both removed zero
items in production.

## Decision

**The item list of an opname is the branch catalog. The stock records supply
the quantity, never the scope.**

1. `triggerStockOpnameCore` reads `FROM ingredients LEFT JOIN inventory` with
   the join carrying the branch id. `systemStock` is
   `roundQuantity(inventory.quantity ?? 0)`: an item the branch has never
   received is a real line at 0, to be counted like any other. The trigger
   still owns the scope decision — catalog flag for outlets, everything for
   central, plus the two documented exclusions. Rows are ordered by name so
   the sheet and the multi-row INSERT are reproducible.
2. The opname is a **snapshot**. `getStockOpnameDetailCore` and
   `printStockOpname` read back exactly the rows the trigger wrote, with no
   second master-data filter, so the view can never hide a line that realize
   will apply. `printStockOpname` also uses `LEFT JOIN` instead of `INNER` so
   a hard-deleted ingredient prints rather than shrinking the sheet.
3. `getStockOpnameDetailCore` is extracted from the endpoint so the snapshot
   contract can be driven in a flow test — the read-path exception in
   ADR 0015 rule 4 (`getStockLedgerCore` precedent).

## Consequences

- Every outlet now gets 93 count-sheet lines instead of 59-67; central gets
  152 instead of 135. A new branch (Wiyung-01, Pucang) gets a full sheet on
  its first trigger instead of an almost empty one.
- A never-stocked item is counted as 0 explicitly, so its absence becomes an
  audited result rather than a missing line. Realize creates its stock record
  at the counted value (`ensureInventoryRow`) and approves it with
  `oldQuantity = 0` when no record exists.
- The 25th baseline (ADR 0021) now covers the whole catalog, so the monthly
  correction is measured against every item the branch owes, not just the
  items that happened to have moved.
- The inventory list page stays `FROM inventory` — it shows stock records, so
  it will show fewer lines than a new opname. That difference is the point:
  one view reports records, the other reports the count obligation.
- Tests in `stock-opname-flow.integration.test.ts` were rewritten to the new
  contract, including the case that encoded the old rule ("only ingredients
  with an existing inventory row at the branch get SO items") and a new
  snapshot test pinning that a flagged-off or soft-deleted line survives and
  is still realized.

## The catalog-parity follow-up (`ingredient-catalog-parity.integration.test.ts`)

`branchVisibleClause` (ADR 0015's drift-free helper) was applied by
`getIngredients` and by no other read, so the SO could put a line on an
outlet's count sheet while that outlet's ingredient list hid the ingredient —
4 live lines. The parity test pins one rule and forces agreement:

```
SO lines = branch catalog ∩ { countable = true, status <> 'Deleted' }
```

with the branch catalog being the flag gate **and** the `ingredientBranches`
allow-list. It failed on exactly that drift (one line on the sheet, none
missing from the catalog), and the SO trigger now applies the clause.

The clause is applied to **outlet scopes only**. Measured on production,
applying it to central branches would drop 20 lines from the Central Kitchen
(Food Prep) count sheet, because that branch is named by almost none of the 53
link rows — a data gap, not an intent. Central Warehouse would lose 3. Until
the links cover every central location, central scope stays flag-gate-only,
and test 2 in the parity file pins that asymmetry on purpose.

## Guards on the flag default

The `false` default stays undecided (it is a schema-level business call), but the
trap is now visible:

- The ingredient create and edit forms state, when the flag is off, that the
  item never appears on any branch opname.
- `getBranchCatalogGaps` / `getBranchCatalogGapsCore` report every countable
  ingredient that is flagged off and **stocked at an outlet** — the blind spot
  made checkable. The ingredient master renders it as a dismissible panel with
  a link per item. Production returns 4 ingredients across 6 branch-item pairs:
  _Tepung Panir Katsu Kuning_ (666 + 333), _Tepung Panir Katsu Putih_
  (1334 + 667), _Miso Pasta_ (30), _Vaccum Pack 30x40_ (1).

## The sheet counts what the branch holds

The catalog scope is not the whole answer. Five write paths create a stock
record without reading the catalog flag: manual adjustment, SCM transfer-in,
supplier delivery, waste/yield, and `ensureInventoryRow` on a sale. Each one
treats a missing record as a setup gap, not as a reason to refuse a real
movement. A branch can therefore hold real stock for an item flagged out of its
catalog, and the ledger proves it: all 6 production cases carry an `ADJ-`
reference whose notes read "stock awal" / "barang masuk".

The outlet sheet is therefore a union:

```
SO lines = branch catalog UNION { countable, not Deleted, held at this branch }
```

Central scope is unchanged (its catalog already includes every countable item).
Those union lines carry `outsideBranchCatalog: true` on the detail and a
`[di luar katalog]` suffix on the printout, so a counter working from paper sees
them too. A central role gets a link to the ingredient edit page to fix the flag;
a `branch_admin` gets the badge and the banner but not the link, because the
ingredient page is role-guarded to central roles. The trigger modal warns before
an opname starts.

Measured: 88-91 lines per outlet, of which 0-2 are held outside the catalog
(6 lines across the network, the same 4 ingredients). The union breaks the strict
parity invariant, so the parity test now pins the union and asserts that exactly
the flagged-out lines carry the marker.

Known edge, left deliberately: lines that are flagged TRUE but restricted away by
the allow-list are counted through the union half with **no** marker, because the
marker reports the flag and not the link. 4 live lines are in that state.

## Still unresolved — role vs branch type

The ingredient master gates the flag by **role** (`branch_admin`), while the
opname gates it by **branch type** (`Outlet`). A `branch_admin` assigned to a
Central-type branch (Central Kitchen Food Prep) therefore sees 93 ingredients
but a 152-line sheet. Parity test 3 pins the opname half so a future "unify by
role" change cannot silently drop central-only items from that branch's count
sheet. Either the master half must follow the branch type, or someone must
state that "what can this user see" and "what does this branch count" are two
different questions on purpose. That call is still owed.

## References

- ADR 0001 decision 6 (countable only), ADR 0009 (tombstone), ADR 0015 rule 4
  (read-path core extraction), ADR 0021 (realize on the 25th).
- `scripts/diagnose-so-catalog-gap.mjs` — reproduces both scopes side by side
  against the live database.
