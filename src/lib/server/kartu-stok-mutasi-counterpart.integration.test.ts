/**
 * Kartu Stok — the counterpart branch on a Mutasi movement.
 *
 * A Mutasi ledger row's `reference` is the transfer id and its note names only
 * the transfer code ("Mutasi MT/… dikirim"), so the sender's ledger could not
 * answer "which branch received this?" without leaving the page. The read path
 * joins `scm_transfers` and surfaces the other end of the movement. Pinned:
 *
 *  - the sender's OUT row names the RECEIVING branch,
 *  - the receiver's IN row names the SENDING branch,
 *  - non-Mutasi rows stay NULL — their reference is not a transfer id.
 *
 * Drives the ADR 0015 core seam (`getStockLedgerCore`) — a vitest process has
 * no Start request context, so `requireAuth()` can't run here — against the
 * local dockerized test Postgres.
 *
 * Run:
 *   TEST_DATABASE_URL=postgresql://omoiyari_test:omoiyari_test@localhost:5433/omoiyari_pos_test DATABASE_URL= vp test run src/lib/server/kartu-stok-mutasi-counterpart.integration.test.ts
 */

import { describe, expect, it, vi } from "vite-plus/test";
import { eq } from "drizzle-orm";
import * as schema from "#/db/schema";
import { getTestDatabaseUrl } from "./test-database";
import type { TestDb } from "./integration-test-harness";
import { setupFlowHarness } from "./integration-test-harness";
import { getStockLedgerCore } from "./inventory";
import type { AppUser } from "./auth";

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

/** Read-side actor: a global auditor (no branch scoping applies). */
const auditor: AppUser = {
  id: crypto.randomUUID(),
  email: "auditor@example.test",
  name: "Ledger Auditor",
  role: "super_admin",
  status: "Active",
};

function testDb(): TestDb {
  if (!dbHolder.db) throw new Error("db holder not initialized — beforeAll must run first");
  return dbHolder.db;
}

/**
 * Central Warehouse sends one item to an outlet, and a POS sale sits in the
 * same ledger so the "no counterpart" case is covered by the same read.
 */
async function seedSenderAndReceiver(): Promise<{
  centralId: string;
  outletId: string;
  transferId: string;
}> {
  const db = testDb();

  const centralId = crypto.randomUUID();
  const outletId = crypto.randomUUID();
  await db.insert(schema.branches).values([
    { id: centralId, code: "CTR", name: "Central Warehouse", location: "Test", type: "Central" },
    { id: outletId, code: "OUT", name: "Omoiyari Darmo Permai", location: "Test", type: "Outlet" },
  ]);

  const userId = crypto.randomUUID();
  await db.insert(schema.users).values({
    id: userId,
    name: "Sender BA",
    email: "sender@example.test",
    role: "central_kitchen",
    branchId: centralId,
  });

  const ingredientId = crypto.randomUUID();
  await db.insert(schema.ingredients).values({
    id: ingredientId,
    code: "MTC-001",
    name: "Plastik Kresek 20",
    category: "Packaging",
    skuType: "RM",
    purchaseUnit: "pack",
    stockUnit: "pack",
    conversionFactor: 1,
    averageCost: 1000,
  });

  const transferId = crypto.randomUUID();
  const transferCode = "MT/CENTRAL/161026/04";
  await db.insert(schema.scmTransfers).values({
    id: transferId,
    code: transferCode,
    fromBranchId: centralId,
    toBranchId: outletId,
    requestedById: userId,
  });

  await db.insert(schema.stockLedger).values([
    // Sender's ledger: the stock left Central for the outlet.
    {
      branchId: centralId,
      ingredientId,
      type: "OUT",
      quantity: 5,
      balance: 36,
      reference: transferId,
      notes: `Mutasi ${transferCode} dikirim`,
    },
    // Receiver's ledger: the same transfer arriving at the outlet.
    {
      branchId: outletId,
      ingredientId,
      type: "IN",
      quantity: 5,
      balance: 5,
      reference: transferId,
      notes: `Mutasi ${transferCode} diterima`,
    },
    // Not a transfer: a reference that is not a uuid must not match, and must
    // not break the join's uuid-to-text cast.
    {
      branchId: outletId,
      ingredientId,
      type: "OUT",
      quantity: 1,
      balance: 4,
      reference: "POS-2026-1016-0001",
      notes: "Penjualan POS",
    },
  ]);

  return { centralId, outletId, transferId };
}

describe.skipIf(!hasTestDatabaseUrl)("Kartu Stok — Mutasi counterpart branch", () => {
  it("names the receiving branch on the sender's row and the sender on the receiver's row", async () => {
    const { centralId, outletId, transferId } = await seedSenderAndReceiver();

    const ledger = await getStockLedgerCore(auditor, { page: 0, limit: 50 });

    // Sender's OUT row: the ledger already says "dikirim"; the counterpart
    // answers the question the note left open.
    const sent = ledger.data.find((row) => row.branchId === centralId && row.type === "OUT");
    expect(sent?.reference).toBe(transferId);
    expect(sent?.counterpartBranchName).toBe("Omoiyari Darmo Permai");

    // Receiver's IN row: the same transfer, seen from the other end.
    const received = ledger.data.find((row) => row.branchId === outletId && row.type === "IN");
    expect(received?.counterpartBranchName).toBe("Central Warehouse");

    // The POS row has no counterpart.
    const pos = ledger.data.find((row) => row.reference.startsWith("POS-"));
    expect(pos?.counterpartBranchName).toBeNull();
  });

  it("finds a mutasi row by the branch it was sent to", async () => {
    const { centralId, transferId } = await seedSenderAndReceiver();

    // "Darmo Permai" appears nowhere in the ledger row itself — not in the
    // notes ("Mutasi MT/… dikirim"), not in the reference, not in the item
    // name. If it is rendered as the counterpart, it must be searchable.
    const hits = await getStockLedgerCore(auditor, { search: "Darmo Permai", page: 0, limit: 50 });

    // total is asserted with data: the count query needs the same joins as the
    // page query, or the search would page against a different result set.
    expect(hits.total).toBe(1);
    expect(hits.data.map((row) => row.branchId)).toEqual([centralId]);
    expect(hits.data[0].reference).toBe(transferId);
  });

  it("matches the counterpart, not the row's own branch", async () => {
    const { centralId, outletId } = await seedSenderAndReceiver();

    // The counterpart is the OTHER end of the movement: the receiver's row
    // shows "dari Central Warehouse", the sender's shows "ke Omoiyari Darmo
    // Permai". Typing "Central Warehouse" must therefore surface the receiver's
    // row and not the sender's own (the Cabang filter is the control for
    // "this branch's movements").
    const hits = await getStockLedgerCore(auditor, {
      search: "Central Warehouse",
      page: 0,
      limit: 50,
    });
    expect(hits.total).toBe(1);
    expect(hits.data.map((row) => `${row.branchId}/${row.type}`)).toEqual([`${outletId}/IN`]);
    expect(hits.data.some((row) => row.branchId === centralId)).toBe(false);
  });

  it("leaves the counterpart NULL when the referenced transfer no longer exists", async () => {
    const { centralId, outletId, transferId } = await seedSenderAndReceiver();

    // A ledger row can outlive its transfer row; the join must degrade to
    // "no counterpart" rather than crash or name the wrong branch.
    await testDb().delete(schema.scmTransfers).where(eq(schema.scmTransfers.id, transferId));

    const ledger = await getStockLedgerCore(auditor, { page: 0, limit: 50 });
    const sent = ledger.data.find((row) => row.branchId === centralId && row.type === "OUT");
    const received = ledger.data.find((row) => row.branchId === outletId && row.type === "IN");

    expect(sent?.counterpartBranchName).toBeNull();
    expect(received?.counterpartBranchName).toBeNull();
  });
});
