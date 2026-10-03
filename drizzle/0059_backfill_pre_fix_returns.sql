-- Retur Barang (ADR 0018) — reconcile the pre-2026-09-30 rejected deliveries.
--
-- The business confirmed on 2026-10-03 that the goods from these three
-- deliveries were physically sent back to Central Warehouse; the pre-fix build
-- simply failed to record it, writing them off as Spoiled waste at Rp0 instead.
-- Migration 0057 deliberately left them alone because at the time we believed
-- they were destroyed. That belief was wrong, so this migration finishes the job
-- 0057 started: the quantity is credited back to Central, a return row records
-- it, and the superseded waste row is removed.
--
-- Scope — matched structurally, not by wording, so this cannot silently miss
-- rows if the note phrasing ever differs. Every target note is exactly five
-- whitespace-separated words whose fifth is a procurement code
-- ('Ditolak saat penerimaan pengadaan PR/JBG/290926/01'). Anything with free
-- text after the code is excluded, because it cannot be attributed with
-- certainty and guessing a procurement id would be worse than leaving it.
--
-- Creates each return as 'PickedUp', not 'Pending': the goods are already back
-- at the source, so there is no outstanding pickup to close. picked_up_at reuses
-- the rejection date and picked_up_by the BA who recorded it — the closest
-- truthful attribution available, since no confirmation was captured back then.
--
-- Valuation uses the procurement item's unit_price snapshot (the price actually
-- paid) rather than the ingredient's current average cost, and is informational
-- only: a return is not a loss, so this never reaches Total Kerugian.
--
-- Idempotent by construction — the target rows are deleted at the end, so a
-- re-run matches nothing. Atomic for the same reason drizzle-kit's other
-- migrations are: it wraps each migration file in a transaction, so a failure
-- anywhere below leaves Central uncredited and no return rows behind.
--
-- WHAT ACTUALLY RAN, recorded 2026-10-03 so the next reader is not guessing:
-- applied to production, converting 36 of the 39 target rows across
-- PR/JBG/280926/01 and PR/JBG/290926/01 — Central credited, 36 IN ledger rows,
-- 36 returns, 36 waste rows removed, and all 24 affected ingredients verified
-- balanced (max 0059 balance == inventory.quantity).
--
-- The remaining 3 rows, from PR/WYG/140926/01, were NOT converted: they had
-- already been soft-deleted on 2026-09-16 via the Waste page's history
-- housekeeping, and the `deleted_at IS NULL` guard above deliberately skips
-- tombstoned rows. They remain as soft-deleted waste, valued 0. If they are
-- confirmed returned like the others, they need their own migration — do not
-- relax the guard here, because a re-run would then also re-adopt rows other
-- people deliberately retired.
--
-- Note for anyone re-running this by hand: production is reached through
-- Supabase's transaction pooler (port 6543), where session TEMP TABLEs are not
-- reliable across statements. This migration's temp tables make it unsuitable
-- for statement-by-statement execution over that pooler — run it as one
-- multi-statement query, or from a direct connection.

-- 0. Rows to convert, with the procurement resolved and the item's paid price.
CREATE TEMP TABLE _mig59 AS
SELECT
  w.id                AS waste_id,
  w.branch_id         AS branch_id,
  w.ingredient_id     AS ingredient_id,
  w.quantity          AS quantity,
  w.created_at        AS created_at,
  w.submitted_by      AS submitted_by,
  p.id                AS procurement_id,
  p.code              AS procurement_code,
  COALESCE(i.unit_price, ing.average_cost) AS unit_price
FROM waste_entries w
JOIN scm_procurements p
  ON p.code = split_part(w.notes, ' ', 5)
JOIN ingredients ing
  ON ing.id = w.ingredient_id
LEFT JOIN scm_procurement_items i
  ON i.scm_procurement_id = p.id
 AND i.ingredient_id = w.ingredient_id
WHERE w.category = 'Spoiled'
  AND w.deleted_at IS NULL
  AND array_length(string_to_array(w.notes, ' '), 1) = 5
  AND split_part(w.notes, ' ', 5) LIKE 'PR/%';
--> statement-breakpoint

-- 1. The canonical Central, by the same rule as getCentralWarehouse(): among
--    Central-type branches, the one owning the most inventory rows, id as a
--    deterministic tiebreak. No Central means no rows are written at all.
CREATE TEMP TABLE _mig59_central AS
SELECT b.id
FROM branches b
WHERE b.type = 'Central'
ORDER BY (SELECT count(*) FROM inventory i WHERE i.branch_id = b.id) DESC, b.id ASC
LIMIT 1;
--> statement-breakpoint

-- 2. Central's stock for each affected ingredient BEFORE any credit, so the
--    ledger balances below can be derived rather than read back mid-update.
CREATE TEMP TABLE _mig59_base AS
SELECT m.ingredient_id, COALESCE(i.quantity, 0) AS qty
FROM (SELECT DISTINCT ingredient_id FROM _mig59) m
LEFT JOIN inventory i
  ON i.branch_id = (SELECT id FROM _mig59_central)
 AND i.ingredient_id = m.ingredient_id;
--> statement-breakpoint

-- 3. One IN ledger row per converted line, each carrying the running balance,
--    so the documented invariant (balance == inventory.quantity) holds for the
--    whole sequence and not just at the end.
WITH ordered AS (
  SELECT
    m.*,
    sum(m.quantity) OVER (
      PARTITION BY m.ingredient_id
      ORDER BY m.waste_id
      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
    ) AS prior_qty
  FROM _mig59 m
)
INSERT INTO stock_ledger (branch_id, ingredient_id, type, quantity, balance, reference, notes, created_at)
SELECT
  c.id,
  o.ingredient_id,
  'IN',
  o.quantity,
  b.qty + COALESCE(o.prior_qty, 0) + o.quantity,
  o.procurement_id::text,
  'Retur barang ditolak — ' || o.procurement_code || ' (koreksi migrasi 0059)',
  o.created_at
FROM ordered o
CROSS JOIN _mig59_central c
JOIN _mig59_base b ON b.ingredient_id = o.ingredient_id;
--> statement-breakpoint

-- 4. Credit Central. Split update/insert because an affected ingredient may have
--    no inventory row yet on this branch.
UPDATE inventory inv
SET quantity = inv.quantity + agg.qty,
    last_updated = now()
FROM (SELECT ingredient_id, sum(quantity) AS qty FROM _mig59 GROUP BY ingredient_id) agg
WHERE inv.branch_id = (SELECT id FROM _mig59_central)
  AND inv.ingredient_id = agg.ingredient_id;
--> statement-breakpoint

INSERT INTO inventory (branch_id, ingredient_id, quantity, last_updated)
SELECT c.id, agg.ingredient_id, agg.qty, now()
FROM (SELECT ingredient_id, sum(quantity) AS qty FROM _mig59 GROUP BY ingredient_id) agg
CROSS JOIN _mig59_central c
WHERE NOT EXISTS (
  SELECT 1 FROM inventory inv
  WHERE inv.branch_id = c.id AND inv.ingredient_id = agg.ingredient_id
);
--> statement-breakpoint

-- 5. The return records. Status 'PickedUp': the goods are home, so there is no
--    pickup outstanding. Both pickup stamps set, as scmret_pickup_stamps_paired
--    requires for that status.
INSERT INTO scm_returns (
  branch_id, scm_procurement_id, ingredient_id, quantity, valuation,
  disposition, reason, status, created_by_id, created_at, picked_up_at, picked_up_by
)
SELECT
  m.branch_id,
  m.procurement_id,
  m.ingredient_id,
  m.quantity,
  round(m.quantity * m.unit_price)::integer,
  'Return to Source',
  'Barang ditolak pada ' || m.procurement_code || ' dan dikirim kembali ke Gudang Pusat',
  'PickedUp',
  m.submitted_by,
  m.created_at,
  m.created_at,
  m.submitted_by
FROM _mig59 m;
--> statement-breakpoint

-- 6. Retire the superseded waste rows so the quantity is not counted as a
--    Spoiled loss AND tracked as a return. They were valued 0, so Total
--    Kerugian is unchanged by their removal.
DELETE FROM waste_entries WHERE id IN (SELECT waste_id FROM _mig59);
