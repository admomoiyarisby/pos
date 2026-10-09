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
    "per-line rejection returns to the sender and invoices only the received quantity",
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

      // Receiver accepts 3, rejects 2 (with a per-line reason, returned to
      // the sender explicitly).
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
              rejectionDisposition: "Return to Source",
            },
          ],
        }),
      ).resolves.toMatchObject({ status: "WaitingForPayment" });

      // The chosen disposition is persisted on the item.
      const [itemAfter] = await db
        .select()
        .from(schema.scmTransferItems)
        .where(eq(schema.scmTransferItems.id, item.id))
        .limit(1);
      expect(itemAfter.rejectionDisposition).toBe("Return to Source");

      // Only the received units land in receiver inventory; the rejected 2
      // return to the sender (issue #93) instead of being stranded.
      expect(await getStock(toBranch, ingredient)).toBe(3);
      expect(await getStock(fromBranch, ingredient)).toBe(7); // 5 shipped − 0 received + 2 rejected back

      // Invoice totals only the received quantity (3 × 1000 average cost).
      const [invoice] = await db
        .select()
        .from(schema.scmTransferInvoices)
        .where(eq(schema.scmTransferInvoices.scmTransferId, transfer.id));
      expect(invoice.totalAmount).toBe(3000);

      // ADR 0018: "Return to Source" is a return, not a waste entry. Nothing is
      // reported as Spoiled at the receiver; the rejected 2 units are tracked as
      // a Retur Barang pending pickup.
      const wastes = await db
        .select()
        .from(schema.wasteEntries)
        .where(eq(schema.wasteEntries.ingredientId, ingredient));
      expect(wastes).toHaveLength(0);

      const returns = await db
        .select()
        .from(schema.scmReturns)
        .where(eq(schema.scmReturns.scmTransferId, transfer.id));
      expect(returns).toHaveLength(1);
      expect(returns[0].branchId).toBe(toBranch);
      expect(returns[0].ingredientId).toBe(ingredient);
      expect(returns[0].quantity).toBe(2);
      expect(returns[0].valuation).toBe(2000);
      expect(returns[0].reason).toBe("Barang rusak 2 pcs");
      expect(returns[0].disposition).toBe("Return to Source");
      expect(returns[0].status).toBe("Pending");
      expect(returns[0].createdById).toBe(receiver.id);

      // The pending_review_inventory row must be fully cleared, including the
      // fully-rejected case (issue #93: no stranded rows).
      const pendingRows = await db
        .select()
        .from(schema.pendingReviewInventory)
        .where(eq(schema.pendingReviewInventory.scmTransferId, transfer.id));
      expect(pendingRows.every((r) => r.clearedAt !== null)).toBe(true);

      // The rejected 2 units return to the sender via an IN ledger entry.
      const rejectLedger = await db
        .select()
        .from(schema.stockLedger)
        .where(eq(schema.stockLedger.reference, transfer.id));
      expect(
        rejectLedger.find(
          (l) => l.type === "IN" && l.quantity === 2 && l.notes?.includes("Mutasi Reject"),
        ),
      ).toBeTruthy();

      // The transfer can still be completed.
      await expect(
        scm.markPaidMutasiTransferCore(sender, { transferId: transfer.id }),
      ).resolves.toMatchObject({ status: "Finished" });
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "Scrap disposition writes the rejected stock off instead of returning it to the sender",
    async () => {
      const fromBranch = await seedBranch(uniq("MT-SCRA"));
      const toBranch = await seedBranch(uniq("MT-SCRB"));
      const ingredient = await seedIngredient(uniq("MT-SCRING"));
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
              receivedQuantity: 0,
              rejectedQuantity: 5,
              reason: "Pecah semua",
              rejectionDisposition: "Scrap",
            },
          ],
        }),
      ).resolves.toMatchObject({ status: "WaitingForPayment" });

      // Scrapped stock goes nowhere: sender keeps the post-ship balance.
      expect(await getStock(fromBranch, ingredient)).toBe(5);
      expect(await getStock(toBranch, ingredient)).toBe(0);

      // The disposition is persisted and reported on the item row.
      const [itemAfter] = await db
        .select()
        .from(schema.scmTransferItems)
        .where(eq(schema.scmTransferItems.id, item.id))
        .limit(1);
      expect(itemAfter.rejectionDisposition).toBe("Scrap");

      // No return ledger entry for a scrapped line.
      const rejectLedger = await db
        .select()
        .from(schema.stockLedger)
        .where(eq(schema.stockLedger.reference, transfer.id));
      expect(
        rejectLedger.filter((l) => l.type === "IN" && l.notes?.includes("Mutasi Reject")),
      ).toHaveLength(0);

      // Waste entry still records the disposition.
      const wastes = await db
        .select()
        .from(schema.wasteEntries)
        .where(eq(schema.wasteEntries.branchId, toBranch));
      expect(wastes).toHaveLength(1);
      expect(wastes[0].notes).toBe("Discard (Scrap) — Pecah semua");

      // Pending rows still fully cleared (issue #93).
      const pendingRows = await db
        .select()
        .from(schema.pendingReviewInventory)
        .where(eq(schema.pendingReviewInventory.scmTransferId, transfer.id));
      expect(pendingRows.every((r) => r.clearedAt !== null)).toBe(true);
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "fractional quantities flow through the pipeline without rounding",
    async () => {
      const fromBranch = await seedBranch(uniq("MT-DECA"));
      const toBranch = await seedBranch(uniq("MT-DECB"));
      const ingredient = await seedIngredient(uniq("MT-DECING"));
      await seedInventory(fromBranch, ingredient, 10);

      const sender = await seedUser("branch_admin", fromBranch);
      const receiver = await seedUser("branch_admin", toBranch);
      const manager = await seedUser("area_manager", undefined, [fromBranch, toBranch]);

      // Draft with a fractional quantity (2.5 kg-style line).
      const { transfer, warnings } = await scm.createMutasiTransferCore(sender, {
        fromBranchId: fromBranch,
        toBranchId: toBranch,
        items: [{ ingredientId: ingredient, quantity: 2.5 }],
        notes: "decimal flow",
      });
      expect(warnings).toEqual([]);

      const [item] = await db
        .select()
        .from(schema.scmTransferItems)
        .where(eq(schema.scmTransferItems.scmTransferId, transfer.id))
        .limit(1);
      expect(item.quantity).toBeCloseTo(2.5, 5);

      await scm.submitMutasiTransferCore(sender, { transferId: transfer.id });
      await scm.approveMutasiTransferCore(manager, { transferId: transfer.id });
      await scm.shipMutasiTransferCore(sender, { transferId: transfer.id });

      // Sender shipped exactly 2.5 (10 − 2.5 = 7.5), no integer rounding.
      expect(await getStock(fromBranch, ingredient)).toBeCloseTo(7.5, 5);

      await scm.markDeliveredMutasiTransferCore(receiver, { transferId: transfer.id });
      await scm.openReceiveMutasiTransferCore(receiver, { transferId: transfer.id });

      // Receiver accepts 2.25, rejects 0.25 back to the sender.
      await expect(
        scm.finishReceiveMutasiTransferCore(receiver, {
          transferId: transfer.id,
          items: [
            {
              id: item.id,
              receivedQuantity: 2.25,
              rejectedQuantity: 0.25,
              reason: "Tumpah 0.25 kg",
              rejectionDisposition: "Return to Source",
            },
          ],
        }),
      ).resolves.toMatchObject({ status: "WaitingForPayment" });

      expect(await getStock(toBranch, ingredient)).toBeCloseTo(2.25, 5);
      expect(await getStock(fromBranch, ingredient)).toBeCloseTo(7.75, 5); // 7.5 + 0.25 back

      // Item row keeps the fractional received/rejected split.
      const [itemAfter] = await db
        .select()
        .from(schema.scmTransferItems)
        .where(eq(schema.scmTransferItems.id, item.id))
        .limit(1);
      expect(itemAfter.receivedQuantity).toBeCloseTo(2.25, 5);
      expect(itemAfter.rejectedQuantity).toBeCloseTo(0.25, 5);

      // Invoice totals only the received fraction (2.25 × 1000).
      const [invoice] = await db
        .select()
        .from(schema.scmTransferInvoices)
        .where(eq(schema.scmTransferInvoices.scmTransferId, transfer.id));
      expect(invoice.totalAmount).toBe(2250);
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

  it.skipIf(!hasTestDatabaseUrl)(
    "finish-receive refuses a rejected line without a reason (Jambangan incident 2026-09-30)",
    async () => {
      const fromBranch = await seedBranch(uniq("MT-RA"));
      const toBranch = await seedBranch(uniq("MT-RB"));
      const ingredient = await seedIngredient(uniq("MT-RING"));
      await seedInventory(fromBranch, ingredient, 10);

      const sender = await seedUser("branch_admin", fromBranch);
      const receiver = await seedUser("branch_admin", toBranch);

      const { transfer } = await createDraft(sender, fromBranch, toBranch, ingredient);
      await scm.submitMutasiTransferCore(sender, { transferId: transfer.id });
      const manager = await seedUser("area_manager", undefined, [fromBranch, toBranch]);
      await scm.approveMutasiTransferCore(manager, { transferId: transfer.id });
      await scm.shipMutasiTransferCore(sender, { transferId: transfer.id });
      await scm.markDeliveredMutasiTransferCore(receiver, { transferId: transfer.id });
      await scm.openReceiveMutasiTransferCore(receiver, { transferId: transfer.id });

      const [item] = await db
        .select()
        .from(schema.scmTransferItems)
        .where(eq(schema.scmTransferItems.scmTransferId, transfer.id))
        .limit(1);

      // Full rejection with NO reason → domain failure, nothing changes.
      await expect(
        scm.finishReceiveMutasiTransferCore(receiver, {
          transferId: transfer.id,
          items: [{ id: item.id, receivedQuantity: 0, rejectedQuantity: 5 }],
        }),
      ).rejects.toThrow("Alasan penolakan wajib diisi");
      expect((await transferStatus(transfer.id)).status).toBe("ReviewingSJ");
      // Sender's stock must be untouched (the transaction rolled back).
      expect(await getStock(fromBranch, ingredient)).toBe(5);

      // The same payload WITH a reason goes through; stock returns to sender.
      await expect(
        scm.finishReceiveMutasiTransferCore(receiver, {
          transferId: transfer.id,
          items: [
            { id: item.id, receivedQuantity: 0, rejectedQuantity: 5, reason: "kemasan rusak" },
          ],
        }),
      ).resolves.toMatchObject({ status: "WaitingForPayment" });
      expect(await getStock(fromBranch, ingredient)).toBe(10);
      expect(await getStock(toBranch, ingredient)).toBe(0);
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "finish-receive refuses received + rejected above the shipped quantity",
    async () => {
      const fromBranch = await seedBranch(uniq("MT-SA"));
      const toBranch = await seedBranch(uniq("MT-SB"));
      const ingredient = await seedIngredient(uniq("MT-SING"));
      await seedInventory(fromBranch, ingredient, 10);

      const sender = await seedUser("branch_admin", fromBranch);
      const receiver = await seedUser("branch_admin", toBranch);

      const { transfer } = await createDraft(sender, fromBranch, toBranch, ingredient);
      await scm.submitMutasiTransferCore(sender, { transferId: transfer.id });
      const manager = await seedUser("area_manager", undefined, [fromBranch, toBranch]);
      await scm.approveMutasiTransferCore(manager, { transferId: transfer.id });
      await scm.shipMutasiTransferCore(sender, { transferId: transfer.id });
      await scm.markDeliveredMutasiTransferCore(receiver, { transferId: transfer.id });
      await scm.openReceiveMutasiTransferCore(receiver, { transferId: transfer.id });

      const [item] = await db
        .select()
        .from(schema.scmTransferItems)
        .where(eq(schema.scmTransferItems.scmTransferId, transfer.id))
        .limit(1);

      await expect(
        scm.finishReceiveMutasiTransferCore(receiver, {
          transferId: transfer.id,
          items: [{ id: item.id, receivedQuantity: 4, rejectedQuantity: 3, reason: "coba" }],
        }),
      ).rejects.toThrow("tidak boleh melebihi jumlah dikirim");
      expect((await transferStatus(transfer.id)).status).toBe("ReviewingSJ");
    },
  );
});

// =============================================================================
// ADR 0019 — prevention guards for double-credit on receiving
//
// Two defects found auditing Royal Plaza (2026-10-05), both "recorded twice":
//
//  1. `MT/CENTRAL/041026/06` listed Simple Syrup on two lines (1000 + 3000)
//     and `finish-receive` credited BOTH — the outlet held 4000 against 3000
//     delivered. Now blocked by `stxi_transfer_ingredient_unique` plus an
//     application-level message.
//
//  2. The reviewing form pre-filled `received` with the promised quantity, so
//     submitting it untouched always meant "received everything". All 22
//     transfers in the database were received that way, `rejectedQuantity` 0
//     on every line — a physical shortage was never representable. The form now
//     starts at 0 and a whole-delivery acceptance is recorded as such.
// =============================================================================

describe("Mutasi Stok — duplicate lines and un-counted receipts (ADR 0019)", () => {
  /** Walk a draft to ReviewingSJ so `finish-receive` is legal. */
  async function draftToReviewing(
    sender: MutasiActorUser,
    receiver: MutasiActorUser,
    manager: MutasiActorUser,
    fromBranch: string,
    toBranch: string,
    ingredientId: string,
  ): Promise<{ transferId: string; itemIds: string[] }> {
    const { transfer } = await scm.createMutasiTransferCore(sender, {
      fromBranchId: fromBranch,
      toBranchId: toBranch,
      items: [{ ingredientId, quantity: 10 }],
    });
    await scm.submitMutasiTransferCore(sender, { transferId: transfer.id });
    await scm.approveMutasiTransferCore(manager, { transferId: transfer.id });
    await scm.shipMutasiTransferCore(sender, { transferId: transfer.id });
    await scm.markDeliveredMutasiTransferCore(receiver, { transferId: transfer.id });
    await scm.openReceiveMutasiTransferCore(receiver, { transferId: transfer.id });
    const items = await db
      .select({ id: schema.scmTransferItems.id })
      .from(schema.scmTransferItems)
      .where(eq(schema.scmTransferItems.scmTransferId, transfer.id));
    return { transferId: transfer.id, itemIds: items.map((i) => i.id) };
  }

  it.skipIf(!hasTestDatabaseUrl)(
    "refuses a transfer that lists the same ingredient on two lines",
    async () => {
      const fromBranch = await seedBranch(uniq("MT-DUP-A"));
      const toBranch = await seedBranch(uniq("MT-DUP-B"));
      const ingredient = await seedIngredient(uniq("MT-SYRUP"));
      await seedInventory(fromBranch, ingredient, 100);
      const sender = await seedUser("branch_admin", fromBranch);

      // The Royal Plaza shape: one ingredient, two lines.
      await expect(
        scm.createMutasiTransferCore(sender, {
          fromBranchId: fromBranch,
          toBranchId: toBranch,
          items: [
            { ingredientId: ingredient, quantity: 10 },
            { ingredientId: ingredient, quantity: 30 },
          ],
        }),
      ).rejects.toThrow(/tidak boleh muncul lebih dari satu kali/i);

      // Nothing was written — no orphan draft, no partial items.
      const drafts = await db
        .select()
        .from(schema.scmTransfers)
        .where(eq(schema.scmTransfers.fromBranchId, fromBranch));
      expect(drafts).toHaveLength(0);
    },
  );

  it.skipIf(!hasTestDatabaseUrl)("refuses a duplicate line at the database level too", async () => {
    const fromBranch = await seedBranch(uniq("MT-DBC-A"));
    const toBranch = await seedBranch(uniq("MT-DBC-B"));
    const ingredient = await seedIngredient(uniq("MT-DBC-ING"));
    await seedInventory(fromBranch, ingredient, 100);
    const sender = await seedUser("branch_admin", fromBranch);
    const { transfer } = await scm.createMutasiTransferCore(sender, {
      fromBranchId: fromBranch,
      toBranchId: toBranch,
      items: [{ ingredientId: ingredient, quantity: 10 }],
    });

    // Bypass the application check entirely — the constraint is the backstop.
    await expect(
      db.insert(schema.scmTransferItems).values({
        scmTransferId: transfer.id,
        ingredientId: ingredient,
        sortOrder: 9,
        quantity: 30,
        unitPrice: 1000,
      }),
    ).rejects.toThrow();
  });

  it.skipIf(!hasTestDatabaseUrl)(
    "a partial receipt is credited only for what was counted",
    async () => {
      const fromBranch = await seedBranch(uniq("MT-PART-A"));
      const toBranch = await seedBranch(uniq("MT-PART-B"));
      const bowls = await seedIngredient(uniq("MT-BOWL"));
      await seedInventory(fromBranch, bowls, 100);
      const sender = await seedUser("branch_admin", fromBranch);
      const receiver = await seedUser("branch_admin", toBranch);
      const manager = await seedUser("area_manager", undefined, [fromBranch, toBranch]);

      const { transferId, itemIds } = await draftToReviewing(
        sender,
        receiver,
        manager,
        fromBranch,
        toBranch,
        bowls,
      );
      // 10 promised, 6 actually arrived, 4 short and sent back.
      await expect(
        scm.finishReceiveMutasiTransferCore(receiver, {
          transferId,
          items: [
            {
              id: itemIds[0],
              receivedQuantity: 6,
              rejectedQuantity: 4,
              reason: "Rusak di jalan",
            },
          ],
        }),
      ).resolves.toMatchObject({ status: "WaitingForPayment" });

      // The point of the whole change: inventory reflects the count, not the promise.
      expect(await getStock(toBranch, bowls)).toBe(6);
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "a whole-delivery acceptance without counting is recorded on the document",
    async () => {
      const fromBranch = await seedBranch(uniq("MT-ALL-A"));
      const toBranch = await seedBranch(uniq("MT-ALL-B"));
      const rolls = await seedIngredient(uniq("MT-NOTA"));
      await seedInventory(fromBranch, rolls, 100);
      const sender = await seedUser("branch_admin", fromBranch);
      const receiver = await seedUser("branch_admin", toBranch);
      const manager = await seedUser("area_manager", undefined, [fromBranch, toBranch]);

      const { transferId, itemIds } = await draftToReviewing(
        sender,
        receiver,
        manager,
        fromBranch,
        toBranch,
        rolls,
      );
      await expect(
        scm.finishReceiveMutasiTransferCore(receiver, {
          transferId,
          acceptedAllWithoutCount: true,
          items: [{ id: itemIds[0], receivedQuantity: 10, rejectedQuantity: 0 }],
        }),
      ).resolves.toMatchObject({ status: "WaitingForPayment" });

      // The marker rides on the document's own audit trail.
      const [entry] = await db
        .select({ note: schema.scmTransferAuditLog.note })
        .from(schema.scmTransferAuditLog)
        .where(
          and(
            eq(schema.scmTransferAuditLog.scmTransferId, transferId),
            eq(schema.scmTransferAuditLog.event, "finish-receive"),
          ),
        );
      expect(entry.note).toMatch(/tanpa menghitung/i);
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "a counted-and-matched receipt carries no such marker",
    async () => {
      const fromBranch = await seedBranch(uniq("MT-OK-A"));
      const toBranch = await seedBranch(uniq("MT-OK-B"));
      const cups = await seedIngredient(uniq("MT-CUP"));
      await seedInventory(fromBranch, cups, 100);
      const sender = await seedUser("branch_admin", fromBranch);
      const receiver = await seedUser("branch_admin", toBranch);
      const manager = await seedUser("area_manager", undefined, [fromBranch, toBranch]);

      const { transferId, itemIds } = await draftToReviewing(
        sender,
        receiver,
        manager,
        fromBranch,
        toBranch,
        cups,
      );
      // Counted, and the count matched the promise — the common good case must
      // not be flagged as an assumption.
      await expect(
        scm.finishReceiveMutasiTransferCore(receiver, {
          transferId,
          items: [{ id: itemIds[0], receivedQuantity: 10, rejectedQuantity: 0 }],
        }),
      ).resolves.toMatchObject({ status: "WaitingForPayment" });

      const [entry] = await db
        .select({ note: schema.scmTransferAuditLog.note })
        .from(schema.scmTransferAuditLog)
        .where(
          and(
            eq(schema.scmTransferAuditLog.scmTransferId, transferId),
            eq(schema.scmTransferAuditLog.event, "finish-receive"),
          ),
        );
      expect(entry.note ?? "").not.toMatch(/tanpa menghitung/i);
    },
  );
});

describe("Mutasi Stok — draft line-quantity edits", () => {
  it.skipIf(!hasTestDatabaseUrl)(
    "sender branch_admin can change a draft quantity, and the change is audited in place",
    async () => {
      const fromBranch = await seedBranch(uniq("MT-ED1"));
      const toBranch = await seedBranch(uniq("MT-ED2"));
      const ingredient = await seedIngredient(uniq("MT-EDING"));
      await seedInventory(fromBranch, ingredient, 10);

      const sender = await seedUser("branch_admin", fromBranch);
      const { transfer } = await createDraft(sender, fromBranch, toBranch, ingredient);
      const [item] = await db
        .select({ id: schema.scmTransferItems.id, quantity: schema.scmTransferItems.quantity })
        .from(schema.scmTransferItems)
        .where(eq(schema.scmTransferItems.scmTransferId, transfer.id));
      expect(item.quantity).toBe(5);

      await expect(
        scm.updateMutasiTransferDraftItemsCore(sender, {
          transferId: transfer.id,
          items: [{ id: item.id, quantity: 8 }],
        }),
      ).resolves.toMatchObject({ success: true });

      // State is untouched — this is an in-state edit, not a transition.
      expect((await transferStatus(transfer.id)).status).toBe("SuratJalanDraft");
      const [after] = await db
        .select({ quantity: schema.scmTransferItems.quantity })
        .from(schema.scmTransferItems)
        .where(eq(schema.scmTransferItems.id, item.id));
      expect(after.quantity).toBe(8);

      // The changed promise lands on the document's own trail, which is what a
      // later shortfall gets measured against.
      const [audit] = await db
        .select({ note: schema.scmTransferAuditLog.note, event: schema.scmTransferAuditLog.event })
        .from(schema.scmTransferAuditLog)
        .where(eq(schema.scmTransferAuditLog.scmTransferId, transfer.id));
      expect(audit.event).toBe("item-update");
      expect(JSON.parse(audit.note ?? "{}")).toEqual({ quantity: { from: 5, to: 8 } });
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "the stock guardrail rejects a quantity the sender branch does not hold",
    async () => {
      const fromBranch = await seedBranch(uniq("MT-ED3"));
      const toBranch = await seedBranch(uniq("MT-ED4"));
      const ingredient = await seedIngredient(uniq("MT-EDING2"));
      await seedInventory(fromBranch, ingredient, 10);

      const sender = await seedUser("branch_admin", fromBranch);
      const { transfer } = await createDraft(sender, fromBranch, toBranch, ingredient);
      const [item] = await db
        .select({ id: schema.scmTransferItems.id, quantity: schema.scmTransferItems.quantity })
        .from(schema.scmTransferItems)
        .where(eq(schema.scmTransferItems.scmTransferId, transfer.id));

      // 11 > 10 available. The failed save must leave the original quantity.
      await expect(
        scm.updateMutasiTransferDraftItemsCore(sender, {
          transferId: transfer.id,
          items: [{ id: item.id, quantity: 11 }],
        }),
      ).rejects.toThrow(/Stok tidak mencukupi/);

      const [after] = await db
        .select({ quantity: schema.scmTransferItems.quantity })
        .from(schema.scmTransferItems)
        .where(eq(schema.scmTransferItems.id, item.id));
      expect(after.quantity).toBe(5);

      // Exactly the available quantity is allowed (no off-by-one from epsilons).
      await expect(
        scm.updateMutasiTransferDraftItemsCore(sender, {
          transferId: transfer.id,
          items: [{ id: item.id, quantity: 10 }],
        }),
      ).resolves.toMatchObject({ success: true });
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "only the sender branch (or super_admin) may edit; other states reject the edit",
    async () => {
      const fromBranch = await seedBranch(uniq("MT-ED5"));
      const toBranch = await seedBranch(uniq("MT-ED6"));
      const unrelatedBranch = await seedBranch(uniq("MT-ED7"));
      const ingredient = await seedIngredient(uniq("MT-EDING3"));
      await seedInventory(fromBranch, ingredient, 10);

      const sender = await seedUser("branch_admin", fromBranch);
      const receiver = await seedUser("branch_admin", toBranch);
      const unrelated = await seedUser("branch_admin", unrelatedBranch);
      const adminPusat = await seedUser("admin_pusat");
      const manager = await seedUser("area_manager", undefined, [fromBranch, toBranch]);
      const superAdmin = await seedUser("super_admin");

      const { transfer } = await createDraft(sender, fromBranch, toBranch, ingredient);
      const [item] = await db
        .select({ id: schema.scmTransferItems.id })
        .from(schema.scmTransferItems)
        .where(eq(schema.scmTransferItems.scmTransferId, transfer.id));
      const patch = { transferId: transfer.id, items: [{ id: item.id, quantity: 6 }] };

      // Wrong side, wrong branch, non-actor, and the AM (who only reviews).
      await expect(scm.updateMutasiTransferDraftItemsCore(receiver, patch)).rejects.toThrow(
        "Only the sender branch can edit the draft",
      );
      await expect(scm.updateMutasiTransferDraftItemsCore(unrelated, patch)).rejects.toThrow(
        "branch_admin can only access transfers involving their branch",
      );
      await expect(scm.updateMutasiTransferDraftItemsCore(adminPusat, patch)).rejects.toThrow(
        "admin_pusat cannot access Mutasi Stok transfers",
      );
      await expect(scm.updateMutasiTransferDraftItemsCore(manager, patch)).rejects.toThrow(
        "Only the sender branch can edit the draft",
      );

      // super_admin is the emergency override: it edits on the sender's behalf.
      await expect(
        scm.updateMutasiTransferDraftItemsCore(superAdmin, patch),
      ).resolves.toMatchObject({ success: true });

      // Once the draft is submitted, the promise is frozen until it is withdrawn.
      await scm.submitMutasiTransferCore(sender, { transferId: transfer.id });
      await expect(scm.updateMutasiTransferDraftItemsCore(sender, patch)).rejects.toThrow(
        "Items can only be edited while in SuratJalanDraft",
      );
      // ...and a rejected edit leaves no trace on the audit trail.
      const rows = await db
        .select({ id: schema.scmTransferAuditLog.id })
        .from(schema.scmTransferAuditLog)
        .where(eq(schema.scmTransferAuditLog.event, "item-update"));
      expect(rows).toHaveLength(1);
    },
  );

  it.skipIf(!hasTestDatabaseUrl)("an unknown item id fails the whole request", async () => {
    const fromBranch = await seedBranch(uniq("MT-ED8"));
    const toBranch = await seedBranch(uniq("MT-ED9"));
    const ingredient = await seedIngredient(uniq("MT-EDING4"));
    await seedInventory(fromBranch, ingredient, 10);

    const sender = await seedUser("branch_admin", fromBranch);
    const { transfer } = await createDraft(sender, fromBranch, toBranch, ingredient);
    const [item] = await db
      .select({ id: schema.scmTransferItems.id })
      .from(schema.scmTransferItems)
      .where(eq(schema.scmTransferItems.scmTransferId, transfer.id));

    await expect(
      scm.updateMutasiTransferDraftItemsCore(sender, {
        transferId: transfer.id,
        items: [
          { id: item.id, quantity: 7 },
          { id: crypto.randomUUID(), quantity: 3 },
        ],
      }),
    ).rejects.toThrow(/not found in transfer/);

    // Nothing was half-applied.
    const [after] = await db
      .select({ quantity: schema.scmTransferItems.quantity })
      .from(schema.scmTransferItems)
      .where(eq(schema.scmTransferItems.id, item.id));
    expect(after.quantity).toBe(5);
  });
});
