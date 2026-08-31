/* oxlint-disable anti-slop/no-console -- effects log progress; not assertions */
/**
 * Purchase Orders full-flow integration test.
 *
 * Drives the real user-parameterized cores from `scm.ts`
 * (`createPurchaseOrderCore`, `updatePurchaseOrderCore`,
 * `sendPurchaseOrderCore`, `receivePurchaseOrderCore`,
 * `cancelPurchaseOrderCore`) against the local dockerized test Postgres. Each
 * core is the exact business logic the `createServerFn` transport endpoint
 * runs — the only thing bypassed is `requireRole()` (HTTP session), replaced
 * by an explicit `user` argument per call, so role guards are fully exercised.
 * All cores throw on failure.
 *
 * Lifecycle: Draft → (update) → Sent → Partial → Completed; cancel from any
 * non-Completed state. No stock effects — PO is an order document only.
 *
 * Isolation: the cores hit the module-level `db` from `#/lib/server/db`, so
 * that module is mocked to return a drizzle instance over a connection to the
 * local test database, and shared tables are TRUNCATE-d between tests.
 *
 * Run:  TEST_DATABASE_URL=postgresql://omoiyari_test:omoiyari_test@localhost:5433/omoiyari_pos_test DATABASE_URL= vp test run src/lib/server/purchase-orders-flow.integration.test.ts
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
}));

setupFlowHarness(dbHolder);

let db: TestDb;
let scm: typeof import("./scm");
let seedCounter = 0;

function uniq(prefix: string): string {
  return `${prefix}-${seedCounter++}-${crypto.randomUUID().slice(0, 8)}`;
}

async function seedBranch(code: string): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(schema.branches).values({
    id,
    code,
    name: `ITS ${code}`,
    location: "Test",
    type: "Outlet",
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

async function poStatus(id: string): Promise<{ status: string }> {
  const [row] = await db
    .select({ status: schema.purchaseOrders.status })
    .from(schema.purchaseOrders)
    .where(eq(schema.purchaseOrders.id, id))
    .limit(1);
  if (!row) throw new Error(`PO ${id} not found`);
  return row;
}

beforeAll(async () => {
  if (!hasTestDatabaseUrl) return;
  // SAFETY: guarded by hasTestDatabaseUrl; when the test DB is absent beforeAll returns early and every test is skipped, so db is never read unset.
  db = dbHolder.db as TestDb;
  scm = await import("./scm");
});

describe("Purchase orders — full lifecycle via the real server-function cores", () => {
  it.skipIf(!hasTestDatabaseUrl)(
    "happy path: create → update → send → partial receive → full receive → Completed",
    async () => {
      const fromBranch = await seedBranch(uniq("PO-AF"));
      const toBranch = await seedBranch(uniq("PO-AT"));
      const ingredient = await seedIngredient(uniq("PO-AING"));

      const adminPusat = await seedUser("admin_pusat");

      // 1. Create — Draft with items; totalPrice = unitPrice × quantity
      const po = await scm.createPurchaseOrderCore(adminPusat, {
        code: uniq("PO/A"),
        fromBranchId: fromBranch,
        toBranchId: toBranch,
        items: [{ ingredientId: ingredient, quantity: 10, unitPrice: 500 }],
        notes: "order awal",
      });
      expect(po.status).toBe("Draft");
      expect(po.createdBy).toBe(adminPusat.id);

      const [item] = await db
        .select()
        .from(schema.purchaseOrderItems)
        .where(eq(schema.purchaseOrderItems.purchaseOrderId, po.id));
      expect(item.quantity).toBe(10);
      expect(item.unitPrice).toBe(500);
      expect(item.totalPrice).toBe(5000);

      // 2. Update while Draft — items replaced, notes updated
      const updated = await scm.updatePurchaseOrderCore(adminPusat, {
        id: po.id,
        notes: "order direvisi",
        items: [{ ingredientId: ingredient, quantity: 12, unitPrice: 550 }],
      });
      expect(updated.success).toBe(true);
      const [revised] = await db
        .select()
        .from(schema.purchaseOrderItems)
        .where(eq(schema.purchaseOrderItems.purchaseOrderId, po.id));
      expect(revised.quantity).toBe(12);
      expect(revised.totalPrice).toBe(6600);

      // 3. Send — Draft → Sent
      const sent = await scm.sendPurchaseOrderCore(adminPusat, { id: po.id });
      expect(sent.status).toBe("Sent");

      // Editing/sending a non-Draft PO is refused
      await expect(
        scm.updatePurchaseOrderCore(adminPusat, { id: po.id, notes: "telat" }),
      ).rejects.toThrow("Only Draft PO can be edited");
      await expect(scm.sendPurchaseOrderCore(adminPusat, { id: po.id })).rejects.toThrow(
        "Only Draft PO can be sent",
      );

      // 4. Partial receive — Sent → Partial. The update above replaced the
      // item rows, so re-fetch the live row before receiving.
      const [liveItem] = await db
        .select()
        .from(schema.purchaseOrderItems)
        .where(eq(schema.purchaseOrderItems.purchaseOrderId, po.id))
        .limit(1);
      const partial = await scm.receivePurchaseOrderCore(adminPusat, {
        id: po.id,
        items: [{ itemId: liveItem.id, receivedQuantity: 5 }],
      });
      expect(partial.status).toBe("Partial");
      const [afterPartial] = await db
        .select({ receivedQuantity: schema.purchaseOrderItems.receivedQuantity })
        .from(schema.purchaseOrderItems)
        .where(eq(schema.purchaseOrderItems.id, liveItem.id));
      expect(afterPartial.receivedQuantity).toBe(5);

      // 5. Full receive — Partial → Completed
      const completed = await scm.receivePurchaseOrderCore(adminPusat, {
        id: po.id,
        items: [{ itemId: liveItem.id, receivedQuantity: 12 }],
      });
      expect(completed.status).toBe("Completed");
      expect((await poStatus(po.id)).status).toBe("Completed");

      // Completed PO cannot be cancelled
      await expect(scm.cancelPurchaseOrderCore(adminPusat, { id: po.id })).rejects.toThrow(
        "Completed PO cannot be cancelled",
      );
    },
  );

  it.skipIf(!hasTestDatabaseUrl)("cancellation from Draft reaches Cancelled", async () => {
    const fromBranch = await seedBranch(uniq("PO-CF"));
    const toBranch = await seedBranch(uniq("PO-CT"));
    const ingredient = await seedIngredient(uniq("PO-CING"));
    const adminPusat = await seedUser("admin_pusat");

    const po = await scm.createPurchaseOrderCore(adminPusat, {
      code: uniq("PO/C"),
      fromBranchId: fromBranch,
      toBranchId: toBranch,
      items: [{ ingredientId: ingredient, quantity: 5 }],
    });
    const cancelled = await scm.cancelPurchaseOrderCore(adminPusat, { id: po.id });
    expect(cancelled.status).toBe("Cancelled");
  });
});

describe("Purchase orders — wrong-role and state-guard negatives", () => {
  it.skipIf(!hasTestDatabaseUrl)(
    "create/update/send/receive/cancel all reject non-central roles",
    async () => {
      const fromBranch = await seedBranch(uniq("PO-NF"));
      const toBranch = await seedBranch(uniq("PO-NT"));
      const ingredient = await seedIngredient(uniq("PO-NING"));

      const adminPusat = await seedUser("admin_pusat");
      const branchAdmin = await seedUser("branch_admin");
      const areaManager = await seedUser("area_manager");

      const createInput = {
        code: uniq("PO/N"),
        fromBranchId: fromBranch,
        toBranchId: toBranch,
        items: [{ ingredientId: ingredient, quantity: 5 }],
      };

      await expect(scm.createPurchaseOrderCore(branchAdmin, createInput)).rejects.toThrow(
        "Forbidden: insufficient role",
      );
      await expect(scm.createPurchaseOrderCore(areaManager, createInput)).rejects.toThrow(
        "Forbidden: insufficient role",
      );

      const po = await scm.createPurchaseOrderCore(adminPusat, createInput);
      const [item] = await db
        .select()
        .from(schema.purchaseOrderItems)
        .where(eq(schema.purchaseOrderItems.purchaseOrderId, po.id));

      await expect(
        scm.updatePurchaseOrderCore(branchAdmin, { id: po.id, notes: "x" }),
      ).rejects.toThrow("Forbidden: insufficient role");
      await expect(scm.sendPurchaseOrderCore(areaManager, { id: po.id })).rejects.toThrow(
        "Forbidden: insufficient role",
      );
      await expect(
        scm.receivePurchaseOrderCore(branchAdmin, {
          id: po.id,
          items: [{ itemId: item.id, receivedQuantity: 5 }],
        }),
      ).rejects.toThrow("Forbidden: insufficient role");
      await expect(scm.cancelPurchaseOrderCore(branchAdmin, { id: po.id })).rejects.toThrow(
        "Forbidden: insufficient role",
      );

      // No side effects: still Draft
      expect((await poStatus(po.id)).status).toBe("Draft");
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "nonexistent and wrong-state transitions are refused",
    async () => {
      const fromBranch = await seedBranch(uniq("PO-MF"));
      const toBranch = await seedBranch(uniq("PO-MT"));
      const ingredient = await seedIngredient(uniq("PO-MING"));
      const adminPusat = await seedUser("admin_pusat");
      const missing = crypto.randomUUID();

      await expect(scm.updatePurchaseOrderCore(adminPusat, { id: missing })).rejects.toThrow(
        "PO not found",
      );
      await expect(scm.sendPurchaseOrderCore(adminPusat, { id: missing })).rejects.toThrow(
        "PO not found",
      );
      await expect(
        scm.receivePurchaseOrderCore(adminPusat, { id: missing, items: [] }),
      ).rejects.toThrow("PO not found");
      await expect(scm.cancelPurchaseOrderCore(adminPusat, { id: missing })).rejects.toThrow(
        "PO not found",
      );

      // receive requires Sent/Partial
      const po = await scm.createPurchaseOrderCore(adminPusat, {
        code: uniq("PO/M"),
        fromBranchId: fromBranch,
        toBranchId: toBranch,
        items: [{ ingredientId: ingredient, quantity: 5 }],
      });
      await expect(
        scm.receivePurchaseOrderCore(adminPusat, { id: po.id, items: [] }),
      ).rejects.toThrow("PO must be Sent or Partial to receive");
    },
  );
});
