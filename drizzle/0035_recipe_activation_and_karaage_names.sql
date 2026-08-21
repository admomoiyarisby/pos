-- Recipe activation policy from the real database:
-- * Every beverage, snack, and add-on is active.
-- * Only the approved main dishes are active.
-- * Active recipes have no explicit branch links, meaning every branch.
-- * Inactive recipes are filtered out of POS by getPosMenu (status = Active).

-- Normalize the recipe spelling to Karaage.
UPDATE recipes
SET name = CASE code
  WHEN 'REC-002' THEN 'Karaage Don'
  WHEN 'REC-003' THEN 'Hot Honey Karaage Don'
  WHEN 'REC-005' THEN 'Karaage Ala Carte'
  WHEN 'REC-006' THEN 'Hot Honey Karaage Ala Carte'
  WHEN 'REC-012' THEN 'extra 2pcs karaage'
  WHEN 'REC-037' THEN 'Karaage Bento'
  ELSE name
END,
updated_at = now()
WHERE code IN ('REC-002', 'REC-003', 'REC-005', 'REC-006', 'REC-012', 'REC-037');

-- All non-deleted beverages, snacks, and add-ons are active.
UPDATE recipes
SET status = 'Active', updated_at = now()
WHERE status <> 'Deleted'
  AND category IN ('minuman', 'snack', 'add_ons');

-- Approved main dishes from the PDF, including the four newly added recipes.
UPDATE recipes
SET status = 'Active', updated_at = now()
WHERE status <> 'Deleted'
  AND category = 'makanan'
  AND lower(trim(name)) IN (
    'gyumeshi',
    'karaage don',
    'hot honey karaage don',
    'gyuniku ala carte',
    'karaage ala carte',
    'hot honey karaage ala carte',
    'curry karaage don',
    'miso sup',
    'nasi putih',
    'chicken katsu don',
    'curry katsu don',
    'japanese beef curry rice',
    'curry omurice',
    'katsu bento',
    'gohan',
    'karaage bento',
    'gyuniku bento'
  );

-- Only main dishes outside the approved list are inactive. Other categories
-- were activated above and are intentionally not affected by this update.
UPDATE recipes
SET status = 'Inactive', updated_at = now()
WHERE status <> 'Deleted'
  AND category = 'makanan'
  AND lower(trim(name)) NOT IN (
    'gyumeshi',
    'karaage don',
    'hot honey karaage don',
    'gyuniku ala carte',
    'karaage ala carte',
    'hot honey karaage ala carte',
    'curry karaage don',
    'miso sup',
    'nasi putih',
    'chicken katsu don',
    'curry katsu don',
    'japanese beef curry rice',
    'curry omurice',
    'katsu bento',
    'gohan',
    'karaage bento',
    'gyuniku bento'
  );

-- Active recipes are available at every branch. Empty recipe_branches means
-- universal visibility in the branch visibility gate.
DELETE FROM recipe_branches AS rb
USING recipes AS r
WHERE rb.recipe_id = r.id
  AND r.status = 'Active';
