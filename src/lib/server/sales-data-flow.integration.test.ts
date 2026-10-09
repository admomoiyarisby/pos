/* oxlint-disable anti-slop/no-console -- effects log progress; not assertions */
/**
 * Data Penjualan (sales-data.ts) full-flow integration test.
 *
 * Drives the real user-parameterized cores... well, the createServerFn-wrapped
 * functions (`createSalesOrder`, `updateSalesOrder`, `deleteSalesOrder`) against
 * the local dockerized test Postgres, with `#/lib/server/db` mocked to the test
 * database (ADR-0015 harness pattern, mirrors `pos-flow.integration.test.ts`).
 *
 * Contract under test — the Kartu Stok invariant:
 *   create  → deducts inventory (OUT ledger, balance == post-write quantity)
 *   update  → restores the old items' consumption (IN) and deducts the new
 *             items' consumption (OUT), all on the same order reference
 *   delete  → restores the consumed stock (IN) before the row is removed
 *
 * Run:
 *   TEST_DATABASE_URL=postgresql://omoiyari_test:omoiyari_test@localhost:5433/omoiyari_pos_test DATABASE_URL= vp test run src/lib/server/sales-data-flow.integration.test.ts
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
    throw new Error("requireAuth should not be called — sales-data fns are role-gated only");
  },
  requireRole: async () => {
    throw new Error("requireRole should not be called — tests drive handlers with real data");
  },
  getCurrentUserRaw: async () => null,
}));

setupFlowHarness(dbHolder);

let db: TestDb;
let salesDataApi: typeof import("./sales-data");
let seedCounter = 0;

function uniq(prefix: string): string {
  return `${prefix}-${seedCounter++}-${crypto.randomUUID().slice(0, 8)}`;
}

beforeAll(async () => {
  if (!hasTestDatabaseUrl) return;
  // SAFETY: guarded by hasTestDatabaseUrl; when the test DB is absent beforeAll returns early and every test is skipped, so db is never read unset.
  db = dbHolder.db as TestDb;
  salesDataApi = await import("./sales-data");
});

async function seedBranch(): Promise<string> {
  const [row] = await db
    .insert(schema.branches)
    .values({ code: uniq("BR"), name: "Cabang", location: "Jakarta", type: "Outlet" })
    .returning({ id: schema.branches.id });
  return row.id;
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

async function seedRecipe(categoryId: string, ingId: string): Promise<string> {
  const [recipe] = await db
    .insert(schema.recipes)
    .values({ categoryId, code: uniq("R"), name: "Menu", basePrice: 10000, status: "Active" })
    .returning({ id: schema.recipes.id });
  await db
    .insert(schema.recipeIngredients)
    .values({ recipeId: recipe.id, ingredientId: ingId, quantity: 2 });
  return recipe.id;
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

// The ADR-0015 core pattern: tests drive the exported cores directly, which
// run the exact business logic the createServerFn wrappers execute without the
// HTTP transport.

describe.skipIf(!hasTestDatabaseUrl)("Data Penjualan — stock effects and Kartu Stok ledger", () => {
  it("create deducts stock + writes OUT ledger; update restores old and deducts new; delete restores", async () => {
    const branchA = await seedBranch();
    const branchB = await seedBranch();
    const admin = await seedUser("admin_pusat");
    const [catRow] = await db
      .insert(schema.categories)
      .values({ code: uniq("CAT"), name: "Menu" })
      .returning({ id: schema.categories.id });
    const ingId = await seedIngredient();
    const recipeId = await seedRecipe(catRow.id, ingId);

    await db
      .insert(schema.inventory)
      .values({ branchId: branchA, ingredientId: ingId, quantity: 100 });
    await db
      .insert(schema.inventory)
      .values({ branchId: branchB, ingredientId: ingId, quantity: 50 });

    // ── CREATE: 3 × recipe (BOM 2 each) → 6 units OUT (100 → 94) ──
    const order = await salesDataApi.createSalesOrderCore(admin, {
      branchId: branchA,
      channel: "Dine-in",
      items: [{ recipeId, quantity: 3, price: 10000 }],
    });
    expect(order.status).toBe("Completed");
    expect(await inventoryQty(branchA, ingId)).toBe(94);

    const createLedger = await ledgerRows(order.id);
    expect(createLedger).toHaveLength(1);
    expect(createLedger[0].type).toBe("OUT");
    expect(createLedger[0].quantity).toBe(6);
    expect(createLedger[0].balance).toBe(94);
    expect(createLedger[0].branchId).toBe(branchA);

    // ── UPDATE: change to 5 × recipe → restore 6 (IN) + deduct 10 (OUT) ──
    await salesDataApi.updateSalesOrderCore(admin, {
      id: order.id,
      branchId: branchA,
      channel: "Dine-in",
      items: [{ recipeId, quantity: 5, price: 10000 }],
    });
    expect(await inventoryQty(branchA, ingId)).toBe(90); // 94 - 6 + 10

    const updateLedger = await ledgerRows(order.id);
    const inRows = updateLedger.filter((r) => r.type === "IN");
    const outRows = updateLedger.filter((r) => r.type === "OUT");
    expect(inRows).toHaveLength(1);
    expect(inRows[0].quantity).toBe(6);
    expect(outRows).toHaveLength(2); // original create OUT + update OUT
    const updateOut = outRows.find((r) => r.quantity === 10);
    expect(updateOut).toBeDefined();
    expect(updateOut!.balance).toBe(90);

    // ── UPDATE with a branch change: restore on A, deduct on B ──
    await salesDataApi.updateSalesOrderCore(admin, {
      id: order.id,
      branchId: branchB,
      channel: "Dine-in",
      items: [{ recipeId, quantity: 1, price: 10000 }],
    });
    expect(await inventoryQty(branchA, ingId)).toBe(100); // 90 - 10 + 10 restore
    expect(await inventoryQty(branchB, ingId)).toBe(48); // 50 - 2

    // ── DELETE: restores branch B's 2 units (48 → 50) ──
    await salesDataApi.deleteSalesOrderCore(admin, { id: order.id });
    expect(await inventoryQty(branchB, ingId)).toBe(50);

    const finalLedger = await ledgerRows(order.id);
    const deleteIns = finalLedger.filter((r) => r.type === "IN" && r.balance === 50);
    expect(deleteIns).toHaveLength(1);
    expect(deleteIns[0].branchId).toBe(branchB);
  });

  it("create with no inventory row for the branch now upserts from 0 and records (ADR 0020)", async () => {
    const branchId = await seedBranch();
    const admin = await seedUser("admin_pusat");
    const [catRow] = await db
      .insert(schema.categories)
      .values({ code: uniq("CAT"), name: "Menu" })
      .returning({ id: schema.categories.id });
    const ingId = await seedIngredient();
    const recipeId = await seedRecipe(catRow.id, ingId);
    // No inventory row seeded for this branch — the movement used to be
    // silently dropped (no stock change, no ledger row). It is now recorded
    // against an upserted-from-0 row, the same policy as waste/yield.

    const order = await salesDataApi.createSalesOrderCore(admin, {
      branchId,
      channel: "Gofood",
      items: [{ recipeId, quantity: 2, price: 10000 }],
    });
    expect(await inventoryQty(branchId, ingId)).toBe(-4);

    const createLedger = await ledgerRows(order.id);
    expect(createLedger).toHaveLength(1);
    expect(createLedger[0].type).toBe("OUT");
    expect(createLedger[0].quantity).toBe(4);
    expect(createLedger[0].balance).toBe(-4);

    // Deleting the order restores it to 0 and records the IN row — no phantom,
    // no silent skip.
    await salesDataApi.deleteSalesOrderCore(admin, { id: order.id });
    expect(await inventoryQty(branchId, ingId)).toBe(0);

    const deleteLedger = (await ledgerRows(order.id)).filter((r) => r.type === "IN");
    expect(deleteLedger).toHaveLength(1);
    expect(deleteLedger[0].quantity).toBe(4);
    expect(deleteLedger[0].balance).toBe(0);
  });
});

describe.skipIf(!hasTestDatabaseUrl)("Data Penjualan — verified flag", () => {
  async function seedOrder(channel: (typeof schema.ORDER_CHANNEL_VALUES)[number]) {
    const branchId = await seedBranch();
    const admin = await seedUser("admin_pusat");
    const [catRow] = await db
      .insert(schema.categories)
      .values({ code: uniq("CAT"), name: "Menu" })
      .returning({ id: schema.categories.id });
    const ingId = await seedIngredient();
    const recipeId = await seedRecipe(catRow.id, ingId);
    await db.insert(schema.inventory).values({ branchId, ingredientId: ingId, quantity: 100 });
    // Dine-in orders are system-generated; customerName is mandatory for them.
    const payload: Parameters<typeof salesDataApi.createSalesOrderCore>[1] = {
      branchId,
      channel,
      items: [{ recipeId, quantity: 1, price: 10000 }],
    };
    if (channel === "Dine-in") payload.customerName = "Rina";
    const order = await salesDataApi.createSalesOrderCore(admin, payload);
    return { order, admin };
  }

  async function verifiedRow(id: string) {
    const [row] = await db
      .select({
        verified: schema.orders.verified,
        verifiedAt: schema.orders.verifiedAt,
        verifiedById: schema.orders.verifiedById,
      })
      .from(schema.orders)
      .where(eq(schema.orders.id, id))
      .limit(1);
    return row;
  }

  // Every channel is reviewable — Dine-in included. The flag was originally
  // Dine-in-exempt on the theory that POS orders are system-generated, but an
  // auditor still reconciles the cashier's shift/route sheet against the POS
  // report, so the flag applies uniformly.
  it.each(schema.ORDER_CHANNEL_VALUES)("can flag and unflag a %s order", async (channel) => {
    const { order, admin } = await seedOrder(channel);

    expect((await verifiedRow(order.id)).verified).toBe(false);

    const on = await salesDataApi.toggleSalesOrderVerifiedCore(admin, {
      id: order.id,
      verified: true,
    });
    expect(on).toEqual({ success: true, verified: true });

    const flagged = await verifiedRow(order.id);
    expect(flagged.verified).toBe(true);
    expect(flagged.verifiedById).toBe(admin.id);
    expect(flagged.verifiedAt).toBeInstanceOf(Date);

    // Unflagging must clear the audit trail again, not leave a stale stamp.
    const off = await salesDataApi.toggleSalesOrderVerifiedCore(admin, {
      id: order.id,
      verified: false,
    });
    expect(off).toEqual({ success: true, verified: false });

    const cleared = await verifiedRow(order.id);
    expect(cleared.verified).toBe(false);
    expect(cleared.verifiedById).toBeNull();
    expect(cleared.verifiedAt).toBeNull();
  });

  it("throws for an unknown order id", async () => {
    const admin = await seedUser("admin_pusat");
    await expect(
      salesDataApi.toggleSalesOrderVerifiedCore(admin, {
        id: crypto.randomUUID(),
        verified: true,
      }),
    ).rejects.toThrow("Order not found");
  });
});
