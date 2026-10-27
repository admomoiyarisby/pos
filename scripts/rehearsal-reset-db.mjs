#!/usr/bin/env node
// Drop and recreate the rehearsal database. Refuses every other name.
//
//   REHEARSAL_ADMIN_URL='postgresql://omoiyari:<pw>@127.0.0.1:55432/postgres' \
//   node scripts/rehearsal-reset-db.mjs
//
// `omoiyari_rehearsal` is a fixed name on purpose: a typo in an env var must
// never drop production.

import pg from "pg";
import process from "node:process";

const TARGET = "omoiyari_rehearsal";
const url = process.env.REHEARSAL_ADMIN_URL;
if (!url) throw new Error("Missing REHEARSAL_ADMIN_URL (must point at the `postgres` database)");

const client = new pg.Client({
  connectionString: url,
  ssl: /supabase\.(co|com)/.test(url) ? { rejectUnauthorized: false } : undefined,
});
await client.connect();

try {
  const { rows } = await client.query("select datname from pg_database where datname = $1", [
    TARGET,
  ]);
  if (rows.length > 0) {
    console.log(`dropping ${TARGET}`);
    await client.query(
      `select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`,
      [TARGET],
    );
    await client.query(`drop database "${TARGET}"`);
  }
  console.log(`creating ${TARGET}`);
  await client.query(`create database "${TARGET}" template template0 encoding 'UTF8'`);
  console.log(JSON.stringify({ ok: true, database: TARGET }, null, 2));
} finally {
  await client.end();
}
