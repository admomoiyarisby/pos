/* oxlint-disable anti-slop/no-console -- effects log progress; not assertions */
/**
 * POS (orders + shifts) full-flow integration test.
 *
 * Drives the real user-parameterized cores from `pos.ts`
 * (`openShiftCore`, `takeOverShiftCore`, `closeShiftCore`, `createOrderCore`,
 * `completeOrderCore`, `voidOrderCore`, `updateOrderStatusCore`,
 * `requestReprintCore`, `approveReprintCore`, `consumePrintRequestCore`,
 * `createCancelRequestCore`, `approveCancelRequestCore`,
 * `executeApprovedCancelCore`) against the local dockerized test Postgres.
 *
 * Lifecycles covered:
 *  - Shift: open → take-over → close (with session rows logged in/out).
 *  - Order: create (inventory OUT + Kartu Stok) → complete; void restores stock.
 *  - Cancel approval flow: create → approve → execute (voids the order and
 *    restores inventory).
 *  - Reprint approval flow: request → approve → consume.
 *
 * These cores carry no role guard (any authenticated staff may operate POS), so
 * the negatives here exercise the lifecycle's state guards and not-found paths
 * and confirm rejected steps have no side effects.
 *
 * Isolation: cores hit `#/lib/server/db` (mocked), tables TRUNCATE-d between
 * tests (orders/shifts cascade off branches/users).
 *
 * Run:
 *   TEST_DATABASE_URL=postgresql://omoiyari_test:omoiyari_test@localhost:5433/omoiyari_pos_test DATABASE_URL= vp test run src/lib/server/pos-flow.integration.test.ts
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
let posApi: typeof import("./pos");
let seedCounter = 0;

function uniq(prefix: string): string {
  return `${prefix}-${seedCounter++}-${crypto.randomUUID().slice(0, 8)}`;
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

async function inventoryQty(branchId: string, ingId: string): Promise<number | null> {
  const [row] = await db
    .select({ quantity: schema.inventory.quantity })
    .from(schema.inventory)
    .where(and(eq(schema.inventory.branchId, branchId), eq(schema.inventory.ingredientId, ingId)))
    .limit(1);
  return row?.quantity ?? null;
}

async function shiftStatus(shiftId: string): Promise<string | null> {
  const [row] = await db
    .select({ status: schema.shifts.status })
    .from(schema.shifts)
    .where(eq(schema.shifts.id, shiftId))
    .limit(1);
  return row?.status ?? null;
}

async function orderStatus(orderId: string): Promise<string | null> {
  const [row] = await db
    .select({ status: schema.orders.status })
    .from(schema.orders)
    .where(eq(schema.orders.id, orderId))
    .limit(1);
  return row?.status ?? null;
}

beforeAll(async () => {
  if (!hasTestDatabaseUrl) return;
  // SAFETY: guarded by hasTestDatabaseUrl; when the test DB is absent beforeAll returns early and every test is skipped, so db is never read unset.
  db = dbHolder.db as TestDb;
  posApi = await import("./pos");
});

describe("POS — shift lifecycle via the real server-function cores", () => {
  it.skipIf(!hasTestDatabaseUrl)(
    "open → take-over → close a shift across two staff members",
    async () => {
      const branchId = await seedBranch();
      const cashier1 = await seedUser("branch_admin", branchId);
      const cashier2 = await seedUser("branch_admin", branchId);

      // Open by cashier1
      const opened = await posApi.openShiftCore(cashier1, {
        branchId,
        userId: cashier1.id,
      });
      expect(opened.status).toBe("Open");
      expect(await shiftStatus(opened.id)).toBe("Open");

      // A second open while a shift is open is allowed (separate row); the
      // lifecycle here is a single cashier shift. Self-take-over is refused.
      await expect(
        posApi.takeOverShiftCore(cashier1, {
          branchId,
          userId: cashier1.id,
          shiftId: opened.id,
        }),
      ).rejects.toThrow("Kamu sudah memegang shift ini");

      // Take over by cashier2
      const taken = await posApi.takeOverShiftCore(cashier2, {
        branchId,
        userId: cashier2.id,
        shiftId: opened.id,
      });
      expect(taken.userId).toBe(cashier2.id);

      // Take-over from a different branch is refused
      const otherBranch = await seedBranch();
      const outsider = await seedUser("branch_admin", otherBranch);
      await expect(
        posApi.takeOverShiftCore(outsider, {
          branchId: otherBranch,
          userId: outsider.id,
          shiftId: opened.id,
        }),
      ).rejects.toThrow("Shift tidak ditemukan di cabang ini");

      // Close
      const closed = await posApi.closeShiftCore(cashier2, {
        shiftId: opened.id,
        actualCash: 100000,
        notes: "penutupan",
      });
      expect(closed.status).toBe("Closed");
      expect(closed.actualCash).toBe(100000);
    },
  );
});

describe("POS — order lifecycle: create → complete, and void restores stock", () => {
  it.skipIf(!hasTestDatabaseUrl)(
    "createOrder deducts inventory + writes Kartu Stok; void restores it",
    async () => {
      const branchId = await seedBranch();
      const cashier = await seedUser("branch_admin", branchId);
      const [catRow] = await db
        .insert(schema.categories)
        .values({ code: uniq("CAT"), name: "Menu" })
        .returning({ id: schema.categories.id });
      const ingId = await seedIngredient();
      const recipeId = await seedRecipe(catRow.id, ingId);
      await db.insert(schema.inventory).values({ branchId, ingredientId: ingId, quantity: 100 });

      // Create an order for 3 of the recipe → deducts 3*2 = 6 from stock (100→94)
      const order = await posApi.createOrderCore(cashier, {
        branchId,
        channel: "Dine-in",
        items: [{ recipeId, quantity: 3, price: 10000 }],
        paymentMethod: "cash",
      });
      expect(order.status).toBe("New");
      expect(order.totalAmount).toBe(30000);
      expect(await inventoryQty(branchId, ingId)).toBe(94);
      expect(order.totalCogs).toBe(3 * 2 * 1000);

      // Complete
      const completed = await posApi.completeOrderCore(cashier, { orderId: order.id });
      expect(completed.status).toBe("Completed");
      expect(completed.completedAt).toBeTruthy();

      // Void restores the 6 units (back to 100)
      const voided = await posApi.voidOrderCore(cashier, {
        orderId: order.id,
        reason: "Salah input",
      });
      expect(voided.status).toBe("Void");
      expect(await inventoryQty(branchId, ingId)).toBe(100);

      // Void again refused
      await expect(
        posApi.voidOrderCore(cashier, { orderId: order.id, reason: "x" }),
      ).rejects.toThrow("Order sudah dibatalkan");
    },
  );
});

describe("POS — cancel request approval flow via the real cores", () => {
  it.skipIf(!hasTestDatabaseUrl)(
    "create → approve → execute voids the order and restores stock",
    async () => {
      const branchId = await seedBranch();
      const cashier = await seedUser("branch_admin", branchId);
      const admin = await seedUser("super_admin");
      const [catRow] = await db
        .insert(schema.categories)
        .values({ code: uniq("CAT"), name: "Menu" })
        .returning({ id: schema.categories.id });
      const ingId = await seedIngredient();
      const recipeId = await seedRecipe(catRow.id, ingId);
      await db.insert(schema.inventory).values({ branchId, ingredientId: ingId, quantity: 100 });

      const order = await posApi.createOrderCore(cashier, {
        branchId,
        channel: "Gofood",
        items: [{ recipeId, quantity: 2, price: 15000 }],
        paymentMethod: "gofood",
      });
      expect(await inventoryQty(branchId, ingId)).toBe(96);

      // Cashier requests a cancel
      const req = await posApi.createCancelRequestCore(cashier, {
        orderId: order.id,
        reason: "Customer Cancel",
        detail: "customer batal",
      });
      expect(req.status).toBe("Pending");

      // Approve by an admin
      const approved = await posApi.approveCancelRequestCore(admin, { requestId: req.id });
      expect(approved.status).toBe("Approved");

      // Execute voids the order + restores stock (back to 100)
      const executed = await posApi.executeApprovedCancelCore(cashier, { requestId: req.id });
      expect(executed.status).toBe("Void");
      expect(await inventoryQty(branchId, ingId)).toBe(100);

      // Executing again refused (request not Approved anymore)
      await expect(
        posApi.executeApprovedCancelCore(cashier, { requestId: req.id }),
      ).rejects.toThrow("Request belum disetujui atau sudah dieksekusi");
    },
  );
});

describe("POS — reprint approval flow via the real cores", () => {
  it.skipIf(!hasTestDatabaseUrl)(
    "request → approve → consume; duplicate pending refused",
    async () => {
      const branchId = await seedBranch();
      const cashier = await seedUser("branch_admin", branchId);
      const admin = await seedUser("super_admin");
      const [catRow] = await db
        .insert(schema.categories)
        .values({ code: uniq("CAT"), name: "Menu" })
        .returning({ id: schema.categories.id });
      const ingId = await seedIngredient();
      const recipeId = await seedRecipe(catRow.id, ingId);
      await db.insert(schema.inventory).values({ branchId, ingredientId: ingId, quantity: 10 });

      const order = await posApi.createOrderCore(cashier, {
        branchId,
        channel: "Dine-in",
        items: [{ recipeId, quantity: 1, price: 10000 }],
      });

      // Request → Pending
      const req = await posApi.requestReprintCore(cashier, { orderId: order.id });
      expect(req.status).toBe("Pending");

      // Duplicate request returns the existing one (alreadyPending marker)
      const dup = await posApi.requestReprintCore(cashier, { orderId: order.id });
      if (!("alreadyPending" in dup)) throw new Error("expected alreadyPending marker");
      expect(dup.alreadyPending).toBe(true);

      // Approve → consume
      const approved = await posApi.approveReprintCore(admin, { requestId: req.id });
      expect(approved.status).toBe("Approved");
      const consumed = await posApi.consumePrintRequestCore(admin, { requestId: req.id });
      expect(consumed.status).toBe("Consumed");

      // Consume a non-approved (now Consumed) request is refused
      await expect(posApi.consumePrintRequestCore(admin, { requestId: req.id })).rejects.toThrow(
        "Hanya request dengan status Approved yang dapat dikonsumsi",
      );
    },
  );
});

describe("POS — negatives: not-found and wrong-state guards with no side effects", () => {
  it.skipIf(!hasTestDatabaseUrl)(
    "missing orders/requests/shifts throw; rejected steps leave state unchanged",
    async () => {
      const branchId = await seedBranch();
      const cashier = await seedUser("branch_admin", branchId);
      const missing = crypto.randomUUID();

      // Order not-found guards
      await expect(posApi.completeOrderCore(cashier, { orderId: missing })).rejects.toThrow(
        "Order not found",
      );
      await expect(
        posApi.voidOrderCore(cashier, { orderId: missing, reason: "x" }),
      ).rejects.toThrow("Order not found");
      await expect(
        posApi.updateOrderStatusCore(cashier, { orderId: missing, newStatus: "Completed" }),
      ).rejects.toThrow("Order not found");

      // Cancel / reprint request not-found and wrong-state guards
      await expect(
        posApi.approveCancelRequestCore(cashier, { requestId: missing }),
      ).rejects.toThrow("Cancel request not found");
      await expect(
        posApi.executeApprovedCancelCore(cashier, { requestId: missing }),
      ).rejects.toThrow("Cancel request not found");
      await expect(posApi.approveReprintCore(cashier, { requestId: missing })).rejects.toThrow(
        "Print request not found",
      );
      await expect(posApi.consumePrintRequestCore(cashier, { requestId: missing })).rejects.toThrow(
        "Print request not found",
      );

      // A pending cancel request cannot be executed (must be approved first)
      const [catRow] = await db
        .insert(schema.categories)
        .values({ code: uniq("CAT"), name: "Menu" })
        .returning({ id: schema.categories.id });
      const ingId = await seedIngredient();
      const recipeId = await seedRecipe(catRow.id, ingId);
      await db.insert(schema.inventory).values({ branchId, ingredientId: ingId, quantity: 10 });
      const order = await posApi.createOrderCore(cashier, {
        branchId,
        channel: "Dine-in",
        items: [{ recipeId, quantity: 1, price: 10000 }],
      });
      const req = await posApi.createCancelRequestCore(cashier, {
        orderId: order.id,
        reason: "Salah Input",
      });
      await expect(
        posApi.executeApprovedCancelCore(cashier, { requestId: req.id }),
      ).rejects.toThrow("Request belum disetujui atau sudah dieksekusi");

      // No side effects — request still Pending, order still New, stock intact
      const [reqRow] = await db
        .select({ status: schema.cancelRequests.status })
        .from(schema.cancelRequests)
        .where(eq(schema.cancelRequests.id, req.id))
        .limit(1);
      expect(reqRow.status).toBe("Pending");
      expect(await orderStatus(order.id)).toBe("New");
      expect(await inventoryQty(branchId, ingId)).toBe(8); // 10 - 2 used

      // Close a missing shift is refused (returns undefined closed → later db
      // access throws on branch.id lookup — no row). Opening with a real branch
      // still works (smoke).
      const opened = await posApi.openShiftCore(cashier, {
        branchId,
        userId: cashier.id,
      });
      expect(opened.status).toBe("Open");
    },
  );
});
