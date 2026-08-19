-- ADR-0009 mirror: ingredient soft-delete tombstone.
-- ingredients.status uses ingredient_status ('Active' | 'Inactive'), which is
-- only consumed by the ingredients table (recipes moved to recipe_status in
-- 0026). Add a third 'Deleted' value: the row is preserved (soft delete), the
-- UI never displays 'Deleted' ingredients, and restore is DB-only.
-- Hand-written migration, applied manually like drizzle/0028 (not journaled).
ALTER TYPE "ingredient_status" ADD VALUE IF NOT EXISTS 'Deleted';
