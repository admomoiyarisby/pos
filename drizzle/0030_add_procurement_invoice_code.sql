-- Pengadaan invoice document codes (issue #90): mirror scm_transfer_invoices,
-- which already carries an INV/<branch>/<ddmmyy>/<serial> code.
--
-- Existing rows are backfilled from the unique procurement code, matching
-- what the print template already displayed as "INV-<procurement code>".
-- New invoices get a real generated code (see generateInvoiceSnapshot).
ALTER TABLE "scm_procurement_invoices" ADD COLUMN "code" text;

UPDATE "scm_procurement_invoices" inv
SET "code" = 'INV-' || p."code"
FROM "scm_procurements" p
WHERE p."id" = inv."scm_procurement_id";

ALTER TABLE "scm_procurement_invoices" ALTER COLUMN "code" SET NOT NULL;
ALTER TABLE "scm_procurement_invoices" ADD CONSTRAINT "spin_code_unique" UNIQUE ("code");
