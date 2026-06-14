-- Backfill scm_procurement_items.unit_price from ingredients.average_cost.
-- ADR 0003: Procurement pricing is sourced from ingredients.averageCost
-- snapshotted at item-creation time. This migration backfills existing
-- items where unit_price is still NULL (rows created before the fix
-- landed in createProcurement). Idempotent — the WHERE clause skips
-- rows that already have a price.
UPDATE "scm_procurement_items" spi
SET "unit_price" = i."average_cost"
FROM "ingredients" i
WHERE spi."ingredient_id" = i."id"
  AND spi."unit_price" IS NULL;
