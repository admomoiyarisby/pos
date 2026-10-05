// Read-only production query runner: `node scripts/read-only-query.mjs query.sql`.
// Results print one JSON object per row.
//
// Two independent guards, because either alone has a gap:
//
//  1. Connects in session mode (port 5432) via `requireScriptDatabaseUrl()`, so
//     anything this script changes about the session dies with the connection
//     instead of being inherited by the app. The app stays on transaction mode
//     (6543), which does not reset session state on checkout.
//  2. Runs the query inside `BEGIN READ ONLY`, so an accidental write in the SQL
//     cannot commit.
//
// Do NOT add a session-level `SET default_transaction_read_only = on` (or
// `SET SESSION CHARACTERISTICS ...`) as a third guard. It reads as the safest
// option and is the one that took the POS down: on a transaction-mode pooler the
// setting survives the connection and breaks every later write in the app until
// someone runs `node scripts/fix-readonly-pooler.mjs`. The
// `anti-slop/no-pooled-session-set` lint rule rejects it.
import "dotenv/config";
import { readFileSync } from "node:fs";
import pg from "pg";

import { requireScriptDatabaseUrl } from "./db-url.mjs";

const connectionString = requireScriptDatabaseUrl();

const sqlPath = process.argv[2];
if (!sqlPath) {
  console.error("usage: node scripts/read-only-query.mjs <file.sql>");
  process.exit(1);
}

const client = new pg.Client({ connectionString });
await client.connect();
try {
  await client.query("BEGIN READ ONLY");
  const result = await client.query(readFileSync(sqlPath, "utf8"));
  for (const row of result.rows) console.log(JSON.stringify(row));
  if (!result.rows.length) console.log("(0 rows)");
  await client.query("COMMIT");
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("QUERY ERROR:", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
