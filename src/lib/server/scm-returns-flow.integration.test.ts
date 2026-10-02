/**
 * Retur Barang (ADR 0018) — return-lifecycle integration test.
 *
 * Covers the loop the old model never had: a receiver rejects stock and sends
 * it home, and the **source** later confirms the goods are physically back.
 *
 * The cores take an explicit `user` argument, so `requireRole()` (and the
 * better-auth instance it instantiates) is never needed here — only the
 * transport wrappers are bypassed, per ADR 0015. The role guard itself *is*
 * still exercised, because it lives inside the core.
 *
 * Run:  TEST_DATABASE_URL=postgresql://omoiyari_test:omoiyari_test@localhost:5433/omoiyari_pos_test DATABASE_URL= vp test run src/lib/server/scm-returns-flow.integration.test.ts
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
let returnsApi: typeof import("./scm-returns");
let seedCounter = 0;

function uniq(prefix: string): string {
  return `${prefix}-${seedCounter++}-${crypto.randomUUID().slice(0, 8)}`;
}

async function seedBranch(code: string, type: "Central" | "Outlet" = "Outlet"): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(schema.branches).values({
    id,
    code,
    name: `ISR ${code}`,
    location: "Test",
    type,
  });
  return id;
}

async function seedIngredient(code: string, averageCost: number): Promise<string> {
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
    averageCost,
  });
  return id;
}

async function seedUser(role: UserRole, branchId?: string): Promise<AppUser> {
  const id = crypto.randomUUID();
  await db.insert(schema.users).values({
    id,
    name: `ISR ${role}`,
    email: `isr-${id}@pos.test`,
    role,
    branchId,
  });
  return { id, email: `isr-${id}@pos.test`, name: `ISR ${role}`, role, branchId, status: "Active" };
}

/**
 * A document a return can trace back to. `scmret_exactly_one_flow_fk` requires
 * exactly one of the two document FKs, so every seeded return names one.
 */
async function seedProcurement(outlet: string, requestedById: string): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(schema.scmProcurements).values({
    id,
    code: uniq("PROC"),
    branchId: outlet,
    status: "WaitingForPayment",
    requestedById,
  });
  return id;
}

/** A Pending return as the `*RejectedDisposition` effect would have left it. */
async function seedPendingReturn(opts: {
  branchId: string;
  ingredientId: string;
  createdById: string;
  procurementId?: string;
  transferId?: string;
  quantity?: number;
  valuation?: number;
}): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(schema.scmReturns).values({
    id,
    branchId: opts.branchId,
    scmProcurementId: opts.procurementId,
    scmTransferId: opts.transferId,
    ingredientId: opts.ingredientId,
    quantity: opts.quantity ?? 2,
    valuation: opts.valuation ?? 2000,
    disposition: "Return to Source",
    reason: "kadaluarsa",
    status: "Pending",
    createdById: opts.createdById,
  });
  return id;
}

async function readReturn(id: string): Promise<typeof schema.scmReturns.$inferSelect> {
  const [row] = await db.select().from(schema.scmReturns).where(eq(schema.scmReturns.id, id));
  if (!row) throw new Error(`return ${id} not found`);
  return row;
}

beforeAll(async () => {
  if (!hasTestDatabaseUrl) return;
  // SAFETY: guarded by hasTestDatabaseUrl; when the test DB is absent beforeAll returns early and every test is skipped, so db is never read unset.
  db = dbHolder.db as TestDb;
  returnsApi = await import("./scm-returns");
});

describe("Retur Barang — pickup confirmation closes the branch's liability (ADR 0018)", () => {
  it.skipIf(!hasTestDatabaseUrl)(
    "confirms a Pending return, stamping both pickup fields",
    async () => {
      const outlet = await seedBranch(uniq("RCV"));
      const ingredient = await seedIngredient(uniq("ING"), 1000);
      const central = await seedUser("admin_pusat");
      const procId = await seedProcurement(outlet, central.id);
      const returnId = await seedPendingReturn({
        branchId: outlet,
        ingredientId: ingredient,
        createdById: central.id,
        procurementId: procId,
      });

      const result = await returnsApi.confirmScmReturnPickupCore(central, { returnId });
      expect(result.success).toBe(true);

      const after = await readReturn(returnId);
      expect(after.status).toBe("PickedUp");
      expect(after.pickedUpBy).toBe(central.id);
      expect(after.pickedUpAt).not.toBeNull();
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "moves no stock — the quantity was already credited at receiving",
    async () => {
      const outlet = await seedBranch(uniq("RCV"));
      const ingredient = await seedIngredient(uniq("ING"), 1000);
      const central = await seedUser("admin_pusat");
      const procId = await seedProcurement(outlet, central.id);
      const returnId = await seedPendingReturn({
        branchId: outlet,
        ingredientId: ingredient,
        createdById: central.id,
        procurementId: procId,
        quantity: 4,
      });

      const before = await db.select().from(schema.inventory);
      await returnsApi.confirmScmReturnPickupCore(central, { returnId });
      const after = await db.select().from(schema.inventory);

      // This is the whole point of the feature: confirming the pickup records
      // that the box caught up with the number, and does NOT move the number
      // again. A second credit here would fabricate stock.
      expect(after).toEqual(before);
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "rejects a branch admin — only the source confirms its own goods",
    async () => {
      const outlet = await seedBranch(uniq("RCV"));
      const ingredient = await seedIngredient(uniq("ING"), 1000);
      const ba = await seedUser("branch_admin", outlet);
      const returnId = await seedPendingReturn({
        branchId: outlet,
        ingredientId: ingredient,
        createdById: ba.id,
        procurementId: await seedProcurement(outlet, ba.id),
      });

      const result = await returnsApi.confirmScmReturnPickupCore(ba, { returnId });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toMatch(/Forbidden/);

      // No side effect: the branch cannot discharge its own liability.
      expect((await readReturn(returnId)).status).toBe("Pending");
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "is not idempotent-by-silence — a second confirm reports the state",
    async () => {
      const outlet = await seedBranch(uniq("RCV"));
      const ingredient = await seedIngredient(uniq("ING"), 1000);
      const central = await seedUser("admin_pusat");
      const procId = await seedProcurement(outlet, central.id);
      const returnId = await seedPendingReturn({
        branchId: outlet,
        ingredientId: ingredient,
        createdById: central.id,
        procurementId: procId,
      });

      await returnsApi.confirmScmReturnPickupCore(central, { returnId });
      const first = await readReturn(returnId);

      const second = await returnsApi.confirmScmReturnPickupCore(central, { returnId });
      expect(second.success).toBe(false);
      if (!second.success) expect(second.error).toMatch(/sudah ditandai/);

      // The original pickup stamp survives — no silent re-stamping.
      expect((await readReturn(returnId)).pickedUpAt).toEqual(first.pickedUpAt);
    },
  );

  it.skipIf(!hasTestDatabaseUrl)("reports a missing return instead of throwing", async () => {
    const central = await seedUser("admin_pusat");
    const result = await returnsApi.confirmScmReturnPickupCore(central, {
      returnId: crypto.randomUUID(),
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/tidak ditemukan/);
  });

  it.skipIf(!hasTestDatabaseUrl)(
    "reopens a return confirmed in error, clearing both stamps",
    async () => {
      const outlet = await seedBranch(uniq("RCV"));
      const ingredient = await seedIngredient(uniq("ING"), 1000);
      const central = await seedUser("admin_pusat");
      const procId = await seedProcurement(outlet, central.id);
      const returnId = await seedPendingReturn({
        branchId: outlet,
        ingredientId: ingredient,
        createdById: central.id,
        procurementId: procId,
      });

      await returnsApi.confirmScmReturnPickupCore(central, { returnId });
      const reopened = await returnsApi.reopenScmReturnCore(central, {
        returnId,
        reason: "Barang belum sampai di gudang sumber",
      });
      expect(reopened.success).toBe(true);

      // Both stamps cleared together — scmret_pickup_stamps_paired forbids a
      // Pending row carrying a pickedUpAt without its pickedUpBy.
      const after = await readReturn(returnId);
      expect(after.status).toBe("Pending");
      expect(after.pickedUpAt).toBeNull();
      expect(after.pickedUpBy).toBeNull();
    },
  );

  it.skipIf(!hasTestDatabaseUrl)("refuses to reopen a return that is already Pending", async () => {
    const outlet = await seedBranch(uniq("RCV"));
    const ingredient = await seedIngredient(uniq("ING"), 1000);
    const central = await seedUser("admin_pusat");
    const procId = await seedProcurement(outlet, central.id);
    const returnId = await seedPendingReturn({
      branchId: outlet,
      ingredientId: ingredient,
      createdById: central.id,
      procurementId: procId,
    });

    const result = await returnsApi.reopenScmReturnCore(central, { returnId, reason: "x" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/masih menunggu/);
  });
});

/**
 * A rejection as it surfaces from drizzle: the wrapper's own message omits the
 * driver detail, so the constraint name lives on `cause`.
 */
interface DriverError extends Error {
  cause?: Error;
}

/**
 * Assert that an insert is rejected by a specific named CHECK constraint.
 *
 * Drizzle wraps the driver's error, so the constraint name is not always on
 * `error.message` — it lives on `error.cause`. Matching on the name (rather
 * than merely "it threw") is the point: it proves the rejection came from the
 * invariant we think it did, and not from an unrelated NOT NULL or FK.
 */
async function expectConstraintViolation<T>(
  insert: () => Promise<T>,
  constraint: string,
): Promise<void> {
  const thrown: DriverError | null = await insert().then(
    () => null,
    (error: DriverError) => error,
  );
  expect(thrown, `expected the insert to be rejected by ${constraint}`).not.toBeNull();
  const text = `${thrown?.message ?? ""} ${thrown?.cause?.message ?? ""}`;
  expect(text).toContain(constraint);
}

/**
 * The two CHECK constraints are the last line of defence — the cores clear
 * both stamps together, so a regression there would be silent. Asserted at the
 * database boundary with raw inserts, since a drizzle insert that throws is
 * exactly the behaviour under test.
 */
describe("Retur Barang — schema invariants (ADR 0018)", () => {
  it.skipIf(!hasTestDatabaseUrl)("rejects a return with no source document", async () => {
    const outlet = await seedBranch(uniq("RCV"));
    const ingredient = await seedIngredient(uniq("ING"), 1000);
    const central = await seedUser("admin_pusat");

    await expectConstraintViolation(
      () =>
        db.insert(schema.scmReturns).values({
          branchId: outlet,
          ingredientId: ingredient,
          quantity: 1,
          disposition: "Return to Source",
          status: "Pending",
          createdById: central.id,
        }),
      "scmret_exactly_one_flow_fk",
    );
  });

  it.skipIf(!hasTestDatabaseUrl)(
    "rejects a Pending return carrying only one pickup stamp",
    async () => {
      const outlet = await seedBranch(uniq("RCV"));
      const ingredient = await seedIngredient(uniq("ING"), 1000);
      const central = await seedUser("admin_pusat");
      const procId = await seedProcurement(outlet, central.id);

      // Only pickedUpAt — the state a careless `set({ pickedUpAt })` would leave.
      await expectConstraintViolation(
        () =>
          db.insert(schema.scmReturns).values({
            branchId: outlet,
            scmProcurementId: procId,
            ingredientId: ingredient,
            quantity: 1,
            disposition: "Return to Source",
            status: "Pending",
            createdById: central.id,
            pickedUpAt: new Date(),
          }),
        "scmret_pickup_stamps_paired",
      );
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "rejects a PickedUp return with no pickup stamps at all",
    async () => {
      const outlet = await seedBranch(uniq("RCV"));
      const ingredient = await seedIngredient(uniq("ING"), 1000);
      const central = await seedUser("admin_pusat");
      const procId = await seedProcurement(outlet, central.id);

      await expectConstraintViolation(
        () =>
          db.insert(schema.scmReturns).values({
            branchId: outlet,
            scmProcurementId: procId,
            ingredientId: ingredient,
            quantity: 1,
            disposition: "Return to Source",
            status: "PickedUp",
            createdById: central.id,
          }),
        "scmret_pickup_stamps_paired",
      );
    },
  );
});
