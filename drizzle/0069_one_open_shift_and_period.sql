-- Two invariants that were only enforced in application code (and therefore
-- racy) become database constraints:
--   * a branch has at most one Open shift
--   * there is at most one Open period
--
-- Existing duplicates are resolved deterministically before the unique indexes
-- are created: the newest open shift per branch and the newest open period are
-- kept; the rest are closed. Any dangling shift session on a closed duplicate is
-- stamped out too, so the holder view stays consistent.

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY branch_id
           ORDER BY start_time DESC, created_at DESC, id DESC
         ) AS rn
  FROM "shifts"
  WHERE "status" = 'Open'
)
UPDATE "shift_sessions" ss
SET "logged_out_at" = now()
WHERE ss."logged_out_at" IS NULL
  AND ss."shift_id" IN (SELECT id FROM ranked WHERE rn > 1);

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY branch_id
           ORDER BY start_time DESC, created_at DESC, id DESC
         ) AS rn
  FROM "shifts"
  WHERE "status" = 'Open'
)
UPDATE "shifts" s
SET "status" = 'Closed',
    "end_time" = COALESCE(s."end_time", now()),
    "notes" = COALESCE(s."notes" || ' ', '') || '[auto-closed: duplicate open shift]'
WHERE s."id" IN (SELECT id FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX "shift_one_open_per_branch"
  ON "shifts" ("branch_id")
  WHERE "status" = 'Open';

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           ORDER BY opened_at DESC, created_at DESC, id DESC
         ) AS rn
  FROM "period_logs"
  WHERE "status" = 'Open'
)
UPDATE "period_logs" p
SET "status" = 'Closed',
    "closed_at" = COALESCE(p."closed_at", now())
WHERE p."id" IN (SELECT id FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX "period_one_open"
  ON "period_logs" ((true))
  WHERE "status" = 'Open';
