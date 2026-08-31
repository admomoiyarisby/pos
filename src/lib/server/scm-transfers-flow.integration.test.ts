/* oxlint-disable anti-slop/no-console -- effects log progress; not assertions */
/**
 * Mutasi Stok (scm-transfers) full-flow integration test.
 *
 * Walks real transfers through **all 10 FSM states** using the actual
 * user-parameterized server-function cores from `scm-transfers.ts`
 * (`createMutasiTransferCore`, `submitMutasiTransferCore`, …). Each core is
 * the exact business logic the `createServerFn` transport endpoint runs — the
 * only thing bypassed is `requireAuth()` (HTTP session), which is replaced by
 * an explicit `user` argument per call so the branch/role guards are still
 * fully exercised.
 *
 * Isolation: the cores hit the module-level `db` from `#/lib/server/db`, so
 * that module is mocked to return a drizzle instance over a connection to the
 * local test database, and shared tables are TRUNCATE-d between tests. No
 * outer transaction is held open, so the cores' own `db.transaction()` calls
 * behave normally and a failing inner transition only rolls back its own work.
 *
 * Run:  TEST_DATABASE_URL=postgresql://omoiyari_test:omoiyari_test@localhost:5433/omoiyari_pos_test DATABASE_URL= vp test run src/lib/server/scm-transfers-flow.integration.test.ts
 */

import { beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { and, eq } from "drizzle-orm";
import * as schema from "#/db/schema";
import { getTestDatabaseUrl } from "./test-database";
import type { TestDb } from "./integration-test-harness";
import { setupFlowHarness } from "./integration-test-harness";
import type { MutasiActorUser } from "./scm-transfers";
import type { UserRole } from "./auth";

const testDatabaseUrl = getTestDatabaseUrl();
const hasTestDatabaseUrl = Boolean(testDatabaseUrl);

// Route the cores' module-level `db` to a transaction-bound drizzle instance
// on the test database. beforeAll/beforeEach set it before any core call.
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

// The cores take an explicit user argument, so `requireAuth()` (and the
// better-auth instance it instantiates) is never needed in this test.
vi.mock("#/lib/server/auth", () => ({
  requireAuth: async () => {
    throw new Error("requireAuth should not be called — cores receive an explicit user");
  },
}));

setupFlowHarness(dbHolder);

let db: TestDb;
let scm: typeof import("./scm-transfers");
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

async function seedInventory(
  branchId: string,
  ingredientId: string,
  quantity: number,
): Promise<void> {
  await db.insert(schema.inventory).values({ branchId, ingredientId, quantity });
}

/**
 * Persist a real `users` row for an actor: the transfer rows carry foreign keys
 * (`requested_by_id`, `reviewing_by_id`, …) to `users.id`, so impersonated
 * actors must exist in the table, exactly as they would after login.
 */
async function seedUser(
  role: UserRole,
  branchId?: string,
  assignedBranches?: string[],
): Promise<MutasiActorUser> {
  const id = crypto.randomUUID();
  await db.insert(schema.users).values({
    id,
    name: `ITS ${role}`,
    email: `its-${id}@pos.test`,
    role,
    branchId,
  });
  return { id, role, branchId, assignedBranches };
}

async function transferStatus(id: string): Promise<{ status: string }> {
  const [row] = await db
    .select({ status: schema.scmTransfers.status })
    .from(schema.scmTransfers)
    .where(eq(schema.scmTransfers.id, id))
    .limit(1);
  if (!row) throw new Error(`transfer ${id} not found`);
  return row;
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

async function createDraft(
  sender: MutasiActorUser,
  fromBranchId: string,
  toBranchId: string,
  ingredientId: string,
) {
  return scm.createMutasiTransferCore(sender, {
    fromBranchId,
    toBranchId,
    items: [{ ingredientId, quantity: 5 }],
    notes: "integration flow",
  });
}

beforeAll(async () => {
  if (!hasTestDatabaseUrl) return;
  // SAFETY: guarded by hasTestDatabaseUrl; when the test DB is absent beforeAll returns early and every test is skipped, so db is never read unset.
  db = dbHolder.db as TestDb;
  scm = await import("./scm-transfers");
});

describe("Mutasi Stok — full 10-state flow via the real server-function cores", () => {
  it.skipIf(!hasTestDatabaseUrl)(
    "happy path: SuratJalanDraft → PendingAMReview → Approved → InTransit → Delivered → ReviewingSJ → WaitingForPayment → Finished",
    async () => {
      const fromBranch = await seedBranch(uniq("MT-A"));
      const toBranch = await seedBranch(uniq("MT-B"));
      const ingredient = await seedIngredient(uniq("MT-ING"));
      await seedInventory(fromBranch, ingredient, 10);

      const sender = await seedUser("branch_admin", fromBranch);
      const receiver = await seedUser("branch_admin", toBranch);
      const manager = await seedUser("area_manager", undefined, [fromBranch, toBranch]);

      // 1. SuratJalanDraft — created by the sender branch admin
      const { transfer, warnings } = await createDraft(sender, fromBranch, toBranch, ingredient);
      expect(warnings).toEqual([]);
      expect(transfer.status).toBe("SuratJalanDraft");
      expect(transfer.code).toMatch(/^MT\//);
      expect(transfer.requestedById).toBe(sender.id);

      // 2. PendingAMReview — sender submits
      await expect(
        scm.submitMutasiTransferCore(sender, { transferId: transfer.id }),
      ).resolves.toMatchObject({ status: "PendingAMReview" });

      // 3. Approved — area manager approves (both branches in their set)
      await expect(
        scm.approveMutasiTransferCore(manager, { transferId: transfer.id }),
      ).resolves.toMatchObject({ status: "Approved" });

      // 4. InTransit — sender stock decremented, in-transit row created
      await expect(
        scm.shipMutasiTransferCore(sender, { transferId: transfer.id }),
      ).resolves.toMatchObject({ status: "InTransit" });
      expect(await getStock(fromBranch, ingredient)).toBe(5);
      const inTransit = await db
        .select()
        .from(schema.inTransitInventory)
        .where(eq(schema.inTransitInventory.scmTransferId, transfer.id));
      expect(inTransit).toHaveLength(1);

      // 5. Delivered — receiver branch admin confirms arrival
      await expect(
        scm.markDeliveredMutasiTransferCore(receiver, { transferId: transfer.id }),
      ).resolves.toMatchObject({ status: "Delivered" });

      // 6. ReviewingSJ — receiver opens the receive form
      await expect(
        scm.openReceiveMutasiTransferCore(receiver, { transferId: transfer.id }),
      ).resolves.toMatchObject({ status: "ReviewingSJ" });

      // 7. WaitingForPayment — receiver finishes receiving; stock IN + invoice snapshot
      const [item] = await db
        .select()
        .from(schema.scmTransferItems)
        .where(eq(schema.scmTransferItems.scmTransferId, transfer.id))
        .limit(1);
      expect(item).toBeTruthy();
      await expect(
        scm.finishReceiveMutasiTransferCore(receiver, {
          transferId: transfer.id,
          items: [{ id: item.id, receivedQuantity: 5, rejectedQuantity: 0 }],
        }),
      ).resolves.toMatchObject({ status: "WaitingForPayment" });
      expect(await getStock(toBranch, ingredient)).toBe(5);
      const [invoice] = await db
        .select()
        .from(schema.scmTransferInvoices)
        .where(eq(schema.scmTransferInvoices.scmTransferId, transfer.id));
      expect(invoice).toBeTruthy();
      expect(invoice.totalAmount).toBeGreaterThan(0);

      // 8. Finished — sender branch admin confirms payment
      await expect(
        scm.markPaidMutasiTransferCore(sender, { transferId: transfer.id }),
      ).resolves.toMatchObject({ status: "Finished" });
      const [paidInvoice] = await db
        .select()
        .from(schema.scmTransferInvoices)
        .where(eq(schema.scmTransferInvoices.scmTransferId, transfer.id));
      expect(paidInvoice.paidAt).toBeTruthy();

      // Audit trail covers every event on the walk
      const audit = await db
        .select({ event: schema.scmTransferAuditLog.event })
        .from(schema.scmTransferAuditLog)
        .where(eq(schema.scmTransferAuditLog.scmTransferId, transfer.id));
      expect(audit.map((a) => a.event)).toEqual(
        expect.arrayContaining([
          "submit",
          "approve",
          "ship",
          "mark-delivered",
          "open-receive",
          "finish-receive",
          "mark-paid",
        ]),
      );
    },
  );

  it.skipIf(!hasTestDatabaseUrl)("rejection path reaches the Rejected terminal state", async () => {
    const fromBranch = await seedBranch(uniq("MT-RA"));
    const toBranch = await seedBranch(uniq("MT-RB"));
    const ingredient = await seedIngredient(uniq("MT-RING"));
    await seedInventory(fromBranch, ingredient, 10);

    const sender = await seedUser("branch_admin", fromBranch);
    const manager = await seedUser("area_manager", undefined, [fromBranch, toBranch]);

    const { transfer } = await createDraft(sender, fromBranch, toBranch, ingredient);
    expect(transfer.status).toBe("SuratJalanDraft");

    await expect(
      scm.submitMutasiTransferCore(sender, { transferId: transfer.id }),
    ).resolves.toMatchObject({ status: "PendingAMReview" });

    await expect(
      scm.rejectMutasiTransferCore(manager, {
        transferId: transfer.id,
        reason: "Stok pengirim sudah cukup — tolak",
      }),
    ).resolves.toMatchObject({ status: "Rejected" });

    const [row] = await db
      .select()
      .from(schema.scmTransfers)
      .where(eq(schema.scmTransfers.id, transfer.id));
    expect(row.status).toBe("Rejected");

    const audit = await db
      .select({ event: schema.scmTransferAuditLog.event })
      .from(schema.scmTransferAuditLog)
      .where(eq(schema.scmTransferAuditLog.scmTransferId, transfer.id));
    expect(audit.map((a) => a.event)).toEqual(["submit", "reject"]);
  });

  it.skipIf(!hasTestDatabaseUrl)(
    "cancellation path reaches the Cancelled terminal state",
    async () => {
      const fromBranch = await seedBranch(uniq("MT-CA"));
      const toBranch = await seedBranch(uniq("MT-CB"));
      const ingredient = await seedIngredient(uniq("MT-CING"));
      await seedInventory(fromBranch, ingredient, 10);

      const sender = await seedUser("branch_admin", fromBranch);

      const { transfer } = await createDraft(sender, fromBranch, toBranch, ingredient);
      expect(transfer.status).toBe("SuratJalanDraft");

      await expect(
        scm.cancelMutasiTransferCore(sender, {
          transferId: transfer.id,
          reason: "Permintaan dibatalkan pengirim",
        }),
      ).resolves.toMatchObject({ status: "Cancelled" });

      const [row] = await db
        .select()
        .from(schema.scmTransfers)
        .where(eq(schema.scmTransfers.id, transfer.id));
      expect(row.status).toBe("Cancelled");
      expect(row.cancellationReason).toBe("Permintaan dibatalkan pengirim");

      const audit = await db
        .select({ event: schema.scmTransferAuditLog.event })
        .from(schema.scmTransferAuditLog)
        .where(eq(schema.scmTransferAuditLog.scmTransferId, transfer.id));
      expect(audit.map((a) => a.event)).toEqual(["cancel"]);
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "withdraw returns to SuratJalanDraft from PendingAMReview and from Approved, staying re-drivable",
    async () => {
      const fromBranch = await seedBranch(uniq("MT-WA"));
      const toBranch = await seedBranch(uniq("MT-WB"));
      const ingredient = await seedIngredient(uniq("MT-WING"));
      await seedInventory(fromBranch, ingredient, 10);

      const sender = await seedUser("branch_admin", fromBranch);
      const manager = await seedUser("area_manager", undefined, [fromBranch, toBranch]);

      const { transfer } = await createDraft(sender, fromBranch, toBranch, ingredient);
      expect(transfer.status).toBe("SuratJalanDraft");

      // submit → PendingAMReview, then withdraw (by sender BA) → back to draft
      await expect(
        scm.submitMutasiTransferCore(sender, { transferId: transfer.id }),
      ).resolves.toMatchObject({ status: "PendingAMReview" });
      await expect(
        scm.withdrawMutasiTransferCore(sender, { transferId: transfer.id }),
      ).resolves.toMatchObject({ status: "SuratJalanDraft" });
      expect((await transferStatus(transfer.id)).status).toBe("SuratJalanDraft");

      // Re-drive forward, approve, then withdraw from Approved too.
      await scm.submitMutasiTransferCore(sender, { transferId: transfer.id });
      await scm.approveMutasiTransferCore(manager, { transferId: transfer.id });
      await expect(
        scm.withdrawMutasiTransferCore(sender, { transferId: transfer.id }),
      ).resolves.toMatchObject({ status: "SuratJalanDraft" });
      expect((await transferStatus(transfer.id)).status).toBe("SuratJalanDraft");

      const audit = await db
        .select({ event: schema.scmTransferAuditLog.event })
        .from(schema.scmTransferAuditLog)
        .where(eq(schema.scmTransferAuditLog.scmTransferId, transfer.id));
      expect(audit.map((a) => a.event)).toEqual([
        "submit",
        "withdraw",
        "submit",
        "approve",
        "withdraw",
      ]);
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "per-line rejection writes receiver waste and invoices only the received quantity",
    async () => {
      const fromBranch = await seedBranch(uniq("MT-REJA"));
      const toBranch = await seedBranch(uniq("MT-REJB"));
      const ingredient = await seedIngredient(uniq("MT-REJING"));
      await seedInventory(fromBranch, ingredient, 10);

      const sender = await seedUser("branch_admin", fromBranch);
      const receiver = await seedUser("branch_admin", toBranch);
      const manager = await seedUser("area_manager", undefined, [fromBranch, toBranch]);

      const { transfer } = await createDraft(sender, fromBranch, toBranch, ingredient);
      await scm.submitMutasiTransferCore(sender, { transferId: transfer.id });
      await scm.approveMutasiTransferCore(manager, { transferId: transfer.id });
      await scm.shipMutasiTransferCore(sender, { transferId: transfer.id });
      await scm.markDeliveredMutasiTransferCore(receiver, { transferId: transfer.id });
      await scm.openReceiveMutasiTransferCore(receiver, { transferId: transfer.id });

      // Receiver accepts 3, rejects 2 (with a per-line reason).
      const [item] = await db
        .select()
        .from(schema.scmTransferItems)
        .where(eq(schema.scmTransferItems.scmTransferId, transfer.id))
        .limit(1);
      await expect(
        scm.finishReceiveMutasiTransferCore(receiver, {
          transferId: transfer.id,
          items: [
            {
              id: item.id,
              receivedQuantity: 3,
              rejectedQuantity: 2,
              reason: "Barang rusak 2 pcs",
            },
          ],
        }),
      ).resolves.toMatchObject({ status: "WaitingForPayment" });

      // Only the received units land in receiver inventory; rejected become waste.
      expect(await getStock(toBranch, ingredient)).toBe(3);
      expect(await getStock(fromBranch, ingredient)).toBe(5); // sender still shipped the full 5

      // Invoice totals only the received quantity (3 × 1000 average cost).
      const [invoice] = await db
        .select()
        .from(schema.scmTransferInvoices)
        .where(eq(schema.scmTransferInvoices.scmTransferId, transfer.id));
      expect(invoice.totalAmount).toBe(3000);

      // Waste entry written at the receiver branch for the rejected 2 units.
      const wastes = await db
        .select()
        .from(schema.wasteEntries)
        .where(eq(schema.wasteEntries.ingredientId, ingredient));
      expect(wastes).toHaveLength(1);
      expect(wastes[0].branchId).toBe(toBranch);
      expect(wastes[0].quantity).toBe(2);
      expect(wastes[0].category).toBe("Spoiled");
      expect(wastes[0].valuation).toBe(2000);
      expect(wastes[0].notes).toBe("Barang rusak 2 pcs");
      expect(wastes[0].submittedBy).toBe(receiver.id);

      // The transfer can still be completed.
      await expect(
        scm.markPaidMutasiTransferCore(sender, { transferId: transfer.id }),
      ).resolves.toMatchObject({ status: "Finished" });
    },
  );
});

describe("Mutasi Stok — wrong-role and wrong-branch actors are rejected", () => {
  it.skipIf(!hasTestDatabaseUrl)(
    "create rejects any actor other than the sender-branch admin (or super_admin)",
    async () => {
      const fromBranch = await seedBranch(uniq("MT-NCA"));
      const toBranch = await seedBranch(uniq("MT-NCB"));
      const ingredient = await seedIngredient(uniq("MT-NCING"));
      await seedInventory(fromBranch, ingredient, 10);

      const manager = await seedUser("area_manager", undefined, [fromBranch, toBranch]);
      const receiverBa = await seedUser("branch_admin", toBranch);

      const input = {
        fromBranchId: fromBranch,
        toBranchId: toBranch,
        items: [{ ingredientId: ingredient, quantity: 5 }],
      };

      // area_manager has no business creating a Mutasi
      await expect(scm.createMutasiTransferCore(manager, input)).rejects.toThrow(
        "Only the Branch Admin at the sender branch can create a Mutasi transfer",
      );
      // branch_admin of the RECEIVER branch is not the sender
      await expect(scm.createMutasiTransferCore(receiverBa, input)).rejects.toThrow(
        "Only the Branch Admin at the sender branch can create a Mutasi transfer",
      );
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "sender-side submit rejects receiver, unrelated-branch, and admin_pusat actors",
    async () => {
      const fromBranch = await seedBranch(uniq("MT-NSA"));
      const toBranch = await seedBranch(uniq("MT-NSB"));
      const unrelatedBranch = await seedBranch(uniq("MT-NSC"));
      const ingredient = await seedIngredient(uniq("MT-NSING"));
      await seedInventory(fromBranch, ingredient, 10);

      const sender = await seedUser("branch_admin", fromBranch);
      const receiver = await seedUser("branch_admin", toBranch);
      const unrelated = await seedUser("branch_admin", unrelatedBranch);
      const adminPusat = await seedUser("admin_pusat");

      const { transfer } = await createDraft(sender, fromBranch, toBranch, ingredient);
      expect(transfer.status).toBe("SuratJalanDraft");

      // receiver BA (wrong branch for a sender action)
      await expect(
        scm.submitMutasiTransferCore(receiver, { transferId: transfer.id }),
      ).rejects.toThrow("Only the sender branch admin can perform this action");
      // branch_admin from a third branch (not part of the transfer)
      await expect(
        scm.submitMutasiTransferCore(unrelated, { transferId: transfer.id }),
      ).rejects.toThrow("branch_admin can only access transfers involving their branch");
      // admin_pusat is never a Mutasi actor
      await expect(
        scm.submitMutasiTransferCore(adminPusat, { transferId: transfer.id }),
      ).rejects.toThrow("admin_pusat cannot access Mutasi Stok transfers");

      // A rejected attempt must leave state and audit trail untouched.
      expect((await transferStatus(transfer.id)).status).toBe("SuratJalanDraft");
      const audit = await db
        .select({ event: schema.scmTransferAuditLog.event })
        .from(schema.scmTransferAuditLog)
        .where(eq(schema.scmTransferAuditLog.scmTransferId, transfer.id));
      expect(audit).toHaveLength(0);

      // The legitimate sender can still submit.
      await expect(
        scm.submitMutasiTransferCore(sender, { transferId: transfer.id }),
      ).resolves.toMatchObject({ status: "PendingAMReview" });
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "approve/reject require an area manager with both branches assigned",
    async () => {
      const fromBranch = await seedBranch(uniq("MT-NAA"));
      const toBranch = await seedBranch(uniq("MT-NAB"));
      const ingredient = await seedIngredient(uniq("MT-NAING"));
      await seedInventory(fromBranch, ingredient, 10);

      const sender = await seedUser("branch_admin", fromBranch);
      const manager = await seedUser("area_manager", undefined, [fromBranch, toBranch]);
      const halfManager = await seedUser("area_manager", undefined, [fromBranch]);

      const { transfer } = await createDraft(sender, fromBranch, toBranch, ingredient);
      await scm.submitMutasiTransferCore(sender, { transferId: transfer.id });

      // branch_admin cannot approve/reject (role pre-check)
      await expect(
        scm.approveMutasiTransferCore(sender, { transferId: transfer.id }),
      ).rejects.toThrow("Only an Area Manager can approve a Mutasi transfer");
      await expect(
        scm.rejectMutasiTransferCore(sender, { transferId: transfer.id, reason: "x" }),
      ).rejects.toThrow("Only an Area Manager can reject a Mutasi transfer");
      // area manager without BOTH branches cannot act (cross-jurisdiction)
      await expect(
        scm.approveMutasiTransferCore(halfManager, { transferId: transfer.id }),
      ).rejects.toThrow("area_manager cannot act on this transfer (cross-jurisdiction)");
      // rejection requires a non-blank reason
      await expect(
        scm.rejectMutasiTransferCore(manager, { transferId: transfer.id, reason: "   " }),
      ).rejects.toThrow("A rejection reason is required");

      // Failed attempts leave the transfer in PendingAMReview.
      expect((await transferStatus(transfer.id)).status).toBe("PendingAMReview");

      // The legitimately-assigned manager can approve.
      await expect(
        scm.approveMutasiTransferCore(manager, { transferId: transfer.id }),
      ).resolves.toMatchObject({ status: "Approved" });
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "every transition rejects the wrong-branch or wrong-role actor, then completes with the right one",
    async () => {
      const fromBranch = await seedBranch(uniq("MT-NWA"));
      const toBranch = await seedBranch(uniq("MT-NWB"));
      const ingredient = await seedIngredient(uniq("MT-NWING"));
      await seedInventory(fromBranch, ingredient, 10);

      const sender = await seedUser("branch_admin", fromBranch);
      const receiver = await seedUser("branch_admin", toBranch);
      const manager = await seedUser("area_manager", undefined, [fromBranch, toBranch]);

      const { transfer } = await createDraft(sender, fromBranch, toBranch, ingredient);
      await scm.submitMutasiTransferCore(sender, { transferId: transfer.id });
      await scm.approveMutasiTransferCore(manager, { transferId: transfer.id });

      // Approved: ship/withdraw are sender-branch-admin actions
      await expect(
        scm.shipMutasiTransferCore(receiver, { transferId: transfer.id }),
      ).rejects.toThrow("Only the sender branch admin can perform this action");
      await expect(
        scm.shipMutasiTransferCore(manager, { transferId: transfer.id }),
      ).rejects.toThrow("Only a Branch Admin can perform ship");
      await expect(
        scm.withdrawMutasiTransferCore(receiver, { transferId: transfer.id }),
      ).rejects.toThrow("Only the sender branch admin can perform this action");
      expect((await transferStatus(transfer.id)).status).toBe("Approved");

      await scm.shipMutasiTransferCore(sender, { transferId: transfer.id });

      // InTransit: cancel is an area-manager action; receiver confirms arrival
      await expect(
        scm.cancelMutasiTransferCore(sender, { transferId: transfer.id, reason: "x" }),
      ).rejects.toThrow("branch_admin is not authorized to perform cancel on a Mutasi transfer");
      await expect(
        scm.markDeliveredMutasiTransferCore(sender, { transferId: transfer.id }),
      ).rejects.toThrow("Only the receiver branch admin can perform this action");
      await expect(
        scm.markDeliveredMutasiTransferCore(manager, { transferId: transfer.id }),
      ).rejects.toThrow("Only a Branch Admin can perform mark-delivered");
      expect((await transferStatus(transfer.id)).status).toBe("InTransit");

      await scm.markDeliveredMutasiTransferCore(receiver, { transferId: transfer.id });

      // Delivered: open-receive is a receiver action
      await expect(
        scm.openReceiveMutasiTransferCore(sender, { transferId: transfer.id }),
      ).rejects.toThrow("Only the receiver branch admin can perform this action");
      await scm.openReceiveMutasiTransferCore(receiver, { transferId: transfer.id });

      // ReviewingSJ: finish-receive is a receiver action
      const [item] = await db
        .select()
        .from(schema.scmTransferItems)
        .where(eq(schema.scmTransferItems.scmTransferId, transfer.id))
        .limit(1);
      const finishItems = [{ id: item.id, receivedQuantity: 5, rejectedQuantity: 0 }];
      await expect(
        scm.finishReceiveMutasiTransferCore(sender, {
          transferId: transfer.id,
          items: finishItems,
        }),
      ).rejects.toThrow("Only the receiver branch admin can perform this action");
      await expect(
        scm.finishReceiveMutasiTransferCore(receiver, {
          transferId: transfer.id,
          items: finishItems,
        }),
      ).resolves.toMatchObject({ status: "WaitingForPayment" });

      // WaitingForPayment: mark-paid is a sender action; receiver is rejected
      await expect(
        scm.markPaidMutasiTransferCore(receiver, { transferId: transfer.id }),
      ).rejects.toThrow("Only the sender branch admin can perform this action");
      await expect(
        scm.markPaidMutasiTransferCore(sender, { transferId: transfer.id }),
      ).resolves.toMatchObject({ status: "Finished" });

      // The audit trail contains only the authorized events (no failed attempts).
      const audit = await db
        .select({ event: schema.scmTransferAuditLog.event })
        .from(schema.scmTransferAuditLog)
        .where(eq(schema.scmTransferAuditLog.scmTransferId, transfer.id));
      expect(audit.map((a) => a.event)).toEqual([
        "submit",
        "approve",
        "ship",
        "mark-delivered",
        "open-receive",
        "finish-receive",
        "mark-paid",
      ]);
    },
  );
});
