-- ADR 0019 — prevention guards for double-entry stock inflation.
--
-- Context: an audit of Royal Plaza (2026-10-05) found the POS systematically
-- over-stating received packaging. Two distinct defects, both "the same thing
-- recorded twice":
--
--   1. Duplicate item lines on a transfer. MT/CENTRAL/041026/06 listed Simple
--      Syrup on two separate lines (sort_order 15 qty 1000, sort_order 26 qty
--      3000) and `finish-receive` credited BOTH into `inventory` — the branch
--      holds 4000 ml of syrup against 3000 ml delivered. Across all 22
--      transfers in the database, every received line is credited 100% and
--      `rejected_quantity` is 0 everywhere: a physical shortage has never once
--      been representable. The receiving form pre-fills `received` with the
--      promised quantity, so submitting untouched always means "received
--      everything".
--
--   2. Duplicate production records. Royal Plaza recorded two batches twice:
--      `232cf7d4` / `3b2682c3` (51s apart, same production_date, same notes,
--      each +6900 g Nasi Putih) and `5698667d` / `f89936b3` (same date and
--      notes, each +2300 g). The second "Masak nasi pagi" drove `Beras` to
--      -72, which is only possible if the same batch was submitted twice.
--
-- This migration is the database half of the fix: one line per ingredient per
-- transfer, enforced by a constraint rather than an application check, so the
-- defect cannot reappear through any write path. The application half
-- (receiving-form default, duplicate-production detection) lives in
-- `src/lib/server/scm-transfers.ts` and `src/lib/server/yield.ts`.
--
-- Idempotent: re-running finds no duplicate groups and is a no-op.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- STEP 1 — refuse to proceed if a duplicate group disagrees on unit_price.
--
-- Merging lines with different prices would silently rewrite the transfer's
-- pricing (and any invoice derived from it). That is a finance decision, not a
-- migration decision, so we stop and make a human look.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  bad RECORD;
BEGIN
  SELECT si.scm_transfer_id, si.ingredient_id,
         count(DISTINCT si.unit_price) AS distinct_prices
    INTO bad
    FROM scm_transfer_items si
   GROUP BY si.scm_transfer_id, si.ingredient_id
  HAVING count(*) > 1
     AND count(DISTINCT si.unit_price) > 1
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'Duplicate scm_transfer_items disagree on unit_price for transfer % ingredient % — merge these manually before applying this migration.',
      bad.scm_transfer_id, bad.ingredient_id;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- STEP 2 — merge duplicate item lines into the earliest-sort_order row.
--
-- Quantities are summed, so every total the document reports (promised qty,
-- received qty, invoice value) is unchanged. The already-generated
-- `scm_transfer_invoices.line_items` snapshot is deliberately NOT rewritten:
-- an issued invoice is a frozen historical document (ADR 0006), and the stock
-- effect it describes — 4000 ml credited — is corrected separately.
--
-- The `stxi_received_plus_rejected_le_qty` and `stxi_qty_positive` checks
-- still hold after summing: both operands were individually valid and
-- non-negative, so their sums are too.
-- -----------------------------------------------------------------------------
WITH ranked AS (
  SELECT si.id,
         si.scm_transfer_id,
         si.ingredient_id,
         row_number() OVER (
           PARTITION BY si.scm_transfer_id, si.ingredient_id
           ORDER BY si.sort_order, si.created_at, si.id
         ) AS rn
    FROM scm_transfer_items si
),
dupes AS (
  SELECT scm_transfer_id, ingredient_id
    FROM ranked
   GROUP BY scm_transfer_id, ingredient_id
  HAVING count(*) > 1
),
keeper AS (
  SELECT r.id, r.scm_transfer_id, r.ingredient_id
    FROM ranked r
    JOIN dupes d
      ON d.scm_transfer_id = r.scm_transfer_id
     AND d.ingredient_id   = r.ingredient_id
   WHERE r.rn = 1
),
agg AS (
  SELECT si.scm_transfer_id,
         si.ingredient_id,
         sum(si.quantity)          AS total_quantity,
         sum(si.received_quantity) AS total_received,
         sum(si.rejected_quantity) AS total_rejected
    FROM scm_transfer_items si
    JOIN dupes d
      ON d.scm_transfer_id = si.scm_transfer_id
     AND d.ingredient_id   = si.ingredient_id
   GROUP BY si.scm_transfer_id, si.ingredient_id
)
UPDATE scm_transfer_items t
   SET quantity          = agg.total_quantity,
       received_quantity = agg.total_received,
       rejected_quantity = agg.total_rejected,
       updated_at        = now()
  FROM keeper k
  JOIN agg
    ON agg.scm_transfer_id = k.scm_transfer_id
   AND agg.ingredient_id   = k.ingredient_id
 WHERE t.id = k.id;

WITH ranked AS (
  SELECT si.id,
         si.scm_transfer_id,
         si.ingredient_id,
         row_number() OVER (
           PARTITION BY si.scm_transfer_id, si.ingredient_id
           ORDER BY si.sort_order, si.created_at, si.id
         ) AS rn
    FROM scm_transfer_items si
),
dupes AS (
  SELECT scm_transfer_id, ingredient_id
    FROM ranked
   GROUP BY scm_transfer_id, ingredient_id
  HAVING count(*) > 1
)
DELETE FROM scm_transfer_items si
 USING ranked r
  JOIN dupes d
    ON d.scm_transfer_id = r.scm_transfer_id
   AND d.ingredient_id   = r.ingredient_id
 WHERE r.id = si.id
   AND r.rn > 1;

-- -----------------------------------------------------------------------------
-- STEP 3 — the guard itself.
--
-- Application-level duplicate checks are bypassable (that is how the Simple
-- Syrup pair got in). A constraint cannot be.
-- -----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS stxi_transfer_ingredient_unique
  ON scm_transfer_items (scm_transfer_id, ingredient_id);

-- -----------------------------------------------------------------------------
-- STEP 4 — support index for duplicate-production detection.
--
-- `createYieldConversionCore` looks for a same-branch / same-production_date /
-- same-notes / same-items record before writing. Runs on every production
-- submission, so it needs to be an index scan, not a seq scan on a table that
-- grows by a few rows a day.
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS yield_conversions_branch_date_idx
  ON yield_conversions (branch_id, production_date)
  WHERE status = 'Active' AND deleted_at IS NULL;