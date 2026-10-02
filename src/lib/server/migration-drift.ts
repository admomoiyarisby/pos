/**
 * Migration-drift checker: does the target database's drizzle bookkeeping
 * table reflect every migration committed to `drizzle/meta`?
 *
 * Incident this guards against (2026-10-01, Data Penjualan outage): commit
 * `622e875` shipped code selecting `orders.verified`, but migration
 * `0056_sales_order_verified_flag.sql` was never applied to production. The
 * summary query (no `verified` column) kept working while the list query and
 * every write path touching the flag failed with
 * `column "verified" does not exist` — totals on screen, empty table, no
 * transactions possible.
 *
 * How drizzle actually decides what to apply (pg-core/dialect.js `migrate`):
 * it compares the **latest** `created_at` (folderMillis from the journal) in
 * the `drizzle.__drizzle_migrations` table against each migration's
 * folderMillis and applies anything newer. So "the DB is up to date" means:
 * the newest journal entry's folderMillis <= the newest bookkeeping
 * `created_at`. Comparing row *counts* or *hashes* is NOT how migrate()
 * decides, so this checker mirrors migrate()'s own rule — a count-based check
 * would pass a database that ran migrations out of order and miss exactly the
 * failures migrate() itself would paper over.
 *
 * The `migrate` deploy step (vercel.json build command) applies anything
 * missing; this checker exists so tests and CI can *detect* the drift rather
 * than silently repair it, and so a local dev database that skipped
 * `pnpm db:migrate` after pulling fails fast with a pointed message.
 */
import { readMigrationFiles } from "drizzle-orm/migrator";
import { sql } from "drizzle-orm";
import { db } from "./db";

export interface MigrationDrift {
  /** Migrations committed to drizzle/meta but not reflected in the DB. */
  readonly missing: { readonly hash: string; readonly when: number }[];
  /** The DB's newest bookkeeping timestamp, or null when the table is empty. */
  readonly dbLatest: number | null;
}

/**
 * Read the DB's drizzle migration bookkeeping without touching data.
 * Uses the same table/schema the node-postgres migrator defaults to
 * (`drizzle.__drizzle_migrations`); the table may legitimately not exist yet
 * on a brand-new database, which counts as "nothing applied".
 */
export async function checkMigrationDrift(): Promise<MigrationDrift> {
  const migrations = readMigrationFiles({ migrationsFolder: "./drizzle" });
  if (migrations.length === 0) return { missing: [], dbLatest: null };

  // SAFETY: node-postgres' db.execute resolves to a pg.QueryResult whose
  // `.rows` carry the selected column; the local pg types aren't reachable
  // through the generic NodePgDatabase handle, so narrow at this single
  // boundary to the one column this query selects.
  const result = (await db.execute(
    sql`select created_at from "drizzle"."__drizzle_migrations"`,
  )) as { rows?: { created_at: string | number | bigint }[] };
  const applied = (result.rows ?? []).map((r) => Number(r.created_at));
  const dbLatest = applied.length > 0 ? Math.max(...applied) : null;

  // Migrate's rule: a migration is applied iff some bookkeeping row's
  // created_at >= its folderMillis (it applies everything newer than the
  // latest recorded row). Missing = journal entries newer than dbLatest.
  const missing = migrations
    .filter((m) => dbLatest === null || m.folderMillis > dbLatest)
    .map((m) => ({ hash: m.hash.slice(0, 12), when: m.folderMillis }));

  return { missing, dbLatest };
}

/** Human-readable message for a drift check (CI logs, test assertions). */
export function formatDriftError(drift: MigrationDrift): string {
  if (drift.missing.length === 0) {
    return `Schema up to date: all committed migrations applied (latest bookkeeping created_at = ${drift.dbLatest ?? "none"}).`;
  }
  const head =
    `Schema drift: ${drift.missing.length} committed migration(s) not applied to this database ` +
    `(DB bookkeeping latest created_at = ${drift.dbLatest ?? "none"}).`;
  const list = drift.missing
    .slice(0, 10)
    .map((m) => `  - ${m.hash}… (folderMillis=${m.when})`)
    .join("\n");
  const fix =
    "Run `pnpm db:migrate` against this database (deploys run it automatically via vercel.json).";
  return [head, list, fix].filter(Boolean).join("\n");
}
