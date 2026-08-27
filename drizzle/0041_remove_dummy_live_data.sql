-- Remove known dummy LIVE / TEST data. This migration runs last, so all
-- referenced tables exist in the canonical migration chain.
DELETE FROM "yield_cancel_requests"
WHERE "yield_conversion_id" IN (
  SELECT "id" FROM "yield_conversions"
  WHERE "branch_id" IN (SELECT "id" FROM "branches" WHERE "code" ILIKE 'LIVE-BR%')
);

DELETE FROM "stock_ledger"
WHERE "ingredient_id" IN (
  SELECT "id" FROM "ingredients"
  WHERE "code" ILIKE 'LIVE%' OR "code" ILIKE 'TEST%'
    OR "code" IN ('BR-0037','BR-0020','BR-0050','BR-0039')
)
OR "branch_id" IN (SELECT "id" FROM "branches" WHERE "code" ILIKE 'LIVE-BR%');

DELETE FROM "inventory"
WHERE "ingredient_id" IN (
  SELECT "id" FROM "ingredients"
  WHERE "code" ILIKE 'LIVE%' OR "code" ILIKE 'TEST%'
    OR "code" IN ('BR-0037','BR-0020','BR-0050','BR-0039')
)
OR "branch_id" IN (SELECT "id" FROM "branches" WHERE "code" ILIKE 'LIVE-BR%');

DELETE FROM "in_transit_inventory"
WHERE "ingredient_id" IN (
  SELECT "id" FROM "ingredients"
  WHERE "code" ILIKE 'LIVE%' OR "code" ILIKE 'TEST%'
    OR "code" IN ('BR-0037','BR-0020','BR-0050','BR-0039')
)
OR "branch_id" IN (SELECT "id" FROM "branches" WHERE "code" ILIKE 'LIVE-BR%');

DELETE FROM "pending_review_inventory"
WHERE "ingredient_id" IN (
  SELECT "id" FROM "ingredients"
  WHERE "code" ILIKE 'LIVE%' OR "code" ILIKE 'TEST%'
    OR "code" IN ('BR-0037','BR-0020','BR-0050','BR-0039')
)
OR "branch_id" IN (SELECT "id" FROM "branches" WHERE "code" ILIKE 'LIVE-BR%');

DELETE FROM "ingredient_branches"
WHERE "ingredient_id" IN (
  SELECT "id" FROM "ingredients"
  WHERE "code" ILIKE 'LIVE%' OR "code" ILIKE 'TEST%'
    OR "code" IN ('BR-0037','BR-0020','BR-0050','BR-0039')
)
OR "branch_id" IN (SELECT "id" FROM "branches" WHERE "code" ILIKE 'LIVE-BR%');

DELETE FROM "yield_conversion_items"
WHERE "ingredient_id" IN (
  SELECT "id" FROM "ingredients"
  WHERE "code" ILIKE 'LIVE%' OR "code" ILIKE 'TEST%'
    OR "code" IN ('BR-0037','BR-0020','BR-0050','BR-0039')
);

DELETE FROM "recipe_ingredients" WHERE "ingredient_id" IN (SELECT "id" FROM "ingredients" WHERE "code" ILIKE 'LIVE%' OR "code" ILIKE 'TEST%' OR "code" IN ('BR-0037','BR-0020','BR-0050','BR-0039'));
DELETE FROM "modifier_ingredients" WHERE "ingredient_id" IN (SELECT "id" FROM "ingredients" WHERE "code" ILIKE 'LIVE%' OR "code" ILIKE 'TEST%' OR "code" IN ('BR-0037','BR-0020','BR-0050','BR-0039'));
DELETE FROM "purchase_requisition_items" WHERE "ingredient_id" IN (SELECT "id" FROM "ingredients" WHERE "code" ILIKE 'LIVE%' OR "code" ILIKE 'TEST%' OR "code" IN ('BR-0037','BR-0020','BR-0050','BR-0039'));
DELETE FROM "purchase_order_items" WHERE "ingredient_id" IN (SELECT "id" FROM "ingredients" WHERE "code" ILIKE 'LIVE%' OR "code" ILIKE 'TEST%' OR "code" IN ('BR-0037','BR-0020','BR-0050','BR-0039'));
DELETE FROM "delivery_note_items" WHERE "ingredient_id" IN (SELECT "id" FROM "ingredients" WHERE "code" ILIKE 'LIVE%' OR "code" ILIKE 'TEST%' OR "code" IN ('BR-0037','BR-0020','BR-0050','BR-0039'));
DELETE FROM "scm_procurement_items" WHERE "ingredient_id" IN (SELECT "id" FROM "ingredients" WHERE "code" ILIKE 'LIVE%' OR "code" ILIKE 'TEST%' OR "code" IN ('BR-0037','BR-0020','BR-0050','BR-0039'));
DELETE FROM "scm_transfer_items" WHERE "ingredient_id" IN (SELECT "id" FROM "ingredients" WHERE "code" ILIKE 'LIVE%' OR "code" ILIKE 'TEST%' OR "code" IN ('BR-0037','BR-0020','BR-0050','BR-0039'));

DELETE FROM "ingredients"
WHERE "code" ILIKE 'LIVE%' OR "code" ILIKE 'TEST%'
   OR "code" IN ('BR-0037','BR-0020','BR-0050','BR-0039');

UPDATE "ingredients" SET "name" = 'Susu'
WHERE "code" = 'ING-001' AND "name" = 'Test4';

UPDATE "users" SET "branch_id" = NULL
WHERE "branch_id" IN (SELECT "id" FROM "branches" WHERE "code" ILIKE 'LIVE-BR%');
DELETE FROM "area_manager_branches" WHERE "branch_id" IN (SELECT "id" FROM "branches" WHERE "code" ILIKE 'LIVE-BR%');
DELETE FROM "recipe_branches" WHERE "branch_id" IN (SELECT "id" FROM "branches" WHERE "code" ILIKE 'LIVE-BR%');
DELETE FROM "shifts" WHERE "branch_id" IN (SELECT "id" FROM "branches" WHERE "code" ILIKE 'LIVE-BR%');
DELETE FROM "orders" WHERE "branch_id" IN (SELECT "id" FROM "branches" WHERE "code" ILIKE 'LIVE-BR%');
DELETE FROM "stock_opnames" WHERE "branch_id" IN (SELECT "id" FROM "branches" WHERE "code" ILIKE 'LIVE-BR%');
DELETE FROM "branches" WHERE "code" ILIKE 'LIVE-BR%';
