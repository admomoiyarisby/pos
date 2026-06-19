-- Add per-branch contact phones to support Detail POS - List Cabang.csv.
-- ADR 0005: phones belong on branches (printed on receipts, called by
-- customers), not on branch_admin users or a separate contacts table.
ALTER TABLE "branches" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "complaint_phone" text;
