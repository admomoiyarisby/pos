-- Migration 0064: retire the day-level `omzet` override, keep its money.
--
-- ADR 0028 (payout-based omzet) makes `channel_revenues` the one omzet input:
-- per channel/day the ledger reports the typed payout, falling back to POS net.
-- The old `daily_overrides` row with field `omzet` replaced the whole day and
-- carried no channel, so it cannot coexist with per-channel margins without
-- either inventing an attribution or dropping history.
--
-- This migration converts every legacy row into a signed, channel-less
-- adjustment on the same day, computed so the day total does not move:
--
--   adjustment = override − (Σ channel payouts + Σ POS net of channels
--                            that have no payout input for that day)
--
-- Case A (the override merely mirrored the channel inputs) therefore yields
-- 0 and is dropped. Cases B/C yield the unexplained remainder as
-- `omzet_adjustment`, which the ledger adds on top of the channel omzet.
--
-- Data-only: no DDL, no table rewrite. The two reads are single grouped scans
-- of `orders` and `channel_revenues`; the only writes touch the handful of
-- legacy override rows. Safe to run against a live database.
--
-- Validation (run after applying; the first must return 0):
--
--   SELECT COUNT(*) FROM daily_overrides WHERE field = 'omzet';
--
--   SELECT d.branch_id, d.date, d.value AS adjustment,
--          COALESCE((SELECT SUM(c.amount) FROM channel_revenues c
--                     WHERE c.branch_id = d.branch_id AND c.date = d.date), 0)
--        + COALESCE((SELECT SUM(o.net_sales) FROM orders o
--                     WHERE o.branch_id = d.branch_id
--                       AND o.status <> 'Void' AND o.deleted_at IS NULL
--                       AND DATE((o.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta') = d.date::date
--                       AND NOT EXISTS (SELECT 1 FROM channel_revenues c2
--                                        WHERE c2.branch_id = d.branch_id AND c2.date = d.date
--                                          AND c2.channel = o.channel)), 0)
--        AS reconstructed_omzet
--   FROM daily_overrides d WHERE d.field = 'omzet_adjustment';
--   -- reconstructed_omzet should equal the pre-migration override value,
--   -- and Σ adjustment should equal Σ (override − old POS-based omzet).

WITH payout_by_channel AS (
  SELECT branch_id, date, channel, SUM(amount) AS amount
  FROM channel_revenues
  GROUP BY branch_id, date, channel
),
payout_by_day AS (
  SELECT branch_id, date, SUM(amount) AS amount
  FROM payout_by_channel
  GROUP BY branch_id, date
),
pos_by_channel AS (
  SELECT
    branch_id,
    DATE((created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta') AS date,
    channel,
    SUM(net_sales) AS net_sales
  FROM orders
  WHERE status <> 'Void'
    AND deleted_at IS NULL
  GROUP BY
    branch_id,
    DATE((created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta'),
    channel
),
pos_unpayouted_by_day AS (
  SELECT p.branch_id, p.date, SUM(p.net_sales) AS net_sales
  FROM pos_by_channel p
  LEFT JOIN payout_by_channel c
    ON c.branch_id = p.branch_id
   AND c.date::date = p.date
   AND c.channel = p.channel
  WHERE c.channel IS NULL
  GROUP BY p.branch_id, p.date
),
legacy AS (
  SELECT
    d.branch_id,
    d.date,
    d.value AS override_value,
    COALESCE(pd.amount, 0) AS payout_total,
    COALESCE(pu.net_sales, 0) AS pos_unpayouted
  FROM daily_overrides d
  LEFT JOIN payout_by_day pd
    ON pd.branch_id = d.branch_id
   AND pd.date = d.date
  LEFT JOIN pos_unpayouted_by_day pu
    ON pu.branch_id = d.branch_id
   AND pu.date = d.date::date
  WHERE d.field = 'omzet'
)
INSERT INTO daily_overrides (branch_id, date, field, value)
SELECT
  branch_id,
  date,
  'omzet_adjustment',
  (override_value - (payout_total + pos_unpayouted))::integer
FROM legacy
WHERE override_value <> payout_total + pos_unpayouted
ON CONFLICT (branch_id, date, field) DO NOTHING;

DELETE FROM daily_overrides WHERE field = 'omzet';
