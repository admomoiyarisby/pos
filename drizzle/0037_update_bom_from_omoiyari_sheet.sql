-- Align recipe BOMs with the Stock Opname Inventory (docs/omoiyari-sheet.md).
--
-- The sheet is the authoritative per-menu ingredient list (SKU code + qty).
-- Every menu that exists in the DB gets its BOM replaced with exactly the
-- sheet's lines:
--   * Rice-based dishes now reference ING-NASI (Nasi Putih, FG) directly
--     instead of the raw Beras/Beras Ketan/Air/Cuka Nasi breakdown.
--   * Packaging switches from Bowl Mangkok/Tutup Mangkok to
--     Paper Bowl 650 ml / Tutup Bowl 650 ml (the sheet's SKUs).
--   * Bayam Crispy (ING-035), Biang Teh (ING-093), White Coin (ING-090),
--     Susu Kental Manis (ING-011) enter BOMs where the sheet lists them.
--   * Operational rows the sheet doesn't list (LPG, Sarung Tangan Plastik,
--     Kresek Putih 35) are dropped from these recipes.
--
-- totalCogs is intentionally NOT recomputed: HPP is a curated value sourced
-- from the Menu Kasir / Excel HPP sheets, not derived from the BOM.

-- 1) Clear the existing BOM lines for every recipe covered by the sheet.
DELETE FROM recipe_ingredients AS ri
USING recipes AS r
WHERE ri.recipe_id = r.id
  AND r.code IN (
    'REC-001', 'REC-002', 'REC-003', 'REC-004', 'REC-005', 'REC-006',
    'REC-007', 'REC-008', 'REC-009', 'REC-010', 'REC-011', 'REC-012',
    'REC-013', 'REC-014', 'REC-015', 'REC-016', 'REC-017', 'REC-018',
    'REC-019', 'REC-030', 'REC-031', 'REC-032', 'REC-033', 'REC-034',
    'REC-035', 'REC-036', 'REC-037', 'REC-038', 'REC-039'
  );

-- 2) Insert the sheet's BOM lines (recipe code, ingredient code, qty).
WITH bom(recipe_code, ingredient_code, quantity) AS (
  VALUES
    -- Gyumeshi
    ('REC-001', 'ING-024', 60::real),
    ('REC-001', 'ING-059', 1::real),
    ('REC-001', 'ING-060', 1::real),
    ('REC-001', 'ING-065', 1::real),
    ('REC-001', 'ING-035', 10::real),
    ('REC-001', 'ING-NASI', 180::real),
    -- Karage Don
    ('REC-002', 'ING-107', 100::real),
    ('REC-002', 'ING-059', 1::real),
    ('REC-002', 'ING-060', 1::real),
    ('REC-002', 'ING-035', 10::real),
    ('REC-002', 'ING-NASI', 180::real),
    -- Hot Honey Karage Don
    ('REC-003', 'ING-107', 100::real),
    ('REC-003', 'ING-059', 1::real),
    ('REC-003', 'ING-060', 1::real),
    ('REC-003', 'ING-NASI', 180::real),
    ('REC-003', 'ING-035', 10::real),
    ('REC-003', 'ING-108', 20::real),
    -- Gyuniku Ala Carte
    ('REC-004', 'ING-024', 140::real),
    ('REC-004', 'ING-070', 1::real),
    -- Karage Ala Carte
    ('REC-005', 'ING-107', 260::real),
    ('REC-005', 'ING-059', 1::real),
    ('REC-005', 'ING-060', 1::real),
    -- Hot Honey Karage Ala Carte
    ('REC-006', 'ING-107', 260::real),
    ('REC-006', 'ING-059', 1::real),
    ('REC-006', 'ING-060', 1::real),
    ('REC-006', 'ING-108', 40::real),
    -- Curry Karage Don
    ('REC-007', 'ING-107', 100::real),
    ('REC-007', 'ING-059', 1::real),
    ('REC-007', 'ING-060', 1::real),
    ('REC-007', 'ING-NASI', 180::real),
    ('REC-007', 'ING-035', 10::real),
    ('REC-007', 'ING-109', 1::real),
    -- Curry Omurice
    ('REC-033', 'ING-004', 2::real),
    ('REC-033', 'ING-059', 1::real),
    ('REC-033', 'ING-060', 1::real),
    ('REC-033', 'ING-NASI', 180::real),
    ('REC-033', 'ING-109', 1::real),
    ('REC-033', 'ING-034', 3::real),
    ('REC-033', 'ING-028', 3::real),
    ('REC-033', 'ING-035', 10::real),
    ('REC-033', 'ING-025', 5::real),
    -- Miso Sup
    ('REC-008', 'ING-111', 1::real),
    ('REC-008', 'ING-062', 1::real),
    ('REC-008', 'ING-055', 0.5::real),
    ('REC-008', 'ING-042', 1::real),
    -- Gohan
    ('REC-036', 'ING-NASI', 180::real),
    ('REC-036', 'ING-042', 1::real),
    -- Curry Sauce
    ('REC-010', 'ING-109', 1::real),
    -- Spicy Sauce
    ('REC-011', 'ING-049', 1::real),
    -- extra 2pcs karage
    ('REC-012', 'ING-107', 65::real),
    -- extra beef 50gr
    ('REC-013', 'ING-024', 35::real),
    -- Chicken Katsu Don
    ('REC-014', 'ING-115', 1::real),
    ('REC-014', 'ING-052', 15::real),
    ('REC-014', 'ING-059', 1::real),
    ('REC-014', 'ING-060', 1::real),
    ('REC-014', 'ING-NASI', 180::real),
    ('REC-014', 'ING-035', 10::real),
    ('REC-014', 'ING-062', 1::real),
    -- Curry Katsu Don
    ('REC-015', 'ING-115', 1::real),
    ('REC-015', 'ING-109', 1::real),
    ('REC-015', 'ING-059', 1::real),
    ('REC-015', 'ING-060', 1::real),
    ('REC-015', 'ING-NASI', 180::real),
    ('REC-015', 'ING-035', 10::real),
    ('REC-015', 'ING-062', 1::real),
    -- Matcha Latte
    ('REC-016', 'ING-100', 3::real),
    ('REC-016', 'ING-090', 2::real),
    ('REC-016', 'ING-009', 15::real),
    ('REC-016', 'ING-014', 50::real),
    ('REC-016', 'ING-013', 180::real),
    ('REC-016', 'ING-008', 125::real),
    ('REC-016', 'ING-022', 1::real),
    ('REC-016', 'ING-015', 1::real),
    -- Hojicha Latte
    ('REC-031', 'ING-010', 4::real),
    ('REC-031', 'ING-009', 15::real),
    ('REC-031', 'ING-014', 50::real),
    ('REC-031', 'ING-013', 180::real),
    ('REC-031', 'ING-008', 125::real),
    ('REC-031', 'ING-022', 1::real),
    ('REC-031', 'ING-015', 1::real),
    -- Choco Latte
    ('REC-030', 'ING-112', 12::real),
    ('REC-030', 'ING-011', 15::real),
    ('REC-030', 'ING-009', 8::real),
    ('REC-030', 'ING-014', 50::real),
    ('REC-030', 'ING-008', 125::real),
    ('REC-030', 'ING-013', 180::real),
    ('REC-030', 'ING-022', 1::real),
    ('REC-030', 'ING-015', 1::real),
    -- Matcha Tea
    ('REC-017', 'ING-100', 1.5::real),
    ('REC-017', 'ING-009', 25::real),
    ('REC-017', 'ING-014', 50::real),
    ('REC-017', 'ING-013', 180::real),
    ('REC-017', 'ING-014', 125::real),
    ('REC-017', 'ING-101', 1::real),
    ('REC-017', 'ING-015', 1::real),
    -- Choco Ichigo Latte
    ('REC-032', 'ING-112', 12::real),
    ('REC-032', 'ING-011', 15::real),
    ('REC-032', 'ING-009', 8::real),
    ('REC-032', 'ING-016', 20::real),
    ('REC-032', 'ING-014', 50::real),
    ('REC-032', 'ING-008', 125::real),
    ('REC-032', 'ING-013', 180::real),
    ('REC-032', 'ING-022', 1::real),
    ('REC-032', 'ING-015', 1::real),
    -- Ice Tea
    ('REC-018', 'ING-093', 100::real),
    ('REC-018', 'ING-009', 20::real),
    ('REC-018', 'ING-014', 50::real),
    ('REC-018', 'ING-013', 180::real),
    ('REC-018', 'ING-101', 1::real),
    ('REC-018', 'ING-015', 1::real),
    -- Japanese Beef Curry Rice
    ('REC-019', 'ING-024', 60::real),
    ('REC-019', 'ING-109', 1::real),
    ('REC-019', 'ING-059', 1::real),
    ('REC-019', 'ING-060', 1::real),
    ('REC-019', 'ING-NASI', 180::real),
    ('REC-019', 'ING-035', 10::real),
    ('REC-019', 'ING-065', 1::real),
    -- Japanese Caramel Pudding
    ('REC-034', 'ING-123', 1::real),
    -- Karaage Bento
    ('REC-037', 'ING-NASI', 67.5::real),
    ('REC-037', 'ING-107', 100::real),
    ('REC-037', 'ING-124', 2::real),
    ('REC-037', 'ING-094', 1::real),
    ('REC-037', 'ING-096', 10::real),
    ('REC-037', 'ING-125', 5::real),
    ('REC-037', 'ING-014', 100::real),
    ('REC-037', 'ING-126', 15::real),
    ('REC-037', 'ING-127', 15::real),
    ('REC-037', 'ING-014', 10::real),
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
    ('REC-038', 'ING-014', 100::real),
    ('REC-038', 'ING-126', 15::real),
    ('REC-038', 'ING-127', 15::real),
    ('REC-038', 'ING-014', 10::real),
    ('REC-038', 'ING-013', 5::real),
    ('REC-038', 'ING-089', 1::real),
    ('REC-038', 'ING-007', 10::real),
    -- Katsu Bento
    ('REC-035', 'ING-NASI', 67.5::real),
    ('REC-035', 'ING-115', 1::real),
    ('REC-035', 'ING-124', 2::real),
    ('REC-035', 'ING-094', 1::real),
    ('REC-035', 'ING-096', 10::real),
    ('REC-035', 'ING-125', 5::real),
    ('REC-035', 'ING-014', 100::real),
    ('REC-035', 'ING-126', 15::real),
    ('REC-035', 'ING-127', 15::real),
    ('REC-035', 'ING-014', 10::real),
    ('REC-035', 'ING-013', 5::real),
    ('REC-035', 'ING-089', 1::real),
    ('REC-035', 'ING-007', 10::real),
    -- nasi putih
    ('REC-009', 'ING-023', 67.5::real),
    ('REC-009', 'ING-088', 7.5::real),
    ('REC-009', 'ING-014', 117::real),
    ('REC-009', 'ING-089', 1.25::real),
    -- Biang Teh
    ('REC-039', 'ING-118', 1::real),
    ('REC-039', 'ING-014', 2000::real)
)
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity)
SELECT r.id, i.id, b.quantity
FROM bom b
JOIN recipes r ON r.code = b.recipe_code
JOIN ingredients i ON i.code = b.ingredient_code
WHERE NOT EXISTS (
  SELECT 1
  FROM recipe_ingredients ri
  WHERE ri.recipe_id = r.id AND ri.ingredient_id = i.id AND ri.quantity = b.quantity
);
