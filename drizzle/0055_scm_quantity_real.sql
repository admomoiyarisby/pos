-- Decimal quantities for the Pengadaan / Mutasi / SJ pipeline.
--
-- The item-level quantity columns were `integer` while the stock side
-- (`inventory.quantity`, `stock_ledger.quantity/balance`) is `real`. That made
-- fractional receiving impossible: a decimal like 2.5 kg would be silently
-- rounded by Postgres on insert into an integer column. These columns now
-- match the inventory side so quantities flow end-to-end without rounding.
--
-- Scopes to the SCM pipeline only (Pengadaan, Mutasi, SJ + their staging
-- tables). The ingredient master (`ingredients.rop/roq/moq/conversionFactor`)
-- and other modules (recipes, waste, yield) keep integers for now.
--
-- Note: integer → real keeps existing values exactly (integers are
-- representable in float32 for magnitudes well beyond anything stocked here).

ALTER TABLE scm_procurement_items
  ALTER COLUMN quantity TYPE real,
  ALTER COLUMN ready_quantity TYPE real,
  ALTER COLUMN picked_quantity TYPE real,
  ALTER COLUMN received_quantity TYPE real,
  ALTER COLUMN rejected_quantity TYPE real;

ALTER TABLE scm_transfer_items
  ALTER COLUMN quantity TYPE real,
  ALTER COLUMN received_quantity TYPE real,
  ALTER COLUMN rejected_quantity TYPE real;

ALTER TABLE delivery_note_items
  ALTER COLUMN quantity TYPE real,
  ALTER COLUMN ready_quantity TYPE real,
  ALTER COLUMN picked_quantity TYPE real,
  ALTER COLUMN received_quantity TYPE real,
  ALTER COLUMN rejected_quantity TYPE real;

-- Staging tables that hold quantities copied from the item rows above.
ALTER TABLE in_transit_inventory
  ALTER COLUMN quantity TYPE real;

ALTER TABLE pending_review_inventory
  ALTER COLUMN quantity TYPE real;

-- The SCM reject effects write a waste_entries row for the rejected quantity
-- (the disposition record), which can now be fractional.
ALTER TABLE waste_entries
  ALTER COLUMN quantity TYPE real;
