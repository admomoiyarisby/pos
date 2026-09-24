-- Stock Opname partial counting: `physicalStock = 0` used to mean both
-- "counted as genuinely 0" and "never filled" (the trigger default), which
-- forced every field to be filled before submit. `counted_at` is NULL until
-- the counter explicitly enters a value for that item, so approve/realize can
-- leave uncounted items' stock untouched instead of zeroing it.
ALTER TABLE "stock_opname_items" ADD COLUMN IF NOT EXISTS "counted_at" timestamp;

-- Backfill: the old UI enforced all-fields-filled before submit, so any SO
-- that left "Submitted" territory (Approved / Under Investigation) or carries a
-- non-zero count was fully counted. Freshly triggered SOs stay all-NULL.
UPDATE "stock_opname_items" si
SET "counted_at" = s."created_at"
FROM "stock_opnames" s
WHERE s."id" = si."stock_opname_id"
  AND si."counted_at" IS NULL
  AND (
    s."status" IN ('Approved', 'Under Investigation')
    OR si."physical_stock" <> 0
  );
