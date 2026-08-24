import { Client } from "pg";
import { describe, expect, it } from "vite-plus/test";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import * as schema from "#/db/schema";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

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
