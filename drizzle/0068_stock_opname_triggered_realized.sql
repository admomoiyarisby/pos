-- Stock opname becomes an explicit five-state machine:
--   Triggered → Submitted → Under Investigation → Approved → Realized
--
-- The old enum overloaded `Submitted` for a freshly triggered sheet (no
-- `Triggered` state) and expressed realization as a nullable `realized_at`
-- outside the enum (no `Realized` state). Backfill both:
--   * Approved + realized_at  -> Realized
--   * Submitted with no counted item -> Triggered
--
-- The replacement type is created under a temporary name and renamed: on a
-- fresh database all migrations run in one transaction, and a value added with
-- ALTER TYPE ADD VALUE cannot be used before commit. Labels created by CREATE
-- TYPE have no such restriction.

ALTER TABLE "stock_opnames" ALTER COLUMN "status" DROP DEFAULT;

CREATE TYPE "public"."stock_opname_status_new" AS ENUM(
  'Triggered',
  'Submitted',
  'Under Investigation',
  'Approved',
  'Realized'
);
ALTER TABLE "stock_opnames"
  ALTER COLUMN "status" TYPE "public"."stock_opname_status_new"
  USING ("status"::text::"public"."stock_opname_status_new");

UPDATE "stock_opnames"
SET "status" = 'Realized'
WHERE "status" = 'Approved' AND "realized_at" IS NOT NULL;

UPDATE "stock_opnames"
SET "status" = 'Triggered'
WHERE "status" = 'Submitted'
  AND NOT EXISTS (
    SELECT 1
    FROM "stock_opname_items" i
    WHERE i."stock_opname_id" = "stock_opnames"."id"
      AND i."counted_at" IS NOT NULL
  );

ALTER TABLE "stock_opnames" ALTER COLUMN "status" SET DEFAULT 'Triggered';
DROP TYPE "public"."stock_opname_status";
ALTER TYPE "public"."stock_opname_status_new" RENAME TO "stock_opname_status";
