-- The app schema (src/db/schema.ts) has no uniqueness on `ingredients.alias`,
-- but a constraint named `ingredients_alias_unique` was added to the database
-- out-of-band, so creating an ingredient whose alias already exists failed with
-- `duplicate key value violates unique constraint "ingredients_alias_unique"`.
-- Drop it so the DB matches the schema (aliases may repeat).
ALTER TABLE "ingredients" DROP CONSTRAINT IF EXISTS "ingredients_alias_unique";
