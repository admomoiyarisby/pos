import { beforeAll, describe, expect, it, vi } from "vite-plus/test";
import * as schema from "#/db/schema";
import { getTestDatabaseUrl } from "./test-database";
import type { TestDb } from "./integration-test-harness";
import { setupFlowHarness } from "./integration-test-harness";
import type { AppUser, UserRole } from "./auth";

/**
 * Availability reads vs the branch catalog (ADR 0023).
 *
 * `isBranchVisible` decides which items a branch COUNTS. It says nothing about
 * which stock the branch HOLDS — a transfer-in, a supplier delivery, a manual
 * adjustment or `ensureInventoryRow` on a sale all write a stock record without
 * reading the flag. A reader that hides held stock therefore lies about
 * availability, and the POS believed it: an outlet's "Sendok Plastik" card
 * showed HABIS while that branch held 300 pcs of "Sendok Makan", because the
 * item had been flagged out of the outlet catalogs for a day.
 *
 * The two scopes are deliberate and must stay apart:
 *
 *   the inventory LIST    -> the branch catalog, flags respected
 *   an AVAILABILITY read  -> what the branch holds (`includeNonCatalog: true`)
 *
 * Run: TEST_DATABASE_URL=postgresql://omoiyari_test:omoiyari_test@localhost:5433/omoiyari_pos_test DATABASE_URL= vp test run src/lib/server/inventory-availability-scope.integration.test.ts
 */

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

// The core receives an explicit user, so requireAuth must never be called.
vi.mock("#/lib/server/auth", () => ({
  requireAuth: async () => {
    throw new Error("requireAuth should not be called — the core receives an explicit user");
  },
  requireRole: async () => {
    throw new Error("requireRole should not be called — the core receives an explicit user");
  },
  getCurrentUserRaw: async () => {
    throw new Error("getCurrentUserRaw should not be called — the core receives an explicit user");
  },
}));

setupFlowHarness(dbHolder);

let db: TestDb;
let inv: typeof import("./inventory");
let seedCounter = 0;

function uniq(prefix: string): string {
  return `${prefix}-${seedCounter++}-${crypto.randomUUID().slice(0, 8)}`;
}

async function seedOutlet(code: string): Promise<string> {
  const id = crypto.randomUUID();
  await db
    .insert(schema.branches)
    .values({ id, code, name: `AV ${code}`, location: "Test", type: "Outlet" });
  return id;
}

async function seedIngredient(code: string, isBranchVisible: boolean): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(schema.ingredients).values({
    id,
    code,
    name: `Ingredient ${code}`,
    category: "Packaging",
    skuType: "RM",
    purchaseUnit: "pcs",
    stockUnit: "pcs",
    conversionFactor: 1,
    averageCost: 1000,
    isBranchVisible,
  });
  return id;
}

async function seedInventory(branchId: string, ingredientId: string, quantity: number) {
  await db.insert(schema.inventory).values({ branchId, ingredientId, quantity });
}

async function seedUser(role: UserRole): Promise<AppUser> {
  const id = crypto.randomUUID();
  await db
    .insert(schema.users)
    .values({ id, name: `AV ${role}`, email: `av-${id}@pos.test`, role });
  return { id, email: `av-${id}@pos.test`, name: `AV ${role}`, role, status: "Active" };
}

beforeAll(async () => {
  if (!hasTestDatabaseUrl) return;
  // SAFETY: guarded by hasTestDatabaseUrl; when the test DB is absent beforeAll returns early and every test is skipped, so db is never read unset.
  db = dbHolder.db as TestDb;
  inv = await import("./inventory");
});

describe("availability reads see what the branch holds, not its catalog", () => {
  it.skipIf(!hasTestDatabaseUrl)(
    "the POS read returns stock for an item flagged out of the outlet catalog",
    async () => {
      const outlet = await seedOutlet(uniq("AV-OUT"));
      const flaggedOut = await seedIngredient(uniq("AV-FOUT"), false);
      await seedInventory(outlet, flaggedOut, 300);

      const { data } = await inv.getInventoryCore(await seedUser("super_admin"), {
        branchId: outlet,
        limit: 1000,
        includeNonCatalog: true,
      });

      const row = data.find((r) => r.ingredientId === flaggedOut);
      expect(row?.quantity).toBe(300);
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "the catalog-scoped list still hides it, and still shows what the catalog names",
    async () => {
      const outlet = await seedOutlet(uniq("AV-OUT"));
      const inCatalog = await seedIngredient(uniq("AV-IN"), true);
      const flaggedOut = await seedIngredient(uniq("AV-FOUT"), false);
      await seedInventory(outlet, inCatalog, 40);
      await seedInventory(outlet, flaggedOut, 300);

      const { data } = await inv.getInventoryCore(await seedUser("super_admin"), {
        branchId: outlet,
        limit: 1000,
      });
      const ids = data.map((r) => r.ingredientId);

      expect(ids).toContain(inCatalog);
      expect(ids).not.toContain(flaggedOut);
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "a catalog item the branch never received is still absent — availability stays truthful",
    async () => {
      const outlet = await seedOutlet(uniq("AV-OUT"));
      const neverStocked = await seedIngredient(uniq("AV-NOSTK"), true);

      const { data } = await inv.getInventoryCore(await seedUser("super_admin"), {
        branchId: outlet,
        limit: 1000,
        includeNonCatalog: true,
      });

      expect(data.map((r) => r.ingredientId)).not.toContain(neverStocked);
    },
  );
});
