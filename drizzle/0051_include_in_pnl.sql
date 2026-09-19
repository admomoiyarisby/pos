-- ADR 0017: includeInPnl flag on manual revenue entries.
-- Manual/channel revenue entries are incremental sales by default (count
-- toward omzet); memo-only entries (e.g. payout reconciliation duplicating
-- POS orders) can be flipped off per row.
ALTER TABLE "manual_revenues" ADD COLUMN "include_in_pnl" boolean NOT NULL DEFAULT true;
ALTER TABLE "channel_revenues" ADD COLUMN "include_in_pnl" boolean NOT NULL DEFAULT true;
