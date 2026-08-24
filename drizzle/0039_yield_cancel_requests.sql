-- Yield Tracking cancellation (Map 122): request→approval flow for Produksi
-- Branch admin requests cancel, super_admin/area_manager approves, Produksi stays documentation-only

DO $$ BEGIN
  CREATE TYPE "public"."yield_conversion_status" AS ENUM('Active', 'Cancelled');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "public"."yield_cancel_request_status" AS ENUM('Pending', 'Approved', 'Rejected', 'Executed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "yield_conversions" ADD COLUMN IF NOT EXISTS "status" "yield_conversion_status" DEFAULT 'Active' NOT NULL;
ALTER TABLE "yield_conversions" ADD COLUMN IF NOT EXISTS "cancelled_at" timestamp;
ALTER TABLE "yield_conversions" ADD COLUMN IF NOT EXISTS "cancelled_by" uuid REFERENCES "users"("id");
ALTER TABLE "yield_conversions" ADD COLUMN IF NOT EXISTS "cancel_reason" text;

CREATE INDEX IF NOT EXISTS "yc_status_idx" ON "yield_conversions" USING btree ("status");

CREATE TABLE IF NOT EXISTS "yield_cancel_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "yield_conversion_id" uuid NOT NULL REFERENCES "yield_conversions"("id") ON DELETE CASCADE,
  "reason" text NOT NULL,
  "detail" text,
  "requested_by" uuid NOT NULL REFERENCES "users"("id"),
  "approved_by" uuid REFERENCES "users"("id"),
  "status" "yield_cancel_request_status" DEFAULT 'Pending' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "approved_at" timestamp
);
CREATE INDEX IF NOT EXISTS "ycr_conversion_idx" ON "yield_cancel_requests" USING btree ("yield_conversion_id");
CREATE INDEX IF NOT EXISTS "ycr_status_idx" ON "yield_cancel_requests" USING btree ("status");
