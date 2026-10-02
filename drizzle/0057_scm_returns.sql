-- Retur Barang (ADR 0018) — rejected-at-receiving stock on its way home.
--
-- Supersedes ADR 0006's "waste at receiver" sub-decision for every non-Scrap
-- disposition. Before this, `writeRejectedWaste` inserted a `waste_entries` row
-- with category 'Spoiled' at the RECEIVER for every rejection — unconditionally,
-- before the disposition check — while the same effect also credited the
-- quantity back to the source's `inventory`. The result: the same units were
-- counted in Central's stock AND reported as a Spoiled loss at the branch, at
-- Rp0 (the procurement effect never set `valuation`). Only `Scrap` — goods
-- genuinely destroyed — is a waste entry now.
--
-- `scm_returns` closes the physical gap the old model ignored: the stock
-- numbers moved back instantly, but the goods are still on the receiver's
-- shelf. 'Pending' = the branch still owes the source a pickup; 'PickedUp' =
-- the source confirmed the box is back, closing the branch's liability.
-- `valuation` is qty × averageCost for the pickup list only — it never reaches
-- Total Kerugian and never touches operational_expenses.
DO $$ BEGIN
  CREATE TYPE "public"."scm_return_status" AS ENUM('Pending', 'PickedUp');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scm_returns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "branch_id" uuid NOT NULL REFERENCES "branches"("id"),
  "scm_procurement_id" uuid REFERENCES "scm_procurements"("id") ON DELETE CASCADE,
  "scm_transfer_id" uuid REFERENCES "scm_transfers"("id") ON DELETE CASCADE,
  "ingredient_id" uuid NOT NULL REFERENCES "ingredients"("id"),
  "quantity" real NOT NULL,
  "valuation" integer DEFAULT 0 NOT NULL,
  "disposition" "rejection_disposition" NOT NULL,
  "reason" text,
  "status" "scm_return_status" DEFAULT 'Pending' NOT NULL,
  "created_by_id" uuid NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "picked_up_by" uuid REFERENCES "users"("id"),
  "picked_up_at" timestamp
);
--> statement-breakpoint
-- A return must always trace back to the delivery that produced it: exactly one
-- of the two document FKs, mirroring pending_review_inventory.
ALTER TABLE "scm_returns"
  ADD CONSTRAINT "scmret_exactly_one_flow_fk" CHECK (
    (CASE WHEN "scm_procurement_id" IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN "scm_transfer_id" IS NOT NULL THEN 1 ELSE 0 END) = 1
  );
--> statement-breakpoint
-- The two pickup stamps are a pair: both or neither, and 'PickedUp' exactly when
-- they are there. Stated as two equalities rather than a sum compared to a
-- divided total, because a half-stamped row would satisfy the looser forms and
-- leave the row looking picked-up on one field and pending on the other.
ALTER TABLE "scm_returns"
  ADD CONSTRAINT "scmret_pickup_stamps_paired" CHECK (
    (
      (CASE WHEN "picked_up_at" IS NOT NULL THEN 1 ELSE 0 END) =
      (CASE WHEN "picked_up_by" IS NOT NULL THEN 1 ELSE 0 END)
    )
    AND (
      (CASE WHEN "status" = 'PickedUp' THEN 1 ELSE 0 END) =
      (CASE WHEN "picked_up_at" IS NOT NULL THEN 1 ELSE 0 END)
    )
  );
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scmret_procurement_idx" ON "scm_returns" USING btree ("scm_procurement_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scmret_transfer_idx" ON "scm_returns" USING btree ("scm_transfer_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scmret_branch_idx" ON "scm_returns" USING btree ("branch_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scmret_ingredient_idx" ON "scm_returns" USING btree ("ingredient_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scmret_status_idx" ON "scm_returns" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scmret_created_idx" ON "scm_returns" USING btree ("created_at");
--> statement-breakpoint
-- ─── Backfill: retire the mislabelled 'Spoiled' rows ───
--
-- Only rows this migration can attribute with certainty are migrated: a
-- procurement rejection whose notes carry the document code
-- ('... — procurement rejected at receiving PR/BG/290926/01'). That is the
-- no-reason wording written by writeRejectedWaste; rows carrying a free-text
-- reason embed no code, and Mutasi rejections are not attributable at all
-- (their notes are just 'Return to Sender — <reason>'). Those are left alone
-- rather than guessed at — a wrong scm_procurement_id would be worse than a
-- stale row the user can cancel by hand.
--
-- Status is set to 'PickedUp' (with picked_up_at = created_at) rather than
-- 'Pending': for these rows the source was already credited the quantity
-- (issue #93, 2026-09-29), so the numbers are home. We have no record of the
-- truck, and 'Pending' would open a false debt on every historical branch.
-- Anyone who knows a specific batch is still on the branch shelf can flip that
-- row back to 'Pending' by clearing picked_up_at/picked_up_by.
--
-- The source waste rows are then deleted so the quantity is not reported as
-- Spoiled loss AND tracked as a return. Their valuation was 0, so Total
-- Kerugian is unchanged. Rows linked to an operational_expense are kept
-- (never orphan a finance row).
INSERT INTO "scm_returns" (
  "branch_id", "scm_procurement_id", "ingredient_id", "quantity", "valuation",
  "disposition", "reason", "status", "created_by_id", "created_at",
  "picked_up_at", "picked_up_by"
)
SELECT
  w."branch_id",
  p."id",
  w."ingredient_id",
  w."quantity",
  ROUND(w."quantity" * i."average_cost")::integer,
  'Return to Source'::"rejection_disposition",
  w."notes",
  'PickedUp'::"scm_return_status",
  w."submitted_by",
  w."created_at",
  w."created_at",
  w."submitted_by"
FROM "waste_entries" w
JOIN "scm_procurements" p
  ON p."code" = substring(w."notes" from 'procurement rejected at receiving ([A-Z0-9/\-]+)')
JOIN "ingredients" i ON i."id" = w."ingredient_id"
WHERE w."category" = 'Spoiled'
  AND w."notes" LIKE '%Return to Source%'
  AND w."notes" LIKE '%procurement rejected at receiving%'
  AND p."id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "operational_expenses" oe WHERE oe."waste_entry_id" = w."id");
--> statement-breakpoint
DELETE FROM "waste_entries" w
WHERE w."category" = 'Spoiled'
  AND w."notes" LIKE '%Return to Source%'
  AND w."notes" LIKE '%procurement rejected at receiving%'
  AND EXISTS (
    SELECT 1 FROM "scm_procurements" p
    WHERE p."code" = substring(w."notes" from 'procurement rejected at receiving ([A-Z0-9/\-]+)')
  )
  AND NOT EXISTS (SELECT 1 FROM "operational_expenses" oe WHERE oe."waste_entry_id" = w."id");
