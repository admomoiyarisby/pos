/* oxlint-disable anti-slop/no-console -- effects log progress; not assertions */
/**
 * Stock Transfers (legacy Mutasi Stok) full-flow integration test.
 *
 * Drives the real user-parameterized cores from `scm.ts`
 * (`createStockTransferCore`, `approveStockTransferCore`,
 * `rejectStockTransferCore`, `shipStockTransferCore`,
 * `receiveStockTransferCore`, `cancelStockTransferCore`) against the local
 * dockerized test Postgres. Each core is the exact business logic the
 * `createServerFn` transport endpoint runs — the only thing bypassed is
 * `requireAuth()` / `requireRole()` (HTTP session), replaced by an explicit
 * `user` argument per call, so role and branch guards are fully exercised.
 * All cores throw on failure.
 *
 * Lifecycle: Pending Approval → Approved / Rejected → In Transit (source OUT +
 * in-transit) → Completed (destination IN); cancel from Approved or In
 * Transit (reverses source stock when in transit).
 *
 * Isolation: the cores hit the module-level `db` from `#/lib/server/db`, so
 * that module is mocked to return a drizzle instance over a connection to the
 * local test database, and shared tables are TRUNCATE-d between tests.
 *
 * Run:  TEST_DATABASE_URL=postgresql://omoiyari_test:omoiyari_test@localhost:5433/omoiyari_pos_test DATABASE_URL= vp test run src/lib/server/stock-transfers-flow.integration.test.ts
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

/** Seed users with a real `users` row (FKs require it) + branch links. */
async function seedUser(
  role: UserRole,
  branchId?: string,
  assignedBranches?: string[],
): Promise<AppUser> {
  const id = crypto.randomUUID();
  await db.insert(schema.users).values({
    id,
    name: `ITS ${role}`,
    email: `its-${id}@pos.test`,
    role,
    branchId,
  });
  if (role === "area_manager" && assignedBranches?.length) {
    for (const b of assignedBranches) {
      await db.insert(schema.areaManagerBranches).values({ userId: id, branchId: b });
    }
  }
  return {
    id,
    email: `its-${id}@pos.test`,
    name: `ITS ${role}`,
    role,
    branchId,
    assignedBranches,
    status: "Active",
  };
}

async function seedInventory(branchId: string, ingredientId: string, quantity: number) {
  await db.insert(schema.inventory).values({ branchId, ingredientId, quantity });
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

async function transferStatus(id: string): Promise<{ status: string }> {
  const [row] = await db
    .select({ status: schema.stockTransfers.status })
    .from(schema.stockTransfers)
    .where(eq(schema.stockTransfers.id, id))
    .limit(1);
  if (!row) throw new Error(`transfer ${id} not found`);
  return row;
}

async function createTransfer(
  ba: AppUser,
  fromBranchId: string,
  toBranchId: string,
  ingredientId: string,
  quantity = 5,
) {
  return scm.createStockTransferCore(ba, {
    code: uniq("MUT"),
    fromBranchId,
    toBranchId,
    ingredientId,
    quantity,
  });
}

beforeAll(async () => {
  if (!hasTestDatabaseUrl) return;
  // SAFETY: guarded by hasTestDatabaseUrl; when the test DB is absent beforeAll returns early and every test is skipped, so db is never read unset.
  db = dbHolder.db as TestDb;
  scm = await import("./scm");
});

describe("Stock transfers — full lifecycle via the real server-function cores", () => {
  it.skipIf(!hasTestDatabaseUrl)(
    "happy path: create → approve → ship → receive → Completed",
    async () => {
      const fromBranch = await seedBranch(uniq("ST-AF"));
      const toBranch = await seedBranch(uniq("ST-AT"));
      const ingredient = await seedIngredient(uniq("ST-AING"));
      await seedInventory(fromBranch, ingredient, 10);

      const senderBa = await seedUser("branch_admin", fromBranch);
      const receiverBa = await seedUser("branch_admin", toBranch);
      const am = await seedUser("area_manager", undefined, [fromBranch, toBranch]);

      // 1. Create — Pending Approval by the sender-branch admin
      const transfer = await createTransfer(senderBa, fromBranch, toBranch, ingredient);
      expect(transfer.status).toBe("Pending Approval");
      expect(transfer.requestedBy).toBe(senderBa.id);

      // 2. Approve — AM with the source branch assigned
      await scm.approveStockTransferCore(am, { transferId: transfer.id });
      expect((await transferStatus(transfer.id)).status).toBe("Approved");

      // 3. Ship — sender BA deducts source stock, in-transit created
      await scm.shipStockTransferCore(senderBa, { transferId: transfer.id });
      expect((await transferStatus(transfer.id)).status).toBe("In Transit");
      expect(await getStock(fromBranch, ingredient)).toBe(5);

      const [inTransit] = await db
        .select()
        .from(schema.inTransitInventory)
        .where(eq(schema.inTransitInventory.stockTransferId, transfer.id));
      expect(inTransit).toBeTruthy();
      expect(inTransit.ingredientId).toBe(ingredient);
      expect(inTransit.quantity).toBe(5);

      // 4. Receive — receiver BA adds destination stock, in-transit cleared
      await scm.receiveStockTransferCore(receiverBa, { transferId: transfer.id });
      expect((await transferStatus(transfer.id)).status).toBe("Completed");
      expect(await getStock(toBranch, ingredient)).toBe(5);
      const [inTransitAfter] = await db
        .select()
        .from(schema.inTransitInventory)
        .where(eq(schema.inTransitInventory.stockTransferId, transfer.id));
      expect(inTransitAfter).toBeUndefined();
    },
  );

  it.skipIf(!hasTestDatabaseUrl)("rejection path reaches the Rejected terminal state", async () => {
    const fromBranch = await seedBranch(uniq("ST-RF"));
    const toBranch = await seedBranch(uniq("ST-RT"));
    const ingredient = await seedIngredient(uniq("ST-RING"));
    const senderBa = await seedUser("branch_admin", fromBranch);
    const am = await seedUser("area_manager", undefined, [fromBranch]);

    const transfer = await createTransfer(senderBa, fromBranch, toBranch, ingredient);
    await scm.rejectStockTransferCore(am, { transferId: transfer.id, reason: "stok tidak cukup" });
    const st = await transferStatus(transfer.id);
    expect(st.status).toBe("Rejected");
    const [row] = await db
      .select({ rejectionReason: schema.stockTransfers.rejectionReason })
      .from(schema.stockTransfers)
      .where(eq(schema.stockTransfers.id, transfer.id));
    expect(row.rejectionReason).toBe("stok tidak cukup");
  });

  it.skipIf(!hasTestDatabaseUrl)(
    "cancel from Approved and from In Transit (reverses source stock)",
    async () => {
      const fromBranch = await seedBranch(uniq("ST-XF"));
      const toBranch = await seedBranch(uniq("ST-XT"));
      const ingredient = await seedIngredient(uniq("ST-XING"));
      await seedInventory(fromBranch, ingredient, 10);

      const senderBa = await seedUser("branch_admin", fromBranch);
      const am = await seedUser("area_manager", undefined, [fromBranch]);
      const adminPusat = await seedUser("admin_pusat");

      // Cancel from Approved — no stock touched
      const t1 = await createTransfer(senderBa, fromBranch, toBranch, ingredient);
      await scm.approveStockTransferCore(am, { transferId: t1.id });
      await scm.cancelStockTransferCore(adminPusat, { transferId: t1.id, reason: "batal" });
      expect((await transferStatus(t1.id)).status).toBe("Cancelled");
      expect(await getStock(fromBranch, ingredient)).toBe(10);

      // Cancel from In Transit — source stock restored, in-transit cleared
      const t2 = await createTransfer(senderBa, fromBranch, toBranch, ingredient);
      await scm.approveStockTransferCore(am, { transferId: t2.id });
      await scm.shipStockTransferCore(senderBa, { transferId: t2.id });
      expect(await getStock(fromBranch, ingredient)).toBe(5);
      await scm.cancelStockTransferCore(adminPusat, { transferId: t2.id, reason: "batal jalan" });
      expect((await transferStatus(t2.id)).status).toBe("Cancelled");
      expect(await getStock(fromBranch, ingredient)).toBe(10);
      const [inTransitAfter] = await db
        .select()
        .from(schema.inTransitInventory)
        .where(eq(schema.inTransitInventory.stockTransferId, t2.id));
      expect(inTransitAfter).toBeUndefined();
    },
  );
});

describe("Stock transfers — wrong-role and wrong-branch actors are rejected", () => {
  it.skipIf(!hasTestDatabaseUrl)(
    "create/approve/ship/receive/cancel reject wrong roles and branches without side effects",
    async () => {
      const fromBranch = await seedBranch(uniq("ST-NF"));
      const toBranch = await seedBranch(uniq("ST-NT"));
      const otherBranch = await seedBranch(uniq("ST-NX"));
      const ingredient = await seedIngredient(uniq("ST-NING"));
      await seedInventory(fromBranch, ingredient, 10);

      const senderBa = await seedUser("branch_admin", fromBranch);
      const receiverBa = await seedUser("branch_admin", toBranch);
      const otherBa = await seedUser("branch_admin", otherBranch);
      const am = await seedUser("area_manager", undefined, [fromBranch, toBranch]);
      const unassignedAm = await seedUser("area_manager", undefined, [otherBranch]);
      const adminPusat = await seedUser("admin_pusat");

      // Create: BA must be involved with one of the branches
      await expect(
        scm.createStockTransferCore(otherBa, {
          code: uniq("MUT-N"),
          fromBranchId: fromBranch,
          toBranchId: toBranch,
          ingredientId: ingredient,
          quantity: 5,
        }),
      ).rejects.toThrow("Branch admin can only create transfers involving their branch");

      const transfer = await createTransfer(senderBa, fromBranch, toBranch, ingredient);

      // Approve/reject: only super_admin | area_manager; AM must have source branch
      await expect(
        scm.approveStockTransferCore(senderBa, { transferId: transfer.id }),
      ).rejects.toThrow("Forbidden: insufficient role");
      await expect(
        scm.rejectStockTransferCore(unassignedAm, { transferId: transfer.id, reason: "x" }),
      ).rejects.toThrow("Forbidden: you do not have access to this branch");

      // The right AM approves
      await scm.approveStockTransferCore(am, { transferId: transfer.id });

      // Ship: area_manager not allowed; BA only from own (source) branch
      await expect(scm.shipStockTransferCore(am, { transferId: transfer.id })).rejects.toThrow(
        "Forbidden: insufficient role",
      );
      await expect(
        scm.shipStockTransferCore(receiverBa, { transferId: transfer.id }),
      ).rejects.toThrow("Can only ship transfers from your own branch");

      // The sender ships
      await scm.shipStockTransferCore(senderBa, { transferId: transfer.id });

      // Receive: admin_pusat not allowed; BA only to own (destination) branch
      await expect(
        scm.receiveStockTransferCore(adminPusat, { transferId: transfer.id }),
      ).rejects.toThrow("Forbidden: insufficient role");
      await expect(
        scm.receiveStockTransferCore(senderBa, { transferId: transfer.id }),
      ).rejects.toThrow("Can only receive transfers to your own branch");

      // Cancel: branch_admin not allowed
      await expect(
        scm.cancelStockTransferCore(senderBa, { transferId: transfer.id, reason: "x" }),
      ).rejects.toThrow("Forbidden: insufficient role");

      // No side effects from rejected attempts — still In Transit, stock intact
      expect((await transferStatus(transfer.id)).status).toBe("In Transit");
      expect(await getStock(fromBranch, ingredient)).toBe(5);
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "wrong-state transitions and missing transfers are refused",
    async () => {
      const fromBranch = await seedBranch(uniq("ST-GF"));
      const toBranch = await seedBranch(uniq("ST-GT"));
      const ingredient = await seedIngredient(uniq("ST-GING"));
      await seedInventory(fromBranch, ingredient, 10);

      const senderBa = await seedUser("branch_admin", fromBranch);
      const receiverBa = await seedUser("branch_admin", toBranch);
      const am = await seedUser("area_manager", undefined, [fromBranch]);
      const adminPusat = await seedUser("admin_pusat");
      const missing = crypto.randomUUID();

      await expect(scm.approveStockTransferCore(am, { transferId: missing })).rejects.toThrow(
        "Transfer not found",
      );
      await expect(
        scm.rejectStockTransferCore(am, { transferId: missing, reason: "x" }),
      ).rejects.toThrow("Transfer not found");
      await expect(scm.shipStockTransferCore(senderBa, { transferId: missing })).rejects.toThrow(
        "Transfer not found",
      );
      await expect(
        scm.receiveStockTransferCore(receiverBa, { transferId: missing }),
      ).rejects.toThrow("Transfer not found");
      await expect(
        scm.cancelStockTransferCore(adminPusat, { transferId: missing, reason: "x" }),
      ).rejects.toThrow("Transfer not found");

      const transfer = await createTransfer(senderBa, fromBranch, toBranch, ingredient);

      // ship requires Approved
      await expect(
        scm.shipStockTransferCore(senderBa, { transferId: transfer.id }),
      ).rejects.toThrow("Transfer must be Approved to ship");

      await scm.approveStockTransferCore(am, { transferId: transfer.id });
      // receive requires In Transit
      await expect(
        scm.receiveStockTransferCore(receiverBa, { transferId: transfer.id }),
      ).rejects.toThrow("Transfer must be In Transit to receive");
    },
  );
});
