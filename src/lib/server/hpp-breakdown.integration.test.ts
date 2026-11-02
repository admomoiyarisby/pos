/* oxlint-disable anti-slop/no-console -- effects log progress; not assertions */
/**
 * HPP breakdown integration test (ADR 0031).
 *
 * Drives the real cores against the dockerized test Postgres to prove the
 * three properties the pure unit tests cannot see:
 *
 *  - a POS sale writes each snapshot row's rupiah cost at sale time, so the
 *    breakdown survives a later `ingredients.average_cost` change;
 *  - legacy rows (null `cost_at_transaction`) are re-priced and then rescaled
 *    to their line's `cogs_at_transaction × quantity`;
 *  - an order with no line items (manual "Data Penjualan") stays
 *    `unallocated`, and `rows + unallocated === totalCogs` always holds.
 *
 * Run:
 *   TEST_DATABASE_URL=postgresql://omoiyari_test:omoiyari_test@localhost:5433/omoiyari_pos_test DATABASE_URL= vp test run src/lib/server/hpp-breakdown.integration.test.ts
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
  getCurrentUserRaw: async () => null,
}));

setupFlowHarness(dbHolder);

let db: TestDb;
let financeApi: typeof import("./finance");
let posApi: typeof import("./pos");
let seedCounter = 0;

function uniq(prefix: string): string {
  return `${prefix}-${seedCounter++}-${crypto.randomUUID().slice(0, 8)}`;
}

interface Seeds {
  admin: AppUser;
  branchId: string;
  ingredientId: string;
  recipeId: string;
}

async function seedUser(role: UserRole): Promise<AppUser> {
  const id = crypto.randomUUID();
  await db.insert(schema.users).values({
    id,
    name: `ITS ${role}`,
    email: `its-${id}@hpp.test`,
    role,
  });
  return { id, email: `its-${id}@hpp.test`, name: `ITS ${role}`, role, status: "Active" };
}

async function seedIngredients(cost = 1000): Promise<Seeds> {
  const admin = await seedUser("super_admin");
  const [branch] = await db
    .insert(schema.branches)
    .values({ code: uniq("BR"), name: "Cabang", location: "Jakarta", type: "Outlet" })
    .returning({ id: schema.branches.id });

  const [ingredient] = await db
    .insert(schema.ingredients)
    .values({
      code: uniq("ING"),
      name: "Bahan Uji",
      category: "Fresh",
      skuType: "RM",
      purchaseUnit: "kg",
      stockUnit: "kg",
      conversionFactor: 1,
      averageCost: cost,
    })
    .returning({ id: schema.ingredients.id });

  await db
    .insert(schema.inventory)
    .values({ branchId: branch.id, ingredientId: ingredient.id, quantity: 50 });

  const [category] = await db
    .insert(schema.categories)
    .values({ code: uniq("CAT"), name: "Kategori" })
    .returning({ id: schema.categories.id });

  // BOM: 2 units per dish, so one dish costs 2 x averageCost.
  const [recipe] = await db
    .insert(schema.recipes)
    .values({
      categoryId: category.id,
      code: uniq("R"),
      name: "Menu Uji",
      basePrice: 10000,
      status: "Active",
      totalCogs: cost * 2,
    })
    .returning({ id: schema.recipes.id });

  await db
    .insert(schema.recipeIngredients)
    .values({ recipeId: recipe.id, ingredientId: ingredient.id, quantity: 2 });

  return { admin, branchId: branch.id, ingredientId: ingredient.id, recipeId: recipe.id };
}

function jakartaToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
}

async function setAverageCost(ingredientId: string, cost: number): Promise<void> {
  await db
    .update(schema.ingredients)
    .set({ averageCost: cost })
    .where(eq(schema.ingredients.id, ingredientId));
}

beforeAll(async () => {
  if (!hasTestDatabaseUrl) return;
  // SAFETY: guarded by hasTestDatabaseUrl; db is set by setupFlowHarness before any test reads it.
  db = dbHolder.db as TestDb;
  financeApi = await import("./finance");
  posApi = await import("./pos");
});

describe("HPP breakdown — sale-time cost and per-order reconciliation", () => {
  it.skipIf(!hasTestDatabaseUrl)(
    "attributes a POS sale to its ingredient and leaves no residual",
    async () => {
      const s = await seedIngredients(1000);
      const order = await posApi.createOrderCore(s.admin, {
        branchId: s.branchId,
        channel: "Dine-in",
        customerName: "Pelanggan Uji",
        items: [{ recipeId: s.recipeId, quantity: 3, price: 10000 }],
        paymentMethod: "cash",
      });
      // 3 x (2 units x Rp 1.000)
      expect(order.totalCogs).toBe(6000);

      const breakdown = await financeApi.getDailyHppBreakdownCore(s.admin, {
        branchId: s.branchId,
        date: jakartaToday(),
      });

      expect(breakdown.totalCogs).toBe(6000);
      expect(breakdown.rows).toHaveLength(1);
      expect(breakdown.rows[0]).toMatchObject({
        ingredientId: s.ingredientId,
        name: "Bahan Uji",
        cost: 6000,
      });
      expect(breakdown.unallocated).toBe(0);
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "keeps the frozen cost after the ingredient price changes",
    async () => {
      const s = await seedIngredients(1000);
      await posApi.createOrderCore(s.admin, {
        branchId: s.branchId,
        channel: "Dine-in",
        customerName: "Pelanggan Uji",
        items: [{ recipeId: s.recipeId, quantity: 3, price: 10000 }],
        paymentMethod: "cash",
      });

      // Price triples after the sale. A report that re-priced history would now
      // claim 18.000; the frozen row must still say 6.000.
      await setAverageCost(s.ingredientId, 3000);

      const breakdown = await financeApi.getDailyHppBreakdownCore(s.admin, {
        branchId: s.branchId,
        date: jakartaToday(),
      });

      expect(breakdown.rows[0]?.cost).toBe(6000);
      expect(breakdown.unallocated).toBe(0);
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "rescales a legacy row (no frozen cost) to its line COGS",
    async () => {
      const s = await seedIngredients(1000);

      // Pre-ADR-0031 order: totalCogs 6.000, 3 units at 2.000 each, snapshot
      // quantities only (cost column null).
      const [order] = await db
        .insert(schema.orders)
        .values({
          branchId: s.branchId,
          channel: "Dine-in",
          subtotal: 30000,
          totalAmount: 30000,
          totalCogs: 6000,
          netSales: 30000,
          status: "Completed",
        })
        .returning();
      const [item] = await db
        .insert(schema.orderItems)
        .values({
          orderId: order.id,
          recipeId: s.recipeId,
          quantity: 3,
          price: 10000,
          cogsAtTransaction: 2000,
        })
        .returning();
      await db.insert(schema.orderItemIngredients).values({
        orderItemId: item.id,
        ingredientId: s.ingredientId,
        quantity: 6,
        costAtTransaction: null,
      });

      // Current price doubles, so re-pricing alone would claim 12.000.
      await setAverageCost(s.ingredientId, 2000);

      const breakdown = await financeApi.getDailyHppBreakdownCore(s.admin, {
        branchId: s.branchId,
        date: jakartaToday(),
      });

      expect(breakdown.rows[0]?.cost).toBe(6000);
      expect(breakdown.unallocated).toBe(0);
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "reports an item-less manual order as unallocated, not as an ingredient",
    async () => {
      const s = await seedIngredients(1000);
      await posApi.createOrderCore(s.admin, {
        branchId: s.branchId,
        channel: "Dine-in",
        customerName: "Pelanggan Uji",
        items: [{ recipeId: s.recipeId, quantity: 3, price: 10000 }],
        paymentMethod: "cash",
      });

      // Manual "Data Penjualan" entry: totalCogs typed, no line items.
      await db.insert(schema.orders).values({
        branchId: s.branchId,
        channel: "Gofood",
        subtotal: 5000,
        totalAmount: 5000,
        totalCogs: 2500,
        netSales: 5000,
        status: "Completed",
      });

      const breakdown = await financeApi.getDailyHppBreakdownCore(s.admin, {
        branchId: s.branchId,
        date: jakartaToday(),
      });

      expect(breakdown.totalCogs).toBe(8500);
      expect(breakdown.rows).toHaveLength(1);
      expect(breakdown.rows[0]?.cost).toBe(6000);
      expect(breakdown.unallocated).toBe(2500);
      expect(breakdown.rows.reduce((sum, r) => sum + r.cost, 0) + breakdown.unallocated).toBe(
        breakdown.totalCogs,
      );
    },
  );
});
