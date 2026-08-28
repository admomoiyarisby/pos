-- Waste entry cancellation (super_admin / area_manager).
-- Mirrors yield_conversions cancellation (ADR 0012): a status tombstone plus
-- cancel metadata — the row and its history stay, and the recorded stock
-- effect is reversed with an IN ledger row on the same reference. Existing
-- rows default to 'Active'.

DO $$ BEGIN
  CREATE TYPE "public"."waste_entry_status" AS ENUM('Active', 'Cancelled');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "waste_entries" ADD COLUMN IF NOT EXISTS "status" "waste_entry_status" DEFAULT 'Active' NOT NULL;
ALTER TABLE "waste_entries" ADD COLUMN IF NOT EXISTS "cancelled_at" timestamp;
ALTER TABLE "waste_entries" ADD COLUMN IF NOT EXISTS "cancelled_by" uuid REFERENCES "users"("id");
ALTER TABLE "waste_entries" ADD COLUMN IF NOT EXISTS "cancel_reason" text;

CREATE INDEX IF NOT EXISTS "waste_status_idx" ON "waste_entries" USING btree ("status");
