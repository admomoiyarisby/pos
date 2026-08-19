-- One line per ingredient per procurement (issue #90): writeReceivedStock
-- clears pending-review rows per (procurement, ingredient), so duplicate
-- lines corrupt receiving. The UI already prevented duplicates; this closes
-- the API hole (createProcurement / addProcurementItem now reject them too).
--
-- Dedupe keeps the earliest line per (procurement, ingredient). Rows that
-- are referenced by the audit log are kept (the FK is RESTRICT), so if a
-- duplicate pair is *both* audited the ALTER below fails loudly — operator
-- must reconcile by hand rather than silently dropping audited rows.
DELETE FROM "scm_procurement_items" a
USING "scm_procurement_items" b
WHERE a."scm_procurement_id" = b."scm_procurement_id"
  AND a."ingredient_id" = b."ingredient_id"
  AND a."id" <> b."id"
  AND (a."sort_order" > b."sort_order"
       OR (a."sort_order" = b."sort_order" AND a."id" > b."id"))
  AND NOT EXISTS (
    SELECT 1 FROM "scm_procurement_audit_log" l WHERE l."item_id" = a."id"
  );

ALTER TABLE "scm_procurement_items" ADD CONSTRAINT "spi_procurement_ingredient_unique"
  UNIQUE ("scm_procurement_id", "ingredient_id");
