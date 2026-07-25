-- Refactor yield_conversions into a pure stock-movement record.
-- A production record now has N "out" (consumed) items and M "produced"
-- (output) items, stored in yield_conversion_items. This replaces the
-- legacy single source/target columns and the yield_conversion_sources
-- junction, and drops auto-HPP / yield% / shrinkage. Existing rows are
-- backfilled so no production history is lost.

DO $$ BEGIN
  CREATE TYPE "yield_item_direction" AS ENUM ('OUT', 'PRODUCED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "yield_conversion_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "conversion_id" uuid NOT NULL,
  "ingredient_id" uuid NOT NULL,
  "quantity" integer NOT NULL,
  "direction" "yield_item_direction" NOT NULL,
  CONSTRAINT "yield_conversion_items_conversion_id_fkey" FOREIGN KEY ("conversion_id") REFERENCES "yield_conversions" ("id") ON DELETE CASCADE,
  CONSTRAINT "yield_conversion_items_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients" ("id")
);

CREATE INDEX IF NOT EXISTS "yci_conversion_idx" ON "yield_conversion_items" ("conversion_id");
CREATE INDEX IF NOT EXISTS "yci_ingredient_idx" ON "yield_conversion_items" ("ingredient_id");

-- Backfill from the old yield_conversion_sources junction (multi-source OUTs).
INSERT INTO "yield_conversion_items" ("conversion_id", "ingredient_id", "quantity", "direction")
SELECT "yield_conversion_id", "ingredient_id", "quantity", 'OUT'
FROM "yield_conversion_sources"
ON CONFLICT DO NOTHING;

-- Backfill legacy single-source columns as OUT, but only for conversions that
-- have no junction rows (the first source was already backfilled above).
INSERT INTO "yield_conversion_items" ("conversion_id", "ingredient_id", "quantity", "direction")
SELECT yc."id", yc."source_ingredient_id", yc."source_quantity", 'OUT'
FROM "yield_conversions" yc
WHERE yc."source_ingredient_id" IS NOT NULL
  AND yc."source_quantity" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "yield_conversion_sources" ycs WHERE ycs."yield_conversion_id" = yc."id"
  )
ON CONFLICT DO NOTHING;

-- Backfill legacy target as PRODUCED (targets were never stored in the junction).
INSERT INTO "yield_conversion_items" ("conversion_id", "ingredient_id", "quantity", "direction")
SELECT "id", "target_ingredient_id", "target_quantity", 'PRODUCED'
FROM "yield_conversions"
WHERE "target_ingredient_id" IS NOT NULL
  AND "target_quantity" IS NOT NULL
ON CONFLICT DO NOTHING;

-- Drop legacy columns and the old junction table.
ALTER TABLE "yield_conversions" DROP COLUMN IF EXISTS "source_ingredient_id";
ALTER TABLE "yield_conversions" DROP COLUMN IF EXISTS "source_quantity";
ALTER TABLE "yield_conversions" DROP COLUMN IF EXISTS "target_ingredient_id";
ALTER TABLE "yield_conversions" DROP COLUMN IF EXISTS "target_quantity";
ALTER TABLE "yield_conversions" DROP COLUMN IF EXISTS "yield_percentage";
ALTER TABLE "yield_conversions" DROP COLUMN IF EXISTS "shrinkage_quantity";

DROP TABLE IF EXISTS "yield_conversion_sources";
