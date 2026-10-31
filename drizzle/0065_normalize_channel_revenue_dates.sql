-- Migration 0065: normalize legacy DDMMYY payout dates, drop a stray zero payout.
--
-- `channel_revenues.date` is text and the app writes strict YYYY-MM-DD. 90 rows
-- imported from the pre-POS system instead use DDMMYY (e.g. 010626 = 1 Jun
-- 2026). Every finance query compares that column as text inside an ISO range,
-- so those rows have been invisible to the app since the import, and Postgres
-- itself parses '010626' as 2001-06-26, not 2026-06-01.
--
-- Normalization is a pure rewrite: DDMMYY round-trips cleanly for all 90 rows
-- (verified before writing this migration), and there are no DDMMYY-DDMMYY
-- duplicates. Two rows collide with an existing ISO row for the same
-- branch+channel+calendar date — e.g. Mulyorejo Grabfood on 2026-06-20 exists
-- as both '200626' and '2026-06-20'. The unique key is on the text value, so
-- they coexist today; after normalization the ISO row wins and the legacy copy
-- is removed from the live table. Every original legacy row is copied to
-- `channel_revenues_legacy_ddmmyy_archive` first, so the decision is reversible
-- with a plain INSERT.
--
-- Also deletes one accidental zero payout (ADR 0028 treats an explicit 0 as
-- "zero revenue", which would hide that channel's POS fallback).

-- Keep the originals for audit/rollback. Only created when there is something
-- to archive, so fresh databases do not grow an empty table.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM channel_revenues WHERE date ~ '^[0-9]{6}$') THEN
    CREATE TABLE IF NOT EXISTS channel_revenues_legacy_ddmmyy_archive AS
    SELECT c.*, now() AS archived_at
    FROM channel_revenues c
    WHERE c.date ~ '^[0-9]{6}$';
  END IF;
END $$;

-- Accidental zero save: Darmo Permai, 1 Oct 2026, Gofood. That day has Gofood
-- POS sales (net 123,360), so the 0 would zero the channel instead of falling
-- back to POS. Approved cleanup, 1 row.
DELETE FROM channel_revenues c
USING branches b
WHERE b.id = c.branch_id
  AND b.name = 'Omoiyari Darmo Permai'
  AND c.date = '2026-10-01'
  AND c.channel = 'Gofood'
  AND c.amount = 0;

-- Normalize everything that does not collide with an existing ISO row.
UPDATE channel_revenues c
SET date = to_char(to_date(c.date, 'DDMMYY'), 'YYYY-MM-DD')
WHERE c.date ~ '^[0-9]{6}$'
  AND NOT EXISTS (
    SELECT 1
    FROM channel_revenues x
    WHERE x.branch_id = c.branch_id
      AND x.channel = c.channel
      AND x.date = to_char(to_date(c.date, 'DDMMYY'), 'YYYY-MM-DD')
  );

-- What remains in DDMMYY form are the collisions; the ISO row is the one the
-- app could already see, so it wins. The archive above holds the removed copy.
DELETE FROM channel_revenues WHERE date ~ '^[0-9]{6}$';

-- Prevent a future import from reintroducing the same silent gap. Small table,
-- so the validation scan is instant.
ALTER TABLE channel_revenues
  ADD CONSTRAINT channel_revenues_date_iso CHECK (date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$');
