/* oxlint-disable anti-slop/no-console -- effects log progress; not assertions */
/**
 * Modifier groups full-flow integration test.
 *
 * Drives the real user-parameterized cores from `modifier-groups.ts`
 * (`createModifierGroupCore`, `updateModifierGroupCore`,
 * `linkRecipesToModifierGroupCore`, `reorderModifiersCore`,
 * `reorderModifierGroupsCore`, `deleteModifierGroupCore`) against the local
 * dockerized test Postgres. Each core re-mirrors the wrapper's
 * (`super_admin | admin_pusat`) guard, so wrong-role rejection is exercised.
 *
 * Lifecycle: create group with modifiers → link recipes → update (rename) →
 * reorder modifiers/groups → delete.
 *
 * Isolation: cores hit `#/lib/server/db` (mocked), tables TRUNCATE-d between
 * tests.
 *
 * Run:
 *   TEST_DATABASE_URL=postgresql://omoiyari_test:omoiyari_test@localhost:5433/omoiyari_pos_test DATABASE_URL= vp test run src/lib/server/modifier-groups-flow.integration.test.ts
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
let mgApi: typeof import("./modifier-groups");
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

async function insertRecipe(categoryId: string): Promise<string> {
  const [row] = await db
    .insert(schema.recipes)
    .values({ categoryId, code: uniq("R"), name: "Resep", basePrice: 1000, status: "Active" })
    .returning({ id: schema.recipes.id });
  return row.id;
}

async function linkedRecipes(groupId: string): Promise<string[]> {
  const rows = await db
    .select({ recipeId: schema.recipeModifierGroups.recipeId })
    .from(schema.recipeModifierGroups)
    .where(eq(schema.recipeModifierGroups.modifierGroupId, groupId));
  return rows.map((r) => r.recipeId);
}

async function groupExists(id: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.modifierGroups.id })
    .from(schema.modifierGroups)
    .where(eq(schema.modifierGroups.id, id))
    .limit(1);
  return Boolean(row);
}

beforeAll(async () => {
  if (!hasTestDatabaseUrl) return;
  // SAFETY: guarded by hasTestDatabaseUrl; when the test DB is absent beforeAll returns early and every test is skipped, so db is never read unset.
  db = dbHolder.db as TestDb;
  mgApi = await import("./modifier-groups");
});

describe("Modifier groups — full lifecycle via the real server-function cores", () => {
  it.skipIf(!hasTestDatabaseUrl)(
    "create with modifiers → link recipes → update → reorder → delete",
    async () => {
      const superAdmin = await seedUser("super_admin");
      const catId = await insertCategory();
      const r1 = await insertRecipe(catId);
      const r2 = await insertRecipe(catId);

      // 1. Create — two text modifiers (ADR-0014 kind = text → no links)
      const created = await mgApi.createModifierGroupCore(superAdmin, {
        code: uniq("GRP"),
        name: "Level Pedas",
        minSelection: 1,
        maxSelection: 1,
        modifiers: [
          { name: "Normal", price: 0, kind: "text" },
          { name: "Pedas", price: 2000, kind: "text" },
        ],
      });
      expect(created.name).toBe("Level Pedas");
      expect(created.minSelection).toBe(1);

      const mods = await db
        .select()
        .from(schema.modifiers)
        .where(eq(schema.modifiers.modifierGroupId, created.id))
        .orderBy(schema.modifiers.sortOrder);
      expect(mods).toHaveLength(2);
      expect(mods[0].name).toBe("Normal");
      expect(mods[1].name).toBe("Pedas");

      // 2. Link recipes to the group (replace semantics)
      const link = await mgApi.linkRecipesToModifierGroupCore(superAdmin, {
        modifierGroupId: created.id,
        recipeIds: [r1, r2],
      });
      expect(link.success).toBe(true);
      expect(await linkedRecipes(created.id)).toEqual([r1, r2]);

      // Replace with just r1
      await mgApi.linkRecipesToModifierGroupCore(superAdmin, {
        modifierGroupId: created.id,
        recipeIds: [r1],
      });
      expect(await linkedRecipes(created.id)).toEqual([r1]);

      // 3. Update — rename only (partial update keeps modifiers intact)
      const upd = await mgApi.updateModifierGroupCore(superAdmin, {
        id: created.id,
        name: "Level Pedas (Baru)",
      });
      expect(upd.success).toBe(true);

      // 4. Reorder modifiers — swap the order so the second becomes first
      await mgApi.reorderModifiersCore(superAdmin, {
        modifierGroupId: created.id,
        modifierIds: [mods[1].id, mods[0].id],
      });
      const [nowFirst, nowSecond] = await db
        .select({ id: schema.modifiers.id, sortOrder: schema.modifiers.sortOrder })
        .from(schema.modifiers)
        .where(eq(schema.modifiers.modifierGroupId, created.id))
        .orderBy(schema.modifiers.sortOrder);
      expect(nowFirst.id).toBe(mods[1].id);
      expect(nowFirst.sortOrder).toBe(0);
      expect(nowSecond.id).toBe(mods[0].id);
      expect(nowSecond.sortOrder).toBe(1);

      // 5. Reorder groups — put g2 first (index 0), created second (index 1)
      const g2 = await mgApi.createModifierGroupCore(superAdmin, {
        code: uniq("GRP2"),
        name: "Topping",
        minSelection: 0,
        maxSelection: 3,
        modifiers: [{ name: "Keju", price: 5000, kind: "text" }],
      });
      await mgApi.reorderModifierGroupsCore(superAdmin, {
        modifierGroupIds: [g2.id, created.id],
      });
      const [g2After, createdAfter] = await Promise.all([
        db
          .select({ sortOrder: schema.modifierGroups.sortOrder })
          .from(schema.modifierGroups)
          .where(eq(schema.modifierGroups.id, g2.id))
          .limit(1),
        db
          .select({ sortOrder: schema.modifierGroups.sortOrder })
          .from(schema.modifierGroups)
          .where(eq(schema.modifierGroups.id, created.id))
          .limit(1),
      ]);
      expect(g2After[0].sortOrder).toBe(0);
      expect(createdAfter[0].sortOrder).toBe(1);
    },
  );
});

describe("Modifier groups — wrong-role, not-found, and ADR-0014 negatives", () => {
  it.skipIf(!hasTestDatabaseUrl)(
    "reject non-central roles and bad modifier links; delete refuses unknown/missing",
    async () => {
      const superAdmin = await seedUser("super_admin");
      const branchAdmin = await seedUser("branch_admin");
      const catId = await insertCategory();
      const r1 = await insertRecipe(catId);

      const createInput = {
        code: uniq("GRP-N"),
        name: "Neg",
        minSelection: 0,
        maxSelection: 1,
        modifiers: [{ name: "None", price: 0, kind: "text" }],
      } satisfies {
        code: string;
        name: string;
        minSelection: number;
        maxSelection: number;
        modifiers: { name: string; price: number; kind: "text" }[];
      };

      for (const wrong of [branchAdmin]) {
        await expect(mgApi.createModifierGroupCore(wrong, createInput)).rejects.toThrow(
          "Forbidden: insufficient role",
        );
      }

      const created = await mgApi.createModifierGroupCore(superAdmin, createInput);

      await expect(
        mgApi.updateModifierGroupCore(branchAdmin, { id: created.id, name: "x" }),
      ).rejects.toThrow("Forbidden: insufficient role");
      await expect(
        mgApi.linkRecipesToModifierGroupCore(branchAdmin, {
          modifierGroupId: created.id,
          recipeIds: [r1],
        }),
      ).rejects.toThrow("Forbidden: insufficient role");
      await expect(mgApi.deleteModifierGroupCore(branchAdmin, { id: created.id })).rejects.toThrow(
        "Forbidden: insufficient role",
      );

      // ADR-0014: a `text` kind must not carry a recipe/ingredient link
      await expect(
        mgApi.createModifierGroupCore(superAdmin, {
          code: uniq("GRP-BAD"),
          name: "Bad",
          minSelection: 0,
          maxSelection: 1,
          modifiers: [{ name: "X", price: 0, kind: "text", recipeId: r1, recipeQty: 1 }],
        }),
      ).rejects.toThrow("tidak cocok dengan isiannya");

      // Not found
      const missing = crypto.randomUUID();
      await expect(
        mgApi.updateModifierGroupCore(superAdmin, { id: missing, name: "x" }),
      ).rejects.toThrow("Modifier group not found");
      await expect(mgApi.deleteModifierGroupCore(superAdmin, { id: missing })).rejects.toThrow(
        "Modifier group not found",
      );

      // Delete works
      const del = await mgApi.deleteModifierGroupCore(superAdmin, { id: created.id });
      expect(del.success).toBe(true);
      expect(await groupExists(created.id)).toBe(false);
    },
  );
});
