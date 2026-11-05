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
      // 12.000 -> 13.000 sits inside the silent band, so the guard saves it.
      if ("needsConfirmation" in updated) throw new Error("cost guard asked to confirm");
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

describe("Ingredients — duplicate codes are refused readably", () => {
  // `ingredients.code` is UNIQUE. With no pre-check, a duplicate surfaced as
  // Drizzle's "Failed query: insert into "ingredients" (...) values (...)" —
  // the user saw the SQL and no explanation. Both paths now name the clash.
  it.skipIf(!hasTestDatabaseUrl)(
    "create refuses a duplicate code by name instead of leaking the failing query",
    async () => {
      const superAdmin = await seedUser("super_admin");
      const code = uniq("IG-DUP");

      await ingredientsApi.createIngredientCore(superAdmin, {
        code,
        name: "Plastik 18",
        category: "Packaging",
        skuType: "RM",
        purchaseUnit: "Pack",
        stockUnit: "Pack",
        conversionFactor: 1,
        averageCost: 2600,
      });

      await expect(
        ingredientsApi.createIngredientCore(superAdmin, {
          code,
          name: "Plastik 18 (duplikat)",
          category: "Packaging",
          skuType: "RM",
          purchaseUnit: "Pack",
          stockUnit: "Pack",
          conversionFactor: 1,
          averageCost: 2600,
        }),
      ).rejects.toThrow(`Kode bahan "${code}" sudah dipakai oleh "Plastik 18"`);
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "update refuses moving an ingredient onto another ingredient's code",
    async () => {
      const superAdmin = await seedUser("super_admin");
      const [first, second] = await Promise.all([
        ingredientsApi.createIngredientCore(superAdmin, {
          code: uniq("IG-A"),
          name: "Bahan A",
          category: "Dry",
          skuType: "RM",
          purchaseUnit: "pcs",
          stockUnit: "pcs",
          conversionFactor: 1,
          averageCost: 1000,
        }),
        ingredientsApi.createIngredientCore(superAdmin, {
          code: uniq("IG-B"),
          name: "Bahan B",
          category: "Dry",
          skuType: "RM",
          purchaseUnit: "pcs",
          stockUnit: "pcs",
          conversionFactor: 1,
          averageCost: 1000,
        }),
      ]);

      await expect(
        ingredientsApi.updateIngredientCore(superAdmin, { id: second.id, code: first.code }),
      ).rejects.toThrow(`Kode bahan "${first.code}" sudah dipakai oleh "Bahan A"`);
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "update may re-save an ingredient under its own unchanged code",
    async () => {
      const superAdmin = await seedUser("super_admin");
      const created = await ingredientsApi.createIngredientCore(superAdmin, {
        code: uniq("IG-SAME"),
        name: "Bahan S",
        category: "Dry",
        skuType: "RM",
        purchaseUnit: "pcs",
        stockUnit: "pcs",
        conversionFactor: 1,
        averageCost: 1000,
      });

      const updated = await ingredientsApi.updateIngredientCore(superAdmin, {
        id: created.id,
        code: created.code,
        name: "Bahan S (revisi)",
      });
      if ("needsConfirmation" in updated) throw new Error("cost guard asked to confirm");
      expect(updated.name).toBe("Bahan S (revisi)");
    },
  );
});

describe("Ingredients — cost guard (package price typed as a unit price)", () => {
  /** Ingredient + one menu using it, so the preview has something to report. */
  async function seedCostedIngredient(admin: AppUser, cost: number) {
    const categoryId = await seedCategory(uniq("IG-CAT"));
    const recipeId = await seedRecipe(uniq("IG-R"), categoryId);
    const ingredient = await ingredientsApi.createIngredientCore(admin, {
      code: uniq("IG-COST"),
      name: "Air",
      category: "Dry",
      skuType: "RM",
      purchaseUnit: "botol",
      stockUnit: "ml",
      conversionFactor: 600,
      averageCost: cost,
    });
    await db
      .insert(schema.recipeIngredients)
      .values({ recipeId, ingredientId: ingredient.id, quantity: 180 });
    await db
      .update(schema.recipes)
      .set({ totalCogs: Math.round(cost * 180) })
      .where(eq(schema.recipes.id, recipeId));
    return { ingredient, recipeId };
  }

  async function storedCost(id: string): Promise<number> {
    const [row] = await db
      .select({ averageCost: schema.ingredients.averageCost })
      .from(schema.ingredients)
      .where(eq(schema.ingredients.id, id))
      .limit(1);
    if (!row) throw new Error(`ingredient ${id} not found`);
    return row.averageCost;
  }

  async function recipeCogs(id: string): Promise<number> {
    const [row] = await db
      .select({ totalCogs: schema.recipes.totalCogs })
      .from(schema.recipes)
      .where(eq(schema.recipes.id, id))
      .limit(1);
    if (!row) throw new Error(`recipe ${id} not found`);
    return row.totalCogs;
  }

  it.skipIf(!hasTestDatabaseUrl)(
    "asks before a 369x jump, showing the menus it would reprice, and writes nothing",
    async () => {
      const admin = await seedUser("super_admin");
      const { ingredient, recipeId } = await seedCostedIngredient(admin, 1);

      // The production mistake: a bottle price typed as the per-ml price.
      const result = await ingredientsApi.updateIngredientCore(admin, {
        id: ingredient.id,
        averageCost: 369,
      });

      if (!("needsConfirmation" in result)) throw new Error("guard did not ask");
      expect(result.verdict).toBe("extreme");
      expect(result.ratio).toBe(369);
      expect(result.stockUnit).toBe("ml");
      expect(result.affectedMenus).toBe(1);
      expect(result.biggest[0]).toMatchObject({
        recipeId,
        cogsBefore: 180,
        cogsAfter: 66_420,
      });

      // Nothing written, nothing repriced.
      expect(await storedCost(ingredient.id)).toBe(1);
      expect(await recipeCogs(recipeId)).toBe(180);
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "applies the same change once the user confirms, and reprices the menus",
    async () => {
      const admin = await seedUser("super_admin");
      const { ingredient, recipeId } = await seedCostedIngredient(admin, 1);

      const result = await ingredientsApi.updateIngredientCore(admin, {
        id: ingredient.id,
        averageCost: 369,
        confirmCostChange: true,
      });

      if ("needsConfirmation" in result) throw new Error("guard asked twice");
      expect(result.averageCost).toBe(369);
      expect(await storedCost(ingredient.id)).toBe(369);
      // The roll-up ran: 180 ml x Rp 369.
      expect(await recipeCogs(recipeId)).toBe(66_420);
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "treats a drop to zero as extreme, because it frees every menu it is in",
    async () => {
      const admin = await seedUser("super_admin");
      const { ingredient } = await seedCostedIngredient(admin, 1_000);

      const result = await ingredientsApi.updateIngredientCore(admin, {
        id: ingredient.id,
        averageCost: 0,
      });

      if (!("needsConfirmation" in result)) throw new Error("guard did not ask");
      expect(result.verdict).toBe("extreme");
      expect(await storedCost(ingredient.id)).toBe(1_000);
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "asks on a first costing that would sell a menu below its HPP",
    async () => {
      // The production case: Air went 0 → 369/ml, so there was no previous price
      // for the ratio to compare against. The selling-price check is what sees it.
      const admin = await seedUser("super_admin");
      const { ingredient, recipeId } = await seedCostedIngredient(admin, 0);

      const result = await ingredientsApi.updateIngredientCore(admin, {
        id: ingredient.id,
        averageCost: 369,
      });

      if (!("needsConfirmation" in result)) throw new Error("guard did not ask");
      // The ratio has nothing to say about a first costing…
      expect(result.verdict).toBe("silent");
      // …but 180 ml x Rp 369 = Rp 66.420 against a Rp 15.000 menu is not a
      // judgement call.
      expect(result.breakingMenus).toBe(1);
      expect(result.biggest[0]).toMatchObject({ recipeId, sellPrice: 15_000 });
      expect(await storedCost(ingredient.id)).toBe(0);
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "first costing (0 → price) is not a ratio question and saves silently",
    async () => {
      const admin = await seedUser("super_admin");
      const ingredient = await ingredientsApi.createIngredientCore(admin, {
        code: uniq("IG-FIRST"),
        name: "Bahan Baru",
        category: "Dry",
        skuType: "RM",
        purchaseUnit: "gr",
        stockUnit: "gr",
        conversionFactor: 1,
        averageCost: 0,
      });

      const result = await ingredientsApi.updateIngredientCore(admin, {
        id: ingredient.id,
        averageCost: 50_000,
      });

      if ("needsConfirmation" in result) throw new Error("guard asked on first costing");
      expect(result.averageCost).toBe(50_000);
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
