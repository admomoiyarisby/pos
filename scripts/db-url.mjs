// Shared database URL helpers for scripts.
//
// Scripts get session mode (port 5432); the app gets transaction mode (6543).
// The distinction is the whole point — see `sessionModeUrl` below.
//
import { readFileSync } from "node:fs";

// Read .env.local without clobbering variables already in the environment, so
// `DATABASE_URL=... node scripts/whatever.mjs` still wins.
export function loadEnvLocal() {
  try {
    const env = readFileSync(".env.local", "utf8");
    for (const line of env.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
}

/**
 * The same database reached in session mode, so a script cannot poison the app.
 *
 * `DATABASE_URL` is Supabase's shared transaction-mode pooler on 6543. It keeps
 * a backend connection between transactions and does not reset session state on
 * checkout, so any session-level SET a script issues outlives the connection and
 * is inherited by the next client to draw that backend — which is how one
 * `SET default_transaction_read_only = on` took every write in the POS down at
 * once. Session mode on 5432 gives each client its own backend for the life of
 * the connection, so there is nothing to inherit.
 *
 * Returns the input unchanged when it is not a pooler URL: a local socket, a
 * direct `db.<ref>` host, or an already-5433 port needs no rewriting.
 */
export function sessionModeUrl(url) {
  const parsed = new URL(url);
  if (parsed.port === "6543") {
    parsed.port = "5432";
  }
  return parsed.toString();
}

/**
 * The connection string a script should use, or exits with a clear message.
 *
 * Prefers an explicit override so a script can be pointed at a test database or
 * a local socket without editing it.
 */
export function requireScriptDatabaseUrl() {
  // Idempotent, and called here so a script that imports only this helper still
  // picks up .env.local without having to remember the loader.
  loadEnvLocal();
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("No DATABASE_URL");
    process.exit(1);
  }
  return sessionModeUrl(url);
}
