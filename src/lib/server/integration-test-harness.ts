import { Client } from "pg";
import { afterAll, beforeAll, beforeEach } from "vite-plus/test";
import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "#/db/schema";
import { getTestDatabaseUrl } from "./test-database";

export type TestDb = NodePgDatabase<typeof schema>;

export const TEST_DATABASE_URL = getTestDatabaseUrl();

/**
 * Root tables to wipe between tests. `CASCADE` reaches every table that
 * references them (inventory, scm_transfers*, scm_procurements*, waste,
 * notifications, sessions, …), so tests never observe each other's rows and
 * document code serials restart cleanly.
 */
export const TRUNCATE_TABLES = [
  "users",
  "branches",
  "ingredients",
  "document_code_sequences",
  "categories",
  "brands",
  "vouchers",
  "modifier_groups",
  "recipes",
];

/**
 * Registers the vitest lifecycle for a flow integration test file:
 *
 *  - beforeAll: connect to the local test database and point the module-level
 *    `db` mock (via `holder`) at a drizzle instance over that connection.
 *  - beforeEach: `TRUNCATE … CASCADE` so every test starts clean.
 *  - afterAll: close the connection.
 *
 * No outer transaction is held open — the cores' own `db.transaction()` calls
 * manage their own transactions, so a failing inner transition rolls back only
 * its own work instead of wiping the whole test.
 *
 * Call this at the top level of a test file, after `vi.mock("#/lib/server/db")`.
 */
export function setupFlowHarness(holder: { db: TestDb | undefined }): void {
  let client: Client | undefined;

  beforeAll(async () => {
    if (!TEST_DATABASE_URL) return;
    client = new Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    holder.db = drizzle(client, { schema });
  });

  beforeEach(async () => {
    if (!client) return;
    await client.query(`TRUNCATE ${TRUNCATE_TABLES.join(", ")} CASCADE`);
  });

  afterAll(async () => {
    await client?.end();
  });
}
