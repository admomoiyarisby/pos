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

        // ADR 0019 — the duplicate-line guard must exist in the database, not
        // only in application code. `finish-receive` credits each item line
        // independently, so a repeated ingredient on one transfer inflated
        // stock twice (MT/CENTRAL/041026/06, Simple Syrup 1000 + 3000).
        const guard = await client.query<{ indexname: string; indexdef: string }>(
          `select indexname, indexdef from pg_indexes
           where schemaname = 'public' and indexname = 'stxi_transfer_ingredient_unique'`,
        );
        expect(guard.rows).toHaveLength(1);
        expect(guard.rows[0].indexdef).toMatch(/UNIQUE/i);
        expect(guard.rows[0].indexdef).toMatch(/scm_transfer_id/);
        expect(guard.rows[0].indexdef).toMatch(/ingredient_id/);

        // The duplicate-production lookup runs on every production submission.
        const yieldIdx = await client.query<{ indexname: string }>(
          `select indexname from pg_indexes
           where schemaname = 'public' and indexname = 'yield_conversions_branch_date_idx'`,
        );
        expect(yieldIdx.rows).toHaveLength(1);

        // Migration 0067 retired two states that no writer produced:
        // `orders.status = 'Cancel Requested'` (cancellation lives in
        // cancel_requests) and `cancel_requests.status = 'Approved'` (approval
        // executes the void). Migration 0068 made stock opname explicit:
        // Triggered and Realized are states now, not an overloaded Submitted
        // plus a nullable realized_at. Pin both so a future generate cannot
        // quietly undo them.
        // `json_agg` (not `array_agg` on `name[]`) so pg parses the result into
        // a real JS array instead of returning the Postgres array literal.
        const enumRows = await client.query<{ typname: string; labels: string[] }>(
          `select t.typname, json_agg(e.enumlabel order by e.enumsortorder) as labels
           from pg_type t join pg_enum e on e.enumtypid = t.oid
           where t.typname in ('order_status', 'cancel_request_status', 'stock_opname_status')
           group by t.typname`,
        );
        const labelsByEnum = Object.fromEntries(
          enumRows.rows.map((row) => [row.typname, row.labels]),
        );
        expect(labelsByEnum.order_status).not.toContain("Cancel Requested");
        expect(labelsByEnum.cancel_request_status).not.toContain("Approved");
        expect(labelsByEnum.stock_opname_status).toEqual([
          "Triggered",
          "Submitted",
          "Under Investigation",
          "Approved",
          "Realized",
        ]);

        // Migration 0069 turns the two "one open …" invariants into database
        // constraints (the app checks are racy on their own).
        const oneOpen = await client.query<{ indexname: string; indexdef: string }>(
          `select indexname, indexdef from pg_indexes
           where schemaname = 'public'
             and indexname in ('shift_one_open_per_branch', 'period_one_open')`,
        );
        expect(oneOpen.rows).toHaveLength(2);
        for (const row of oneOpen.rows) {
          expect(row.indexdef).toMatch(/UNIQUE/i);
          expect(row.indexdef).toMatch(/WHERE/i);
        }

        // Migration 0070 pairs each derived timestamp with its status flag.
        const coherence = await client.query<{ conname: string }>(
          `select conname from pg_constraint
           where conname in (
             'so_realized_coherent', 'inv_paid_coherent', 'waste_cancel_coherent',
             'yc_cancel_coherent', 'sp_cancel_coherent', 'stx_cancel_coherent',
             'user_deleted_status_coherent', 'period_closed_coherent',
             'shift_closed_coherent', 'order_void_reason_coherent',
             'spin_paid_stamps_paired', 'stxinv_paid_stamps_paired',
             'stxinv_checked_coherent'
           )
           order by conname`,
        );
        expect(coherence.rows.map((row) => row.conname)).toEqual([
          "inv_paid_coherent",
          "order_void_reason_coherent",
          "period_closed_coherent",
          "shift_closed_coherent",
          "so_realized_coherent",
          "sp_cancel_coherent",
          "spin_paid_stamps_paired",
          "stx_cancel_coherent",
          "stxinv_checked_coherent",
          "stxinv_paid_stamps_paired",
          "user_deleted_status_coherent",
          "waste_cancel_coherent",
          "yc_cancel_coherent",
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
