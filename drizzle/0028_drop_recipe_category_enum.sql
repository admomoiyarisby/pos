-- Drop the legacy `recipe_category` pgEnum in favor of `recipes.category_id` (FK
-- to the categories master table). The wizard dropdown, POS grouping, and the
-- recipe list all read the category name via the categories join, so a category
-- created on /categories appears everywhere without an enum migration.
--
-- Step 1: backfill any NULL category_id from the legacy enum code, so the
-- NOT NULL constraint below never rejects a live row.
UPDATE recipes r
SET category_id = c.id
FROM categories c
WHERE r.category_id IS NULL
  AND r.category IS NOT NULL
  -- Cast the enum column to text so it can be compared against categories.code
  -- (Postgres has no `text = recipe_category` operator).
  AND c.code = r.category::text;

-- Step 2: any row still missing a category_id (no matching category row) gets
-- assigned to the first category by code, so the NOT NULL constraint can be
-- applied without data loss. This is defensive — the create/update paths kept
-- the FK in sync, so this should affect zero rows in practice.
UPDATE recipes r
SET category_id = sub.id
FROM (
  SELECT id FROM categories ORDER BY code LIMIT 1
) sub
WHERE r.category_id IS NULL;

-- Step 3: drop the legacy enum column.
ALTER TABLE "recipes" DROP COLUMN IF EXISTS "category";

-- Step 4: make the FK NOT NULL (every recipe must belong to a category).
ALTER TABLE "recipes" ALTER COLUMN "category_id" SET NOT NULL;

-- Step 5: drop the enum type now that no column references it.
DROP TYPE IF EXISTS "recipe_category";
