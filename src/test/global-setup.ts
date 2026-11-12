import { resolve } from "node:path";
import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getTestDatabaseUrl } from "../lib/server/test-database";

/**
 * Bring the integration-test database up to the current schema before any
 * test file runs.
 *
 * Without this, `migrations.integration.test.ts` is the only place that
 * migrates — but Vitest runs files in name order, and every `*-flow` file
 * that sorts before `migrations` fails on a brand-new database with
 * "relation does not exist". The first test run should not require a
 * manually prepared volume.
 *
 * `migrate()` is idempotent (drizzle records applied entries in
 * `drizzle.__drizzle_migrations`), so the migration test still exercises the
 * full chain when it runs.
 */
export default async function setup(): Promise<void> {
  const url = getTestDatabaseUrl();
  // Unit-only runs (`vp test run src/lib/foo.test.ts`) need no database.
  if (!url) return;

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await migrate(drizzle(client), {
      migrationsFolder: resolve(process.cwd(), "drizzle"),
    });
  } finally {
    await client.end();
  }
}
