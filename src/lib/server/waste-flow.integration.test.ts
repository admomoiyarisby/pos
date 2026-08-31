/* oxlint-disable anti-slop/no-console -- effects log progress; not assertions */
/**
 * Waste (Pembuangan) full-flow integration test.
 *
 * Drives the real user-parameterized cores from `waste.ts`
 * (`createWasteEntryCore`, `createBomWasteEntryCore`,
 * `addInvestigationNoteCore`, `updateWasteEntryCore`, `cancelWasteEntryCore`)
 * against the local dockerized test Postgres. Each core is the exact business
 * logic the `createServerFn` transport endpoint runs — the only thing bypassed
 * is `requireAuth()` (HTTP session), replaced by an explicit `user` argument
 * per call, so role and branch guards are fully exercised. All cores throw on
 * failure.
 *
 * Lifecycle: create (stock OUT + valuation + optional operational expense) →
 * investigate (super_admin/area_manager note) → cancel (status flip, expense
 * cleanup, stock reversal).
 *
 * Isolation: the cores hit the module-level `db` from `#/lib/server/db`, so
 * that module is mocked to return a drizzle instance over a connection to the
 * local test database, and shared tables are TRUNCATE-d between tests. No
 * outer transaction is held open, so the cores' own `db.transaction()` calls
 * behave normally and a failing inner step only rolls back its own work.
 *
 * Run:  TEST_DATABASE_URL=postgresql://omoiyari_test:omoiyari_test@localhost:5433/omoiyari_pos_test DATABASE_URL= vp test run src/lib/server/waste-flow.integration.test.ts
 */

import { beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { and, eq } from "drizzle-orm";
import * as schema from "#/db/schema";
import { getTestDatabaseUrl } from "./test-database";
import type { TestDb } from "./integration-test-harness";
import { setupFlowHarness } from "./integration-test-harness";
import type { AppUser, UserRole } from "./auth";

const testDatabaseUrl = getTestDatabaseUrl();
const hasTestDatabaseUrl = Boolean(testDatabaseUrl);

// Route the cores' module-level `db` to a drizzle instance on the test
// database. beforeAll/beforeEach set it before any core call.
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

// The cores take an explicit user argument, so `requireAuth()` / `requireRole()`
// (and the better-auth instance they pull in) is never needed in this test.
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
let waste: typeof import("./waste");
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

async function seedIngredient(code: string, averageCost = 1000): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(schema.ingredients).values({
    id,
    code,
    name: `Ingredient ${code}`,
    category: "Fresh",
    skuType: "RM",
    purchaseUnit: "pcs",
    stockUnit: "pcs",
    conversionFactor: 1,
    averageCost,
  });
  return id;
}

async function seedCategory(code: string): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(schema.categories).values({ id, code, name: `Cat ${code}` });
  return id;
}

async function seedRecipe(code: string, categoryId: string, totalCogs = 8000): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(schema.recipes).values({
    id,
    code,
    name: `Recipe ${code}`,
    categoryId,
    basePrice: 15000,
    totalCogs,
  });
  return id;
}

/** Seed users with a real `users` row (FKs require it) + branch links. */
async function seedUser(
  role: UserRole,
  branchId?: string,
  assignedBranches?: string[],
): Promise<AppUser> {
  const id = crypto.randomUUID();
  await db.insert(schema.users).values({
    id,
    name: `ITS ${role}`,
    email: `its-${id}@pos.test`,
    role,
    branchId,
  });
  if (role === "area_manager" && assignedBranches?.length) {
    for (const b of assignedBranches) {
      await db.insert(schema.areaManagerBranches).values({ userId: id, branchId: b });
    }
  }
  return {
    id,
    email: `its-${id}@pos.test`,
    name: `ITS ${role}`,
    role,
    branchId,
    assignedBranches,
    status: "Active",
  };
}

async function seedInventory(branchId: string, ingredientId: string, quantity: number) {
  await db.insert(schema.inventory).values({ branchId, ingredientId, quantity });
}

async function getStock(branchId: string, ingredientId: string): Promise<number> {
  const [row] = await db
    .select({ quantity: schema.inventory.quantity })
    .from(schema.inventory)
    .where(
      and(eq(schema.inventory.branchId, branchId), eq(schema.inventory.ingredientId, ingredientId)),
    )
    .limit(1);
  return row?.quantity ?? 0;
}

async function getRecipeStock(branchId: string, recipeId: string): Promise<number> {
  const [row] = await db
    .select({ quantity: schema.recipeInventory.quantity })
    .from(schema.recipeInventory)
    .where(
      and(
        eq(schema.recipeInventory.branchId, branchId),
        eq(schema.recipeInventory.recipeId, recipeId),
      ),
    )
    .limit(1);
  return row?.quantity ?? 0;
}

async function ledgerRows(reference: string) {
  return db
    .select({
      type: schema.stockLedger.type,
      quantity: schema.stockLedger.quantity,
      balance: schema.stockLedger.balance,
      notes: schema.stockLedger.notes,
      recipeId: schema.stockLedger.recipeId,
      ingredientId: schema.stockLedger.ingredientId,
    })
    .from(schema.stockLedger)
    .where(eq(schema.stockLedger.reference, reference));
}

async function wasteStatus(id: string): Promise<{ status: string; cancelReason: string | null }> {
  const [row] = await db
    .select({ status: schema.wasteEntries.status, cancelReason: schema.wasteEntries.cancelReason })
    .from(schema.wasteEntries)
    .where(eq(schema.wasteEntries.id, id))
    .limit(1);
  if (!row) throw new Error(`waste entry ${id} not found`);
  return row;
}

beforeAll(async () => {
  if (!hasTestDatabaseUrl) return;
  // SAFETY: guarded by hasTestDatabaseUrl; when the test DB is absent beforeAll returns early and every test is skipped, so db is never read unset.
  db = dbHolder.db as TestDb;
  waste = await import("./waste");
});

describe("Waste — full lifecycle via the real server-function cores", () => {
  it.skipIf(!hasTestDatabaseUrl)(
    "happy path: ingredient waste → investigate → cancel (stock restored, OE cleaned up)",
    async () => {
      const branch = await seedBranch(uniq("WS-A"));
      const ingredient = await seedIngredient(uniq("WS-AING"));
      await seedInventory(branch, ingredient, 10);
      // Branch admin sees only branch-linked ingredients
      await db
        .insert(schema.ingredientBranches)
        .values({ ingredientId: ingredient, branchId: branch });

      const ba = await seedUser("branch_admin", branch);
      const am = await seedUser("area_manager", undefined, [branch]);

      // 1. Create — valuation = qty × averageCost, stock OUT, ledger row
      const entry = await waste.createWasteEntryCore(ba, {
        branchId: branch,
        ingredientId: ingredient,
        quantity: 4,
        category: "Spoiled",
        notes: "busuk",
      });
      expect(entry.status).toBe("Active");
      expect(entry.submittedBy).toBe(ba.id);
      expect(entry.valuation).toBe(4000); // 4 × 1000

      expect(await getStock(branch, ingredient)).toBe(6);
      const ledger = await ledgerRows(entry.id);
      expect(ledger).toHaveLength(1);
      expect(ledger[0]).toEqual(
        expect.objectContaining({
          ingredientId: ingredient,
          type: "OUT",
          quantity: 4,
          balance: 6,
          notes: "Waste: Spoiled - busuk",
        }),
      );

      // 2. Investigate — area manager adds the note
      const investigated = await waste.addInvestigationNoteCore(am, {
        wasteEntryId: entry.id,
        investigationNote: "stok dingin bermasalah",
      });
      expect(investigated.investigationNote).toBe("stok dingin bermasalah");

      // 3. Cancel — status flip, stock restored, reverse ledger row
      const cancelled = await waste.cancelWasteEntryCore(am, {
        wasteEntryId: entry.id,
        reason: "salah input",
      });
      expect(cancelled.status).toBe("Cancelled");
      expect(cancelled.cancelledBy).toBe(am.id);

      const after = await wasteStatus(entry.id);
      expect(after.status).toBe("Cancelled");
      expect(after.cancelReason).toBe("salah input");

      expect(await getStock(branch, ingredient)).toBe(10);
      const reversed = await ledgerRows(entry.id);
      expect(reversed).toHaveLength(2);
      expect(reversed).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ingredientId: ingredient,
            type: "IN",
            quantity: 4,
            balance: 10,
            notes: `Waste dibatalkan ${entry.id.slice(0, 8)}`,
          }),
        ]),
      );
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "Biaya Operasional waste writes an operational expense that cancel removes",
    async () => {
      const branch = await seedBranch(uniq("WS-OE"));
      const ingredient = await seedIngredient(uniq("WS-OEING"), 2000);

      const ba = await seedUser("branch_admin", branch);
      const superAdmin = await seedUser("super_admin");

      const entry = await waste.createWasteEntryCore(ba, {
        branchId: branch,
        ingredientId: ingredient,
        quantity: 3,
        category: "Biaya Operasional",
      });
      expect(entry.valuation).toBe(6000); // 3 × 2000

      const [oe] = await db
        .select()
        .from(schema.operationalExpenses)
        .where(eq(schema.operationalExpenses.wasteEntryId, entry.id));
      expect(oe).toBeTruthy();
      expect(oe.amount).toBe(6000);
      expect(oe.submittedBy).toBe(ba.id);

      // Cancelling removes the operational expense and restores stock
      await waste.cancelWasteEntryCore(superAdmin, {
        wasteEntryId: entry.id,
        reason: "salah catat",
      });
      const [oeAfter] = await db
        .select()
        .from(schema.operationalExpenses)
        .where(eq(schema.operationalExpenses.wasteEntryId, entry.id));
      expect(oeAfter).toBeUndefined();
      expect(await getStock(branch, ingredient)).toBe(0);
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "recipe waste deducts the porsi shelf (recipeInventory) and BOM waste deducts ingredients",
    async () => {
      const branch = await seedBranch(uniq("WS-R"));
      const category = await seedCategory(uniq("WS-CAT"));
      const recipe = await seedRecipe(uniq("WS-REC"), category, 8000);
      const ingredient = await seedIngredient(uniq("WS-RING"));
      await db.insert(schema.recipeBranches).values({ recipeId: recipe, branchId: branch });
      await db
        .insert(schema.ingredientBranches)
        .values({ ingredientId: ingredient, branchId: branch });
      await seedInventory(branch, ingredient, 10);

      const ba = await seedUser("branch_admin", branch);

      // Porsi-shelf waste: valuation = qty × totalCogs
      const entry = await waste.createWasteEntryCore(ba, {
        branchId: branch,
        recipeId: recipe,
        quantity: 3,
        category: "Beban Makan",
      });
      expect(entry.valuation).toBe(24000); // 3 × 8000
      expect(await getRecipeStock(branch, recipe)).toBe(-3); // upsert from 0
      const recipeLedger = await ledgerRows(entry.id);
      expect(recipeLedger[0].recipeId).toBe(recipe);

      // BOM waste: one entry per line, ingredient inventory deducted
      const entries = await waste.createBomWasteEntryCore(ba, {
        branchId: branch,
        recipeId: recipe,
        lines: [{ ingredientId: ingredient, quantity: 2 }],
        category: "Beban Makan",
      });
      expect(entries).toHaveLength(1);
      expect(entries[0].ingredientId).toBe(ingredient);
      expect(entries[0].valuation).toBe(2000); // 2 × 1000
      expect(entries[0].notes).toContain("Waste BOM");
      expect(await getStock(branch, ingredient)).toBe(8);
    },
  );
});

describe("Waste — wrong-role and wrong-branch actors are rejected", () => {
  it.skipIf(!hasTestDatabaseUrl)(
    "create rejects other-branch admins, branch-invisible ingredients, and ambiguous input",
    async () => {
      const branch = await seedBranch(uniq("WS-NC"));
      const otherBranch = await seedBranch(uniq("WS-NCX"));
      const ingredient = await seedIngredient(uniq("WS-NCING"));
      // Linked only to OTHER branch → invisible to this branch's admin
      await db
        .insert(schema.ingredientBranches)
        .values({ ingredientId: ingredient, branchId: otherBranch });

      const ba = await seedUser("branch_admin", branch);
      const otherBa = await seedUser("branch_admin", otherBranch);

      // Other-branch admin is refused outright
      await expect(
        waste.createWasteEntryCore(otherBa, {
          branchId: branch,
          ingredientId: ingredient,
          quantity: 1,
          category: "Spoiled",
        }),
      ).rejects.toThrow("Unauthorized branch");

      // Own-branch admin but ingredient not linked to the branch → forbidden
      await expect(
        waste.createWasteEntryCore(ba, {
          branchId: branch,
          ingredientId: ingredient,
          quantity: 1,
          category: "Spoiled",
        }),
      ).rejects.toThrow("Forbidden: ingredient is not available to your branch");

      // Exactly one of ingredientId/recipeId must be set (zod validator)
      await expect(
        waste.createWasteEntryCore(ba, {
          branchId: branch,
          quantity: 1,
          category: "Spoiled",
        }),
      ).rejects.toThrow("Exactly one of ingredientId or recipeId must be set");
      await expect(
        waste.createWasteEntryCore(ba, {
          branchId: branch,
          ingredientId: ingredient,
          recipeId: crypto.randomUUID(),
          quantity: 1,
          category: "Spoiled",
        }),
      ).rejects.toThrow("Exactly one of ingredientId or recipeId must be set");
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "investigate/update/cancel reject wrong roles and cancelled entries without side effects",
    async () => {
      const branch = await seedBranch(uniq("WS-NA"));
      const otherBranch = await seedBranch(uniq("WS-NAX"));
      const ingredient = await seedIngredient(uniq("WS-NAING"));
      await db
        .insert(schema.ingredientBranches)
        .values({ ingredientId: ingredient, branchId: branch });
      await seedInventory(branch, ingredient, 10);

      const ba = await seedUser("branch_admin", branch);
      const otherBa = await seedUser("branch_admin", otherBranch);
      const assignedAm = await seedUser("area_manager", undefined, [branch]);
      const unassignedAm = await seedUser("area_manager", undefined, [otherBranch]);

      const entry = await waste.createWasteEntryCore(ba, {
        branchId: branch,
        ingredientId: ingredient,
        quantity: 4,
        category: "Spoiled",
      });

      // Investigate: only super_admin / area_manager
      await expect(
        waste.addInvestigationNoteCore(ba, { wasteEntryId: entry.id, investigationNote: "x" }),
      ).rejects.toThrow(
        "Unauthorized: hanya super_admin dan area_manager yang dapat menambahkan catatan investigasi",
      );

      // Update: branch admins may only edit their own entries
      await expect(
        waste.updateWasteEntryCore(otherBa, { wasteEntryId: entry.id, notes: "x" }),
      ).rejects.toThrow("Unauthorized: hanya dapat mengedit waste entry sendiri");
      // Empty update refused
      await expect(waste.updateWasteEntryCore(ba, { wasteEntryId: entry.id })).rejects.toThrow(
        "Tidak ada perubahan",
      );
      // branch_admin cannot sneak an investigationNote through update
      const sneaky = await waste.updateWasteEntryCore(ba, {
        wasteEntryId: entry.id,
        notes: "ok",
        investigationNote: "sneaky",
      });
      expect(sneaky.notes).toBe("ok");
      expect(sneaky.investigationNote).toBeNull();

      // Cancel: branch_admin refused; unassigned AM refused
      await expect(
        waste.cancelWasteEntryCore(ba, { wasteEntryId: entry.id, reason: "x" }),
      ).rejects.toThrow(
        "Unauthorized: hanya super_admin dan area_manager yang dapat membatalkan waste entry",
      );
      await expect(
        waste.cancelWasteEntryCore(unassignedAm, { wasteEntryId: entry.id, reason: "x" }),
      ).rejects.toThrow(
        "Unauthorized: Area Manager hanya dapat membatalkan untuk cabang yang ditugaskan",
      );
      // Empty reason refused
      await expect(
        waste.cancelWasteEntryCore(assignedAm, { wasteEntryId: entry.id, reason: " " }),
      ).rejects.toThrow("Alasan pembatalan wajib diisi");

      // No side effects from the failed attempts
      const [stillActive] = await db
        .select()
        .from(schema.wasteEntries)
        .where(eq(schema.wasteEntries.id, entry.id));
      expect(stillActive.status).toBe("Active");
      expect(stillActive.investigationNote).toBeNull();
      expect(await getStock(branch, ingredient)).toBe(6);

      // A real cancel succeeds; then nothing can touch the cancelled entry
      await waste.cancelWasteEntryCore(assignedAm, {
        wasteEntryId: entry.id,
        reason: "salah input",
      });
      await expect(
        waste.cancelWasteEntryCore(assignedAm, { wasteEntryId: entry.id, reason: "lagi" }),
      ).rejects.toThrow("Waste entry sudah dibatalkan");
      await expect(
        waste.addInvestigationNoteCore(assignedAm, {
          wasteEntryId: entry.id,
          investigationNote: "late",
        }),
      ).rejects.toThrow("Waste entry sudah dibatalkan — tidak dapat diubah");
      await expect(
        waste.updateWasteEntryCore(ba, { wasteEntryId: entry.id, notes: "late" }),
      ).rejects.toThrow("Waste entry sudah dibatalkan — tidak dapat diubah");
    },
  );
});
