-- Migration 0063: drop the reverted `include_in_pnl` dead columns.
--
-- ADR-0017-finance-pnl-definitions.md: the `includeInPnl` intent flag was
-- implemented, then reverted BEFORE merge — manual revenues are memo notes, not
-- sales, so they must never enter omzet / P&L. The revert touched the Drizzle
-- schema only; no migration ever carried the drop, so the LIVE database kept
-- the columns.
--
-- This migration puts any migrated database back on the repo's HEAD schema.
-- The Supabase→native data move relies on a data-only dump (which lists every
-- source column, dead columns included), so the columns must exist on the
-- target before the dump restores, and be gone afterwards.

ALTER TABLE "public"."manual_revenues" DROP COLUMN IF EXISTS "include_in_pnl";
ALTER TABLE "public"."channel_revenues" DROP COLUMN IF EXISTS "include_in_pnl";
