# Procurement Unit Price Sourcing

## Context

The new SCM procurement flow (ADR 0002) generates an **Invoice SCM** at
`finish-receive` whose line items are priced at `unitPrice * receivedQuantity`.
The schema column `scm_procurement_items.unitPrice` (integer, nullable) was
introduced in ADR 0002 to hold this price, but no code path was filling it
in:

- `createProcurement` (the BA's "Buat Pengadaan" server function) inserted
  items with `unitPrice: null`
- The seed data (`scm-procurements-seed.ts`) likewise inserted with `null`
- The CA review form had no price field
- The BA's "Buat Pengadaan" form had no price field

The downstream consequence was that `generateInvoiceSnapshot` ran
`unitPrice ?? 0` for every line, producing invoices with `lineTotal = 0` and
a grand total of Rp 0 — no items listed, even when `receivedQuantity` and
`unitPrice` should have produced non-zero amounts.

The legacy 3-document SCM (purchase orders + delivery notes + invoices)
sidestepped this by looking up `ingredients.averageCost` **at invoice-generation
time** (in `scm.ts` line ~1484), bypassing the procurement item row entirely.
The new flow was meant to **snapshot** the price on the item — the column was
added for that — but the snapshot was never written.

## Decision

**Source**: `ingredients.averageCost` (the per-ingredient cost already
maintained for COGS and recipe cost roll-up).

**Snapshot time**: at procurement-item-creation time, inside `createProcurement`.
The server function issues a single `SELECT id, averageCost FROM ingredients
WHERE id IN (...)` for the new procurement's items, builds a `Map`, and
writes `unitPrice: priceById.get(ingredientId) ?? null` into each
`scm_procurement_items` row.

**UI visibility** (per design discussion, recorded for traceability):

- **CA review form** (`ScmItemTable` `ca-review` mode): price shown
  read-only in a `Harga` column, with a per-line `Subtotal`
  (`readyQuantity * unitPrice`) and a tfoot `Subtotal` row showing the
  grand subtotal. Lets the CA see the cost impact while approving items.
- **BA's "Buat Pengadaan" form** (`new.tsx`): price shown read-only in
  a `Harga` column with per-line `Subtotal` and a tfoot `Total` row.
  Lets the BA see what they're requesting before submitting (transparency
  aid, not editable in this flow).
- **CA does NOT have a price-override field** in this iteration. If a
  procurement needs a non-default price, CA adjusts `ingredients.averageCost`
  first and creates a new procurement. (A future iteration could add a
  per-item `overrideUnitPrice` column if this becomes a real need.)

**Migration for existing data**: one-shot backfill
(`0014_backfill_scm_unit_price.sql`) that runs
`UPDATE scm_procurement_items SET unit_price = i.average_cost FROM ingredients
i WHERE spi.ingredient_id = i.id AND spi.unit_price IS NULL`. Idempotent
(skip rows that already have a price). Runs once after this ADR is applied
to repair the 3 existing seed procurements.

**Seed file**: updated to write `unitPrice: it.averageCost` in all three
seed insert blocks, so future `npm run db:seed` runs produce items with
prices from the start.

## Consequences

- **Price is frozen at creation time.** A procurement created today uses
  today's `averageCost`. If `averageCost` changes tomorrow (e.g., due to
  a new supplier quote), this procurement is unaffected. The invoice will
  show the old price. For an MVP, this is the right trade-off — a "live
  lookup at invoice time" would let the price shift mid-flight, which
  is worse for audit clarity.

- **The price column is now load-bearing.** The `scm_procurement_items.unitPrice`
  column went from "vestigial (no writers)" to "the source of truth for
  what the branch is being invoiced." Any future report that asks "what
  was the procurement price for ingredient X" reads from this column.

- **No manual price entry in the current flow.** If a specific
  procurement genuinely needs a different price (e.g., volume discount
  negotiated by phone), the workaround is: temporarily update
  `ingredients.averageCost`, create the procurement, restore the
  `averageCost`. This is ugly and should be replaced with a proper
  per-procurement price override when the need becomes real. Logged as
  a TODO, not implemented.

- **Backfill handles existing data.** The 3 seed procurements (Draft,
  UnderReview, Finished) were created before this fix and had null
  prices. Migration `0014` backfills them from current `averageCost` in
  one statement.

- **The CA's review is now a cost check.** The CA can see the total
  they're approving before clicking "Setujui & Buat SJ." If
  `averageCost` is wrong, the wrong total is visible. This is a feature
  (catches bad data) but also a footgun (a CA might approve an item
  because "the total looks reasonable" without checking per-line
  quantities). UI doesn't surface this risk — the CA still has to read
  the rows.

- **No new schema columns.** The pricing data fits in the existing
  `unitPrice` column. No `overrideUnitPrice`, no `priceListId`, no
  `priceVersion`. If a future iteration needs price versioning, that's
  a new ADR.

## Alternatives considered

- **A. Look up `averageCost` at `finish-receive` (legacy pattern).**
  Pro: always uses the current cost. Con: contradicts the
  `scm_procurement_items.unitPrice` column; the column becomes
  vestigial; a future query "what was the price on this procurement
  item" can't be answered from the row. Rejected — this is what the
  legacy code did, and the whole point of the new flow was to put the
  price on the item.

- **B. CA sets the price manually at `accept-and-ship`.**
  Pro: most flexible — CA can negotiate per-procurement prices. Con:
  adds a CA step; requires a new field in the review form; the price
  is invisible to the BA at receipt time (BA would only see it on the
  invoice). Rejected for the MVP — the cost is system-known, no need
  to ask a human. Re-evaluate if real supplier negotiations become a
  thing.

- **C. Add a separate "procurement price list" table** (per-ingredient
  prices maintained by CA, snapshot at creation).
  Pro: cleanest model; prices can be reviewed/audited separately from
  `averageCost`; the "this is what we charge for procurement" concept
  is explicit. Con: another table, another UI for CA to maintain, more
  complexity than the current need warrants. Rejected for the MVP —
  premature abstraction. If `averageCost` ever diverges from "what
  central charges branches", this becomes the right answer.

- **D. Source from `ingredients.plannedCost` instead of `averageCost`.**
  Pro: planned cost is forward-looking (what we expect to pay), which
  is arguably the right "selling price" for procurement. Con:
  `plannedCost` is nullable in the schema (only `averageCost` is
  required); many ingredients have null `plannedCost`; would need a
  `?? averageCost` fallback anyway. Rejected — the fallback makes
  `plannedCost` a no-op for the majority of rows; just use
  `averageCost` directly and avoid the confusion.
