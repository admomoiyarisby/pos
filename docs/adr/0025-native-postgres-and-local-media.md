# 0025 — Native Postgres and Local Media on the VPS

## Context

The POS ran its database and recipe images on Supabase's free plan. That plan
pauses a project after one week without activity, caps the database at 500 MB,
and cannot be relied on for a production POS. The app already deploys to a VPS
that has spare CPU, RAM, and disk.

The database is Drizzle-managed: every schema change is a file in `drizzle/`
plus a `_journal.json` entry. Supabase's schema had drifted from that journal
(hand-applied migrations, a reverted feature's columns), so the Supabase schema
is not a trustworthy source.

Recipe images are 51 files / 18 MB. They live in a public Supabase Storage
bucket, and `recipes.image_url` holds absolute `supabase.co` URLs.

## Decision

- Run Postgres 17 as a `db` service in `deploy/compose.yaml`, with a named
  volume, UTC time zone, and a loopback-only published port (`127.0.0.1:5432`).
- The target schema is built by `vp run db:migrate`; the Supabase schema is
  never restored. Data moves as a `--data-only` dump of the `public` schema.
- Recipe images move to local disk on the VPS (`/srv/omoiyari-pos/media`),
  served by the app at `/media/recipe-images/<path>`. No object-store service
  and no Supabase dependency remain.
- `recipes.image_url` is rewritten on the **target** database only, so the
  source stays intact for rollback.
- Backups are nightly `pg_dump -Fc` + `pg_dumpall --globals-only`, plus the
  media directory, uploaded off-site by `restic` to Cloudflare R2.
- A restore drill runs monthly into `omoiyari_restore_test`.
- Migration rehearsal happens in `omoiyari_rehearsal` on the VPS, driven by
  `.github/workflows/db-rehearsal.yml`, and the real app is smoke-tested
  against it before cutover.

## Consequences

- The VPS is now responsible for durability. Losing the VPS without an
  off-site copy loses sales history — hence restic + R2 is mandatory, not
  optional.
- Deploys must apply migrations before starting the new image. CI does this
  through an SSH tunnel; the runtime image still has no `drizzle-kit`.
- `/api/keepalive` and the Vercel cron are obsolete.
- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` and `@supabase/supabase-js` are
  removed from the app.
- Supabase stays alive, read-only, as the rollback source until the cutover is
  accepted.

## References

- `deploy/README.md` — setup, backup, rehearsal, and cutover runbook.
- `scripts/sql/rehearsal-*.sql` — the source-only column bridge.
- `scripts/migrate-recipe-images.mjs`, `scripts/verify-restored-db.mjs`.
