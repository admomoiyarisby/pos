-- Coherence constraints for state flags that were only maintained by code.
--
-- Each pair below is written by one statement in application code, so a partial
-- write (or a manual DB edit) could leave a row claiming two contradictory
-- things. The migration normalises existing rows first, then lets the database
-- enforce the pairing from now on.
--
-- Policy for conflicting rows: a populated "event happened" timestamp wins over
-- the status column (the audit fact is preserved and the status is corrected).
-- The one exception is `orders.void_reason`: a reason on a non-void order is
-- stale metadata, not an event, so it is cleared.

-- ─── Stock opname: Realized ⇔ realized_at ────────────────────────────────
UPDATE "stock_opnames"
SET "realized_at" = "created_at"
WHERE "status" = 'Realized' AND "realized_at" IS NULL;
UPDATE "stock_opnames"
SET "status" = 'Realized'
WHERE "realized_at" IS NOT NULL AND "status" <> 'Realized';

ALTER TABLE "stock_opnames"
  ADD CONSTRAINT "so_realized_coherent" CHECK (
    (CASE WHEN "status" = 'Realized' THEN 1 ELSE 0 END) =
    (CASE WHEN "realized_at" IS NOT NULL THEN 1 ELSE 0 END)
  );

-- ─── SCM invoice: Paid ⇔ paid_at ─────────────────────────────────────────
UPDATE "scm_invoices"
SET "paid_at" = "created_at"
WHERE "status" = 'Paid' AND "paid_at" IS NULL;
UPDATE "scm_invoices"
SET "status" = 'Paid'
WHERE "paid_at" IS NOT NULL AND "status" <> 'Paid';

ALTER TABLE "scm_invoices"
  ADD CONSTRAINT "inv_paid_coherent" CHECK (
    (CASE WHEN "status" = 'Paid' THEN 1 ELSE 0 END) =
    (CASE WHEN "paid_at" IS NOT NULL THEN 1 ELSE 0 END)
  );

-- ─── Waste: Cancelled ⇔ cancelled_at ─────────────────────────────────────
UPDATE "waste_entries"
SET "cancelled_at" = "created_at"
WHERE "status" = 'Cancelled' AND "cancelled_at" IS NULL;
UPDATE "waste_entries"
SET "status" = 'Cancelled'
WHERE "cancelled_at" IS NOT NULL AND "status" <> 'Cancelled';

ALTER TABLE "waste_entries"
  ADD CONSTRAINT "waste_cancel_coherent" CHECK (
    (CASE WHEN "status" = 'Cancelled' THEN 1 ELSE 0 END) =
    (CASE WHEN "cancelled_at" IS NOT NULL THEN 1 ELSE 0 END)
  );

-- ─── Production: Cancelled ⇔ cancelled_at ────────────────────────────────
UPDATE "yield_conversions"
SET "cancelled_at" = "created_at"
WHERE "status" = 'Cancelled' AND "cancelled_at" IS NULL;
UPDATE "yield_conversions"
SET "status" = 'Cancelled'
WHERE "cancelled_at" IS NOT NULL AND "status" <> 'Cancelled';

ALTER TABLE "yield_conversions"
  ADD CONSTRAINT "yc_cancel_coherent" CHECK (
    (CASE WHEN "status" = 'Cancelled' THEN 1 ELSE 0 END) =
    (CASE WHEN "cancelled_at" IS NOT NULL THEN 1 ELSE 0 END)
  );

-- ─── Procurement / Mutasi: Cancelled ⇔ cancelled_at ──────────────────────
UPDATE "scm_procurements"
SET "cancelled_at" = "updated_at"
WHERE "status" = 'Cancelled' AND "cancelled_at" IS NULL;
UPDATE "scm_procurements"
SET "status" = 'Cancelled'
WHERE "cancelled_at" IS NOT NULL AND "status" <> 'Cancelled';

ALTER TABLE "scm_procurements"
  ADD CONSTRAINT "sp_cancel_coherent" CHECK (
    (CASE WHEN "status" = 'Cancelled' THEN 1 ELSE 0 END) =
    (CASE WHEN "cancelled_at" IS NOT NULL THEN 1 ELSE 0 END)
  );

UPDATE "scm_transfers"
SET "cancelled_at" = "updated_at"
WHERE "status" = 'Cancelled' AND "cancelled_at" IS NULL;
UPDATE "scm_transfers"
SET "status" = 'Cancelled'
WHERE "cancelled_at" IS NOT NULL AND "status" <> 'Cancelled';

ALTER TABLE "scm_transfers"
  ADD CONSTRAINT "stx_cancel_coherent" CHECK (
    (CASE WHEN "status" = 'Cancelled' THEN 1 ELSE 0 END) =
    (CASE WHEN "cancelled_at" IS NOT NULL THEN 1 ELSE 0 END)
  );

-- ─── User: tombstoned ⇒ Inactive (Inactive alone = suspended) ────────────
UPDATE "users"
SET "status" = 'Inactive'
WHERE "deleted_at" IS NOT NULL AND "status" <> 'Inactive';

ALTER TABLE "users"
  ADD CONSTRAINT "user_deleted_status_coherent" CHECK (
    "deleted_at" IS NULL OR "status" = 'Inactive'
  );

-- ─── Period: Closed ⇔ closed_at ──────────────────────────────────────────
UPDATE "period_logs"
SET "closed_at" = "opened_at"
WHERE "status" = 'Closed' AND "closed_at" IS NULL;
UPDATE "period_logs"
SET "status" = 'Closed'
WHERE "closed_at" IS NOT NULL AND "status" <> 'Closed';

ALTER TABLE "period_logs"
  ADD CONSTRAINT "period_closed_coherent" CHECK (
    (CASE WHEN "status" = 'Closed' THEN 1 ELSE 0 END) =
    (CASE WHEN "closed_at" IS NOT NULL THEN 1 ELSE 0 END)
  );

-- ─── Shift: Closed ⇔ end_time ────────────────────────────────────────────
UPDATE "shifts"
SET "end_time" = "created_at"
WHERE "status" = 'Closed' AND "end_time" IS NULL;
UPDATE "shifts"
SET "status" = 'Closed'
WHERE "end_time" IS NOT NULL AND "status" <> 'Closed';

ALTER TABLE "shifts"
  ADD CONSTRAINT "shift_closed_coherent" CHECK (
    (CASE WHEN "status" = 'Closed' THEN 1 ELSE 0 END) =
    (CASE WHEN "end_time" IS NOT NULL THEN 1 ELSE 0 END)
  );

-- ─── Order: Void ⇔ void_reason ───────────────────────────────────────────
UPDATE "orders"
SET "void_reason" = 'Data historis (migrasi 0070)'
WHERE "status" = 'Void' AND "void_reason" IS NULL;
UPDATE "orders"
SET "void_reason" = NULL
WHERE "status" <> 'Void' AND "void_reason" IS NOT NULL;

ALTER TABLE "orders"
  ADD CONSTRAINT "order_void_reason_coherent" CHECK (
    (CASE WHEN "status" = 'Void' THEN 1 ELSE 0 END) =
    (CASE WHEN "void_reason" IS NOT NULL THEN 1 ELSE 0 END)
  );

-- ─── Invoice paid/checked stamps are pairs ───────────────────────────────
UPDATE "scm_procurement_invoices"
SET "paid_by_id" = "generated_by_id"
WHERE "paid_at" IS NOT NULL AND "paid_by_id" IS NULL;
UPDATE "scm_procurement_invoices"
SET "paid_at" = "generated_at"
WHERE "paid_by_id" IS NOT NULL AND "paid_at" IS NULL;

ALTER TABLE "scm_procurement_invoices"
  ADD CONSTRAINT "spin_paid_stamps_paired" CHECK (
    ("paid_at" IS NULL) = ("paid_by_id" IS NULL)
  );

UPDATE "scm_transfer_invoices"
SET "paid_by_id" = "created_by_id"
WHERE "paid_at" IS NOT NULL AND "paid_by_id" IS NULL;
UPDATE "scm_transfer_invoices"
SET "paid_at" = "created_at"
WHERE "paid_by_id" IS NOT NULL AND "paid_at" IS NULL;

UPDATE "scm_transfer_invoices"
SET "checked_at" = COALESCE("checked_at", "created_at")
WHERE "checked" AND "checked_at" IS NULL;
UPDATE "scm_transfer_invoices"
SET "checked_by_id" = COALESCE("checked_by_id", "created_by_id")
WHERE "checked" AND "checked_by_id" IS NULL;
UPDATE "scm_transfer_invoices"
SET "checked_at" = NULL, "checked_by_id" = NULL
WHERE NOT "checked";

ALTER TABLE "scm_transfer_invoices"
  ADD CONSTRAINT "stxinv_paid_stamps_paired" CHECK (
    ("paid_at" IS NULL) = ("paid_by_id" IS NULL)
  );
ALTER TABLE "scm_transfer_invoices"
  ADD CONSTRAINT "stxinv_checked_coherent" CHECK (
    ("checked") = ("checked_at" IS NOT NULL) AND
    ("checked") = ("checked_by_id" IS NOT NULL)
  );
