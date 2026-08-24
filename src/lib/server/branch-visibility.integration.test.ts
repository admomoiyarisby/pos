import { Client } from "pg";
import { describe, expect, it } from "vite-plus/test";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "#/db/schema";
import { branchVisibleClause } from "./branch-visibility";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

type TestFixture = {
  branchA: string;
  branchB: string;
  branchC: string;
  recipeCodes: {
    unrestricted: string;
    branchAOnly: string;
    branchAAndB: string;
    branchCOnly: string;
  };
};

async function createFixture(db: ReturnType<typeof drizzle<typeof schema>>): Promise<TestFixture> {
  const branchA = crypto.randomUUID();
  const branchB = crypto.randomUUID();
  const branchC = crypto.randomUUID();
  const categoryId = crypto.randomUUID();
  const recipeIds = {
    unrestricted: crypto.randomUUID(),
    branchAOnly: crypto.randomUUID(),
    branchAAndB: crypto.randomUUID(),
    branchCOnly: crypto.randomUUID(),
  };
  const recipeCodes = {
    unrestricted: `IT-ALL-${crypto.randomUUID().slice(0, 8)}`,
    branchAOnly: `IT-A-${crypto.randomUUID().slice(0, 8)}`,
    branchAAndB: `IT-AB-${crypto.randomUUID().slice(0, 8)}`,
    branchCOnly: `IT-C-${crypto.randomUUID().slice(0, 8)}`,
  };

  await db.insert(schema.branches).values([
    {
      id: branchA,
      code: `IT-A-${crypto.randomUUID().slice(0, 8)}`,
      name: "Visibility integration branch A",
      location: "Test",
      type: "Outlet",
    },
    {
      id: branchB,
      code: `IT-B-${crypto.randomUUID().slice(0, 8)}`,
      name: "Visibility integration branch B",
      location: "Test",
      type: "Outlet",
    },
    {
      id: branchC,
      code: `IT-C-${crypto.randomUUID().slice(0, 8)}`,
      name: "Visibility integration branch C",
      location: "Test",
      type: "Outlet",
    },
  ]);

  await db.insert(schema.categories).values({
    id: categoryId,
    code: `IT-CAT-${crypto.randomUUID().slice(0, 8)}`,
    name: "Visibility integration category",
  });

  await db.insert(schema.recipes).values([
    {
      id: recipeIds.unrestricted,
      code: recipeCodes.unrestricted,
      name: "Visibility integration unrestricted",
      categoryId,
      basePrice: 1000,
      status: "Active",
    },
    {
      id: recipeIds.branchAOnly,
      code: recipeCodes.branchAOnly,
      name: "Visibility integration branch A only",
      categoryId,
      basePrice: 1000,
      status: "Active",
    },
    {
      id: recipeIds.branchAAndB,
      code: recipeCodes.branchAAndB,
      name: "Visibility integration branches A and B",
      categoryId,
      basePrice: 1000,
      status: "Active",
    },
    {
      id: recipeIds.branchCOnly,
      code: recipeCodes.branchCOnly,
      name: "Visibility integration branch C only",
      categoryId,
      basePrice: 1000,
      status: "Active",
    },
  ]);

  await db.insert(schema.recipeBranches).values([
    { recipeId: recipeIds.branchAOnly, branchId: branchA },
    { recipeId: recipeIds.branchAAndB, branchId: branchA },
    { recipeId: recipeIds.branchAAndB, branchId: branchB },
    { recipeId: recipeIds.branchCOnly, branchId: branchC },
  ]);

  return { branchA, branchB, branchC, recipeCodes };
}

async function visibleRecipeCodes(
  db: ReturnType<typeof drizzle<typeof schema>>,
  branchId: string | undefined,
  recipeCodes: string[],
): Promise<string[]> {
  const branchClause = branchVisibleClause({
    linkTable: schema.recipeBranches,
    linkRowId: schema.recipeBranches.recipeId,
    rowId: schema.recipes.id,
    linkBranchId: schema.recipeBranches.branchId,
    currentBranchId: branchId,
  });

  const rows = await db
    .select({ code: schema.recipes.code })
    .from(schema.recipes)
    .where(
      and(
        eq(schema.recipes.status, "Active"),
        inArray(schema.recipes.code, recipeCodes),
        branchClause,
      ),
    )
    .orderBy(schema.recipes.code);

  return rows.map((row) => row.code);
}

describe("branch visibility SQL integration", () => {
  it.skipIf(!hasDatabaseUrl)(
    "applies the allow-list policy for unrestricted, single-branch, and multi-branch recipes",
    async () => {
      const client = new Client({ connectionString: process.env.DATABASE_URL });
      await client.connect();

      try {
        await client.query("BEGIN");
        const db = drizzle(client, { schema });
        const fixture = await createFixture(db);

        const recipeCodes = Object.values(fixture.recipeCodes);

        expect(await visibleRecipeCodes(db, fixture.branchA, recipeCodes)).toEqual(
          [
            fixture.recipeCodes.unrestricted,
            fixture.recipeCodes.branchAOnly,
            fixture.recipeCodes.branchAAndB,
          ].sort(),
        );
        expect(await visibleRecipeCodes(db, fixture.branchB, recipeCodes)).toEqual(
          [fixture.recipeCodes.unrestricted, fixture.recipeCodes.branchAAndB].sort(),
        );
        expect(await visibleRecipeCodes(db, fixture.branchC, recipeCodes)).toEqual(
          [fixture.recipeCodes.unrestricted, fixture.recipeCodes.branchCOnly].sort(),
        );
        expect(await visibleRecipeCodes(db, undefined, recipeCodes)).toEqual(
          [
            fixture.recipeCodes.unrestricted,
            fixture.recipeCodes.branchAOnly,
            fixture.recipeCodes.branchAAndB,
            fixture.recipeCodes.branchCOnly,
          ].sort(),
        );
      } finally {
        await client.query("ROLLBACK");
        await client.end();
      }
    },
  );
});
