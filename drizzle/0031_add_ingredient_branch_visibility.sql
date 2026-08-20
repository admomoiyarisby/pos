-- Branch-vs-central ingredient visibility (omoiyari stock-opname catalog).
-- Hand-written migration, applied manually like drizzle/0028-0030 (not journaled).
--
-- Items flagged is_branch_visible = true are the branch (outlet) catalog: visible
-- to outlet branches (role branch_admin). Items left false are visible only to the
-- central warehouse + management (super_admin / admin_pusat / central_kitchen /
-- area_manager). Per-branch exceptions still work via the existing
-- ingredient_branches link table (ANDed on top in getIngredients).
--
-- Source of truth: docs/omoiyari-stock-form.pdf (70-item branch catalog,
-- BR-0001 .. BR-0070). Covers all 70: 54 exact + 4 near + 2 renamed-existing
-- + 10 newly inserted.
--
-- ASSUMPTION: the target DB was seeded from src/lib/seed/seed-data.ts so the
-- referenced ING-xxx codes exist; missing codes make their UPDATE/INSERT no-op
-- (harmless). Adjust the IN(...) / code lists if your env uses different codes.

ALTER TABLE "ingredients" ADD COLUMN IF NOT EXISTS "is_branch_visible" BOOLEAN NOT NULL DEFAULT false;

-- 1) Exact name matches to existing ingredients (54 of the 70 PDF items).
UPDATE "ingredients" SET "is_branch_visible" = true WHERE "code" IN (
  'ING-004', 'ING-009', 'ING-095', 'ING-015', 'ING-016', 'ING-017', 'ING-020', 'ING-021',
  'ING-101', 'ING-025', 'ING-034', 'ING-039', 'ING-042', 'ING-045', 'ING-058', 'ING-103',
  'ING-061', 'ING-062', 'ING-065', 'ING-066', 'ING-076', 'ING-105', 'ING-106', 'ING-069',
  'ING-070', 'ING-108', 'ING-109', 'ING-111', 'ING-071', 'ING-083', 'ING-113', 'ING-055',
  'ING-023', 'ING-077', 'ING-114', 'ING-116', 'ING-117', 'ING-118', 'ING-119', 'ING-003',
  'ING-121', 'ING-122', 'ING-123', 'ING-130', 'ING-088', 'ING-089', 'ING-094', 'ING-096',
  'ING-124', 'ING-125', 'ING-126', 'ING-007', 'ING-127', 'ING-090'
);

-- 2) Confident near-matches: PDF item exists under a differently-named ingredient
--    (same physical product). Mapping reviewed against seed-data.ts:
--      BR-0005 HOJICHA POWDER  -> ING-010 Bubuk Hojicha
--      BR-0006 SKM             -> ING-011 Susu Kental Manis
--      BR-0015 DASHI           -> ING-028 Dashi Halal
--      BR-0023 TUTUP BOWL      -> ING-060 Tutup Bowl 650 ml
UPDATE "ingredients" SET "is_branch_visible" = true WHERE "code" IN (
  'ING-010', 'ING-011', 'ING-028', 'ING-060'
);

-- 3) Uncertain -> mapped to existing ingredient AND renamed to the PDF name
--    (per request). SUSU DIAMOND maps to the generic ING-001 "Susu".
UPDATE "ingredients" SET "name" = 'Matcha Powder',   "is_branch_visible" = true WHERE "code" = 'ING-100';
UPDATE "ingredients" SET "name" = 'Susu Diamond',    "is_branch_visible" = true WHERE "code" = 'ING-001';

-- 4) New ingredients for the 10 PDF items with no existing master row. Sensible
--    defaults (category/unit best-guess, cost 0, RM, conversion 1); correct details
--    later in the UI. Codes use the PDF's BR-00xx so the mapping is explicit.
INSERT INTO "ingredients"
  ("id", "code", "name", "category", "sku_type", "purchase_unit", "stock_unit",
   "conversion_factor", "average_cost", "rop", "roq", "moq", "status", "countable", "is_nasi", "is_branch_visible")
VALUES
  (gen_random_uuid(), 'BR-0020', 'Saus Katsu',                  'Dry',       'RM', 'gram', 'gram', 1, 0, 0, 0, 1, 'Active', true, false, true),
  (gen_random_uuid(), 'BR-0033', 'Ayam Matang',                'Fresh',     'RM', 'gram', 'gram', 1, 0, 0, 0, 1, 'Active', true, false, true),
  (gen_random_uuid(), 'BR-0034', 'Daging Matang',              'Fresh',     'RM', 'gram', 'gram', 1, 0, 0, 0, 1, 'Active', true, false, true),
  (gen_random_uuid(), 'BR-0037', 'Spicy Minced Chicken Sauce', 'Dry',       'RM', 'pcs',  'pcs',  1, 0, 0, 0, 1, 'Active', true, false, true),
  (gen_random_uuid(), 'BR-0039', 'Bubuk Choco Latte',          'Dry',       'RM', 'gram', 'gram', 1, 0, 0, 0, 1, 'Active', true, false, true),
  (gen_random_uuid(), 'BR-0046', 'LPG',                        'Packaging', 'RM', 'pcs',  'pcs',  1, 0, 0, 0, 1, 'Active', true, false, true),
  (gen_random_uuid(), 'BR-0047', 'Galon',                      'Packaging', 'RM', 'pcs',  'pcs',  1, 0, 0, 0, 1, 'Active', true, false, true),
  (gen_random_uuid(), 'BR-0048', 'Sunlight',                   'Packaging', 'RM', 'ml',   'ml',   1, 0, 0, 0, 1, 'Active', true, false, true),
  (gen_random_uuid(), 'BR-0050', 'Ayam Katsu',                'Fresh',     'RM', 'pcs',  'pcs',  1, 0, 0, 0, 1, 'Active', true, false, true),
  (gen_random_uuid(), 'BR-0055', 'Isi Steples',               'Packaging', 'RM', 'pcs',  'pcs',  1, 0, 0, 0, 1, 'Active', true, false, true);
