-- Run against the TARGET after restoring the Supabase dump.
--
-- These columns exist only so the data dump could list them. Migration 0063
-- drops them on a normal deploy, but the restore re-created them through the
-- bridge in `rehearsal-before-restore.sql`. The code never reads them
-- (ADR-0017 reverted `includeInPnl`), and every source value was `true`.

ALTER TABLE public.manual_revenues DROP COLUMN IF EXISTS include_in_pnl;
ALTER TABLE public.channel_revenues DROP COLUMN IF EXISTS include_in_pnl;
