-- ADR-0009: Recipe soft-delete tombstone.
-- recipes.status currently borrows ingredient_status ('Active' | 'Inactive').
-- Introduce a dedicated recipe_status enum with a third 'Deleted' value and
-- switch the column over. The row is preserved (soft delete); the UI never
-- displays 'Deleted' recipes and restore is DB-only.
CREATE TYPE "recipe_status" AS ENUM ('Active', 'Inactive', 'Deleted');

ALTER TABLE "recipes"
  ALTER COLUMN "status" TYPE "recipe_status"
  USING ("status"::text::"recipe_status");
