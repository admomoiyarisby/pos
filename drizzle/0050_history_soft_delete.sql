-- Soft-delete tombstones (ADR-0009 deleted_at pattern) for history/list rows.
-- Deleting a row outright would break FK references (orders ↔ shift cash math,
-- cancel_requests → orders, waste/yield → ledger, scm_* → items/audit) — a
-- deleted_at tombstone hides the row from lists while keeping every
-- referenced row and aggregate consistent.
ALTER TABLE "orders" ADD COLUMN "deleted_at" timestamp;
ALTER TABLE "shift_sessions" ADD COLUMN "deleted_at" timestamp;
ALTER TABLE "cancel_requests" ADD COLUMN "deleted_at" timestamp;
ALTER TABLE "waste_entries" ADD COLUMN "deleted_at" timestamp;
ALTER TABLE "yield_conversions" ADD COLUMN "deleted_at" timestamp;
ALTER TABLE "stock_opnames" ADD COLUMN "deleted_at" timestamp;
ALTER TABLE "scm_procurements" ADD COLUMN "deleted_at" timestamp;
ALTER TABLE "scm_transfers" ADD COLUMN "deleted_at" timestamp;

-- Partial indexes keep the hot list paths (WHERE deleted_at IS NULL) fast
-- while tombstoned rows cost nothing.
CREATE INDEX "order_deleted_null_idx" ON "orders" ("created_at" DESC) WHERE "deleted_at" IS NULL;
CREATE INDEX "ss_deleted_null_idx" ON "shift_sessions" ("logged_in_at" DESC) WHERE "deleted_at" IS NULL;
CREATE INDEX "cr_deleted_null_idx" ON "cancel_requests" ("created_at" DESC) WHERE "deleted_at" IS NULL;
CREATE INDEX "waste_deleted_null_idx" ON "waste_entries" ("created_at" DESC) WHERE "deleted_at" IS NULL;
CREATE INDEX "yc_deleted_null_idx" ON "yield_conversions" ("created_at" DESC) WHERE "deleted_at" IS NULL;
CREATE INDEX "so_deleted_null_idx" ON "stock_opnames" ("created_at" DESC) WHERE "deleted_at" IS NULL;
CREATE INDEX "sp_deleted_null_idx" ON "scm_procurements" ("created_at" DESC) WHERE "deleted_at" IS NULL;
CREATE INDEX "stx_deleted_null_idx" ON "scm_transfers" ("created_at" DESC) WHERE "deleted_at" IS NULL;
