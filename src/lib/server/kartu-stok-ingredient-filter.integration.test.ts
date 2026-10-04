/**
 * Kartu Stok per-item filter — the contract the page relies on to read one
 * item's Saldo as a series.
 *
 * The page used to show every item at once, so the Saldo column mixed unrelated
 * balances and an `OUT` row sitting under another item's larger stock read as an
 * increase. Free-text `search` cannot stand in for the filter: it also matches
 * `reference`, `notes` and `orders.order_code`, so rows for other items survive.
 *
 * Driven through `stockLedgerQuery` and `stockLedgerInputFromSearch` — the two
 * functions the route loader and the page component share. The server args that
 * `stockLedgerQuery` builds are handed to `getStockLedgerCore` (ADR 0015's
 * session-free seam) rather than to the `createServerFn` transport wrapper,
 * which needs a Start request context a vitest process does not have. So the
 * plumbing under test is exactly the plumbing the page uses.
 *
 * Run:
 *   TEST_DATABASE_URL=postgresql://omoiyari_test:omoiyari_test@localhost:5433/omoiyari_pos_test DATABASE_URL= vp test run src/lib/server/kartu-stok-ingredient-filter.integration.test.ts
 */

import { beforeAll, describe, expect, it, vi } from "vite-plus/test";
import * as schema from "#/db/schema";
import { getTestDatabaseUrl } from "./test-database";
import type { TestDb } from "./integration-test-harness";
import { setupFlowHarness } from "./integration-test-harness";
import {
  stockLedgerInputFromSearch,
  stockLedgerQuery,
  stockLedgerSearchSchema,
} from "#/lib/stock-ledger-query";
import { getStockLedgerCore } from "./inventory";
import type { AppUser } from "./auth";
import type { GetStockLedgerData } from "./inventory";

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
    throw new Error("requireAuth should not be called — the core receives an explicit user");
  },
  requireRole: async () => {
    throw new Error("requireRole should not be called — the core receives an explicit user");
  },
  getCurrentUserRaw: async () => null,
}));

setupFlowHarness(dbHolder);

let db: TestDb;

const auditor: AppUser = {
  id: crypto.randomUUID(),
  email: "auditor@test.local",
  name: "Ledger Auditor",
  role: "super_admin",
  status: "Active",
};

beforeAll(async () => {
  if (!hasTestDatabaseUrl) return;
  // SAFETY: guarded by hasTestDatabaseUrl; when the test DB is absent beforeAll returns early and every test is skipped, so db is never read unset.
  db = dbHolder.db as TestDb;
});

type Row = { id: string; ingredientId: string | null; balance: number };

async function seedBranch(name: string, code: string): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(schema.branches).values({ id, code, name, location: "Test", type: "Outlet" });
  return id;
}

async function seedIngredient(name: string): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(schema.ingredients).values({
    id,
    code: `F${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    name,
    category: "Packaging",
    skuType: "RM",
    purchaseUnit: "pack",
    stockUnit: "pack",
    conversionFactor: 1,
    averageCost: 1000,
  });
  return id;
}

/**
 * Run the page's real query for a URL search object: build the query exactly as
 * the component does, then execute the server args it produced.
 */
async function readLedger(search: Parameters<typeof stockLedgerInputFromSearch>[0]) {
  const { queryKey } = stockLedgerQuery(stockLedgerInputFromSearch(search));
  // SAFETY: `stockLedgerQuery` builds `queryKey` as ["stock-ledger", args] with
  // `args` typed as GetStockLedgerData, so index 1 is that object.
  const args = queryKey[1] as GetStockLedgerData;
  const result = await getStockLedgerCore(auditor, args);
  return { ...result, args, queryKey };
}

describe.skipIf(!hasTestDatabaseUrl)("Kartu Stok — per-item filter", () => {
  it("returns only the picked item's rows, so the Saldo reads as a series", async () => {
    const branchId = await seedBranch("Central Filter", "CFILT");
    const kresek = await seedIngredient("Plastik Kresek 20");
    const other = await seedIngredient("Plastik Kresek 25");

    for (const r of [
      {
        ingredientId: kresek,
        type: "IN" as const,
        quantity: 31,
        balance: 31,
        at: "2026-10-02T18:53:33.031Z",
      },
      {
        ingredientId: kresek,
        type: "OUT" as const,
        quantity: 2,
        balance: 29,
        at: "2026-10-02T23:34:03.782Z",
      },
      {
        ingredientId: other,
        type: "IN" as const,
        quantity: 500,
        balance: 500,
        at: "2026-10-03T01:00:00.000Z",
      },
      {
        ingredientId: other,
        type: "OUT" as const,
        quantity: 30,
        balance: 470,
        at: "2026-10-03T02:00:00.000Z",
      },
    ]) {
      await db.insert(schema.stockLedger).values({
        branchId,
        ingredientId: r.ingredientId,
        type: r.type,
        quantity: r.quantity,
        balance: r.balance,
        reference: `REF-${r.ingredientId.slice(0, 6)}`,
        notes: r.type === "IN" ? "Supplier Delivery: Plastik Wiyung" : "Kirim Jambangan 03/10",
        createdAt: new Date(r.at),
      });
    }

    const unfiltered = await readLedger({ branchId });
    expect(unfiltered.total).toBe(4);

    const filtered = await readLedger({ ingredientId: kresek, branchId });
    expect(filtered.total).toBe(2);
    expect(filtered.data.map((r: Row) => r.ingredientId)).toEqual([kresek, kresek]);
    // Newest first, and the Saldo now reads as a series: 29 below 31.
    expect(filtered.data.map((r: Row) => r.balance)).toEqual([29, 31]);
  });

  it("narrows further than a free-text search can", async () => {
    const branchId = await seedBranch("Central Search", "CSEARCH");
    const kresek = await seedIngredient("Kresek 20");
    const other = await seedIngredient("Kresek 25");

    // Both rows carry the same phrase in `notes`, and the same reference, so a
    // text search cannot separate them. This is why the page needs an id filter.
    await db.insert(schema.stockLedger).values([
      {
        branchId,
        ingredientId: kresek,
        type: "OUT",
        quantity: 2,
        balance: 29,
        reference: "ADJ-KIRIMJAMBANGAN",
        notes: "Kirim Jamba 03/10",
        createdAt: new Date("2026-10-02T23:34:03.782Z"),
      },
      {
        branchId,
        ingredientId: other,
        type: "OUT",
        quantity: 2,
        balance: 470,
        reference: "ADJ-KIRIMJAMBANGAN",
        notes: "Kirim Jamba 03/10",
        createdAt: new Date("2026-10-03T02:00:00.000Z"),
      },
    ]);

    const byText = await readLedger({ search: "Jamba", branchId });
    expect(byText.total).toBe(2);

    const byId = await readLedger({ search: "Jamba", ingredientId: kresek, branchId });
    expect(byId.total).toBe(1);
    expect(byId.data[0].ingredientId).toBe(kresek);
  });

  it("puts the filter in the query key, so the loader and the page cannot disagree", () => {
    const all = stockLedgerQuery({ page: 0 });
    const filtered = stockLedgerQuery({ page: 0, ingredientId: "abc" });
    const blank = stockLedgerQuery({ page: 0, ingredientId: "" });

    expect(JSON.stringify(all.queryKey)).not.toBe(JSON.stringify(filtered.queryKey));
    // An unset filter and a blank one must hash to the same key, or the loader
    // pre-fetches a slice the page never asks for.
    expect(JSON.stringify(blank.queryKey)).toBe(JSON.stringify(all.queryKey));
  });

  it("degrades a junk ingredientId out of the URL instead of breaking", () => {
    expect(stockLedgerSearchSchema.parse({ ingredientId: "abc" }).ingredientId).toBe("abc");
    // A number is not a uuid; the param is `.catch`-guarded, so it drops out of
    // the query rather than reaching the server.
    expect(stockLedgerSearchSchema.parse({ ingredientId: 42 }).ingredientId).toBeUndefined();
    expect(stockLedgerSearchSchema.parse({ page: "not-a-page" }).page).toBeUndefined();
  });
});
