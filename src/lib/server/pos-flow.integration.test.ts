/* oxlint-disable anti-slop/no-console -- effects log progress; not assertions */
/**
 * POS (orders + shifts) full-flow integration test.
 *
 * Drives the real user-parameterized cores from `pos.ts`
 * (`openShiftCore`, `takeOverShiftCore`, `closeShiftCore`, `createOrderCore`,
 * `completeOrderCore`, `voidOrderCore`, `updateOrderStatusCore`,
 * `requestReprintCore`, `approveReprintCore`, `consumePrintRequestCore`,
 * `createCancelRequestCore`, `approveCancelRequestCore`) against the local
 * dockerized test Postgres.
 *
 * Lifecycles covered:
 *  - Shift: open → take-over → close (with session rows logged in/out).
 *  - Order: create (inventory OUT + Kartu Stok) → complete; void restores stock.
 *  - Cancel approval flow: create → approve, where approving is the step that
 *    voids the order and restores inventory (no separate push). Also covers the
 *    role guard on approve/reject and a concurrent double-approval.
 *  - Reprint approval flow: request → approve → consume.
 *
 * Most of these cores carry no role guard (any authenticated staff may operate
 * POS), so the negatives there exercise the lifecycle's state guards and
 * not-found paths. The cancel request path is the exception: approve/reject are
 * restricted to super_admin / area_manager, mirroring the /cancel-requests
 * RoleGuard, because approving is what now mutates stock.
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
let OrderInsufficientStockError: typeof import("./pos").OrderInsufficientStockError;
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
  OrderInsufficientStockError = posApi.OrderInsufficientStockError;
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
        cashFloat: 200000,
      });
      expect(opened.status).toBe("Open");
      expect(opened.cashFloat).toBe(200000);
      expect(await shiftStatus(opened.id)).toBe("Open");

      // One branch, one open shift. A second open must be refused, otherwise
      // POS orders are attributed to whichever open row was found first.
      await expect(
        posApi.openShiftCore(cashier2, {
          branchId,
          userId: cashier2.id,
          cashFloat: 50000,
        }),
      ).rejects.toThrow("Shift sudah dibuka di cabang ini");

      // Self-take-over is refused.
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

      // Mid-shift cash adjustment: add 50k, audit row is written.
      const adjusted = await posApi.adjustCashFloatCore(cashier2, {
        shiftId: opened.id,
        amountDelta: 50000,
        reason: "tambah uang kembalian",
      });
      expect(adjusted.cashFloat).toBe(250000);
      const [auditRow] = await db
        .select()
        .from(schema.shiftEdits)
        .where(eq(schema.shiftEdits.shiftId, opened.id))
        .limit(1);
      expect(auditRow.fieldName).toBe("cashFloat");
      expect(auditRow.oldValue).toBe("200000");
      expect(auditRow.newValue).toBe("250000");
      expect(auditRow.editedBy).toBe(cashier2.id);

      // Guard rails: zero delta, overdrawing the drawer, closed shift.
      await expect(
        posApi.adjustCashFloatCore(cashier2, { shiftId: opened.id, amountDelta: 0 }),
      ).rejects.toThrow("Penyesuaian kas tidak boleh nol");
      await expect(
        posApi.adjustCashFloatCore(cashier2, { shiftId: opened.id, amountDelta: -999999 }),
      ).rejects.toThrow("Uang kas tidak boleh menjadi negatif");

      // Close — expected cash = float (200k + 50k) + no cash sales this shift.
      const closed = await posApi.closeShiftCore(cashier2, {
        shiftId: opened.id,
        actualCash: 100000,
        notes: "penutupan",
      });
      expect(closed.status).toBe("Closed");
      expect(closed.actualCash).toBe(100000);
      expect(closed.expectedCash).toBe(250000);

      // Closing it again is refused — it would overwrite the cash count above.
      await expect(
        posApi.closeShiftCore(cashier2, {
          shiftId: opened.id,
          actualCash: 1,
        }),
      ).rejects.toThrow("Shift tidak ditemukan atau sudah ditutup");

      // Adjusting or taking over a closed shift is refused.
      await expect(
        posApi.adjustCashFloatCore(cashier2, { shiftId: opened.id, amountDelta: 1000 }),
      ).rejects.toThrow("Shift tidak ditemukan atau sudah ditutup");
      await expect(
        posApi.takeOverShiftCore(cashier1, {
          branchId,
          userId: cashier1.id,
          shiftId: opened.id,
        }),
      ).rejects.toThrow("Shift sudah ditutup");
    },
  );
});

describe("POS — order lifecycle: create → complete, and void restores stock", () => {
  it.skipIf(!hasTestDatabaseUrl)(
    "createOrder deducts inventory + writes Kartu Stok; void restores it",
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

      // Create an order for 3 of the recipe → deducts 3*2 = 6 from stock (100→94)
      const order = await posApi.createOrderCore(cashier, {
        branchId,
        channel: "Dine-in",
        customerName: "Budi Santoso",
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

      // A branch_admin cannot void directly — that is the request flow's job.
      await expect(
        posApi.voidOrderCore(cashier, { orderId: order.id, reason: "Salah input" }),
      ).rejects.toThrow("Forbidden: insufficient role");

      // An admin void restores the 6 units (back to 100)
      const voided = await posApi.voidOrderCore(admin, {
        orderId: order.id,
        reason: "Salah input",
      });
      expect(voided.status).toBe("Void");
      expect(await inventoryQty(branchId, ingId)).toBe(100);

      // Void again refused
      await expect(posApi.voidOrderCore(admin, { orderId: order.id, reason: "x" })).rejects.toThrow(
        "Order sudah dibatalkan",
      );

      // No edge leaves Void — completing it is refused too.
      await expect(posApi.completeOrderCore(admin, { orderId: order.id })).rejects.toThrow(
        "Cannot complete an order in Void",
      );
    },
  );

  it.skipIf(!hasTestDatabaseUrl)("status changes follow the forward-only order FSM", async () => {
    const branchId = await seedBranch();
    const cashier = await seedUser("branch_admin", branchId);
    const [catRow] = await db
      .insert(schema.categories)
      .values({ code: uniq("CAT"), name: "Menu" })
      .returning({ id: schema.categories.id });
    const ingId = await seedIngredient();
    const recipeId = await seedRecipe(catRow.id, ingId);
    await db.insert(schema.inventory).values({ branchId, ingredientId: ingId, quantity: 100 });

    const order = await posApi.createOrderCore(cashier, {
      branchId,
      channel: "Dine-in",
      customerName: "Budi Santoso",
      items: [{ recipeId, quantity: 1, price: 10000 }],
    });

    // New → Processing → In Delivery → Completed
    expect(
      (
        await posApi.updateOrderStatusCore(cashier, {
          orderId: order.id,
          newStatus: "Processing",
        })
      ).status,
    ).toBe("Processing");
    expect(
      (
        await posApi.updateOrderStatusCore(cashier, {
          orderId: order.id,
          newStatus: "In Delivery",
        })
      ).status,
    ).toBe("In Delivery");
    expect(
      (
        await posApi.updateOrderStatusCore(cashier, {
          orderId: order.id,
          newStatus: "Completed",
        })
      ).status,
    ).toBe("Completed");

    // Completed is terminal for fulfilment: there is no edge back.
    await expect(
      posApi.updateOrderStatusCore(cashier, {
        orderId: order.id,
        newStatus: "In Delivery",
      }),
    ).rejects.toThrow("Cannot dispatch an order in Completed");

    // A New order may also be completed directly (walk-in), but not
    // "started" once it is already Completed.
    const walkIn = await posApi.createOrderCore(cashier, {
      branchId,
      channel: "Dine-in",
      customerName: "Siti",
      items: [{ recipeId, quantity: 1, price: 10000 }],
    });
    await expect(
      posApi.updateOrderStatusCore(cashier, {
        orderId: walkIn.id,
        newStatus: "Completed",
      }),
    ).resolves.toMatchObject({ status: "Completed" });
    await expect(
      posApi.updateOrderStatusCore(cashier, {
        orderId: walkIn.id,
        newStatus: "Processing",
      }),
    ).rejects.toThrow("Cannot start-processing an order in Completed");
  });
});

describe("POS — cancel request: approval executes immediately", () => {
  it.skipIf(!hasTestDatabaseUrl)(
    "create → approve voids the order and restores stock in one step",
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

      // Approving now does the work: the order comes back Void, not "Approved".
      const voided = await posApi.approveCancelRequestCore(admin, { requestId: req.id });
      expect(voided.status).toBe("Void");
      // Stock is restored as part of the same approval.
      expect(await inventoryQty(branchId, ingId)).toBe(100);

      const [persisted] = await db
        .select()
        .from(schema.cancelRequests)
        .where(eq(schema.cancelRequests.id, req.id));
      expect(persisted.status).toBe("Executed");
      expect(persisted.approvedBy).toBe(admin.id);

      // Approval is the only push. Re-approving is refused (nothing left in
      // "Pending"), and crucially the
      // inventory is not restored a second time.
      await expect(posApi.approveCancelRequestCore(admin, { requestId: req.id })).rejects.toThrow(
        "Request sudah diproses",
      );
      expect(await inventoryQty(branchId, ingId)).toBe(100);
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "a request that is no longer Pending is refused even while its order is still active",
    async () => {
      // Isolates the conditional-UPDATE claim from the "order already Void"
      // pre-check: here the order is untouched, so the only thing that can
      // refuse the approval is the status guard on the claim itself. Without
      // that guard the order would be voided and the stock restored.
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
        paymentMethod: "gofood",
        items: [{ recipeId, quantity: 2, price: 15000 }],
      });
      const req = await posApi.createCancelRequestCore(cashier, {
        orderId: order.id,
        reason: "Salah Input",
      });

      // Simulate the request being settled by another path (e.g. a concurrent
      // reject winning the race) while the order is still active.
      await db
        .update(schema.cancelRequests)
        .set({ status: "Executed" })
        .where(eq(schema.cancelRequests.id, req.id));

      await expect(posApi.approveCancelRequestCore(admin, { requestId: req.id })).rejects.toThrow(
        "Request sudah diproses",
      );

      // The order was left alone and the stock was not restored.
      const [stillActive] = await db
        .select()
        .from(schema.orders)
        .where(eq(schema.orders.id, order.id));
      expect(stillActive.status).not.toBe("Void");
      expect(await inventoryQty(branchId, ingId)).toBe(96);
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "a second concurrent approval cannot restore stock twice",
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
        paymentMethod: "gofood",
        items: [{ recipeId, quantity: 2, price: 15000 }],
      });
      const req = await posApi.createCancelRequestCore(cashier, {
        orderId: order.id,
        reason: "Salah Input",
      });

      // Both approvals race for the same request.
      const results = await Promise.allSettled([
        posApi.approveCancelRequestCore(admin, { requestId: req.id }),
        posApi.approveCancelRequestCore(admin, { requestId: req.id }),
      ]);

      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
      // Exactly one restore: 100 - 2 consumed, then +2 back = 100, not 102.
      expect(await inventoryQty(branchId, ingId)).toBe(100);
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "only super_admin / area_manager may approve or reject; the cashier may not self-approve",
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

      const order = await posApi.createOrderCore(cashier, {
        branchId,
        channel: "Gofood",
        paymentMethod: "gofood",
        items: [{ recipeId, quantity: 2, price: 15000 }],
      });
      const req = await posApi.createCancelRequestCore(cashier, {
        orderId: order.id,
        reason: "Salah Input",
      });

      // The requesting cashier cannot approve their own request — this is the
      // whole point of the approval step, and approving now also voids.
      await expect(posApi.approveCancelRequestCore(cashier, { requestId: req.id })).rejects.toThrow(
        "Forbidden: insufficient role",
      );
      await expect(posApi.rejectCancelRequestCore(cashier, { requestId: req.id })).rejects.toThrow(
        "Forbidden: insufficient role",
      );

      // Still pending and the order untouched.
      const [stillPending] = await db
        .select()
        .from(schema.cancelRequests)
        .where(eq(schema.cancelRequests.id, req.id));
      expect(stillPending.status).toBe("Pending");
      const [untouched] = await db
        .select()
        .from(schema.orders)
        .where(eq(schema.orders.id, order.id));
      expect(untouched.status).not.toBe("Void");
      // qty 2 x 2 per unit = 4 consumed; the refused approve/reject restored nothing.
      expect(await inventoryQty(branchId, ingId)).toBe(96);
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "area_manager may approve, and a rejection leaves the order alone",
    async () => {
      const branchId = await seedBranch();
      const cashier = await seedUser("branch_admin", branchId);
      const am = await seedUser("area_manager");
      // The void edge is branch-bounded for area managers.
      await db.insert(schema.areaManagerBranches).values({ userId: am.id, branchId });
      am.assignedBranches = [branchId];
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
        paymentMethod: "gofood",
        items: [{ recipeId, quantity: 1, price: 15000 }],
      });

      // Rejected: order stays, stock stays consumed.
      const rejectedReq = await posApi.createCancelRequestCore(cashier, {
        orderId: order.id,
        reason: "Salah Input",
      });
      const rejected = await posApi.rejectCancelRequestCore(am, { requestId: rejectedReq.id });
      expect(rejected.status).toBe("Rejected");
      // qty 1 x 2 per unit = 2 consumed; rejecting must not restore it.
      expect(await inventoryQty(branchId, ingId)).toBe(98);

      // A second request on the same order can still be approved by an AM.
      const secondReq = await posApi.createCancelRequestCore(cashier, {
        orderId: order.id,
        reason: "Customer Cancel",
      });
      const voided = await posApi.approveCancelRequestCore(am, { requestId: secondReq.id });
      expect(voided.status).toBe("Void");
      expect(await inventoryQty(branchId, ingId)).toBe(100);
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "a direct void closes the pending request instead of stranding it",
    async () => {
      // The reported bug: a manager cancels the order from the POS (the void
      // button they already have) instead of approving the cashier's request.
      // The request stayed Pending, every approval answered "Order sudah
      // dibatalkan" and rolled back, and the row could never leave the review
      // queue — only rejecting it cleared it.
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
        paymentMethod: "gofood",
        items: [{ recipeId, quantity: 2, price: 15000 }],
      });
      const req = await posApi.createCancelRequestCore(cashier, {
        orderId: order.id,
        reason: "Salah Input",
      });

      await posApi.voidOrderCore(admin, { orderId: order.id, reason: "Salah input" });
      expect(await inventoryQty(branchId, ingId)).toBe(100);

      const [persisted] = await db
        .select()
        .from(schema.cancelRequests)
        .where(eq(schema.cancelRequests.id, req.id));
      expect(persisted.status).toBe("Executed");

      // The cashier is told why their request disappeared.
      const notifications = await db
        .select({ title: schema.systemNotifications.title })
        .from(schema.systemNotifications)
        .where(eq(schema.systemNotifications.userId, cashier.id));
      expect(notifications.map((n) => n.title)).toContain("Cancel Request Ditutup");
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "approving a request whose order is already void closes it without restoring stock twice",
    async () => {
      // Rows the old code left behind: Pending request, order already Void.
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
        paymentMethod: "gofood",
        items: [{ recipeId, quantity: 2, price: 15000 }],
      });
      const req = await posApi.createCancelRequestCore(cashier, {
        orderId: order.id,
        reason: "Customer Cancel",
      });

      // Cancelled elsewhere without going through this request (the historical
      // state that had no way out). Inventory is left as the void left it.
      await db
        .update(schema.orders)
        .set({ status: "Void", voidReason: "Cancel: Customer Cancel" })
        .where(eq(schema.orders.id, order.id));

      const closed = await posApi.approveCancelRequestCore(admin, { requestId: req.id });
      expect(closed.status).toBe("Void");
      expect(closed.alreadyVoid).toBe(true);

      const [persisted] = await db
        .select()
        .from(schema.cancelRequests)
        .where(eq(schema.cancelRequests.id, req.id));
      expect(persisted.status).toBe("Executed");

      // 96 is what the order consumed; the approval must not add the 4 back on
      // top of a restore that already happened elsewhere.
      expect(await inventoryQty(branchId, ingId)).toBe(96);
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "a second request for the same order returns the open one instead of queueing a duplicate",
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

      const order = await posApi.createOrderCore(cashier, {
        branchId,
        channel: "Gofood",
        paymentMethod: "gofood",
        items: [{ recipeId, quantity: 1, price: 15000 }],
      });

      const first = await posApi.createCancelRequestCore(cashier, {
        orderId: order.id,
        reason: "Salah Input",
      });
      const again = await posApi.createCancelRequestCore(cashier, {
        orderId: order.id,
        reason: "Customer Cancel",
      });

      expect(again.id).toBe(first.id);
      expect("alreadyPending" in again && again.alreadyPending).toBe(true);

      const rows = await db
        .select({ id: schema.cancelRequests.id })
        .from(schema.cancelRequests)
        .where(eq(schema.cancelRequests.orderId, order.id));
      expect(rows).toHaveLength(1);
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "no request can be raised against an order that is already cancelled",
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
        paymentMethod: "gofood",
        items: [{ recipeId, quantity: 1, price: 15000 }],
      });
      await posApi.voidOrderCore(admin, { orderId: order.id, reason: "Salah input" });

      await expect(
        posApi.createCancelRequestCore(cashier, { orderId: order.id, reason: "Salah Input" }),
      ).rejects.toThrow("Order sudah dibatalkan");
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
        customerName: "Budi Santoso",
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

      // Reject a Consumed request is refused — the paper is already printed.
      await expect(posApi.rejectReprintCore(admin, { requestId: req.id })).rejects.toThrow(
        "Request sudah diproses",
      );

      // An Approved request cannot be rejected either: approval is the only
      // edge into printing, so Rejected must stay a Pending-only outcome.
      const req2 = await posApi.requestReprintCore(cashier, { orderId: order.id });
      await posApi.approveReprintCore(admin, { requestId: req2.id });
      await expect(posApi.rejectReprintCore(admin, { requestId: req2.id })).rejects.toThrow(
        "Request sudah diproses",
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
      const approver = await seedUser("super_admin");
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

      // Cancel / reprint request not-found and wrong-state guards.
      // approveCancelRequestCore is called as an approver: it carries a role
      // guard, so the not-found path is only reachable by someone allowed to
      // approve in the first place.
      await expect(
        posApi.approveCancelRequestCore(approver, { requestId: missing }),
      ).rejects.toThrow("Cancel request not found");
      // A non-approver is refused on role before the row is even looked up.
      await expect(
        posApi.approveCancelRequestCore(cashier, { requestId: missing }),
      ).rejects.toThrow("Forbidden: insufficient role");
      await expect(posApi.approveReprintCore(cashier, { requestId: missing })).rejects.toThrow(
        "Print request not found",
      );
      await expect(posApi.consumePrintRequestCore(cashier, { requestId: missing })).rejects.toThrow(
        "Print request not found",
      );

      // A failed approval (wrong role) leaves the pending request untouched.
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
        customerName: "Budi Santoso",
        items: [{ recipeId, quantity: 1, price: 10000 }],
      });
      const req = await posApi.createCancelRequestCore(cashier, {
        orderId: order.id,
        reason: "Salah Input",
      });
      await expect(posApi.approveCancelRequestCore(cashier, { requestId: req.id })).rejects.toThrow(
        "Forbidden: insufficient role",
      );

      // No side effects — request still Pending, order still New, stock intact
      const [reqRow] = await db
        .select({ status: schema.cancelRequests.status })
        .from(schema.cancelRequests)
        .where(eq(schema.cancelRequests.id, req.id))
        .limit(1);
      expect(reqRow.status).toBe("Pending");
      expect(await orderStatus(order.id)).toBe("New");
      expect(await inventoryQty(branchId, ingId)).toBe(8); // 10 - 2 used

      // Closing a missing shift is refused before any write. Opening with a
      // real branch still works (smoke).
      await expect(
        posApi.closeShiftCore(cashier, { shiftId: crypto.randomUUID(), actualCash: 0 }),
      ).rejects.toThrow("Shift tidak ditemukan");

      const opened = await posApi.openShiftCore(cashier, {
        branchId,
        userId: cashier.id,
        cashFloat: 50000,
      });
      expect(opened.status).toBe("Open");
    },
  );
});

describe("POS — hard stock block: order refused when main or addon ingredients would go minus", () => {
  async function seedModifierAddons(
    recipeId: string,
    ingId: string,
  ): Promise<{ groupId: string; modifierId: string; price: number }> {
    const [grp] = await db
      .insert(schema.modifierGroups)
      .values({ code: uniq("MG"), name: "Addon" })
      .returning({ id: schema.modifierGroups.id });
    await db.insert(schema.recipeModifierGroups).values({ recipeId, modifierGroupId: grp.id });
    const [mod] = await db
      .insert(schema.modifiers)
      .values({
        code: uniq("MOD"),
        modifierGroupId: grp.id,
        name: "Telur Ceplok",
        price: 3000,
        kind: "ingredient",
      })
      .returning({ id: schema.modifiers.id });
    await db
      .insert(schema.modifierIngredients)
      .values({ modifierId: mod.id, ingredientId: ingId, quantity: 1 });
    return { groupId: grp.id, modifierId: mod.id, price: 3000 };
  }

  it.skipIf(!hasTestDatabaseUrl)(
    "insufficient main-item stock refuses the order, notifies AMs, and writes nothing",
    async () => {
      const branchId = await seedBranch();
      const cashier = await seedUser("branch_admin", branchId);
      const am = await seedUser("area_manager");
      await db.insert(schema.areaManagerBranches).values({ userId: am.id, branchId });
      const [catRow] = await db
        .insert(schema.categories)
        .values({ code: uniq("CAT"), name: "Menu" })
        .returning({ id: schema.categories.id });
      const ingId = await seedIngredient();
      const recipeId = await seedRecipe(catRow.id, ingId);
      // Stock 3, order of 2 items x 2 units = 4 needed → short by 1.
      await db.insert(schema.inventory).values({ branchId, ingredientId: ingId, quantity: 3 });

      await expect(
        posApi.createOrderCore(cashier, {
          branchId,
          channel: "Dine-in",
          customerName: "Budi Santoso",
          items: [{ recipeId, quantity: 2, price: 10000 }],
        }),
      ).rejects.toThrow(OrderInsufficientStockError);

      // Nothing was written: no order, no ledger row, stock untouched.
      const [orderRow] = await db.select().from(schema.orders).limit(1);
      expect(orderRow).toBeUndefined();
      expect(await inventoryQty(branchId, ingId)).toBe(3);
      const ledgerRows = await db.select().from(schema.stockLedger);
      expect(ledgerRows).toHaveLength(0);

      // The Area Manager still got the alert so they know stock is short.
      const notifs = await db
        .select()
        .from(schema.systemNotifications)
        .where(eq(schema.systemNotifications.userId, am.id));
      expect(notifs).toHaveLength(1);
      expect(notifs[0].title).toBe("Stok Minus");
      expect(notifs[0].message).toContain("Bahan");
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "insufficient ADDON ingredient stock refuses the order even when the main item is fine",
    async () => {
      const branchId = await seedBranch();
      const cashier = await seedUser("branch_admin", branchId);
      const am = await seedUser("area_manager");
      await db.insert(schema.areaManagerBranches).values({ userId: am.id, branchId });
      const [catRow] = await db
        .insert(schema.categories)
        .values({ code: uniq("CAT"), name: "Menu" })
        .returning({ id: schema.categories.id });
      const ingId = await seedIngredient();
      const recipeId = await seedRecipe(catRow.id, ingId);
      const addon = await seedModifierAddons(recipeId, ingId);
      // Main needs 2/order; addon needs 1. Stock 5: 1 order (2) is fine alone,
      // but 2 orders (4) + 2 addons (2) = 6 > 5 → the ADDON pushes it over.
      await db.insert(schema.inventory).values({ branchId, ingredientId: ingId, quantity: 5 });

      await expect(
        posApi.createOrderCore(cashier, {
          branchId,
          channel: "Dine-in",
          customerName: "Budi Santoso",
          items: [
            { recipeId, quantity: 1, price: 10000, selectedModifiers: [addon] },
            { recipeId, quantity: 1, price: 10000, selectedModifiers: [addon] },
          ],
        }),
      ).rejects.toThrow(OrderInsufficientStockError);

      expect(await inventoryQty(branchId, ingId)).toBe(5);
      const [orderRow] = await db.select().from(schema.orders).limit(1);
      expect(orderRow).toBeUndefined();

      // AM notified about the addon-driven shortfall too.
      const notifs = await db
        .select()
        .from(schema.systemNotifications)
        .where(eq(schema.systemNotifications.userId, am.id));
      expect(notifs).toHaveLength(1);
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "sufficient stock (main + addon) proceeds normally with deduction",
    async () => {
      const branchId = await seedBranch();
      const cashier = await seedUser("branch_admin", branchId);
      const [catRow] = await db
        .insert(schema.categories)
        .values({ code: uniq("CAT"), name: "Menu" })
        .returning({ id: schema.categories.id });
      const ingId = await seedIngredient();
      const recipeId = await seedRecipe(catRow.id, ingId);
      const addon = await seedModifierAddons(recipeId, ingId);
      await db.insert(schema.inventory).values({ branchId, ingredientId: ingId, quantity: 10 });

      const order = await posApi.createOrderCore(cashier, {
        branchId,
        channel: "Dine-in",
        customerName: "Budi Santoso",
        items: [
          {
            recipeId,
            quantity: 1,
            price: 10000,
            selectedModifiers: [addon],
          },
        ],
      });
      // 1 main (2 units) + 1 addon (1 unit) = 3 consumed → 10 - 3 = 7.
      expect(order.status).toBe("New");
      expect(await inventoryQty(branchId, ingId)).toBe(7);
    },
  );
});
