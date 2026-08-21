-- Omoiyari POS menu baseline, derived from the current database records and
-- docs/omoiyari-sheet.pdf (not from seed data).
--
-- The PDF menu names that exist in the database are sellable at every branch;
-- every other non-deleted recipe is inactive and therefore absent from POS.
-- An empty recipe_branches set means "all branches" in the shared visibility
-- gate, including branches added after this migration.

UPDATE recipes
SET status = 'Active', updated_at = now()
WHERE lower(trim(name)) IN (
  'gyumeshi',
  'karage don',
  'hot honey karage don',
  'gyuniku ala carte',
  'karage ala carte',
  'hot honey karage ala carte',
  'curry karage don',
  'miso sup',
  'nasi putih',
  'curry sauce',
  'spicy sauce',
  'extra 2pcs karage',
  'extra beef 50gr',
  'chicken katsu don',
  'curry katsu don',
  'matcha latte',
  'matcha tea',
  'ice tea',
  'japanese beef curry rice',
  'choco latte',
  'hojicha latte',
  'choco ichigo latte',
  'curry omurice',
  'japanese caramel pudding',
  'katsu bento'
);

UPDATE recipes
SET status = 'Inactive', updated_at = now()
WHERE status <> 'Deleted'
  AND lower(trim(name)) NOT IN (
    'gyumeshi',
    'karage don',
    'hot honey karage don',
    'gyuniku ala carte',
    'karage ala carte',
    'hot honey karage ala carte',
    'curry karage don',
    'miso sup',
    'nasi putih',
    'curry sauce',
    'spicy sauce',
    'extra 2pcs karage',
    'extra beef 50gr',
    'chicken katsu don',
    'curry katsu don',
    'matcha latte',
    'matcha tea',
    'ice tea',
    'japanese beef curry rice',
    'choco latte',
    'hojicha latte',
    'choco ichigo latte',
    'curry omurice',
    'japanese caramel pudding',
    'katsu bento'
  );

DELETE FROM recipe_branches AS rb
USING recipes AS r
WHERE rb.recipe_id = r.id
  AND r.status = 'Active'
  AND lower(trim(r.name)) IN (
    'gyumeshi',
    'karage don',
    'hot honey karage don',
    'gyuniku ala carte',
    'karage ala carte',
    'hot honey karage ala carte',
    'curry karage don',
    'miso sup',
    'nasi putih',
    'curry sauce',
    'spicy sauce',
    'extra 2pcs karage',
    'extra beef 50gr',
    'chicken katsu don',
    'curry katsu don',
    'matcha latte',
    'matcha tea',
    'ice tea',
    'japanese beef curry rice',
    'choco latte',
    'hojicha latte',
    'choco ichigo latte',
    'curry omurice',
    'japanese caramel pudding',
    'katsu bento'
  );
