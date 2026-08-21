-- Add a manual sort order to modifier_groups so operators can reorder the
-- groups themselves (drag-and-drop on /modifier-groups). The order drives how
-- modifier groups appear in the POS ModifierModal and the recipe-edit menu.
ALTER TABLE "modifier_groups" ADD COLUMN "sort_order" integer NOT NULL DEFAULT 0;

-- Backfill sort_order from the current name order so existing groups keep a
-- stable, predictable order (matching the previous alphabetical listing)
-- until the operator reorders them.
UPDATE modifier_groups
SET sort_order = sub.row_num - 1
FROM (
  SELECT id, ROW_NUMBER() OVER (ORDER BY name) AS row_num
  FROM modifier_groups
) sub
WHERE modifier_groups.id = sub.id;
