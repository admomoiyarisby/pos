/**
 * Sales analytics aggregate — integration coverage for `getSalesAnalyticsCore`.
 *
 * Guards the status/date filters: void and soft-deleted orders must not count
 * toward the channel mix or top sales, the status scope narrows the live set
 * without ever counting voids, and "Semua waktu" (no dates) must still exclude
 * them.
 *
 * Run:
 *   TEST_DATABASE_URL=postgresql://omoiyari_test:omoiyari_test@localhost:5433/omoiyari_pos_test DATABASE_URL= vp test run src/lib/server/analytics-flow.integration.test.ts
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
let finance: typeof import("./finance");
let seedCounter = 0;

function uniq(prefix: string): string {
  return `${prefix}-${seedCounter++}-${crypto.randomUUID().slice(0, 8)}`;
}

async function seedUser(role: UserRole): Promise<AppUser> {
  const id = crypto.randomUUID();
  await db.insert(schema.users).values({
    id,
    name: `ITS ${role}`,
    email: `its-${id}@analytics.test`,
    role,
  });
  return {
    id,
    email: `its-${id}@analytics.test`,
    name: `ITS ${role}`,
    role,
    status: "Active",
  };
}

async function seedBranch(): Promise<string> {
  const [row] = await db
    .insert(schema.branches)
    .values({ code: uniq("BR"), name: "Cabang Analitik", location: "Jakarta", type: "Outlet" })
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

async function seedOrder(input: {
  branchId: string;
  createdAt: Date;
  totalAmount: number;
  status?: "New" | "Completed" | "Void";
  deletedAt?: Date;
  items?: { recipeId: string; quantity: number; price: number }[];
}): Promise<void> {
  const [order] = await db
    .insert(schema.orders)
    .values({
      branchId: input.branchId,
      channel: "Dine-in",
      subtotal: input.totalAmount,
      totalAmount: input.totalAmount,
      status: input.status ?? "Completed",
      createdAt: input.createdAt,
      voidReason: input.status === "Void" ? "test" : undefined,
      deletedAt: input.deletedAt,
    })
    .returning({ id: schema.orders.id });

  for (const item of input.items ?? []) {
    await db.insert(schema.orderItems).values({
      orderId: order.id,
      recipeId: item.recipeId,
      quantity: item.quantity,
      price: item.price,
    });
  }
}

beforeAll(async () => {
  if (!hasTestDatabaseUrl) return;
  // SAFETY: guarded by hasTestDatabaseUrl; when the test DB is absent beforeAll returns early and every test is skipped, so db is never read unset.
  db = dbHolder.db as TestDb;
  finance = await import("./finance");
});

describe("Sales analytics aggregate", () => {
  it.skipIf(!hasTestDatabaseUrl)(
    "excludes void and soft-deleted orders from the channel mix and top sales",
    async () => {
      const branch = await seedBranch();
      const admin = await seedUser("super_admin");
      const recipeId = await seedRecipe();

      // Live sale in range.
      await seedOrder({
        branchId: branch,
        createdAt: new Date("2026-08-28T03:00:00.000Z"),
        totalAmount: 100000,
        items: [{ recipeId, quantity: 2, price: 30000 }],
      });
      // Void in range: its items must not appear in Top Sales.
      await seedOrder({
        branchId: branch,
        createdAt: new Date("2026-08-28T04:00:00.000Z"),
        totalAmount: 900000,
        status: "Void",
        items: [{ recipeId, quantity: 100, price: 30000 }],
      });
      // Soft-deleted in range: also ignored.
      await seedOrder({
        branchId: branch,
        createdAt: new Date("2026-08-28T05:00:00.000Z"),
        totalAmount: 800000,
        deletedAt: new Date(),
        items: [{ recipeId, quantity: 50, price: 30000 }],
      });
      // Outside the range when both ends are sent.
      await seedOrder({
        branchId: branch,
        createdAt: new Date("2026-08-20T03:00:00.000Z"),
        totalAmount: 700000,
        items: [{ recipeId, quantity: 5, price: 30000 }],
      });

      const range = await finance.getSalesAnalyticsCore(admin, {
        dateFrom: "2026-08-28",
        dateTo: "2026-08-29",
      });

      expect(range.channelData).toEqual([{ channel: "Dine-in", total: 100000, count: 1 }]);
      expect(range.topSales).toEqual([
        { recipeId, totalQty: 2, totalRevenue: 60000, name: "Nasi Goreng" },
      ]);

      // "Semua waktu" is unbounded but still live-only.
      const allTime = await finance.getSalesAnalyticsCore(admin, {});
      expect(allTime.channelData).toEqual([{ channel: "Dine-in", total: 800000, count: 2 }]);
      expect(allTime.topSales[0]).toMatchObject({ totalQty: 7, totalRevenue: 210000 });
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "the status scope narrows the live set and void stays out of every scope",
    async () => {
      const branch = await seedBranch();
      const admin = await seedUser("super_admin");
      const recipeId = await seedRecipe();

      await seedOrder({
        branchId: branch,
        createdAt: new Date("2026-08-28T03:00:00.000Z"),
        totalAmount: 100000,
        status: "Completed",
        items: [{ recipeId, quantity: 2, price: 50000 }],
      });
      await seedOrder({
        branchId: branch,
        createdAt: new Date("2026-08-28T04:00:00.000Z"),
        totalAmount: 40000,
        status: "New",
        items: [{ recipeId, quantity: 1, price: 40000 }],
      });
      await seedOrder({
        branchId: branch,
        createdAt: new Date("2026-08-28T05:00:00.000Z"),
        totalAmount: 900000,
        status: "Void",
        items: [{ recipeId, quantity: 30, price: 30000 }],
      });

      const range = { dateFrom: "2026-08-28", dateTo: "2026-08-29" };

      const all = await finance.getSalesAnalyticsCore(admin, range);
      expect(all.channelData).toEqual([{ channel: "Dine-in", total: 140000, count: 2 }]);
      expect(all.voidOrders).toEqual({ count: 1, amount: 900000 });

      const completed = await finance.getSalesAnalyticsCore(admin, {
        ...range,
        status: "completed",
      });
      expect(completed.channelData).toEqual([{ channel: "Dine-in", total: 100000, count: 1 }]);
      expect(completed.topSales).toEqual([
        { recipeId, totalQty: 2, totalRevenue: 100000, name: "Nasi Goreng" },
      ]);
      // The void total describes what was excluded, not the scoped population.
      expect(completed.voidOrders).toEqual({ count: 1, amount: 900000 });

      const open = await finance.getSalesAnalyticsCore(admin, { ...range, status: "open" });
      expect(open.channelData).toEqual([{ channel: "Dine-in", total: 40000, count: 1 }]);
      expect(open.topSales[0]).toMatchObject({ totalQty: 1, totalRevenue: 40000 });
      expect(open.voidOrders).toEqual({ count: 1, amount: 900000 });
    },
  );

  it.skipIf(!hasTestDatabaseUrl)("rejects a half-specified range", async () => {
    const admin = await seedUser("super_admin");
    await expect(finance.getSalesAnalyticsCore(admin, { dateFrom: "2026-08-28" })).rejects.toThrow(
      "Isi tanggal awal dan akhir sekaligus",
    );
  });
});
