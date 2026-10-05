// Clear a read-only `default_transaction_read_only` that a client left on a
// pooled backend, and say what to do next.
//
// When the POS loses every write with "cannot execute ... in a read-only
// transaction" while reads keep working, run this. It reports the setting and
// its source on each backend it can reach, clears any it finds set to on, and
// verifies the database accepts writes afterwards.
//
// Why this is needed at all: DATABASE_URL is Supabase's shared transaction-mode
// pooler (port 6543), which keeps a backend connection between transactions and
// does not reset session state on checkout. One client running
// `SET default_transaction_read_only = on` leaves the setting on that backend
// and takes down every write routed through it.
//
// Usage:
//   node scripts/fix-readonly-pooler.mjs          inspect, clear if needed, verify
//   node scripts/fix-readonly-pooler.mjs --check  inspect only, change nothing
//
/* oxlint-disable anti-slop/no-pooled-session-set -- this is the one script whose job is to clear exactly that session-level setting; the rule's alternative (scope it to a transaction) cannot work, because the offending state lives on the backend outside any transaction */
import "dotenv/config";
import { readFileSync } from "node:fs";
import pg from "pg";

// Deliberately the raw DATABASE_URL, NOT `requireScriptDatabaseUrl()`. The
// poisoned backend lives in the transaction-mode pool, so this script has to
// reach that pool to find and clear it — rewriting the port to 5432 would
// inspect a different, healthy set of backends and report a false all-clear.
const connectionString = (() => {
  try {
    const env = readFileSync(".env.local", "utf8");
    for (const line of env.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
  if (!process.env.DATABASE_URL) {
    console.error("No DATABASE_URL");
    process.exit(1);
  }
  return process.env.DATABASE_URL;
})();

const checkOnly = process.argv.includes("--check");

/** Read the setting and prove whether a write is accepted, on one backend. */
async function probe() {
  const client = new pg.Client({ connectionString });
  try {
    await client.connect();
    await client.query("BEGIN");
    const settings = await client.query(
      "SELECT setting, source FROM pg_settings WHERE name = 'default_transaction_read_only'",
    );
    const inRecovery = await client.query("SELECT pg_is_in_recovery() AS rec");
    const backend = await client.query("SELECT pg_backend_pid() AS pid");

    let write = "accepted";
    try {
      // Zero rows, so nothing changes even if this somehow committed.
      await client.query("UPDATE orders SET branch_id = branch_id WHERE false");
    } catch (e) {
      write = `REFUSED: ${e.message}`;
    }
    await client.query("ROLLBACK");

    return {
      setting: settings.rows[0].setting,
      source: settings.rows[0].source,
      pid: backend.rows[0].pid,
      inRecovery: inRecovery.rows[0].rec,
      write,
    };
  } finally {
    await client.end().catch(() => {});
  }
}

// Transaction-mode pooling hands out backends per transaction, so sample
// repeatedly: a single probe can land on a clean one and hide a poisoned
// sibling. Measured pool width for this project was 1, so a handful is plenty.
const SAMPLES = 5;
const seen = new Map();
for (let i = 0; i < SAMPLES; i++) {
  const r = await probe();
  const key = `${r.pid}:${r.setting}`;
  seen.set(key, (seen.get(key) ?? 0) + 1);
}

console.log("=== backends sampled ===");
for (const [key, count] of seen) {
  const [pid, setting] = key.split(":");
  console.log(
    `  backend ${pid}  default_transaction_read_only=${setting}  (seen ${count}/${SAMPLES})`,
  );
}

const poisoned = [...seen.keys()].filter((k) => k.endsWith(":on"));
const last = await probe();

console.log("\n=== diagnosis ===");
if (poisoned.length === 0 && last.write === "accepted") {
  console.log("  Pool is writable. Nothing to fix.");
  if (last.source === "session") {
    console.log(
      "  Note: source is still `session`, so some client has SET this before. Harmless while off.",
    );
  }
  process.exit(0);
}

if (last.inRecovery) {
  console.error(
    "  This is a read REPLICA (pg_is_in_recovery = true). Writes cannot succeed here at all —",
  );
  console.error(
    "  point DATABASE_URL at the primary. This is a different problem from a poisoned pool.",
  );
  process.exit(1);
}

console.log(`  Writes are being refused: ${last.write}`);
console.log("  Cause: a client set default_transaction_read_only on a pooled backend and");
console.log("         transaction-mode pooling did not reset it when the client returned.");

if (checkOnly) {
  console.log("\n  --check given, so nothing was changed. Re-run without --check to clear it.");
  process.exit(1);
}

console.log("\n=== clearing ===");
const fix = new pg.Client({ connectionString });
await fix.connect();
await fix.query("SET default_transaction_read_only = off");
await fix.end();
console.log("  Ran: SET default_transaction_read_only = off");

const after = await probe();
console.log("\n=== verify ===");
if (after.write === "accepted") {
  console.log("  Writes accepted. The POS should be saving again.");
  process.exit(0);
}
console.error(`  Still refused: ${after.write}`);
console.error("  The pool may have more than one backend, each poisoned separately.");
console.error("  Re-run this script; it clears one backend per attempt.");
process.exit(1);
