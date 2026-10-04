/**
 * Kartu Stok saldo — the running-balance contract the page must report.
 *
 * The client report (2026-10-02, batch "Kirim Jambangan 03/10" at Central
 * Warehouse): a row whose `Tipe` badge reads OUT showed a *higher* Saldo than
 * the row above it. The movement was a real decrease.
 *
 * `stock_ledger.balance` is a denormalized snapshot of `inventory.quantity`
 * taken when the row was written, and nothing enforces that it stayed that way.
 * The 0059 backfill re-stamped repaired rows with the *original* movement time
 * while deriving `balance` from the balance at *repair* time, so every row
 * written in between carries an off-by-N snapshot and the Saldo column reads
 * backwards. The page rendered that stored column verbatim.
 *
 * The reported Saldo is the series' running movement total, anchored to the
 * item's current stock. What that buys the reader:
 *  - a Saldo drop between two rows equals the quantity that moved,
 *  - an OUT never reads as an increase,
 *  - the newest row agrees with the stock every other screen shows.
 *
 * Drives the ADR 0015 core seam (`getStockLedgerCore`) against the local
 * dockerized test Postgres.
 *
 * Run:
 *   TEST_DATABASE_URL=postgresql://omoiyari_test:omoiyari_test@localhost:5433/omoiyari_pos_test DATABASE_URL= vp test run src/lib/server/kartu-stok-balance.integration.test.ts
 */

import { describe, expect, it, vi } from "vite-plus/test";
import * as schema from "#/db/schema";
import { getTestDatabaseUrl } from "./test-database";
import type { TestDb } from "./integration-test-harness";
import { setupFlowHarness } from "./integration-test-harness";
import { getStockLedgerCore } from "./inventory";
import type { AppUser } from "./auth";

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

const auditor: AppUser = {
  id: crypto.randomUUID(),
  email: "auditor@test.local",
  name: "Ledger Auditor",
  role: "super_admin",
  status: "Active",
};

function testDb(): TestDb {
  if (!dbHolder.db) throw new Error("db holder not initialized — beforeAll must run first");
  return dbHolder.db;
}

async function seedBranch(name: string, code: string): Promise<string> {
  const id = crypto.randomUUID();
  await testDb()
    .insert(schema.branches)
    .values({ id, code, name, location: "Test", type: "Outlet" });
  return id;
}

async function seedIngredient(name: string, stockUnit: string): Promise<string> {
  const id = crypto.randomUUID();
  await testDb()
    .insert(schema.ingredients)
    .values({
      id,
      code: `T${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      name,
      category: "Packaging",
      skuType: "RM",
      purchaseUnit: stockUnit,
      stockUnit,
      conversionFactor: 1,
      averageCost: 1000,
    });
  return id;
}

type LedgerRow = {
  branchId: string;
  ingredientId?: string | null;
  recipeId?: string | null;
  type: "IN" | "OUT";
  quantity: number;
  balance: number;
  reference: string;
  notes?: string | null;
  createdAt: Date;
};

async function seedLedger(rows: LedgerRow[]): Promise<void> {
  await testDb().insert(schema.stockLedger).values(rows);
}

/** Reported Saldo keyed by reference, plus the rows in page order. */
async function readLedger(branchId: string) {
  const { data } = await getStockLedgerCore(auditor, { branchId, page: 0, limit: 200 });
  return {
    saldo: new Map(data.map((r) => [r.reference, Number(r.balance)])),
    rows: data,
  };
}

/** Saldo of each reference in the order the references are given (oldest first). */
function chronological(saldo: Map<string, number>, references: string[]): number[] {
  return references.map((r) => {
    const v = saldo.get(r);
    if (v === undefined) throw new Error(`reference ${r} missing from the ledger page`);
    return v;
  });
}

describe.skipIf(!hasTestDatabaseUrl)("Kartu Stok saldo — running movement total", () => {
  it("reads an OUT as a decrease across a series whose stored snapshots drifted", async () => {
    const branchId = await seedBranch("Central Warehouse", "CENTRAL");
    const ingredientId = await seedIngredient("Plastik Kresek 20", "pack");

    await seedLedger([
      {
        branchId,
        ingredientId,
        type: "IN",
        quantity: 31,
        balance: 31,
        reference: "SALDOAWAL",
        notes: "saldo awal gudang",
        createdAt: new Date("2026-09-26T05:06:15.316Z"),
      },
      {
        branchId,
        ingredientId,
        type: "OUT",
        quantity: 3,
        balance: 28,
        reference: "KIRIMTEGALSARI",
        notes: "Pengiriman Tegalsari 02/10",
        createdAt: new Date("2026-10-02T00:20:21.988Z"),
      },
      {
        branchId,
        ingredientId,
        type: "OUT",
        quantity: 24,
        balance: 20,
        reference: "KIRIMTEGALSARI-2",
        createdAt: new Date("2026-10-02T00:47:17.664Z"),
      },
      {
        // Stored snapshot is 4 short of the item's real stock at this point.
        branchId,
        ingredientId,
        type: "IN",
        quantity: 25,
        balance: 25,
        reference: "SUPPLIER-WIYUNG",
        notes: "Supplier Delivery: Plastik Wiyung ( Ce Debrina)",
        createdAt: new Date("2026-10-02T18:53:33.031Z"),
      },
      {
        branchId,
        ingredientId,
        type: "OUT",
        quantity: 2,
        balance: 27,
        reference: "KIRIMJAMBANGAN",
        notes: "Kirim Jambangan 03/10",
        createdAt: new Date("2026-10-02T23:34:03.782Z"),
      },
    ]);
    await testDb().insert(schema.inventory).values({ branchId, ingredientId, quantity: 27 });

    const { saldo } = await readLedger(branchId);

    expect(
      chronological(saldo, [
        "SALDOAWAL",
        "KIRIMTEGALSARI",
        "KIRIMTEGALSARI-2",
        "SUPPLIER-WIYUNG",
        "KIRIMJAMBANGAN",
      ]),
    ).toEqual([31, 28, 4, 29, 27]);
  });

  it("reports a Saldo drop equal to the quantity that left", async () => {
    const branchId = await seedBranch("Omoiyari Jambangan", "JMB");
    const ingredientId = await seedIngredient("Egg Roll", "pcs");

    await seedLedger([
      {
        branchId,
        ingredientId,
        type: "IN",
        quantity: 143,
        balance: 143,
        reference: "IN-1",
        createdAt: new Date("2026-10-02T10:00:00.000Z"),
      },
      {
        branchId,
        ingredientId,
        type: "OUT",
        quantity: 30,
        balance: 113,
        reference: "OUT-1",
        createdAt: new Date("2026-10-02T23:34:03.782Z"),
      },
      {
        branchId,
        ingredientId,
        type: "OUT",
        quantity: 50,
        balance: 63,
        reference: "OUT-2",
        createdAt: new Date("2026-10-03T00:14:42.343Z"),
      },
    ]);
    await testDb().insert(schema.inventory).values({ branchId, ingredientId, quantity: 63 });

    const { saldo, rows } = await readLedger(branchId);

    const pageOrder = ["OUT-2", "OUT-1", "IN-1"].map((r) => Number(saldo.get(r)));
    expect(pageOrder[0]).toBeLessThan(pageOrder[1]);
    expect(pageOrder[1]).toBeLessThan(pageOrder[2]);
    expect(pageOrder[1] - pageOrder[0]).toBe(50);
    expect(pageOrder[2] - pageOrder[1]).toBe(30);
    for (const row of rows) {
      expect(Number(row.balance)).toBeGreaterThanOrEqual(0);
    }
  });

  it("anchors the newest row to the item's current stock when the movements do not reconcile", async () => {
    const branchId = await seedBranch("Central Warehouse 2", "CENTRAL2");
    const ingredientId = await seedIngredient("Tepung Terigu", "gr");

    await seedLedger([
      {
        branchId,
        ingredientId,
        type: "IN",
        quantity: 22968,
        balance: 22968,
        reference: "IN-1",
        createdAt: new Date("2026-09-26T05:06:15.316Z"),
      },
      {
        branchId,
        ingredientId,
        type: "OUT",
        quantity: 36000,
        balance: 0,
        reference: "DELETE-SUPPLIER",
        notes: "Delete Supplier Delivery: PT Kreasi Delapan Delapan",
        createdAt: new Date("2026-09-27T23:28:41.294Z"),
      },
      {
        branchId,
        ingredientId,
        type: "IN",
        quantity: 36000,
        balance: 36000,
        reference: "SUPPLIER-RECREATED",
        createdAt: new Date("2026-10-01T18:46:37.171Z"),
      },
      {
        branchId,
        ingredientId,
        type: "OUT",
        quantity: 14848,
        balance: 24120,
        reference: "OUT-1",
        createdAt: new Date("2026-10-04T01:38:20.264Z"),
      },
    ]);
    await testDb().insert(schema.inventory).values({ branchId, ingredientId, quantity: 24120 });

    const { saldo } = await readLedger(branchId);

    expect(saldo.get("OUT-1")).toBe(24120);
    for (const v of chronological(saldo, [
      "IN-1",
      "DELETE-SUPPLIER",
      "SUPPLIER-RECREATED",
      "OUT-1",
    ])) {
      expect(v).toBeGreaterThanOrEqual(0);
    }
    expect(Number(saldo.get("OUT-1")) - Number(saldo.get("SUPPLIER-RECREATED"))).toBe(-14848);
  });

  it("keeps recipe movements in a series separate from ingredient movements", async () => {
    const branchId = await seedBranch("Omoiyari Royal Plaza", "ORP");
    const ingredientId = await seedIngredient("Simple Syrup", "gr");

    const [category] = await testDb()
      .insert(schema.categories)
      .values({ code: `C${Math.random().toString(36).slice(2, 8).toUpperCase()}`, name: "Drink" })
      .returning({ id: schema.categories.id });
    const [recipe] = await testDb()
      .insert(schema.recipes)
      .values({
        name: "Iced Tea",
        code: `R${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        categoryId: category.id,
        basePrice: 8000,
        totalCogs: 3000,
      })
      .returning({ id: schema.recipes.id });

    await seedLedger([
      {
        branchId,
        ingredientId,
        type: "IN",
        quantity: 100,
        balance: 100,
        reference: "ING-1",
        createdAt: new Date("2026-10-03T10:00:00.000Z"),
      },
      {
        branchId,
        ingredientId: null,
        recipeId: recipe.id,
        type: "IN",
        quantity: 40,
        balance: 40,
        reference: "RECIPE-1",
        createdAt: new Date("2026-10-04T10:00:00.000Z"),
      },
    ]);
    await testDb().insert(schema.inventory).values({ branchId, ingredientId, quantity: 100 });
    await testDb()
      .insert(schema.recipeInventory)
      .values({ branchId, recipeId: recipe.id, quantity: 40 });

    const { saldo } = await readLedger(branchId);

    expect(saldo.get("ING-1")).toBe(100);
    expect(saldo.get("RECIPE-1")).toBe(40);
  });

  it("leaves a page empty rather than inventing rows", async () => {
    const branchId = await seedBranch("Omoiyari Wiyung", "WYG");
    const { data, total } = await getStockLedgerCore(auditor, { branchId, page: 0, limit: 50 });

    expect(data).toEqual([]);
    expect(total).toBe(0);
  });
});
