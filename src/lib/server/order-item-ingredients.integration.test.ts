/**
 * ADR 0020 — transaction-time ingredient snapshots (`order_item_ingredients`).
 *
 * The silent-drift defect this fixes: a restore (void / edit restore / delete
 * restore) used to re-resolve the recipe BOM *at restore time*. Any recipe edit
 * between sale and restore made the restored quantity differ from the deducted
 * one, and the difference vanished with no ledger row — the Mulyorejo cup audit
 * found POS at 1 against a physical 59 with nothing on Kartu Stok explaining
 * the 58 owed back.
 *
 * Contract under test:
 *   create → freezes each item's consumption (positive/negative per ingredient)
 *   recipe edited afterwards → every restore still replays the frozen amounts
 *   edit   → restores the OLD frozen amounts, deducts the NEW resolution
 *   delete / void → restores exactly what went out (net zero on the item)
 *   legacy order items (no snapshot) → still resolve via the live BOM
 *
 * Run:
 *   TEST_DATABASE_URL=postgresql://omoiyari_test:omoiyari_test@localhost:5433/omoiyari_pos_test DATABASE_URL= vp test run src/lib/server/order-item-ingredients.integration.test.ts
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
  getCurrentUserRaw: async () => null,
}));

setupFlowHarness(dbHolder);

let db: TestDb;
let salesDataApi: typeof import("./sales-data");
let posApi: typeof import("./pos");
let resolverApi: typeof import("./ingredient-resolver");
let seedCounter = 0;

function uniq(prefix: string): string {
  return `${prefix}-${seedCounter++}-${crypto.randomUUID().slice(0, 8)}`;
}

beforeAll(async () => {
  if (!hasTestDatabaseUrl) return;
  // SAFETY: guarded by hasTestDatabaseUrl; every test is skipped without the DB, so db is never read unset.
  db = dbHolder.db as TestDb;
  salesDataApi = await import("./sales-data");
  posApi = await import("./pos");
  resolverApi = await import("./ingredient-resolver");
});

async function seedBranch(): Promise<string> {
  const [row] = await db
    .insert(schema.branches)
    .values({ code: uniq("BR"), name: "Cabang", location: "Jakarta", type: "Outlet" })
    .returning({ id: schema.branches.id });
  return row.id;
}

async function seedUser(role: UserRole, branchId?: string): Promise<AppUser> {
  const id = crypto.randomUUID();
  await db.insert(schema.users).values({
    id,
    name: `ITS ${role}`,
    email: `its-${id}@pos.test`,
    role,
    branchId,
  });
  return {
    id,
    email: `its-${id}@pos.test`,
    name: `ITS ${role}`,
    role,
    branchId,
    status: "Active",
  };
}

async function seedIngredient(): Promise<string> {
  const [row] = await db
    .insert(schema.ingredients)
    .values({
      code: uniq("ING"),
      name: "Bahan",
      category: "Fresh",
      skuType: "RM",
      purchaseUnit: "kg",
      stockUnit: "kg",
      conversionFactor: 1,
      averageCost: 1000,
    })
    .returning({ id: schema.ingredients.id });
  return row.id;
}

async function seedCategory(): Promise<string> {
  const [row] = await db
    .insert(schema.categories)
    .values({ code: uniq("CAT"), name: "Menu" })
    .returning({ id: schema.categories.id });
  return row.id;
}

/** Recipe consuming `bomQty` units of `ingId` per unit ordered. */
async function seedRecipe(categoryId: string, ingId: string, bomQty: number): Promise<string> {
  const [recipe] = await db
    .insert(schema.recipes)
    .values({ categoryId, code: uniq("R"), name: "Menu", basePrice: 10000, status: "Active" })
    .returning({ id: schema.recipes.id });
  await db
    .insert(schema.recipeIngredients)
    .values({ recipeId: recipe.id, ingredientId: ingId, quantity: bomQty });
  return recipe.id;
}

async function setBomQty(recipeId: string, ingId: string, qty: number): Promise<void> {
  await db
    .update(schema.recipeIngredients)
    .set({ quantity: qty })
    .where(
      and(
        eq(schema.recipeIngredients.recipeId, recipeId),
        eq(schema.recipeIngredients.ingredientId, ingId),
      ),
    );
}

async function inventoryQty(branchId: string, ingId: string): Promise<number | null> {
  const [row] = await db
    .select({ quantity: schema.inventory.quantity })
    .from(schema.inventory)
    .where(and(eq(schema.inventory.branchId, branchId), eq(schema.inventory.ingredientId, ingId)))
    .limit(1);
  return row?.quantity ?? null;
}

async function ledgerRows(reference: string) {
  return db.select().from(schema.stockLedger).where(eq(schema.stockLedger.reference, reference));
}

describe("ADR 0020 — order_item_ingredients snapshot", () => {
  it.skipIf(!hasTestDatabaseUrl)(
    "create freezes consumption; delete replays it even after the recipe is edited",
    async () => {
      const branch = await seedBranch();
      const admin = await seedUser("admin_pusat");
      const cat = await seedCategory();
      const ing = await seedIngredient();
      const recipe = await seedRecipe(cat, ing, 2);
      await db
        .insert(schema.inventory)
        .values({ branchId: branch, ingredientId: ing, quantity: 100 });

      // 3 × recipe at BOM 2/unit → 6 consumed (100 → 94)
      const order = await salesDataApi.createSalesOrderCore(admin, {
        branchId: branch,
        channel: "Dine-in",
        customerName: "Budi",
        items: [{ recipeId: recipe, quantity: 3, price: 10000 }],
      });
      expect(await inventoryQty(branch, ing)).toBe(94);

      const snapshot = await db.select().from(schema.orderItemIngredients);
      expect(snapshot).toHaveLength(1);
      expect(snapshot[0].ingredientId).toBe(ing);
      expect(snapshot[0].quantity).toBe(6);

      // The recipe is edited AFTER the sale (the silent-drift trigger): a
      // naive restore would now put back 3 × 5 = 15.
      await setBomQty(recipe, ing, 5);

      await salesDataApi.deleteSalesOrderCore(admin, { id: order.id });
      expect(await inventoryQty(branch, ing)).toBe(100); // not 100 - 15 + … anything else

      const restore = (await ledgerRows(order.id)).filter((r) => r.type === "IN");
      expect(restore).toHaveLength(1);
      expect(restore[0].quantity).toBe(6); // the frozen amount, not 15
      expect(restore[0].balance).toBe(100);
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "update restores the old frozen amounts and deducts the new resolution",
    async () => {
      const branch = await seedBranch();
      const admin = await seedUser("admin_pusat");
      const cat = await seedCategory();
      const ing = await seedIngredient();
      const recipe = await seedRecipe(cat, ing, 2);
      await db
        .insert(schema.inventory)
        .values({ branchId: branch, ingredientId: ing, quantity: 100 });

      const order = await salesDataApi.createSalesOrderCore(admin, {
        branchId: branch,
        channel: "Gofood",
        items: [{ recipeId: recipe, quantity: 2, price: 10000 }],
      });
      expect(await inventoryQty(branch, ing)).toBe(96);

      // Recipe changes, then the order is corrected from 2 to 4 units.
      await setBomQty(recipe, ing, 5);
      await salesDataApi.updateSalesOrderCore(admin, {
        id: order.id,
        branchId: branch,
        channel: "Gofood",
        items: [{ recipeId: recipe, quantity: 4, price: 10000 }],
      });

      // Restore replays the frozen 2 × 2 = 4; the new deduction resolves the
      // current BOM 4 × 5 = 20. Net: 96 + 4 - 20 = 80.
      expect(await inventoryQty(branch, ing)).toBe(80);

      const rows = await ledgerRows(order.id);
      const restoreRow = rows.find((r) => r.type === "IN" && r.notes?.includes("Edit Order"));
      expect(restoreRow?.quantity).toBe(4);
      const deductRow = rows.find(
        (r) => r.type === "OUT" && r.quantity === 20 && r.notes?.includes("Edit Order"),
      );
      expect(deductRow).toBeDefined();

      // The snapshot is re-frozen to the new items, so a later delete still
      // closes the loop at zero net change from the edit onward (80 → 100).
      await salesDataApi.deleteSalesOrderCore(admin, { id: order.id });
      expect(await inventoryQty(branch, ing)).toBe(100);
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "POS void replays the snapshot (stock returns to exactly pre-order)",
    async () => {
      const branch = await seedBranch();
      const cashier = await seedUser("branch_admin", branch);
      const cat = await seedCategory();
      const ing = await seedIngredient();
      const recipe = await seedRecipe(cat, ing, 2);
      await db
        .insert(schema.inventory)
        .values({ branchId: branch, ingredientId: ing, quantity: 100 });

      const order = await posApi.createOrderCore(cashier, {
        branchId: branch,
        channel: "Dine-in",
        customerName: "Budi Santoso",
        items: [{ recipeId: recipe, quantity: 3, price: 10000 }],
        paymentMethod: "cash",
      });
      expect(await inventoryQty(branch, ing)).toBe(94);

      const snapshot = await db
        .select()
        .from(schema.orderItemIngredients)
        .innerJoin(
          schema.orderItems,
          eq(schema.orderItemIngredients.orderItemId, schema.orderItems.id),
        )
        .where(eq(schema.orderItems.orderId, order.id));
      expect(snapshot).toHaveLength(1);
      expect(Number(snapshot[0].order_item_ingredients.quantity)).toBe(6);

      // Recipe edited after the sale, then the order is voided ("Salah Input").
      await setBomQty(recipe, ing, 5);
      const voided = await posApi.voidOrderCore(cashier, {
        orderId: order.id,
        reason: "Salah input",
      });
      expect(voided.status).toBe("Void");
      expect(await inventoryQty(branch, ing)).toBe(100);

      const restore = (await ledgerRows(order.id)).filter((r) => r.type === "IN");
      expect(restore).toHaveLength(1);
      expect(restore[0].quantity).toBe(6);
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "legacy order items without a snapshot still resolve via the live BOM",
    async () => {
      const branch = await seedBranch();
      const admin = await seedUser("admin_pusat");
      const cat = await seedCategory();
      const ing = await seedIngredient();
      const recipe = await seedRecipe(cat, ing, 2);
      // Post-deduction books for a pre-ADR order that consumed 2 × 2 = 4:
      // 100 on the books, i.e. 104 before the order was placed.
      await db
        .insert(schema.inventory)
        .values({ branchId: branch, ingredientId: ing, quantity: 100 });

      // An order created before ADR 0020: items exist, no snapshot rows.
      const [order] = await db
        .insert(schema.orders)
        .values({
          branchId: branch,
          channel: "Gofood",
          subtotal: 20000,
          totalAmount: 20000,
          totalCogs: 0,
          netSales: 20000,
          status: "Completed",
        })
        .returning();
      const [orderItem] = await db
        .insert(schema.orderItems)
        .values({ orderId: order.id, recipeId: recipe, quantity: 2, price: 10000 })
        .returning();

      const resolved = await resolverApi.resolvePersistedItemIngredients(orderItem.id);
      expect(resolved.ingredients).toHaveLength(1);
      expect(resolved.ingredients[0].quantity).toBe(2 * 2); // 4, from the live BOM

      // Deleting restores via the same live path: 100 + 4 = back to the
      // pre-order 104.
      await salesDataApi.deleteSalesOrderCore(admin, { id: order.id });
      expect(await inventoryQty(branch, ing)).toBe(104);
      const restore = (await ledgerRows(order.id)).filter((r) => r.type === "IN");
      expect(restore).toHaveLength(1);
      expect(restore[0].quantity).toBe(4);
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "movements with no seeded inventory row are recorded, never silently dropped",
    async () => {
      const branch = await seedBranch();
      const admin = await seedUser("admin_pusat");
      const cat = await seedCategory();
      const ing = await seedIngredient();
      const recipe = await seedRecipe(cat, ing, 2);
      // No inventory row — the old `if (!inv) continue` dropped both the
      // stock change and the ledger row for every restore here.

      const order = await salesDataApi.createSalesOrderCore(admin, {
        branchId: branch,
        channel: "ShopeeFood",
        items: [{ recipeId: recipe, quantity: 4, price: 10000 }],
      });
      // Upserted from 0 (allow-negative), exactly one recorded movement.
      expect(await inventoryQty(branch, ing)).toBe(-8);
      const created = await ledgerRows(order.id);
      expect(created).toHaveLength(1);
      expect(created[0].type).toBe("OUT");
      expect(created[0].quantity).toBe(8);
      expect(created[0].balance).toBe(-8);

      // And the delete closes the loop at 0 with both rows recorded.
      await salesDataApi.deleteSalesOrderCore(admin, { id: order.id });
      expect(await inventoryQty(branch, ing)).toBe(0);
      const all = await ledgerRows(order.id);
      expect(all.filter((r) => r.type === "IN")).toHaveLength(1);
      expect(all.filter((r) => r.type === "OUT")).toHaveLength(1);
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "editing an already-voided order is refused (no stacked restore on top of the void)",
    async () => {
      const branch = await seedBranch();
      const admin = await seedUser("admin_pusat");
      const cat = await seedCategory();
      const ing = await seedIngredient();
      const recipe = await seedRecipe(cat, ing, 2);
      await db
        .insert(schema.inventory)
        .values({ branchId: branch, ingredientId: ing, quantity: 100 });

      const order = await salesDataApi.createSalesOrderCore(admin, {
        branchId: branch,
        channel: "Dine-in",
        customerName: "Budi",
        items: [{ recipeId: recipe, quantity: 2, price: 10000 }],
      });
      expect(await inventoryQty(branch, ing)).toBe(96);

      // The order was voided: its stock was restored by the void itself.
      await db.update(schema.orders).set({ status: "Void" }).where(eq(schema.orders.id, order.id));
      await db
        .update(schema.inventory)
        .set({ quantity: 100 })
        .where(and(eq(schema.inventory.branchId, branch), eq(schema.inventory.ingredientId, ing)));

      // Editing it would restore the frozen amounts a second time.
      await expect(
        salesDataApi.updateSalesOrderCore(admin, {
          id: order.id,
          branchId: branch,
          channel: "Dine-in",
          items: [{ recipeId: recipe, quantity: 1, price: 10000 }],
        }),
      ).rejects.toThrow("Order sudah di-void");
      expect(await inventoryQty(branch, ing)).toBe(100);
    },
  );
});
