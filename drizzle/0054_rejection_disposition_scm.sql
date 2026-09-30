-- Rejected-quantity disposition for Pengadaan and Mutasi (issue #93 follow-up).
--
-- The receiving BA now chooses what happens to rejected stock at
-- finish-receive: "Return to Source" credits the source branch's inventory
-- (the new default behavior), "Scrap" writes it off. "Quarantine" is offered
-- by the SJ flow's picker; here it is accepted for enum compatibility but
-- behaves like Return to Source (stock is tracked, not destroyed) until a
-- quarantine location exists.
--
-- Nullable: rows finished before this feature keep NULL and are reported as
-- "Return to Source" (the behavior the 2026-09-29 fix introduced).
ALTER TABLE "scm_procurement_items"
  ADD COLUMN IF NOT EXISTS "rejection_disposition" "rejection_disposition";
ALTER TABLE "scm_transfer_items"
  ADD COLUMN IF NOT EXISTS "rejection_disposition" "rejection_disposition";
