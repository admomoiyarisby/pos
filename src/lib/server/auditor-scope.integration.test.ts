/**
 * Auditor role — read-only and branch-scoped.
 *
 * The role is only half the feature: every read it can call must derive the
 * branch from the assignment, never from the `branchId` the client sends. These
 * tests drive the cores directly (ADR 0015) and assert both halves:
 *
 *  - an auditor sees the branches they were assigned, even when asking for
 *    someone else's (the request is narrowed, not honored);
 *  - an auditor with no assignment sees nothing rather than everything;
 *  - a role that is not on the read's allow-list is still refused, so opening a
 *    read to auditors never widened it to branch admins.
 *
 * Run:
 *   TEST_DATABASE_URL=postgresql://omoiyari_test:omoiyari_test@localhost:5433/omoiyari_pos_test DATABASE_URL= vp test run src/lib/server/auditor-scope.integration.test.ts
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

async function seedBranch(name: string): Promise<string> {
  const [row] = await db
    .insert(schema.branches)
    .values({ code: uniq("BR"), name, location: "Jakarta", type: "Outlet" })
    .returning({ id: schema.branches.id });
  return row.id;
}

async function seedUser(
  role: UserRole,
  assignedBranches: string[] = [],
  branchId?: string,
): Promise<AppUser> {
  const id = crypto.randomUUID();
  await db.insert(schema.users).values({
    id,
    name: `ITS ${role}`,
    email: `its-${id}@auditor.test`,
    role,
    branchId,
  });
  for (const branch of assignedBranches) {
    await db.insert(schema.areaManagerBranches).values({ userId: id, branchId: branch });
  }
  return {
    id,
    email: `its-${id}@auditor.test`,
    name: `ITS ${role}`,
    role,
    branchId,
    assignedBranches: assignedBranches.length > 0 ? assignedBranches : undefined,
    status: "Active",
  };
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

async function seedCompletedOrder(params: {
  branchId: string;
  createdAt: Date;
  totalAmount: number;
  netSales?: number;
  recipeId: string;
}): Promise<void> {
  const [order] = await db
    .insert(schema.orders)
    .values({
      branchId: params.branchId,
      channel: "Dine-in",
      subtotal: params.totalAmount,
      totalAmount: params.totalAmount,
      totalCogs: 0,
      netSales: params.netSales ?? params.totalAmount,
      status: "Completed",
      createdAt: params.createdAt,
    })
    .returning({ id: schema.orders.id });
  await db.insert(schema.orderItems).values({
    orderId: order.id,
    recipeId: params.recipeId,
    quantity: 1,
    price: params.totalAmount,
  });
}

const RANGE = { dateFrom: "2026-08-28", dateTo: "2026-08-29" };

beforeAll(async () => {
  if (!hasTestDatabaseUrl) return;
  // SAFETY: guarded by hasTestDatabaseUrl; when the test DB is absent beforeAll returns early and every test is skipped, so db is never read unset.
  db = dbHolder.db as TestDb;
  finance = await import("./finance");
});

describe("auditor reads are branch-scoped", () => {
  it.skipIf(!hasTestDatabaseUrl)(
    "narrows every analytics read to the assignment, whatever branch is requested",
    async () => {
      const branchA = await seedBranch("Cabang A");
      const branchB = await seedBranch("Cabang B");
      const recipeId = await seedRecipe();
      const auditor = await seedUser("auditor", [branchA]);

      await seedCompletedOrder({
        branchId: branchA,
        createdAt: new Date("2026-08-28T03:00:00.000Z"),
        totalAmount: 100000,
        recipeId,
      });
      await seedCompletedOrder({
        branchId: branchB,
        createdAt: new Date("2026-08-28T04:00:00.000Z"),
        totalAmount: 900000,
        recipeId,
      });

      // No branch filter: the assignment is the filter.
      const ownScope = await finance.getSalesAnalyticsCore(auditor, { ...RANGE });
      expect(ownScope.channelData).toEqual([{ channel: "Dine-in", total: 100000, count: 1 }]);
      expect(ownScope.voidOrders).toEqual({ count: 0, amount: 0 });

      // Asking for another branch must not widen the scope.
      const crossBranch = await finance.getSalesAnalyticsCore(auditor, {
        ...RANGE,
        branchId: branchB,
      });
      expect(crossBranch.channelData).toEqual([{ channel: "Dine-in", total: 100000, count: 1 }]);
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "defaults a multi-branch auditor to the whole assignment and honors one assigned branch",
    async () => {
      const branchA = await seedBranch("Cabang A");
      const branchB = await seedBranch("Cabang B");
      const recipeId = await seedRecipe();
      const auditor = await seedUser("auditor", [branchA, branchB]);

      for (const [branchId, total] of [
        [branchA, 100000],
        [branchB, 50000],
      ] as const) {
        await seedCompletedOrder({
          branchId,
          createdAt: new Date("2026-08-28T03:00:00.000Z"),
          totalAmount: total,
          recipeId,
        });
      }

      const all = await finance.getSalesAnalyticsCore(auditor, { ...RANGE });
      expect(all.channelData).toEqual([{ channel: "Dine-in", total: 150000, count: 2 }]);

      const one = await finance.getSalesAnalyticsCore(auditor, { ...RANGE, branchId: branchA });
      expect(one.channelData).toEqual([{ channel: "Dine-in", total: 100000, count: 1 }]);
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "an unassigned auditor sees nothing instead of everything",
    async () => {
      const branch = await seedBranch("Cabang A");
      const recipeId = await seedRecipe();
      const auditor = await seedUser("auditor", []);

      await seedCompletedOrder({
        branchId: branch,
        createdAt: new Date("2026-08-28T03:00:00.000Z"),
        totalAmount: 100000,
        recipeId,
      });

      const empty = await finance.getSalesAnalyticsCore(auditor, { ...RANGE });
      expect(empty.channelData).toEqual([]);
      expect(empty.topSales).toEqual([]);
    },
  );

  it.skipIf(!hasTestDatabaseUrl)("the ledger reads follow the same assignment", async () => {
    const branchA = await seedBranch("Cabang A");
    const branchB = await seedBranch("Cabang B");
    const recipeId = await seedRecipe();
    const auditor = await seedUser("auditor", [branchA]);

    await seedCompletedOrder({
      branchId: branchA,
      createdAt: new Date("2026-08-28T03:00:00.000Z"),
      totalAmount: 100000,
      netSales: 90000,
      recipeId,
    });
    await seedCompletedOrder({
      branchId: branchB,
      createdAt: new Date("2026-08-28T04:00:00.000Z"),
      totalAmount: 900000,
      netSales: 800000,
      recipeId,
    });

    const days = await finance.getDailyPnlCore(auditor, { ...RANGE });
    expect(days).toHaveLength(1);
    expect(days[0]?.channels.map((line) => line.orderCount)).toEqual([1]);

    const crossBranch = await finance.getDailyPnlCore(auditor, {
      ...RANGE,
      branchId: branchB,
    });
    expect(crossBranch[0]?.channels.map((line) => line.orderCount)).toEqual([1]);
  });

  it.skipIf(!hasTestDatabaseUrl)(
    "opening a read to auditors does not widen it to other branch roles",
    async () => {
      const branch = await seedBranch("Cabang A");
      const branchAdmin = await seedUser("branch_admin", [], branch);

      await expect(finance.getDailyPnlCore(branchAdmin, { ...RANGE })).rejects.toThrow(/Forbidden/);
      await expect(finance.getSalesAnalyticsCore(branchAdmin, { ...RANGE })).rejects.toThrow(
        /Forbidden/,
      );
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "adding the role to the enum does not hand it an order write edge",
    async () => {
      const { orderTransitions } = await import("./order-fsm");

      // The FSM derives its non-void actors from USER_ROLE_VALUES, so a new
      // label is one careless `satisfies` away from granting fulfilment writes.
      for (const rules of Object.values(orderTransitions)) {
        for (const rule of Object.values(rules)) {
          expect(rule.actors).not.toContain("auditor");
        }
      }
    },
  );
});
