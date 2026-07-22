-- Seed the 5 existing recipe_category enum values into the new categories table
INSERT INTO categories (id, code, name)
VALUES
  (gen_random_uuid(), 'makanan', 'Makanan'),
  (gen_random_uuid(), 'minuman', 'Minuman'),
  (gen_random_uuid(), 'snack', 'Snack'),
  (gen_random_uuid(), 'add_ons', 'Add-Ons'),
  (gen_random_uuid(), 'paket_bundle', 'Paket / Bundle')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint

-- Backfill category_id on recipes by matching old category enum value to code
UPDATE recipes r
SET category_id = c.id
FROM categories c
WHERE r.category::text = c.code
  AND r.category_id IS NULL;
