import { Client } from "pg";
import { describe, expect, it } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "#/db/schema";
import { getTestDatabaseUrl } from "./test-database";
import { resolveNewItemIngredients } from "./ingredient-resolver";

type TestDb = NodePgDatabase<typeof schema>;

const testDatabaseUrl = getTestDatabaseUrl();
const hasTestDatabaseUrl = Boolean(testDatabaseUrl);

type ResolverFixture = {
  branchId: string;
  parentRecipeId: string;
  ingredientId: string;
  childIngredientId: string;
  addOnIngredientId: string;
  recipeAddOnId: string;
  recipeAddOnIngredientId: string;
  exclusionIngredientId: string;
  modifierGroupId: string;
  addOnModifierId: string;
  exclusionModifierId: string;
};

async function createResolverFixture(db: TestDb): Promise<ResolverFixture> {
  const branchId = crypto.randomUUID();
  const categoryId = crypto.randomUUID();
  const parentRecipeId = crypto.randomUUID();
  const childRecipeId = crypto.randomUUID();
  const ingredientId = crypto.randomUUID();
  const childIngredientId = crypto.randomUUID();
  const addOnIngredientId = crypto.randomUUID();
  const recipeAddOnId = crypto.randomUUID();
  const recipeAddOnIngredientId = crypto.randomUUID();
  const exclusionIngredientId = crypto.randomUUID();
  const modifierGroupId = crypto.randomUUID();
  const addOnModifierId = crypto.randomUUID();
  const exclusionModifierId = crypto.randomUUID();
  const suffix = crypto.randomUUID().slice(0, 8);

  await db.insert(schema.branches).values({
    id: branchId,
    code: `IT-R-${suffix}`,
    name: "Resolver integration branch",
    location: "Test",
    type: "Outlet",
  });
  await db.insert(schema.categories).values({
    id: categoryId,
    code: `IT-RC-${suffix}`,
    name: "Resolver integration category",
  });
  await db.insert(schema.ingredients).values([
    {
      id: ingredientId,
      code: `IT-I-${suffix}`,
      name: "Parent ingredient",
      category: "Fresh",
      skuType: "RM",
      purchaseUnit: "pcs",
      stockUnit: "pcs",
      conversionFactor: 1,
      averageCost: 100,
    },
    {
      id: childIngredientId,
      code: `IT-CI-${suffix}`,
      name: "Child ingredient",
      category: "Fresh",
      skuType: "RM",
      purchaseUnit: "pcs",
      stockUnit: "pcs",
      conversionFactor: 1,
      averageCost: 200,
    },
    {
      id: addOnIngredientId,
      code: `IT-AI-${suffix}`,
      name: "Add-on ingredient",
      category: "Fresh",
      skuType: "RM",
      purchaseUnit: "pcs",
      stockUnit: "pcs",
      conversionFactor: 1,
      averageCost: 300,
    },
    {
      id: recipeAddOnIngredientId,
      code: `IT-RAI-${suffix}`,
      name: "Recipe add-on ingredient",
      category: "Fresh",
      skuType: "RM",
      purchaseUnit: "pcs",
      stockUnit: "pcs",
      conversionFactor: 1,
      averageCost: 500,
    },
    {
      id: exclusionIngredientId,
      code: `IT-EI-${suffix}`,
      name: "Exclusion ingredient",
      category: "Fresh",
      skuType: "RM",
      purchaseUnit: "pcs",
      stockUnit: "pcs",
      conversionFactor: 1,
      averageCost: 400,
    },
  ]);
  await db.insert(schema.recipes).values([
    {
      id: parentRecipeId,
      code: `IT-RP-${suffix}`,
      name: "Resolver parent",
      categoryId,
      basePrice: 1000,
      isBOGO: true,
      status: "Active",
    },
    {
      id: childRecipeId,
      code: `IT-RCH-${suffix}`,
      name: "Resolver child",
      categoryId,
      basePrice: 1000,
      status: "Active",
    },
    {
      id: recipeAddOnId,
      code: `IT-RA-${suffix}`,
      name: "Recipe add-on",
      categoryId,
      basePrice: 500,
      status: "Active",
    },
  ]);
  await db.insert(schema.recipeIngredients).values([
    { recipeId: parentRecipeId, ingredientId, quantity: 1 },
    { recipeId: childRecipeId, ingredientId: childIngredientId, quantity: 2 },
    { recipeId: recipeAddOnId, ingredientId: recipeAddOnIngredientId, quantity: 3 },
  ]);
  await db.insert(schema.recipeChildRecipes).values({
    parentRecipeId,
    childRecipeId,
    quantity: 3,
  });
  await db.insert(schema.modifierGroups).values({
    id: modifierGroupId,
    code: `IT-MG-${suffix}`,
    name: "Resolver modifiers",
  });
  await db.insert(schema.modifiers).values([
    {
      id: addOnModifierId,
      modifierGroupId,
      code: `IT-MA-${suffix}`,
      name: "Extra",
      price: 100,
    },
    {
      id: exclusionModifierId,
      modifierGroupId,
      code: `IT-ME-${suffix}`,
      name: "No ingredient",
      price: 0,
      isExclusion: true,
    },
  ]);
  await db.insert(schema.modifierIngredients).values({
    modifierId: addOnModifierId,
    ingredientId: addOnIngredientId,
    quantity: 4,
  });
  await db.insert(schema.modifierRecipes).values({
    modifierId: addOnModifierId,
    recipeId: recipeAddOnId,
    quantity: 2,
  });
  await db.insert(schema.recipeModifierExclusions).values({
    recipeId: parentRecipeId,
    modifierId: exclusionModifierId,
    ingredientId: exclusionIngredientId,
    quantity: 1,
  });

  return {
    branchId,
    parentRecipeId,
    ingredientId,
    childIngredientId,
    addOnIngredientId,
    recipeAddOnId,
    recipeAddOnIngredientId,
    exclusionIngredientId,
    modifierGroupId,
    addOnModifierId,
    exclusionModifierId,
  };
}

describe("ingredient resolver database integration", () => {
  it.skipIf(!hasTestDatabaseUrl)(
    "resolves BOGO, bundle, add-on, and exclusion quantities from real rows",
    async () => {
      const client = new Client({ connectionString: testDatabaseUrl });
      await client.connect();

      try {
        await client.query("BEGIN");
        const db = drizzle(client, { schema });
        const fixture = await createResolverFixture(db);

        const result = await resolveNewItemIngredients(
          fixture.parentRecipeId,
          2,
          [
            { modifierId: fixture.addOnModifierId },
            { modifierId: fixture.exclusionModifierId, isExclusion: true },
          ],
          { includeCost: true, tx: db },
        );

        expect(result.ingredients).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ ingredientId: fixture.ingredientId, quantity: 4 }),
            expect.objectContaining({ ingredientId: fixture.childIngredientId, quantity: 24 }),
            expect.objectContaining({ ingredientId: fixture.addOnIngredientId, quantity: 4 }),
            expect.objectContaining({
              ingredientId: fixture.recipeAddOnIngredientId,
              quantity: 12,
            }),
            expect.objectContaining({ ingredientId: fixture.exclusionIngredientId, quantity: -4 }),
          ]),
        );
        expect(result.exclusionRecords).toEqual([
          { ingredientId: fixture.exclusionIngredientId, quantity: 4 },
        ]);

        const branchRows = await db
          .select({ id: schema.branches.id })
          .from(schema.branches)
          .where(eq(schema.branches.id, fixture.branchId));
        expect(branchRows).toHaveLength(1);
      } finally {
        await client.query("ROLLBACK");
        await client.end();
      }
    },
  );
});
