-- Run against the freshly-migrated TARGET before restoring the Supabase dump.
--
-- 1. The live Supabase database still has two columns that the repo dropped
--    without a migration (`manual_revenues.include_in_pnl`,
--    `channel_revenues.include_in_pnl`). `pg_dump` writes every column name in
--    its INSERT statements, so the target must have them for the restore.
-- 2. `db:migrate` seeds demo rows (categories, …). The source dump contains the
--    real rows and would collide on unique keys, so clear the tables first.
--    TRUNCATE keeps the schema and resets nothing else — the target has no data
--    worth keeping at this point.
--
-- `scripts/migrate-recipe-images.mjs` does not depend on these columns, and
-- `rehearsal-after-restore.sql` drops them again.

ALTER TABLE public.manual_revenues
  ADD COLUMN IF NOT EXISTS include_in_pnl boolean NOT NULL DEFAULT true;
ALTER TABLE public.channel_revenues
  ADD COLUMN IF NOT EXISTS include_in_pnl boolean NOT NULL DEFAULT true;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('TRUNCATE TABLE public.%I CASCADE', r.tablename);
  END LOOP;
END $$;
