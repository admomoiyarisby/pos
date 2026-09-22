-- Soft-delete tombstone for users (ADR-0009 deleted_at pattern, mirroring
-- 0049_modifier_group_soft_delete). "Hapus permanen" on branch staff previously
-- hard-DELETEd the row, which broke when any operational history referenced it
-- (NOT NULL FKs from shifts/orders/procurements/stock opnames). The tombstone
-- hides the user from lists + login while preserving every referencing row.
ALTER TABLE "users" ADD COLUMN "deleted_at" timestamp;
