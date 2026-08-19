-- Pengadaan invoice cancellation (issue #93): cancelling a procurement from
-- WaitingForPayment voids the frozen invoice snapshot. Mirrors
-- scm_transfer_invoices.cancelled_at (ADR 0006). Hand-written migration,
-- applied manually like drizzle/0028_ingredient_branches.sql (not journaled).
ALTER TABLE "scm_procurement_invoices" ADD COLUMN IF NOT EXISTS "cancelled_at" timestamp;
