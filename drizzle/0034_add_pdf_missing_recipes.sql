-- Add PDF menu records that were absent from the real database.
-- Prices are intentionally Rp 0 because the source PDF has no selling prices.
-- No recipe_branches rows are created: empty means available to every branch.

INSERT INTO recipes
  (id, code, name, description, category, category_id, is_sub_recipe, base_price, status)
SELECT gen_random_uuid(), v.code, v.name, 'Imported from docs/omoiyari-sheet.pdf', v.category::recipe_category,
       c.id, false, 0, 'Active'
FROM (
  VALUES
    ('REC-036', 'Gohan', 'makanan'),
    ('REC-037', 'Kaarage Bento', 'makanan'),
    ('REC-038', 'Gyuniku Bento', 'makanan'),
    ('REC-039', 'Biang Teh', 'minuman')
) AS v(code, name, category)
JOIN categories c ON c.code = v.category
WHERE NOT EXISTS (
  SELECT 1 FROM recipes r WHERE r.code = v.code OR lower(trim(r.name)) = lower(trim(v.name))
);

-- All four new recipes use the existing Omoiyari brand.
INSERT INTO recipe_brands (recipe_id, brand_id)
SELECT r.id, b.id
FROM recipes r
CROSS JOIN brands b
WHERE r.code IN ('REC-036', 'REC-037', 'REC-038', 'REC-039')
  AND b.code = 'BRAND-1'
  AND NOT EXISTS (
    SELECT 1
    FROM recipe_brands rb
    WHERE rb.recipe_id = r.id AND rb.brand_id = b.id
  );

WITH pdf_bom(recipe_code, ingredient_code, quantity) AS (
  VALUES
    -- Gohan
    ('REC-036', 'ING-NASI', 180::real),
    ('REC-036', 'ING-042', 1::real),
    -- Kaarage Bento
    ('REC-037', 'ING-NASI', 67.5::real),
    ('REC-037', 'ING-107', 100::real),
    ('REC-037', 'ING-124', 2::real),
    ('REC-037', 'ING-094', 1::real),
    ('REC-037', 'ING-096', 10::real),
    ('REC-037', 'ING-125', 5::real),
    ('REC-037', 'ING-014', 110::real),
    ('REC-037', 'ING-126', 15::real),
    ('REC-037', 'ING-127', 15::real),
    ('REC-037', 'ING-013', 5::real),
    ('REC-037', 'ING-089', 1::real),
    ('REC-037', 'ING-007', 10::real),
    -- Gyuniku Bento
    ('REC-038', 'ING-NASI', 67.5::real),
    ('REC-038', 'ING-024', 60::real),
    ('REC-038', 'ING-124', 2::real),
    ('REC-038', 'ING-094', 1::real),
    ('REC-038', 'ING-096', 10::real),
    ('REC-038', 'ING-125', 5::real),
    ('REC-038', 'ING-014', 110::real),
    ('REC-038', 'ING-126', 15::real),
    ('REC-038', 'ING-127', 15::real),
    ('REC-038', 'ING-013', 5::real),
    ('REC-038', 'ING-089', 1::real),
    ('REC-038', 'ING-007', 10::real),
    -- Biang Teh
    ('REC-039', 'ING-118', 100::real),
    ('REC-039', 'ING-009', 20::real),
    ('REC-039', 'ING-014', 50::real)
)
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity)
SELECT r.id, i.id, b.quantity
FROM pdf_bom b
JOIN recipes r ON r.code = b.recipe_code
JOIN ingredients i ON i.code = b.ingredient_code
WHERE NOT EXISTS (
  SELECT 1
  FROM recipe_ingredients ri
  WHERE ri.recipe_id = r.id AND ri.ingredient_id = i.id
);
