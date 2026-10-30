/**
 * Safety-stock recommendation — integration test for the real core.
 *
 * `getStockRecommendationCore` reads stock_ledger OUT rows from the last 3
 * complete Jakarta days (today is excluded) with the same void/cancel filters
 * as Stok Keluar, unions them with `inventory`, and applies the 5-day lead-time
 * reference. The tests drive that reading, not the arithmetic (which is unit
 * tested in `src/lib/stock-recommendation.test.ts`).
 *
 * Run:
 *   TEST_DATABASE_URL=postgresql://omoiyari_test:omoiyari_test@localhost:5433/omoiyari_pos_test DATABASE_URL= vp test run src/lib/server/stock-recommendation.integration.test.ts
 */

import { beforeAll, describe, expect, it, vi } from "vite-plus/test";
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
let recommendations: typeof import("./stock-recommendation");
let seedCounter = 0;

function uniq(prefix: string): string {
  return `${prefix}-${seedCounter++}-${crypto.randomUUID().slice(0, 8)}`;
}

/** Noon Jakarta (05:00Z) so day bucketing is unambiguous. */
function jakartaNoon(date: string): Date {
  return new Date(`${date}T05:00:00Z`);
}

async function seedBranch(type: "Central" | "Outlet" = "Outlet"): Promise<string> {
  const [row] = await db
    .insert(schema.branches)
    .values({ code: uniq("SR"), name: `Cabang ${uniq("N")}`, location: "Jakarta", type })
    .returning({ id: schema.branches.id });
  return row.id;
}

async function seedIngredient(opts: { isNasi?: boolean } = {}): Promise<string> {
  const [row] = await db
    .insert(schema.ingredients)
    .values({
      code: uniq("ING"),
      name: `Bahan ${uniq("N")}`,
      category: "Fresh",
      skuType: "RM",
      purchaseUnit: "kg",
      stockUnit: "kg",
      conversionFactor: 1,
      averageCost: 1000,
      isNasi: opts.isNasi ?? false,
    })
    .returning({ id: schema.ingredients.id });
  return row.id;
}

async function seedUser(
  role: UserRole,
  branchId?: string,
  assignedBranches?: string[],
): Promise<AppUser> {
  const id = crypto.randomUUID();
  await db.insert(schema.users).values({
    id,
    name: `ITS ${role}`,
    email: `its-${id}@stock-rec.test`,
    role,
    branchId,
  });
  for (const assigned of assignedBranches ?? []) {
    await db.insert(schema.areaManagerBranches).values({ userId: id, branchId: assigned });
  }
  return {
    id,
    email: `its-${id}@stock-rec.test`,
    name: `ITS ${role}`,
    role,
    branchId,
    assignedBranches,
    status: "Active",
  };
}

async function seedInventory(
  branchId: string,
  ingredientId: string,
  quantity: number,
): Promise<void> {
  await db.insert(schema.inventory).values({ branchId, ingredientId, quantity });
}

async function seedLedger(input: {
  branchId: string;
  ingredientId: string;
  quantity: number;
  date: string;
  reference?: string;
}): Promise<void> {
  await db.insert(schema.stockLedger).values({
    branchId: input.branchId,
    ingredientId: input.ingredientId,
    type: "OUT",
    quantity: input.quantity,
    balance: 0,
    reference: input.reference ?? uniq("LEDGER"),
    createdAt: jakartaNoon(input.date),
  });
}

async function seedOrder(branchId: string, status: "New" | "Void"): Promise<string> {
  const [row] = await db
    .insert(schema.orders)
    .values({
      branchId,
      channel: "Dine-in",
      subtotal: 0,
      totalAmount: 0,
      status,
    })
    .returning({ id: schema.orders.id });
  return row.id;
}

async function seedWaste(
  branchId: string,
  ingredientId: string,
  submittedBy: string,
  status: "Active" | "Cancelled",
): Promise<string> {
  const [row] = await db
    .insert(schema.wasteEntries)
    .values({
      branchId,
      ingredientId,
      quantity: 1,
      category: "Spoiled",
      submittedBy,
      status,
    })
    .returning({ id: schema.wasteEntries.id });
  return row.id;
}

beforeAll(async () => {
  if (!hasTestDatabaseUrl) return;
  // SAFETY: guarded by hasTestDatabaseUrl; when the test DB is absent beforeAll returns early and every test is skipped, so db is never read unset.
  db = dbHolder.db as TestDb;
  recommendations = await import("./stock-recommendation");
});

describe("Safety-stock recommendation via the real core", () => {
  it.skipIf(!hasTestDatabaseUrl)("reads only the 3 complete days before today", async () => {
    const branch = await seedBranch();
    const ingredient = await seedIngredient();
    await seedInventory(branch, ingredient, 10);
    const admin = await seedUser("branch_admin", branch);

    for (const date of ["2026-08-27", "2026-08-28", "2026-08-29"]) {
      await seedLedger({ branchId: branch, ingredientId: ingredient, quantity: 3, date });
    }
    // Today is partial, and 26 Aug is outside the window: neither counts.
    await seedLedger({
      branchId: branch,
      ingredientId: ingredient,
      quantity: 100,
      date: "2026-08-30",
    });
    await seedLedger({
      branchId: branch,
      ingredientId: ingredient,
      quantity: 100,
      date: "2026-08-26",
    });

    const [row] = await recommendations.getStockRecommendationCore(
      admin,
      {},
      jakartaNoon("2026-08-30"),
    );

    expect(row.dateFrom).toBe("2026-08-27");
    expect(row.dateTo).toBe("2026-08-29");
    expect(row.usage3d).toBe(9);
    expect(row.avgDailyUsage).toBe(3);
    expect(row.targetStock).toBe(15);
    expect(row.currentStock).toBe(10);
    expect(row.status).toBe("low");
    expect(row.recommendedOrder).toBe(5);
  });

  it.skipIf(!hasTestDatabaseUrl)(
    "ignores voided orders and cancelled waste but keeps active documents",
    async () => {
      const branch = await seedBranch();
      const ingredient = await seedIngredient();
      await seedInventory(branch, ingredient, 10);
      const admin = await seedUser("branch_admin", branch);
      const date = "2026-08-28";

      const voidedOrder = await seedOrder(branch, "Void");
      await seedLedger({
        branchId: branch,
        ingredientId: ingredient,
        quantity: 50,
        date,
        reference: voidedOrder,
      });

      const liveOrder = await seedOrder(branch, "New");
      await seedLedger({
        branchId: branch,
        ingredientId: ingredient,
        quantity: 2,
        date,
        reference: liveOrder,
      });

      const cancelledWaste = await seedWaste(branch, ingredient, admin.id, "Cancelled");
      await seedLedger({
        branchId: branch,
        ingredientId: ingredient,
        quantity: 50,
        date,
        reference: cancelledWaste,
      });

      const activeWaste = await seedWaste(branch, ingredient, admin.id, "Active");
      await seedLedger({
        branchId: branch,
        ingredientId: ingredient,
        quantity: 1,
        date,
        reference: activeWaste,
      });

      const [row] = await recommendations.getStockRecommendationCore(
        admin,
        {},
        jakartaNoon("2026-08-30"),
      );

      expect(row.usage3d).toBe(3);
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "unions usage-only and stock-only ingredients, and drops Nasi",
    async () => {
      const branch = await seedBranch();
      const usedOnly = await seedIngredient();
      const stockedOnly = await seedIngredient();
      const nasi = await seedIngredient({ isNasi: true });
      await seedInventory(branch, stockedOnly, 10);
      await seedInventory(branch, nasi, 10);
      const admin = await seedUser("branch_admin", branch);

      await seedLedger({
        branchId: branch,
        ingredientId: usedOnly,
        quantity: 3,
        date: "2026-08-28",
      });
      await seedLedger({
        branchId: branch,
        ingredientId: nasi,
        quantity: 3,
        date: "2026-08-28",
      });

      const rows = await recommendations.getStockRecommendationCore(
        admin,
        {},
        jakartaNoon("2026-08-30"),
      );
      const byIngredient = new Map(rows.map((row) => [row.ingredientId, row]));

      const used = byIngredient.get(usedOnly);
      expect(used?.currentStock).toBe(0);
      expect(used?.recommendedOrder).toBe(5);
      expect(used?.status).toBe("low");

      const stocked = byIngredient.get(stockedOnly);
      expect(stocked?.currentStock).toBe(10);
      expect(stocked?.status).toBe("no-data");
      expect(stocked?.recommendedOrder).toBe(0);

      expect(byIngredient.has(nasi)).toBe(false);
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "scopes reads by role: branch admin locked, area manager assigned, supervisor all",
    async () => {
      const branchA = await seedBranch();
      const branchB = await seedBranch();
      const ingredient = await seedIngredient();
      await seedInventory(branchA, ingredient, 10);
      await seedInventory(branchB, ingredient, 10);
      for (const branchId of [branchA, branchB]) {
        await seedLedger({
          branchId,
          ingredientId: ingredient,
          quantity: 3,
          date: "2026-08-28",
        });
      }
      const now = jakartaNoon("2026-08-30");

      const branchAdmin = await seedUser("branch_admin", branchA);
      const locked = await recommendations.getStockRecommendationCore(
        branchAdmin,
        { branchId: branchB },
        now,
      );
      expect(locked.map((row) => row.branchId)).toEqual([branchA]);

      const areaManager = await seedUser("area_manager", undefined, [branchA]);
      const assigned = await recommendations.getStockRecommendationCore(
        areaManager,
        { branchId: branchB },
        now,
      );
      expect(assigned.map((row) => row.branchId)).toEqual([branchA]);

      const superAdmin = await seedUser("super_admin");
      const all = await recommendations.getStockRecommendationCore(superAdmin, {}, now);
      expect(new Set(all.map((row) => row.branchId))).toEqual(new Set([branchA, branchB]));

      const one = await recommendations.getStockRecommendationCore(
        superAdmin,
        { branchId: branchB },
        now,
      );
      expect(one.map((row) => row.branchId)).toEqual([branchB]);
    },
  );
});
