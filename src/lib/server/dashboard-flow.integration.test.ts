/**
 * Dashboard aggregates and date-range filtering — integration coverage for the
 * real cores (`getDashboardOverviewCore`, `getDashboardDetailsCore`).
 *
 * Verifies the things the old client-side roll-up got wrong: voids/deleted rows
 * are not sales, the range is applied in Jakarta days, brand revenue comes from
 * order items, and branch scope reaches area managers.
 *
 * Run:
 *   TEST_DATABASE_URL=postgresql://omoiyari_test:omoiyari_test@localhost:5433/omoiyari_pos_test DATABASE_URL= vp test run src/lib/server/dashboard-flow.integration.test.ts
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
let dashboard: typeof import("./dashboard");
let seedCounter = 0;

function uniq(prefix: string): string {
  return `${prefix}-${seedCounter++}-${crypto.randomUUID().slice(0, 8)}`;
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
    email: `its-${id}@dashboard.test`,
    role,
    branchId,
  });
  for (const branch of assignedBranches ?? []) {
    await db.insert(schema.areaManagerBranches).values({ userId: id, branchId: branch });
  }
  return {
    id,
    email: `its-${id}@dashboard.test`,
    name: `ITS ${role}`,
    role,
    branchId,
    assignedBranches,
    status: "Active",
  };
}

async function seedBranch(name = `Cabang ${uniq("N")}`): Promise<string> {
  const [row] = await db
    .insert(schema.branches)
    .values({ code: uniq("BR"), name, location: "Jakarta", type: "Outlet" })
    .returning({ id: schema.branches.id });
  return row.id;
}

async function seedRecipe(): Promise<string> {
  const [category] = await db
    .insert(schema.categories)
    .values({ code: uniq("CAT"), name: "Menu" })
    .returning({ id: schema.categories.id });
  const [recipe] = await db
    .insert(schema.recipes)
    .values({ categoryId: category.id, code: uniq("R"), name: "Nasi Goreng", basePrice: 30000 })
    .returning({ id: schema.recipes.id });
  return recipe.id;
}

async function seedBrand(): Promise<string> {
  const [brand] = await db
    .insert(schema.brands)
    .values({ code: uniq("B"), name: `Brand ${uniq("N")}` })
    .returning({ id: schema.brands.id });
  return brand.id;
}

async function seedIngredient(): Promise<string> {
  const [ingredient] = await db
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
      rop: 10,
    })
    .returning({ id: schema.ingredients.id });
  return ingredient.id;
}

async function seedOrder(input: {
  branchId: string;
  createdAt: Date;
  totalAmount: number;
  channel?: "Dine-in" | "ShopeeFood";
  status?: "New" | "Completed" | "Void";
  deletedAt?: Date;
  items?: { recipeId: string; brandId?: string; quantity: number; price: number }[];
}): Promise<string> {
  const [order] = await db
    .insert(schema.orders)
    .values({
      branchId: input.branchId,
      channel: input.channel ?? "Dine-in",
      subtotal: input.totalAmount,
      totalAmount: input.totalAmount,
      status: input.status ?? "New",
      createdAt: input.createdAt,
      voidReason: input.status === "Void" ? "test" : undefined,
      deletedAt: input.deletedAt,
    })
    .returning({ id: schema.orders.id });

  for (const item of input.items ?? []) {
    await db.insert(schema.orderItems).values({
      orderId: order.id,
      recipeId: item.recipeId,
      brandId: item.brandId,
      quantity: item.quantity,
      price: item.price,
    });
  }
  return order.id;
}

const NOW = new Date("2026-08-30T05:00:00.000Z"); // 30 Aug 2026, 12:00 WIB

beforeAll(async () => {
  if (!hasTestDatabaseUrl) return;
  // SAFETY: guarded by hasTestDatabaseUrl; when the test DB is absent beforeAll returns early and every test is skipped, so db is never read unset.
  db = dbHolder.db as TestDb;
  dashboard = await import("./dashboard");
});

describe("Dashboard aggregates via the real cores", () => {
  it.skipIf(!hasTestDatabaseUrl)(
    "counts only live in-range sales and reads brand revenue from order items",
    async () => {
      const branch = await seedBranch("Cabang A");
      const admin = await seedUser("super_admin");
      const recipeId = await seedRecipe();
      const brandId = await seedBrand();
      const ingredientId = await seedIngredient();
      await db.insert(schema.inventory).values({ branchId: branch, ingredientId, quantity: 5 });

      // In range, live, completed.
      await seedOrder({
        branchId: branch,
        createdAt: new Date("2026-08-28T03:00:00.000Z"), // 10:00 WIB
        totalAmount: 100000,
        status: "Completed",
        items: [{ recipeId, brandId, quantity: 2, price: 30000 }],
      });
      // In range, live, still New.
      await seedOrder({
        branchId: branch,
        createdAt: new Date("2026-08-29T03:00:00.000Z"),
        totalAmount: 50000,
        channel: "ShopeeFood",
        items: [{ recipeId, brandId, quantity: 1, price: 20000 }],
      });
      // In range but void — visible in the void counter, never in sales/charts.
      await seedOrder({
        branchId: branch,
        createdAt: new Date("2026-08-28T05:00:00.000Z"),
        totalAmount: 900000,
        status: "Void",
      });
      // In range but soft-deleted.
      await seedOrder({
        branchId: branch,
        createdAt: new Date("2026-08-28T06:00:00.000Z"),
        totalAmount: 800000,
        deletedAt: new Date(),
      });
      // Outside the range.
      await seedOrder({
        branchId: branch,
        createdAt: new Date("2026-08-20T03:00:00.000Z"),
        totalAmount: 700000,
      });

      const overview = await dashboard.getDashboardOverviewCore(
        admin,
        { from: "2026-08-28", to: "2026-08-29" },
        NOW,
      );

      expect(overview.stats).toEqual({
        totalSales: 150000,
        completedCount: 1,
        voidCount: 1,
        orderCount: 2,
        manualRevenue: 0,
      });
      expect(overview.salesTrend.map((point) => point.bucket)).toEqual([
        "2026-08-28",
        "2026-08-29",
      ]);
      expect(overview.salesTrend.map((point) => point.revenue)).toEqual([100000, 50000]);
      expect(overview.channelData).toEqual(
        expect.arrayContaining([
          { channel: "Dine-in", count: 1, revenue: 100000 },
          { channel: "ShopeeFood", count: 1, revenue: 50000 },
        ]),
      );
      expect(overview.brandSales).toEqual([
        { brandId, name: expect.any(String), revenue: 80000, count: 2 },
      ]);
      expect(overview.branchSales).toEqual([
        { branchId: branch, name: "Cabang A", revenue: 150000, count: 2 },
      ]);
      expect(overview.lowStock).toEqual([
        {
          ingredientId,
          ingredientName: expect.any(String),
          quantity: 5,
          rop: 10,
          stockUnit: "kg",
        },
      ]);
      expect(overview.branches).toEqual([{ id: branch, name: "Cabang A" }]);
    },
  );

  it.skipIf(!hasTestDatabaseUrl)("applies the same range to the detail rows", async () => {
    const branch = await seedBranch();
    const admin = await seedUser("super_admin");
    const recipeId = await seedRecipe();

    const inRange = await seedOrder({
      branchId: branch,
      createdAt: new Date("2026-08-29T03:00:00.000Z"),
      totalAmount: 50000,
      items: [{ recipeId, quantity: 1, price: 50000 }],
    });
    await seedOrder({
      branchId: branch,
      createdAt: new Date("2026-08-20T03:00:00.000Z"),
      totalAmount: 40000,
      items: [{ recipeId, quantity: 1, price: 40000 }],
    });

    const details = await dashboard.getDashboardDetailsCore(
      admin,
      { from: "2026-08-29", to: "2026-08-29" },
      NOW,
    );

    expect(details.orders.map((order) => order.id)).toEqual([inRange]);
    expect(details.orderItems).toHaveLength(1);
    expect(details.orderItems[0].orderId).toBe(inRange);
    expect(details.recipes).toHaveLength(1);
    expect(details.production).toEqual([]);
    expect(details.wasteEntries).toEqual([]);
  });

  it.skipIf(!hasTestDatabaseUrl)("scopes an area manager to assigned branches", async () => {
    const branchA = await seedBranch("Cabang A");
    const branchB = await seedBranch("Cabang B");
    const manager = await seedUser("area_manager", undefined, [branchA]);

    await seedOrder({
      branchId: branchA,
      createdAt: new Date("2026-08-28T03:00:00.000Z"),
      totalAmount: 100000,
    });
    await seedOrder({
      branchId: branchB,
      createdAt: new Date("2026-08-28T04:00:00.000Z"),
      totalAmount: 200000,
    });

    const overview = await dashboard.getDashboardOverviewCore(
      manager,
      { from: "2026-08-28", to: "2026-08-29" },
      NOW,
    );

    expect(overview.stats.totalSales).toBe(100000);
    expect(overview.branchSales.map((row) => row.branchId)).toEqual([branchA]);
    expect(overview.branches.map((row) => row.id)).toEqual([branchA]);
  });
});
