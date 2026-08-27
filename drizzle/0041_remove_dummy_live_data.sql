-- Remove dummy LIVE / TEST ingredients and branches introduced during
-- Kartu Stok ↔ Yield Tracking integration testing.
-- Ingredients like LIVE-PROD / LIVE-OUT and TEST-*, and branches LIVE-BR-*
-- were inserted via ad-hoc tests and are not part of the canonical seed.
-- This migration cleans them and their dependent rows so a fresh DB
-- and the live Supabase no longer show dummy stock movements.

-- 1) Yield cancel requests for dummy conversions
DELETE FROM "yield_cancel_requests"
WHERE "yield_conversion_id" IN (
  SELECT "id" FROM "yield_conversions"
  WHERE "branch_id" IN (SELECT "id" FROM "branches" WHERE "code" ILIKE 'LIVE-BR%')
  UNION
  SELECT "conversion_id" FROM "yield_conversion_items"
  WHERE "ingredient_id" IN (SELECT "id" FROM "ingredients" WHERE "code" ILIKE 'LIVE%' OR "code" ILIKE 'TEST%' OR "code" IN ('BR-0037','BR-0020','BR-0050','BR-0039'))
);

-- 2) Stock ledger for dummy ingredients / branches
DELETE FROM "stock_ledger"
WHERE "ingredient_id" IN (SELECT "id" FROM "ingredients" WHERE "code" ILIKE 'LIVE%' OR "code" ILIKE 'TEST%' OR "code" IN ('BR-0037','BR-0020','BR-0050','BR-0039'))
   OR "branch_id"    IN (SELECT "id" FROM "branches"    WHERE "code" ILIKE 'LIVE-BR%');

DELETE FROM "stock_ledger"
WHERE "reference" IN (
  SELECT 'YIELD-' || "id" FROM "yield_conversions"
  WHERE "branch_id" IN (SELECT "id" FROM "branches" WHERE "code" ILIKE 'LIVE-BR%')
  UNION
  SELECT 'YIELD-' || "conversion_id" FROM "yield_conversion_items"
  WHERE "ingredient_id" IN (SELECT "id" FROM "ingredients" WHERE "code" ILIKE 'LIVE%' OR "code" ILIKE 'TEST%' OR "code" IN ('BR-0037','BR-0020','BR-0050','BR-0039'))
);

-- 3) Inventory
DELETE FROM "inventory"
WHERE "ingredient_id" IN (SELECT "id" FROM "ingredients" WHERE "code" ILIKE 'LIVE%' OR "code" ILIKE 'TEST%' OR "code" IN ('BR-0037','BR-0020','BR-0050','BR-0039'))
   OR "branch_id"    IN (SELECT "id" FROM "branches"    WHERE "code" ILIKE 'LIVE-BR%');

DELETE FROM "in_transit_inventory"
WHERE "ingredient_id" IN (SELECT "id" FROM "ingredients" WHERE "code" ILIKE 'LIVE%' OR "code" ILIKE 'TEST%' OR "code" IN ('BR-0037','BR-0020','BR-0050','BR-0039'))
   OR "branch_id"    IN (SELECT "id" FROM "branches"    WHERE "code" ILIKE 'LIVE-BR%');

DELETE FROM "pending_review_inventory"
WHERE "ingredient_id" IN (SELECT "id" FROM "ingredients" WHERE "code" ILIKE 'LIVE%' OR "code" ILIKE 'TEST%' OR "code" IN ('BR-0037','BR-0020','BR-0050','BR-0039'))
   OR "branch_id"    IN (SELECT "id" FROM "branches"    WHERE "code" ILIKE 'LIVE-BR%');

DELETE FROM "ingredient_branches"
WHERE "ingredient_id" IN (SELECT "id" FROM "ingredients" WHERE "code" ILIKE 'LIVE%' OR "code" ILIKE 'TEST%' OR "code" IN ('BR-0037','BR-0020','BR-0050','BR-0039'))
   OR "branch_id"    IN (SELECT "id" FROM "branches"    WHERE "code" ILIKE 'LIVE-BR%');

-- 4) Yield conversion items / conversions
DELETE FROM "yield_conversion_items"
WHERE "ingredient_id" IN (SELECT "id" FROM "ingredients" WHERE "code" ILIKE 'LIVE%' OR "code" ILIKE 'TEST%' OR "code" IN ('BR-0037','BR-0020','BR-0050','BR-0039'));

DELETE FROM "yield_conversion_items"
WHERE "conversion_id" IN (
  SELECT "id" FROM "yield_conversions"
  WHERE "branch_id" IN (SELECT "id" FROM "branches" WHERE "code" ILIKE 'LIVE-BR%')
);

DELETE FROM "yield_conversions"
WHERE "branch_id" IN (SELECT "id" FROM "branches" WHERE "code" ILIKE 'LIVE-BR%')
   OR "id" IN (
     SELECT "conversion_id" FROM "yield_conversion_items"
     WHERE "ingredient_id" IN (SELECT "id" FROM "ingredients" WHERE "code" ILIKE 'LIVE%' OR "code" ILIKE 'TEST%' OR "code" IN ('BR-0037','BR-0020','BR-0050','BR-0039'))
   );

-- 5) Other ingredient-dependent tables (best-effort, ignore if no rows)
DELETE FROM "recipe_ingredients"          WHERE "ingredient_id" IN (SELECT "id" FROM "ingredients" WHERE "code" ILIKE 'LIVE%' OR "code" ILIKE 'TEST%' OR "code" IN ('BR-0037','BR-0020','BR-0050','BR-0039'));
DELETE FROM "modifier_ingredients"        WHERE "ingredient_id" IN (SELECT "id" FROM "ingredients" WHERE "code" ILIKE 'LIVE%' OR "code" ILIKE 'TEST%' OR "code" IN ('BR-0037','BR-0020','BR-0050','BR-0039'));
DELETE FROM "purchase_requisition_items"  WHERE "ingredient_id" IN (SELECT "id" FROM "ingredients" WHERE "code" ILIKE 'LIVE%' OR "code" ILIKE 'TEST%' OR "code" IN ('BR-0037','BR-0020','BR-0050','BR-0039'));
DELETE FROM "purchase_order_items"        WHERE "ingredient_id" IN (SELECT "id" FROM "ingredients" WHERE "code" ILIKE 'LIVE%' OR "code" ILIKE 'TEST%' OR "code" IN ('BR-0037','BR-0020','BR-0050','BR-0039'));
DELETE FROM "delivery_note_items"         WHERE "ingredient_id" IN (SELECT "id" FROM "ingredients" WHERE "code" ILIKE 'LIVE%' OR "code" ILIKE 'TEST%' OR "code" IN ('BR-0037','BR-0020','BR-0050','BR-0039'));
DELETE FROM "scm_procurement_items"       WHERE "ingredient_id" IN (SELECT "id" FROM "ingredients" WHERE "code" ILIKE 'LIVE%' OR "code" ILIKE 'TEST%' OR "code" IN ('BR-0037','BR-0020','BR-0050','BR-0039'));
DELETE FROM "scm_transfer_items"          WHERE "ingredient_id" IN (SELECT "id" FROM "ingredients" WHERE "code" ILIKE 'LIVE%' OR "code" ILIKE 'TEST%' OR "code" IN ('BR-0037','BR-0020','BR-0050','BR-0039'));

-- 6) Ingredients themselves
DELETE FROM "ingredients"
WHERE "code" ILIKE 'LIVE%' OR "code" ILIKE 'TEST%' OR "code" IN ('BR-0037','BR-0020','BR-0050','BR-0039');

-- Restore polluted canonical ingredient name
UPDATE "ingredients" SET "name" = 'Susu' WHERE "code" = 'ING-001' AND "name" = 'Test4';

-- 7) Branches (clear FKs first)
UPDATE "users" SET "branch_id" = NULL WHERE "branch_id" IN (SELECT "id" FROM "branches" WHERE "code" ILIKE 'LIVE-BR%');
DELETE FROM "area_manager_branches" WHERE "branch_id" IN (SELECT "id" FROM "branches" WHERE "code" ILIKE 'LIVE-BR%');
DELETE FROM "recipe_branches"       WHERE "branch_id" IN (SELECT "id" FROM "branches" WHERE "code" ILIKE 'LIVE-BR%');
DELETE FROM "shifts"                WHERE "branch_id" IN (SELECT "id" FROM "branches" WHERE "code" ILIKE 'LIVE-BR%');
DELETE FROM "orders"                WHERE "branch_id" IN (SELECT "id" FROM "branches" WHERE "code" ILIKE 'LIVE-BR%');
DELETE FROM "stock_opnames"         WHERE "branch_id" IN (SELECT "id" FROM "branches" WHERE "code" ILIKE 'LIVE-BR%');
DELETE FROM "branches"              WHERE "code" ILIKE 'LIVE-BR%';
