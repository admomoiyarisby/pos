-- Ingredient branch visibility (mirrors recipe_branches).
-- An ingredient with zero rows here is visible in ALL branches; rows restrict
-- it to the listed branches. Enforced by a single gate in getIngredients keyed
-- on the caller's currentBranchId. Empty list therefore means "all branches".
CREATE TABLE IF NOT EXISTS "ingredient_branches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "ingredient_id" uuid NOT NULL,
  "branch_id" uuid NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "ingredient_branch_unique" UNIQUE ("ingredient_id", "branch_id")
);

ALTER TABLE "ingredient_branches" ADD CONSTRAINT "ingredient_branches_ingredient_id_fkey"
  FOREIGN KEY ("ingredient_id") REFERENCES "ingredients" ("id") ON DELETE CASCADE;

ALTER TABLE "ingredient_branches" ADD CONSTRAINT "ingredient_branches_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branches" ("id") ON DELETE CASCADE;

-- Speeds up the branch-scoped gate: EXISTS (... AND branch_id = $currentBranchId)
CREATE INDEX IF NOT EXISTS "icb_branch_idx" ON "ingredient_branches" ("branch_id");
