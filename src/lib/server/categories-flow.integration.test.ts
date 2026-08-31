/* oxlint-disable anti-slop/no-console -- effects log progress; not assertions */
/**
 * Categories full-flow integration test.
 *
 * Drives the real user-parameterized cores from `categories.ts`
 * (`createCategoryCore`, `assignRecipesToCategoryCore`, `deleteCategoryCore`)
 * against the local dockerized test Postgres. Each core re-mirrors the
 * wrapper's `requireRole` guard, so wrong-role rejection is exercised.
 *
 * Lifecycle: create category → assign recipes to it (and move some out) →
 * delete (recipes reassigned to a destination, then the category row removed).
 *
 * Isolation: the cores hit the module-level `db` from `#/lib/server/db`, mocked
 * to a connection over the local test database, tables TRUNCATE-d between tests.
 *
 * Run:
 *   TEST_DATABASE_URL=postgresql://omoiyari_test:omoiyari_test@localhost:5433/omoiyari_pos_test DATABASE_URL= vp test run src/lib/server/categories-flow.integration.test.ts
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
let categoriesApi: typeof import("./categories");
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

async function insertCategory(code: string, name: string): Promise<string> {
  const [row] = await db
    .insert(schema.categories)
    .values({ code, name })
    .returning({ id: schema.categories.id });
  return row.id;
}

async function insertRecipe(categoryId: string, code: string, name: string): Promise<string> {
  const [row] = await db
    .insert(schema.recipes)
    .values({ categoryId, code, name, basePrice: 1000, status: "Active" })
    .returning({ id: schema.recipes.id });
  return row.id;
}

async function recipeCategory(id: string): Promise<string | null> {
  const [row] = await db
    .select({ categoryId: schema.recipes.categoryId })
    .from(schema.recipes)
    .where(eq(schema.recipes.id, id))
    .limit(1);
  return row?.categoryId ?? null;
}

async function categoryExists(id: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.categories.id })
    .from(schema.categories)
    .where(eq(schema.categories.id, id))
    .limit(1);
  return Boolean(row);
}

beforeAll(async () => {
  if (!hasTestDatabaseUrl) return;
  // SAFETY: guarded by hasTestDatabaseUrl; when the test DB is absent beforeAll returns early and every test is skipped, so db is never read unset.
  db = dbHolder.db as TestDb;
  categoriesApi = await import("./categories");
});

describe("Categories — full lifecycle via the real server-function cores", () => {
  it.skipIf(!hasTestDatabaseUrl)(
    "create → assign recipes (and move-out) → delete with reassignment",
    async () => {
      const superAdmin = await seedUser("super_admin");

      // 1. Create two categories
      const createdA = await categoriesApi.createCategoryCore(superAdmin, {
        code: uniq("CAT-A"),
        name: "Makanan",
      });
      const createdB = await categoriesApi.createCategoryCore(superAdmin, {
        code: uniq("CAT-B"),
        name: "Minuman",
      });
      expect(createdA.category.name).toBe("Makanan");
      expect(createdA.category.code.length).toBeGreaterThan(4);

      // 2. Seed recipes and assign them into category A
      const r1 = await insertRecipe(createdA.category.id, uniq("R-1"), "Ayam Goreng");
      const r2 = await insertRecipe(createdA.category.id, uniq("R-2"), "Nasi Putih");
      const r3 = await insertRecipe(createdB.category.id, uniq("R-3"), "Es Teh");

      const assign = await categoriesApi.assignRecipesToCategoryCore(superAdmin, {
        categoryId: createdA.category.id,
        recipeIds: [r1, r2, r3],
        removedRecipeIds: [r3],
        destinationCategoryId: createdB.category.id,
      });
      expect(assign.success).toBe(true);
      expect(await recipeCategory(r1)).toBe(createdA.category.id);
      expect(await recipeCategory(r2)).toBe(createdA.category.id);
      // r3 moved out to destination B
      expect(await recipeCategory(r3)).toBe(createdB.category.id);

      // 3. Delete category B → its recipe is reassigned to A, row removed.
      //    (B currently holds r3.)
      const del = await categoriesApi.deleteCategoryCore(superAdmin, {
        categoryId: createdB.category.id,
        destinationCategoryId: createdA.category.id,
      });
      expect(del.success).toBe(true);
      expect(await categoryExists(createdB.category.id)).toBe(false);
      expect(await recipeCategory(r3)).toBe(createdA.category.id);

      // Deleting a missing category returns { success:false } rather than throwing
      const missingDeleted = await categoriesApi.deleteCategoryCore(superAdmin, {
        categoryId: crypto.randomUUID(),
        destinationCategoryId: createdA.category.id,
      });
      expect(missingDeleted).toEqual({ success: false, error: "Kategori tidak ditemukan" });
    },
  );
});

describe("Categories — wrong-role negatives", () => {
  it.skipIf(!hasTestDatabaseUrl)(
    "create/assign/delete reject non-central roles without side effects",
    async () => {
      const branchAdmin = await seedUser("branch_admin");
      const areaManager = await seedUser("area_manager");

      const catA = await insertCategory(uniq("CAT-A"), "Makanan");
      const catB = await insertCategory(uniq("CAT-B"), "Minuman");
      const rec = await insertRecipe(catA, uniq("R-1"), "Menu");

      for (const wrong of [branchAdmin, areaManager]) {
        await expect(
          categoriesApi.createCategoryCore(wrong, { code: uniq("CAT-X"), name: "X" }),
        ).rejects.toThrow("Forbidden: insufficient role");
        await expect(
          categoriesApi.assignRecipesToCategoryCore(wrong, {
            categoryId: catA,
            recipeIds: [rec],
            removedRecipeIds: [],
            destinationCategoryId: catB,
          }),
        ).rejects.toThrow("Forbidden: insufficient role");
        await expect(
          categoriesApi.deleteCategoryCore(wrong, {
            categoryId: catA,
            destinationCategoryId: catB,
          }),
        ).rejects.toThrow("Forbidden: insufficient role");
      }

      // No side effects — recipe stayed in A, both categories still exist
      expect(await recipeCategory(rec)).toBe(catA);
      expect(await categoryExists(catA)).toBe(true);
      expect(await categoryExists(catB)).toBe(true);
    },
  );
});
