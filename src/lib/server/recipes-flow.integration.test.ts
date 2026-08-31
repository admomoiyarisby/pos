/* oxlint-disable anti-slop/no-console -- effects log progress; not assertions */
/**
 * Recipes full-flow integration test.
 *
 * Drives the real user-parameterized cores from `recipes.ts`
 * (`createRecipeCore`, `updateRecipeCore`, `deactivateRecipeCore`,
 * `reactivateRecipeCore`, `deleteRecipeCore`, `assignRecipeStockCore`) against
 * the local dockerized test Postgres. Each core re-mirrors the wrapper's role
 * guard (`super_admin | admin_pusat`, except delete which is `super_admin`),
 * so wrong-role rejection is exercised.
 *
 * Lifecycle: create (with BOM + brands + branches) → update (BOM swap) →
 * deactivate → reactivate → assign finished-good stock (ingredient OUT + recipe
 * IN in Kartu Stok) → delete (with the active-bundle guard).
 *
 * Isolation: cores hit `#/lib/server/db` (mocked), tables TRUNCATE-d between
 * tests.
 *
 * Run:
 *   TEST_DATABASE_URL=postgresql://omoiyari_test:omoiyari_test@localhost:5433/omoiyari_pos_test DATABASE_URL= vp test run src/lib/server/recipes-flow.integration.test.ts
 */

import { beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { eq, and } from "drizzle-orm";
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
let recipesApi: typeof import("./recipes");
let brandsApi: typeof import("./brands");
let ingredientsApi: typeof import("./ingredients");
let seedCounter = 0;

function uniq(prefix: string): string {
  return `${prefix}-${seedCounter++}-${crypto.randomUUID().slice(0, 8)}`;
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

async function insertCategory(): Promise<string> {
  const [row] = await db
    .insert(schema.categories)
    .values({ code: uniq("CAT"), name: "Menu" })
    .returning({ id: schema.categories.id });
  return row.id;
}

async function insertCentralBranch(): Promise<string> {
  const [row] = await db
    .insert(schema.branches)
    .values({
      code: uniq("BR-C"),
      name: "Central Warehouse",
      location: "Jakarta",
      type: "Central",
    })
    .returning({ id: schema.branches.id });
  return row.id;
}

async function seedIngredient(centralId?: string): Promise<string> {
  const superAdmin = await seedUser("super_admin");
  const ing = await ingredientsApi.createIngredientCore(superAdmin, {
    code: uniq("ING"),
    name: "Bahan",
    category: "Fresh",
    skuType: "RM",
    purchaseUnit: "kg",
    stockUnit: "kg",
    conversionFactor: 1,
    averageCost: 1000,
    branchIds: centralId ? [centralId] : null,
  });
  return ing.id;
}

async function insertInventory(branchId: string, ingredientId: string, quantity: number) {
  await db.insert(schema.inventory).values({ branchId, ingredientId, quantity });
}

async function recipeStatus(id: string): Promise<string | null> {
  const [row] = await db
    .select({ status: schema.recipes.status })
    .from(schema.recipes)
    .where(eq(schema.recipes.id, id))
    .limit(1);
  return row?.status ?? null;
}

async function recipeCogs(id: string): Promise<number | null> {
  const [row] = await db
    .select({ totalCogs: schema.recipes.totalCogs })
    .from(schema.recipes)
    .where(eq(schema.recipes.id, id))
    .limit(1);
  return row?.totalCogs ?? null;
}

async function recipeBomQuantity(recipeId: string, ingredientId: string): Promise<number | null> {
  const [row] = await db
    .select({ quantity: schema.recipeIngredients.quantity })
    .from(schema.recipeIngredients)
    .where(
      and(
        eq(schema.recipeIngredients.recipeId, recipeId),
        eq(schema.recipeIngredients.ingredientId, ingredientId),
      ),
    )
    .limit(1);
  return row?.quantity ?? null;
}

async function inventoryQty(branchId: string, ingredientId: string): Promise<number | null> {
  const [row] = await db
    .select({ quantity: schema.inventory.quantity })
    .from(schema.inventory)
    .where(
      and(eq(schema.inventory.branchId, branchId), eq(schema.inventory.ingredientId, ingredientId)),
    )
    .limit(1);
  return row?.quantity ?? null;
}

async function recipeInventoryQty(recipeId: string, branchId: string): Promise<number | null> {
  const [row] = await db
    .select({ quantity: schema.recipeInventory.quantity })
    .from(schema.recipeInventory)
    .where(
      and(
        eq(schema.recipeInventory.recipeId, recipeId),
        eq(schema.recipeInventory.branchId, branchId),
      ),
    )
    .limit(1);
  return row?.quantity ?? null;
}

async function stockLedgerCount(reference: string): Promise<number> {
  const rows = await db
    .select({ id: schema.stockLedger.id })
    .from(schema.stockLedger)
    .where(eq(schema.stockLedger.reference, reference));
  return rows.length;
}

beforeAll(async () => {
  if (!hasTestDatabaseUrl) return;
  // SAFETY: guarded by hasTestDatabaseUrl; when the test DB is absent beforeAll returns early and every test is skipped, so db is never read unset.
  db = dbHolder.db as TestDb;
  recipesApi = await import("./recipes");
  brandsApi = await import("./brands");
  ingredientsApi = await import("./ingredients");
});

describe("Recipes — full lifecycle via the real server-function cores", () => {
  it.skipIf(!hasTestDatabaseUrl)(
    "create with BOM/brand/branches → update BOM → deactivate/reactivate → assign stock → delete",
    async () => {
      const superAdmin = await seedUser("super_admin");
      const catId = await insertCategory();
      const central = await insertCentralBranch();
      const brand = await brandsApi.createBrandCore(superAdmin, {
        code: uniq("BRAND"),
        name: "Partner",
      });

      const ing1 = await seedIngredient(central);
      const ing2 = await seedIngredient(central);
      // Give central enough stock for 2 units of recipe (BOM: 2×ing1, 3×ing2)
      await insertInventory(central, ing1, 100);
      await insertInventory(central, ing2, 100);

      // 1. Create — code+name, category, brand, BOM, branch-restricted
      const recipe = await recipesApi.createRecipeCore(superAdmin, {
        code: uniq("REC"),
        name: "Es Kopi Special",
        categoryId: catId,
        isSubRecipe: false,
        basePrice: 15000,
        brandIds: [brand.id],
        ingredients: [
          { ingredientId: ing1, quantity: 2 },
          { ingredientId: ing2, quantity: 3 },
        ],
        modifierGroupIds: [],
        branchIds: [central],
      });
      expect(recipe.name).toBe("Es Kopi Special");
      expect(recipe.status).toBe("Active");
      expect(await recipeStatus(recipe.id)).toBe("Active");
      // totalCogs recomputed after create (2*1000 + 3*1000)
      expect(await recipeCogs(recipe.id)).toBe(5000);
      expect(await recipeBomQuantity(recipe.id, ing1)).toBe(2);
      expect(await recipeBomQuantity(recipe.id, ing2)).toBe(3);

      // 2. Update — swap BOM to 4×ing1 (drops ing2), rename
      const upd = await recipesApi.updateRecipeCore(superAdmin, {
        id: recipe.id,
        name: "Es Kopi Special V2",
        ingredients: [{ ingredientId: ing1, quantity: 4 }],
      });
      expect(upd.success).toBe(true);
      expect(await recipeBomQuantity(recipe.id, ing1)).toBe(4);
      expect(await recipeBomQuantity(recipe.id, ing2)).toBeNull();

      // 3. Deactivate → Inactive, then reactivate → Active
      await recipesApi.deactivateRecipeCore(superAdmin, { id: recipe.id });
      expect(await recipeStatus(recipe.id)).toBe("Inactive");
      await recipesApi.reactivateRecipeCore(superAdmin, { id: recipe.id });
      expect(await recipeStatus(recipe.id)).toBe("Active");

      // 4. Assign finished-good stock: 2 units. BOM = 4×ing1 → deduct 8 from
      //    central stock (100 → 92), add 2 to recipe_inventory.
      const assign = await recipesApi.assignRecipeStockCore(superAdmin, {
        recipeId: recipe.id,
        quantity: 2,
      });
      expect(assign.success).toBe(true);
      expect(await inventoryQty(central, ing1)).toBe(92);
      expect(await recipeInventoryQty(recipe.id, central)).toBe(2);
      // Kartu Stok: 1 ingredient OUT + 1 recipe IN under the production ref
      const ledgerCount = await stockLedgerCount(assign.reference!);
      expect(ledgerCount).toBe(2);

      // 5. Delete soft-tombstones → Deleted (super_admin)
      const del = await recipesApi.deleteRecipeCore(superAdmin, { id: recipe.id });
      expect(del.success).toBe(true);
      expect(await recipeStatus(recipe.id)).toBe("Deleted");
    },
  );
});

describe("Recipes — wrong-role, guards, and not-found negatives", () => {
  it.skipIf(!hasTestDatabaseUrl)(
    "reject non-central roles, block delete-when-active-bundle, refuse missing",
    async () => {
      const superAdmin = await seedUser("super_admin");
      const adminPusat = await seedUser("admin_pusat");
      const branchAdmin = await seedUser("branch_admin");
      const catId = await insertCategory();
      const central = await insertCentralBranch();

      // SAFETY: explicit empty/null selections pin the element shapes TS cannot infer; the core's zod validator fills defaults.
      const createInput = {
        code: uniq("REC-N"),
        name: "Menu Negatif",
        categoryId: catId,
        isSubRecipe: false,
        basePrice: 1000,
        brandIds: [] as string[],
        ingredients: [] as { ingredientId: string; quantity: number }[],
        modifierGroupIds: [] as string[],
        branchIds: null as string[] | null,
      };

      // create/update require super_admin | admin_pusat; branch_admin refused
      await expect(recipesApi.createRecipeCore(branchAdmin, createInput)).rejects.toThrow(
        "Forbidden: insufficient role",
      );

      const recipe = await recipesApi.createRecipeCore(adminPusat, createInput);
      await expect(
        recipesApi.updateRecipeCore(branchAdmin, { id: recipe.id, name: "x" }),
      ).rejects.toThrow("Forbidden: insufficient role");
      await expect(recipesApi.deactivateRecipeCore(branchAdmin, { id: recipe.id })).rejects.toThrow(
        "Forbidden: insufficient role",
      );

      // delete requires super_admin only — admin_pusat refused
      await expect(recipesApi.deleteRecipeCore(adminPusat, { id: recipe.id })).rejects.toThrow(
        "Forbidden: insufficient role",
      );

      // No side effects
      expect(await recipeStatus(recipe.id)).toBe("Active");

      // Not found
      const missing = crypto.randomUUID();
      await expect(
        recipesApi.updateRecipeCore(superAdmin, { id: missing, name: "x" }),
      ).rejects.toThrow("Recipe not found");
      await expect(recipesApi.deactivateRecipeCore(superAdmin, { id: missing })).rejects.toThrow(
        "Recipe not found",
      );
      await expect(recipesApi.deleteRecipeCore(superAdmin, { id: missing })).rejects.toThrow(
        "Recipe not found",
      );

      // Active-bundle guard: a recipe that is a child of an Active parent cannot
      // be deleted.
      const parent = await recipesApi.createRecipeCore(superAdmin, {
        ...createInput,
        code: uniq("REC-P"),
        name: "Paket",
      });
      const child = await recipesApi.createRecipeCore(superAdmin, {
        ...createInput,
        code: uniq("REC-C"),
        name: "Anak",
        isSubRecipe: true,
      });
      await db
        .insert(schema.recipeChildRecipes)
        .values({ parentRecipeId: parent.id, childRecipeId: child.id, quantity: 1 });
      await expect(recipesApi.deleteRecipeCore(superAdmin, { id: child.id })).rejects.toThrow(
        "Tidak dapat menghapus resep yang digunakan dalam 1 paket aktif",
      );

      // assignRecipeStock rejects a non-central actor
      const toAssign = await recipesApi.createRecipeCore(superAdmin, {
        ...createInput,
        code: uniq("REC-A"),
        name: "Masak",
        ingredients: [],
        branchIds: [central],
      });
      await expect(
        recipesApi.assignRecipeStockCore(branchAdmin, { recipeId: toAssign.id, quantity: 1 }),
      ).rejects.toThrow("Forbidden: insufficient role");
    },
  );
});
