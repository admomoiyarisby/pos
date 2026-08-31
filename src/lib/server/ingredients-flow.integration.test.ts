/* oxlint-disable anti-slop/no-console -- effects log progress; not assertions */
/**
 * Ingredients full-flow integration test.
 *
 * Drives the real user-parameterized cores from `ingredients.ts`
 * (`createIngredientCore`, `updateIngredientCore`, `deleteIngredientCore`)
 * against the local dockerized test Postgres. Each core is the exact business
 * logic the `createServerFn` transport endpoint runs — the only thing bypassed
 * is `requireRole()` (HTTP session), replaced by an explicit `user` argument
 * per call, so role guards and the branch-visibility link handling are fully
 * exercised. All cores throw on failure.
 *
 * Lifecycle: create (with optional per-branch visibility links) → update
 * (links replaced atomically) → soft-delete tombstone (status → Deleted);
 * hard delete is refused while the ingredient is referenced by a recipe.
 *
 * Isolation: the cores hit the module-level `db` from `#/lib/server/db`, so
 * that module is mocked to return a drizzle instance over a connection to the
 * local test database, and shared tables are TRUNCATE-d between tests.
 *
 * Run:  TEST_DATABASE_URL=postgresql://omoiyari_test:omoiyari_test@localhost:5433/omoiyari_pos_test DATABASE_URL= vp test run src/lib/server/ingredients-flow.integration.test.ts
 */

import { beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { eq } from "drizzle-orm";
import * as schema from "#/db/schema";
import { getTestDatabaseUrl } from "./test-database";
import type { TestDb } from "./integration-test-harness";
import { setupFlowHarness } from "./integration-test-harness";
import type { AppUser, UserRole } from "./auth";

const testDatabaseUrl = getTestDatabaseUrl();
const hasTestDatabaseUrl = Boolean(testDatabaseUrl);

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

vi.mock("#/lib/server/auth", () => ({
  requireAuth: async () => {
    throw new Error("requireAuth should not be called — cores receive an explicit user");
  },
  requireRole: async () => {
    throw new Error("requireRole should not be called — cores receive an explicit user");
  },
}));

setupFlowHarness(dbHolder);

let db: TestDb;
let ingredientsApi: typeof import("./ingredients");
let seedCounter = 0;

function uniq(prefix: string): string {
  return `${prefix}-${seedCounter++}-${crypto.randomUUID().slice(0, 8)}`;
}

async function seedBranch(code: string): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(schema.branches).values({
    id,
    code,
    name: `ITS ${code}`,
    location: "Test",
    type: "Outlet",
  });
  return id;
}

async function seedCategory(code: string): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(schema.categories).values({ id, code, name: `Cat ${code}` });
  return id;
}

async function seedRecipe(code: string, categoryId: string): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(schema.recipes).values({
    id,
    code,
    name: `Recipe ${code}`,
    categoryId,
    basePrice: 15000,
  });
  return id;
}

async function seedUser(role: UserRole): Promise<AppUser> {
  const id = crypto.randomUUID();
  await db.insert(schema.users).values({
    id,
    name: `ITS ${role}`,
    email: `its-${id}@pos.test`,
    role,
  });
  return { id, email: `its-${id}@pos.test`, name: `ITS ${role}`, role, status: "Active" };
}

async function ingredientStatus(id: string): Promise<{ status: string }> {
  const [row] = await db
    .select({ status: schema.ingredients.status })
    .from(schema.ingredients)
    .where(eq(schema.ingredients.id, id))
    .limit(1);
  if (!row) throw new Error(`ingredient ${id} not found`);
  return row;
}

async function branchLinks(ingredientId: string): Promise<string[]> {
  const rows = await db
    .select({ branchId: schema.ingredientBranches.branchId })
    .from(schema.ingredientBranches)
    .where(eq(schema.ingredientBranches.ingredientId, ingredientId));
  return rows.map((r) => r.branchId);
}

beforeAll(async () => {
  if (!hasTestDatabaseUrl) return;
  // SAFETY: guarded by hasTestDatabaseUrl; when the test DB is absent beforeAll returns early and every test is skipped, so db is never read unset.
  db = dbHolder.db as TestDb;
  ingredientsApi = await import("./ingredients");
});

describe("Ingredients — full lifecycle via the real server-function cores", () => {
  it.skipIf(!hasTestDatabaseUrl)(
    "create with branch links → update (links replaced) → soft delete",
    async () => {
      const branchA = await seedBranch(uniq("IG-A"));
      const branchB = await seedBranch(uniq("IG-B"));
      const superAdmin = await seedUser("super_admin");

      // 1. Create — with per-branch visibility links
      const ingredient = await ingredientsApi.createIngredientCore(superAdmin, {
        code: uniq("IG-CODE"),
        name: "Tepung Terigu",
        category: "Dry",
        skuType: "RM",
        purchaseUnit: "kg",
        stockUnit: "kg",
        conversionFactor: 1,
        averageCost: 12000,
        branchIds: [branchA],
      });
      expect(ingredient.name).toBe("Tepung Terigu");
      expect(await branchLinks(ingredient.id)).toEqual([branchA]);

      // 2. Update — name + replace the branch links atomically
      const updated = await ingredientsApi.updateIngredientCore(superAdmin, {
        id: ingredient.id,
        name: "Tepung Terigu Premium",
        averageCost: 13000,
        branchIds: [branchB],
      });
      expect(updated.name).toBe("Tepung Terigu Premium");
      expect(updated.averageCost).toBe(13000);
      expect(await branchLinks(ingredient.id)).toEqual([branchB]);

      // Empty array clears links (visible everywhere)
      await ingredientsApi.updateIngredientCore(superAdmin, {
        id: ingredient.id,
        branchIds: [],
      });
      expect(await branchLinks(ingredient.id)).toEqual([]);

      // 3. Delete — soft-delete tombstone
      const deleted = await ingredientsApi.deleteIngredientCore(superAdmin, {
        id: ingredient.id,
        hardDelete: false,
      });
      expect(deleted.success).toBe(true);
      expect(deleted.wasSoftDelete).toBe(true);
      expect((await ingredientStatus(ingredient.id)).status).toBe("Deleted");
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "hard delete is refused while the ingredient is referenced by a recipe",
    async () => {
      const category = await seedCategory(uniq("IG-CAT"));
      const recipe = await seedRecipe(uniq("IG-REC"), category);
      const superAdmin = await seedUser("super_admin");

      const ingredient = await ingredientsApi.createIngredientCore(superAdmin, {
        code: uniq("IG-REF"),
        name: "Gula",
        category: "Dry",
        skuType: "RM",
        purchaseUnit: "kg",
        stockUnit: "kg",
        conversionFactor: 1,
        averageCost: 15000,
      });
      await db.insert(schema.recipeIngredients).values({
        recipeId: recipe,
        ingredientId: ingredient.id,
        quantity: 0.5,
      });

      await expect(
        ingredientsApi.deleteIngredientCore(superAdmin, {
          id: ingredient.id,
          hardDelete: true,
        }),
      ).rejects.toThrow("Cannot hard delete ingredient referenced in 1 recipe(s)");
    },
  );
});

describe("Ingredients — wrong-role and not-found negatives", () => {
  it.skipIf(!hasTestDatabaseUrl)(
    "create/update/delete reject non-master roles; missing ingredients are refused",
    async () => {
      const superAdmin = await seedUser("super_admin");
      const branchAdmin = await seedUser("branch_admin");
      const areaManager = await seedUser("area_manager");

      const createInput = {
        code: uniq("IG-N"),
        name: "Bahan N",
        category: "Fresh" as const,
        skuType: "RM" as const,
        purchaseUnit: "pcs",
        stockUnit: "pcs",
        conversionFactor: 1,
        averageCost: 1000,
      };

      await expect(ingredientsApi.createIngredientCore(branchAdmin, createInput)).rejects.toThrow(
        "Forbidden: insufficient role",
      );
      await expect(ingredientsApi.createIngredientCore(areaManager, createInput)).rejects.toThrow(
        "Forbidden: insufficient role",
      );

      const ingredient = await ingredientsApi.createIngredientCore(superAdmin, createInput);

      await expect(
        ingredientsApi.updateIngredientCore(branchAdmin, { id: ingredient.id, name: "x" }),
      ).rejects.toThrow("Forbidden: insufficient role");
      await expect(
        ingredientsApi.deleteIngredientCore(areaManager, {
          id: ingredient.id,
          hardDelete: false,
        }),
      ).rejects.toThrow("Forbidden: insufficient role");

      // No side effects — still Active
      expect((await ingredientStatus(ingredient.id)).status).toBe("Active");

      // Not found
      const missing = crypto.randomUUID();
      await expect(
        ingredientsApi.updateIngredientCore(superAdmin, { id: missing, name: "x" }),
      ).rejects.toThrow("Ingredient not found");
      await expect(
        ingredientsApi.deleteIngredientCore(superAdmin, { id: missing, hardDelete: false }),
      ).rejects.toThrow("Ingredient not found");
    },
  );
});
