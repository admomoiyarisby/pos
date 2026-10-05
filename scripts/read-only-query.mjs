// Read-only production query runner: `node scripts/read-only-query.mjs query.sql`.
// Results print one JSON object per row. Every query runs inside a
// `BEGIN READ ONLY` transaction, so an accidental write in the SQL cannot
// commit — same guarantee as the session-level setting, minus the damage.
//
// Do NOT add a session-level `SET default_transaction_read_only = on` (or
// `SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY`) here. The app reaches
// the database through Supabase's shared transaction-mode pooler (port 6543),
// which keeps a backend connection between transactions and does not reset
// session state on checkout. A session-level SET sticks to that backend after
// this script disconnects, and every later INSERT/UPDATE from the app then
// fails with "cannot execute ... in a read-only transaction" until someone runs
// `SET default_transaction_read_only = off`. `BEGIN READ ONLY` scopes the
// protection to this one transaction, so there is nothing left behind.
import "dotenv/config";
import { readFileSync } from "node:fs";
import pg from "pg";

function loadEnvLocal() {
  try {
    const env = readFileSync(".env.local", "utf8");
    for (const line of env.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
}
loadEnvLocal();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("No DATABASE_URL");
  process.exit(1);
}

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
