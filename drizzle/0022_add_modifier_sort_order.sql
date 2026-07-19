-- Add sort_order to modifiers table for manual ordering
ALTER TABLE "modifiers" ADD COLUMN "sort_order" integer NOT NULL DEFAULT 0;
--> statement-breakpoint

-- Backfill sort_order based on created_at for existing rows
UPDATE "modifiers"
SET "sort_order" = sub.row_num
FROM (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "modifier_group_id"
      ORDER BY "created_at", "name"
    ) - 1 AS row_num
  FROM "modifiers"
) sub
WHERE "modifiers"."id" = sub."id";
