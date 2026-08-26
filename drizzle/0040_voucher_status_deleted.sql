-- Voucher lifecycle: Active ⇄ Inactive → Deleted.
-- Existing is_active=false rows are preserved as Inactive; Deleted is a
-- separate tombstone so inactive vouchers can be soft-deleted later.

DO $$ BEGIN
  CREATE TYPE "public"."voucher_status" AS ENUM('Active', 'Inactive', 'Deleted');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "vouchers" ADD COLUMN IF NOT EXISTS "status" "voucher_status";

UPDATE "vouchers"
SET "status" = CASE WHEN "is_active" THEN 'Active'::"voucher_status" ELSE 'Inactive'::"voucher_status" END
WHERE "status" IS NULL;

ALTER TABLE "vouchers" ALTER COLUMN "status" SET DEFAULT 'Active';
ALTER TABLE "vouchers" ALTER COLUMN "status" SET NOT NULL;
ALTER TABLE "vouchers" DROP COLUMN IF EXISTS "is_active";

CREATE INDEX IF NOT EXISTS "voucher_status_idx" ON "vouchers" USING btree ("status");
