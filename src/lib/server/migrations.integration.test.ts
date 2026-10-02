import { Client } from "pg";
import { beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import * as schema from "#/db/schema";
import { getTestDatabaseUrl } from "./test-database";
import { setupFlowHarness, type TestDb } from "./integration-test-harness";

const testDatabaseUrl = getTestDatabaseUrl();

// The drift checker imports the module-level `db`; point that mock at the
// test database (same pattern as every *-flow.integration.test.ts).
const dbHolder = vi.hoisted(() => ({
  // SAFETY: setupFlowHarness(dbHolder) assigns dbHolder.db in beforeAll before any test reads it.
  db: undefined as TestDb | undefined,
}));

vi.mock("#/lib/server/db", () => ({
  get db() {
    if (!dbHolder.db) throw new Error("db holder not initialized — beforeAll must run first");
    return dbHolder.db;
  },
}));

setupFlowHarness(dbHolder);

describe("database migrations", () => {
  it.skipIf(!testDatabaseUrl)(
    "applies the complete migration set and exposes the branch visibility schema",
    async () => {
      const client = new Client({ connectionString: testDatabaseUrl });
      await client.connect();

      try {
        const db = drizzle(client, { schema });
        await migrate(db, { migrationsFolder: "./drizzle" });

        const tableRows = await client.query<{ table_name: string }>(
          `
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name IN ('branches', 'recipes', 'recipe_branches')
            ORDER BY table_name
          `,
        );
        expect(tableRows.rows.map((row) => row.table_name)).toEqual([
          "branches",
          "recipe_branches",
          "recipes",
        ]);

        const recipeBranchColumns = await client.query<{ column_name: string }>(
          `
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'recipe_branches'
            ORDER BY ordinal_position
          `,
        );
        expect(recipeBranchColumns.rows.map((row) => row.column_name)).toEqual([
          "id",
          "recipe_id",
          "branch_id",
          "created_at",
        ]);
      } finally {
        await client.end();
      }
    },
  );
});

/**
 * Migration-drift detection (Data Penjualan outage, 2026-10-01): code was
 * deployed selecting `orders.verified` while migration 0056 had never been
 * applied to production — the page showed correct summary totals over an
 * empty table and every transaction touching the flag failed. These tests
 * pin `checkMigrationDrift` to migrate()'s own newer-than-latest rule: the
 * drizzle bookkeeping table is the ground truth, and a migration whose
 * folderMillis is newer than the latest bookkeeping row counts as missing.
 */
describe.skipIf(!testDatabaseUrl)("migration drift detection", () => {
  let drift: typeof import("./migration-drift");

  beforeAll(async () => {
    drift = await import("./migration-drift");
  });

  it("reports no drift on a fully-migrated database", async () => {
    // The suite's test DB is migrated by the first describe block; probe the
    // same bookkeeping the real migrator wrote (default drizzle schema).
    const result = await drift.checkMigrationDrift();
    expect(result.missing).toEqual([]);
    expect(result.dbLatest).not.toBeNull();
    expect(drift.formatDriftError(result)).not.toMatch(/Schema drift/);
  });

  it("fails like production did when the newest migration is missing from bookkeeping", async () => {
    // Simulate the exact prod state: every migration applied EXCEPT the
    // newest one — its bookkeeping row is missing, which is precisely what
    // the un-migrated 0056 deploy looked like to the migrator's
    // newer-than-latest rule. The deleted row (hash + created_at) is saved
    // first and re-inserted in the finally block, so the shared test DB
    // stays fully migrated even when assertions fail.
    const client = new Client({ connectionString: testDatabaseUrl });
    await client.connect();
    const { rows: newest } = await client.query<{
      id: number;
      hash: string;
      created_at: string;
    }>(
      `select id, hash, created_at from drizzle.__drizzle_migrations
       order by created_at desc limit 1`,
    );
    expect(newest.length).toBe(1);
    const saved = newest[0];
    try {
      await client.query(`delete from drizzle.__drizzle_migrations where id = $1`, [saved.id]);

      const result = await drift.checkMigrationDrift();
      expect(result.missing.length).toBe(1);
      expect(result.dbLatest).toBeLessThan(result.missing[0].when);
      const message = drift.formatDriftError(result);
      expect(message).toMatch(/Schema drift: 1 committed migration/);
      expect(message).toMatch(/pnpm db:migrate/);
    } finally {
      await client.query(
        `insert into drizzle.__drizzle_migrations (id, hash, created_at)
         values ($1, $2, $3)`,
        [saved.id, saved.hash, saved.created_at],
      );
      await client.end();
    }
    // Restore is verified — drift must be gone again.
    const restored = await drift.checkMigrationDrift();
    expect(restored.missing).toEqual([]);
  });
});
