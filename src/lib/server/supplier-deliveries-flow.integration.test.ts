/* oxlint-disable anti-slop/no-console -- effects log progress; not assertions */
/**
 * Supplier deliveries (Barang Masuk) full-flow integration test.
 *
 * Drives the real user-parameterized cores from `supplier-deliveries.ts`
 * (`createSupplierDeliveryCore`, `updateSupplierDeliveryCore`,
 * `deleteSupplierDeliveryCore`, `completeSupplierDeliveryCore`) against the
 * local dockerized test Postgres. Each core is the exact business logic the
 * `createServerFn` transport endpoint runs — the only thing bypassed is
 * `requireRole()` (HTTP session), replaced by an explicit `user` argument per
 * call, so the role guards are fully exercised. All cores throw on failure.
 *
 * The lifecycle is CRUD rather than an FSM: create (stock IN at the CENTRAL
 * warehouse + ledger) → update (revert + re-apply) → complete (Pending Invoice
 * → Completed) → delete (deduct + remove row).
 *
 * Isolation: the cores hit the module-level `db` from `#/lib/server/db`, so
 * that module is mocked to return a drizzle instance over a connection to the
 * local test database, and shared tables are TRUNCATE-d between tests. No
 * outer transaction is held open, so the cores' own transactions behave
 * normally and a failing inner step only rolls back its own work.
 *
 * Run:  TEST_DATABASE_URL=postgresql://omoiyari_test:omoiyari_test@localhost:5433/omoiyari_pos_test DATABASE_URL= vp test run src/lib/server/supplier-deliveries-flow.integration.test.ts
 */

import { beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { and, eq } from "drizzle-orm";
import * as schema from "#/db/schema";
import { getTestDatabaseUrl } from "./test-database";
import type { TestDb } from "./integration-test-harness";
import { setupFlowHarness } from "./integration-test-harness";
import type { AppUser, UserRole } from "./auth";

const testDatabaseUrl = getTestDatabaseUrl();
const hasTestDatabaseUrl = Boolean(testDatabaseUrl);

// Route the cores' module-level `db` to a drizzle instance on the test
// database. beforeAll/beforeEach set it before any core call.
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

// The cores take an explicit user argument, so `requireAuth()` / `requireRole()`
// (and the better-auth instance they pull in) is never needed in this test.
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
let sd: typeof import("./supplier-deliveries");
let seedCounter = 0;

function uniq(prefix: string): string {
  return `${prefix}-${seedCounter++}-${crypto.randomUUID().slice(0, 8)}`;
}

async function seedBranch(code: string, type: "Central" | "Outlet" = "Outlet"): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(schema.branches).values({
    id,
    code,
    name: `ITS ${code}`,
    location: "Test",
    type,
  });
  return id;
}

async function seedIngredient(code: string): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(schema.ingredients).values({
    id,
    code,
    name: `Ingredient ${code}`,
    category: "Fresh",
    skuType: "RM",
    purchaseUnit: "pcs",
    stockUnit: "pcs",
    conversionFactor: 1,
    averageCost: 1000,
  });
  return id;
}

async function seedSupplier(name: string): Promise<void> {
  await db.insert(schema.suppliers).values({ code: uniq("SUP"), name });
}

async function seedUser(role: UserRole): Promise<AppUser> {
  const id = crypto.randomUUID();
  await db.insert(schema.users).values({
    id,
    name: `ITS ${role}`,
    email: `its-${id}@pos.test`,
    role,
  });
  return { id, email: `its-${id}@pos.test`, name: `ITS ${role}`, role, status: "Active" };
}

async function getStock(branchId: string, ingredientId: string): Promise<number> {
  const [row] = await db
    .select({ quantity: schema.inventory.quantity })
    .from(schema.inventory)
    .where(
      and(eq(schema.inventory.branchId, branchId), eq(schema.inventory.ingredientId, ingredientId)),
    )
    .limit(1);
  return row?.quantity ?? 0;
}

async function ledgerRows(reference: string) {
  return db
    .select({
      type: schema.stockLedger.type,
      quantity: schema.stockLedger.quantity,
      balance: schema.stockLedger.balance,
      notes: schema.stockLedger.notes,
    })
    .from(schema.stockLedger)
    .where(eq(schema.stockLedger.reference, reference));
}

beforeAll(async () => {
  if (!hasTestDatabaseUrl) return;
  // SAFETY: guarded by hasTestDatabaseUrl; when the test DB is absent beforeAll returns early and every test is skipped, so db is never read unset.
  db = dbHolder.db as TestDb;
  sd = await import("./supplier-deliveries");
});

describe("Supplier deliveries — full lifecycle via the real server-function cores", () => {
  it.skipIf(!hasTestDatabaseUrl)(
    "happy path: create (central stock IN) → update → complete → delete",
    async () => {
      // The CENTRAL warehouse branch is required by getCentralBranchId().
      const central = await seedBranch("CENTRAL", "Central");
      const ingredient = await seedIngredient(uniq("SD-ING"));
      await seedSupplier("PT Supplier A");
      await seedSupplier("PT Supplier B");

      const adminPusat = await seedUser("admin_pusat");

      // 1. Create — delivery recorded as Pending Invoice, central stock IN
      const delivery = await sd.createSupplierDeliveryCore(adminPusat, {
        supplierName: "PT Supplier A",
        ingredientId: ingredient,
        quantity: 10,
        price: 5000,
      });
      expect(delivery.status).toBe("Pending Invoice");
      expect(delivery.receivedBy).toBe(adminPusat.id);

      // Supplier looked up by name
      const [supplier] = await db
        .select({ name: schema.suppliers.name })
        .from(schema.suppliers)
        .where(eq(schema.suppliers.id, delivery.supplierId!));
      expect(supplier.name).toBe("PT Supplier A");

      expect(await getStock(central, ingredient)).toBe(10);
      let ledger = await ledgerRows(delivery.id);
      expect(ledger).toHaveLength(1);
      expect(ledger[0]).toEqual(
        expect.objectContaining({
          type: "IN",
          quantity: 10,
          balance: 10,
          notes: "Supplier Delivery: PT Supplier A",
        }),
      );

      // 2. Update — old quantity reverted, new quantity applied (net +2)
      const updated = await sd.updateSupplierDeliveryCore(adminPusat, {
        id: delivery.id,
        quantity: 12,
        price: 5500,
        supplierName: "PT Supplier B",
      });
      expect(updated.quantity).toBe(12);
      expect(updated.price).toBe(5500);
      expect(updated.supplierName).toBe("PT Supplier B");

      expect(await getStock(central, ingredient)).toBe(12);
      ledger = await ledgerRows(delivery.id);
      expect(ledger).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "OUT", quantity: 10, balance: 0 }), // revert
          expect.objectContaining({ type: "IN", quantity: 12, balance: 12 }), // re-apply
        ]),
      );

      // 3. Complete — Pending Invoice → Completed; double-complete refused
      const completed = await sd.completeSupplierDeliveryCore(adminPusat, { id: delivery.id });
      expect(completed.success).toBe(true);
      const [row] = await db
        .select({ status: schema.supplierDeliveries.status })
        .from(schema.supplierDeliveries)
        .where(eq(schema.supplierDeliveries.id, delivery.id));
      expect(row.status).toBe("Completed");

      await expect(
        sd.completeSupplierDeliveryCore(adminPusat, { id: delivery.id }),
      ).rejects.toThrow("Delivery already completed");

      // 4. Delete — stock deducted back to zero, row removed
      const deleted = await sd.deleteSupplierDeliveryCore(adminPusat, { id: delivery.id });
      expect(deleted.success).toBe(true);
      expect(await getStock(central, ingredient)).toBe(0);
      const [gone] = await db
        .select({ id: schema.supplierDeliveries.id })
        .from(schema.supplierDeliveries)
        .where(eq(schema.supplierDeliveries.id, delivery.id));
      expect(gone).toBeUndefined();

      ledger = await ledgerRows(delivery.id);
      expect(ledger).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "OUT",
            quantity: 12,
            balance: 0,
            notes: "Delete Supplier Delivery: PT Supplier B",
          }),
        ]),
      );
    },
  );
});

describe("Supplier deliveries — wrong-role actors are rejected", () => {
  it.skipIf(!hasTestDatabaseUrl)(
    "create/update/delete/complete all reject non-central roles without side effects",
    async () => {
      const central = await seedBranch("CENTRAL", "Central");
      const ingredient = await seedIngredient(uniq("SD-NING"));
      await seedSupplier("PT Supplier A");

      const adminPusat = await seedUser("admin_pusat");
      const branchAdmin = await seedUser("branch_admin");
      const areaManager = await seedUser("area_manager");

      const input = {
        supplierName: "PT Supplier A",
        ingredientId: ingredient,
        quantity: 10,
        price: 5000,
      };

      // Both non-central roles are refused at create
      await expect(sd.createSupplierDeliveryCore(branchAdmin, input)).rejects.toThrow(
        "Forbidden: insufficient role",
      );
      await expect(sd.createSupplierDeliveryCore(areaManager, input)).rejects.toThrow(
        "Forbidden: insufficient role",
      );
      expect(await getStock(central, ingredient)).toBe(0); // nothing written

      // A real create so update/delete/complete can be probed
      const delivery = await sd.createSupplierDeliveryCore(adminPusat, input);

      await expect(
        sd.updateSupplierDeliveryCore(branchAdmin, { id: delivery.id, quantity: 5 }),
      ).rejects.toThrow("Forbidden: insufficient role");
      await expect(
        sd.completeSupplierDeliveryCore(areaManager, { id: delivery.id }),
      ).rejects.toThrow("Forbidden: insufficient role");
      await expect(sd.deleteSupplierDeliveryCore(branchAdmin, { id: delivery.id })).rejects.toThrow(
        "Forbidden: insufficient role",
      );

      // No side effects: still Pending Invoice, stock untouched
      const [row] = await db
        .select({ status: schema.supplierDeliveries.status })
        .from(schema.supplierDeliveries)
        .where(eq(schema.supplierDeliveries.id, delivery.id));
      expect(row.status).toBe("Pending Invoice");
      expect(await getStock(central, ingredient)).toBe(10);

      // Nonexistent ids are refused on every mutation
      const missing = crypto.randomUUID();
      await expect(
        sd.updateSupplierDeliveryCore(adminPusat, { id: missing, quantity: 5 }),
      ).rejects.toThrow("Supplier delivery not found");
      await expect(sd.completeSupplierDeliveryCore(adminPusat, { id: missing })).rejects.toThrow(
        "Supplier delivery not found",
      );
      await expect(sd.deleteSupplierDeliveryCore(adminPusat, { id: missing })).rejects.toThrow(
        "Supplier delivery not found",
      );
    },
  );
});
