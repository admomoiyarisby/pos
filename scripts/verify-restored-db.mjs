#!/usr/bin/env node
// Prove a restored database matches its source before the app is pointed at it.
//
//   SOURCE_DATABASE_URL='postgresql://...:5432/postgres' \
//   TARGET_DATABASE_URL='postgresql://omoiyari:...@127.0.0.1:55432/omoiyari_rehearsal' \
//   node scripts/verify-restored-db.mjs
//
// Checks, in order:
//   1. Every `public` table on the source exists on the target.
//   2. Row counts match for every such table.
//   3. The Drizzle journal on the target has rows (the schema was built by
//      `db:migrate`, not restored from the source).
//   4. No recipe still points at Supabase Storage.
//
// Exit code 0 only when every check passes. Writes a JSON report to stdout so
// CI can upload it as an artifact.

import pg from "pg";
import process from "node:process";

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

const client = (url) =>
  new pg.Client({
    connectionString: url,
    ssl: /supabase\.(co|com)/.test(url) ? { rejectUnauthorized: false } : undefined,
  });

const source = client(required("SOURCE_DATABASE_URL"));
const target = client(required("TARGET_DATABASE_URL"));
await source.connect();
await target.connect();

const report = { ok: true, checkedAt: new Date().toISOString(), tables: {}, problems: [] };

try {
  const { rows: tableRows } = await source.query(
    `select table_name from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE'
     order by table_name`,
  );
  const tables = tableRows.map((row) => row.table_name);
  report.tableCount = tables.length;

  const { rows: targetTables } = await target.query(
    "select table_name from information_schema.tables where table_schema = 'public'",
  );
  const targetSet = new Set(targetTables.map((row) => row.table_name));

  for (const table of tables) {
    if (!targetSet.has(table)) {
      report.problems.push(`missing table: ${table}`);
      continue;
    }
    const [s, t] = await Promise.all([
      source.query(`select count(*)::bigint n from "${table}"`),
      target.query(`select count(*)::bigint n from "${table}"`),
    ]);
    const sourceCount = Number(s.rows[0].n);
    const targetCount = Number(t.rows[0].n);
    report.tables[table] = { source: sourceCount, target: targetCount };
    if (sourceCount !== targetCount) {
      report.problems.push(
        `row count mismatch: ${table} source=${sourceCount} target=${targetCount}`,
      );
    }
  }

  try {
    const journal = await target.query("select count(*)::int n from drizzle.__drizzle_migrations");
    report.drizzleMigrations = journal.rows[0].n;
  } catch {
    report.drizzleMigrations = 0;
  }
  if (report.drizzleMigrations === 0) {
    report.problems.push("target has no Drizzle migration history");
  }

  try {
    const supabase = await target.query(
      "select count(*)::int n from recipes where image_url like '%supabase.co/storage/%'",
    );
    report.recipesStillOnSupabase = supabase.rows[0].n;
    if (report.recipesStillOnSupabase > 0) {
      report.problems.push(
        `${report.recipesStillOnSupabase} recipes still point at Supabase Storage — run scripts/migrate-recipe-images.mjs`,
      );
    }
  } catch {
    report.recipesStillOnSupabase = null;
    report.problems.push("cannot count recipes still on Supabase Storage (recipes table missing)");
  }

  report.ok = report.problems.length === 0;
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
} finally {
  await source.end();
  await target.end();
}
