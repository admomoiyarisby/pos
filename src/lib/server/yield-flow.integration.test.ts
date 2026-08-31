/* oxlint-disable anti-slop/no-console -- effects log progress; not assertions */
/**
 * Yield tracking (Produksi) full-flow integration test.
 *
 * Drives the real user-parameterized cores from `yield.ts` against the local
 * dockerized test Postgres: `createYieldConversionCore` → `requestYieldCancelCore`
 * → `approveYieldCancelRequestCore` / `rejectYieldCancelRequestCore`, plus
 * `directCancelYieldConversionCore`. Each core is the exact business logic the
 * `createServerFn` transport endpoint runs — the only thing bypassed is
 * `requireAuth()` / `requireRole()` (HTTP session), replaced by an explicit
 * `user` argument per call, so role and branch guards are fully exercised.
 * All cores throw on failure (no `{success:false}` envelope), so negative
 * cases assert on thrown errors.
 *
 * Isolation: the cores hit the module-level `db` from `#/lib/server/db`, so
 * that module is mocked to return a drizzle instance over a connection to the
 * local test database, and shared tables are TRUNCATE-d between tests. No
 * outer transaction is held open, so the cores' own `db.transaction()` calls
 * behave normally and a failing inner step only rolls back its own work.
 *
 * Run:  TEST_DATABASE_URL=postgresql://omoiyari_test:omoiyari_test@localhost:5433/omoiyari_pos_test DATABASE_URL= vp test run src/lib/server/yield-flow.integration.test.ts
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
let yieldApi: typeof import("./yield");
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

/** Persist a real `users` row for an actor (FKs require it) and return the
 *  AppUser-shaped object the cores consume. */
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

async function conversionStatus(
  id: string,
): Promise<{ status: string; cancelReason: string | null }> {
  const [row] = await db
    .select({
      status: schema.yieldConversions.status,
      cancelReason: schema.yieldConversions.cancelReason,
    })
    .from(schema.yieldConversions)
    .where(eq(schema.yieldConversions.id, id))
    .limit(1);
  if (!row) throw new Error(`conversion ${id} not found`);
  return row;
}

async function ledgerRows(reference: string) {
  return db
    .select({
      ingredientId: schema.stockLedger.ingredientId,
      type: schema.stockLedger.type,
      quantity: schema.stockLedger.quantity,
      balance: schema.stockLedger.balance,
      notes: schema.stockLedger.notes,
    })
    .from(schema.stockLedger)
    .where(eq(schema.stockLedger.reference, reference));
}

async function createConversion(
  ba: AppUser,
  branchId: string,
  outIngredientId: string,
  producedIngredientId: string,
) {
  const res = await yieldApi.createYieldConversionCore(ba, {
    branchId,
    out: [{ ingredientId: outIngredientId, quantity: 5 }],
    produced: [{ ingredientId: producedIngredientId, quantity: 3 }],
    notes: "integration flow",
  });
  expect(res.success).toBe(true);
  return res;
}

async function requestCancel(ba: AppUser, conversionId: string, reason = "Stok salah catat") {
  return yieldApi.requestYieldCancelCore(ba, { yieldConversionId: conversionId, reason });
}

beforeAll(async () => {
  if (!hasTestDatabaseUrl) return;
  // SAFETY: guarded by hasTestDatabaseUrl; when the test DB is absent beforeAll returns early and every test is skipped, so db is never read unset.
  db = dbHolder.db as TestDb;
  yieldApi = await import("./yield");
});

describe("Yield — full flow via the real server-function cores", () => {
  it.skipIf(!hasTestDatabaseUrl)(
    "happy path: create (stock effect) → request cancel → approve → stock reversed",
    async () => {
      const branch = await seedBranch(uniq("YL-A"));
      const outIng = await seedIngredient(uniq("YL-AOUT"));
      const producedIng = await seedIngredient(uniq("YL-APROD"));

      const ba = await seedUser("branch_admin", branch);
      const superAdmin = await seedUser("super_admin");

      // 1. Create — records the conversion and applies the stock effect (ADR 0012)
      const { conversion } = await createConversion(ba, branch, outIng, producedIng);
      expect(conversion.status).toBe("Active");
      expect(conversion.processedBy).toBe(ba.id);

      // OUT deducted (upsert from 0 → -5), PRODUCED added (0 → 3)
      expect(await getStock(branch, outIng)).toBe(-5);
      expect(await getStock(branch, producedIng)).toBe(3);

      // Ledger mirrors both moves on a shared YIELD-* reference
      const ledger = await ledgerRows(`YIELD-${conversion.id}`);
      expect(ledger).toHaveLength(2);
      expect(ledger).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ ingredientId: outIng, type: "OUT", quantity: 5, balance: -5 }),
          expect.objectContaining({
            ingredientId: producedIng,
            type: "IN",
            quantity: 3,
            balance: 3,
          }),
        ]),
      );

      // 2. Request cancel — branch admin requests, super_admin notified
      const req = await requestCancel(ba, conversion.id);
      expect(req.status).toBe("Pending");
      expect(req.requestedBy).toBe(ba.id);

      const saNotifs = await db
        .select()
        .from(schema.systemNotifications)
        .where(eq(schema.systemNotifications.userId, superAdmin.id));
      expect(saNotifs.some((n) => n.title === "Permintaan Batal Produksi")).toBe(true);

      // 3. Approve — request Approved, conversion Cancelled, stock reversed
      const approved = await yieldApi.approveYieldCancelRequestCore(superAdmin, {
        requestId: req.id,
      });
      expect(approved.status).toBe("Approved");
      expect(approved.approvedBy).toBe(superAdmin.id);

      const after = await conversionStatus(conversion.id);
      expect(after.status).toBe("Cancelled");
      expect(after.cancelReason).toBe("Stok salah catat");

      // Stock restored (A back to 0, B back to 0); reverse ledger rows written
      expect(await getStock(branch, outIng)).toBe(0);
      expect(await getStock(branch, producedIng)).toBe(0);
      const reversed = await ledgerRows(`YIELD-${conversion.id}`);
      expect(reversed).toHaveLength(4);
      expect(reversed).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ingredientId: outIng,
            type: "IN",
            quantity: 5,
            balance: 0,
            notes: `Produksi dibatalkan ${conversion.id.slice(0, 8)}`,
          }),
          expect.objectContaining({
            ingredientId: producedIng,
            type: "OUT",
            quantity: 3,
            balance: 0,
            notes: `Produksi dibatalkan ${conversion.id.slice(0, 8)}`,
          }),
        ]),
      );

      // Requester notified of the approval
      const baNotifs = await db
        .select()
        .from(schema.systemNotifications)
        .where(eq(schema.systemNotifications.userId, ba.id));
      expect(baNotifs.some((n) => n.title === "Permintaan Batal Produksi Disetujui")).toBe(true);
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "rejection path: AM rejects the cancel request, conversion stays Active, stock untouched",
    async () => {
      const branch = await seedBranch(uniq("YL-R"));
      const outIng = await seedIngredient(uniq("YL-ROUT"));
      const producedIng = await seedIngredient(uniq("YL-RPROD"));

      const ba = await seedUser("branch_admin", branch);
      const am = await seedUser("area_manager", undefined, [branch]);

      const { conversion } = await createConversion(ba, branch, outIng, producedIng);
      const req = await requestCancel(ba, conversion.id);

      const rejected = await yieldApi.rejectYieldCancelRequestCore(am, { requestId: req.id });
      expect(rejected.status).toBe("Rejected");
      expect(rejected.approvedBy).toBe(am.id);

      // Conversion untouched, stock untouched
      expect((await conversionStatus(conversion.id)).status).toBe("Active");
      expect(await getStock(branch, outIng)).toBe(-5);
      expect(await getStock(branch, producedIng)).toBe(3);
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "direct cancel: super_admin cancels outright, stock reversed, Executed request recorded",
    async () => {
      const branch = await seedBranch(uniq("YL-D"));
      const outIng = await seedIngredient(uniq("YL-DOUT"));
      const producedIng = await seedIngredient(uniq("YL-DPROD"));

      const ba = await seedUser("branch_admin", branch);
      const superAdmin = await seedUser("super_admin");

      const { conversion } = await createConversion(ba, branch, outIng, producedIng);

      const cancelled = await yieldApi.directCancelYieldConversionCore(superAdmin, {
        yieldConversionId: conversion.id,
        reason: "Salah input produksi",
      });
      expect(cancelled.status).toBe("Cancelled");
      expect(cancelled.cancelReason).toBe("Salah input produksi");

      expect(await getStock(branch, outIng)).toBe(0);
      expect(await getStock(branch, producedIng)).toBe(0);

      // An Executed request row is written for audit
      const [executed] = await db
        .select()
        .from(schema.yieldCancelRequests)
        .where(eq(schema.yieldCancelRequests.yieldConversionId, conversion.id));
      expect(executed).toBeTruthy();
      expect(executed.status).toBe("Executed");
      expect(executed.requestedBy).toBe(superAdmin.id);
    },
  );
});

describe("Yield — wrong-role and wrong-branch actors are rejected", () => {
  it.skipIf(!hasTestDatabaseUrl)(
    "create rejects non-creator roles and branch admins of other branches",
    async () => {
      const branch = await seedBranch(uniq("YL-NC"));
      const otherBranch = await seedBranch(uniq("YL-NCX"));
      const outIng = await seedIngredient(uniq("YL-NCOUT"));
      const producedIng = await seedIngredient(uniq("YL-NCPROD"));

      const otherBa = await seedUser("branch_admin", otherBranch);
      const am = await seedUser("area_manager", undefined, [branch]);

      const input = {
        branchId: branch,
        out: [{ ingredientId: outIng, quantity: 5 }],
        produced: [{ ingredientId: producedIng, quantity: 3 }],
      };

      // area_manager is not a creator role
      await expect(yieldApi.createYieldConversionCore(am, input)).rejects.toThrow(
        "Forbidden: insufficient role",
      );
      // branch_admin of a different branch cannot record production here
      await expect(yieldApi.createYieldConversionCore(otherBa, input)).rejects.toThrow(
        "Unauthorized branch",
      );
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "request cancel rejects wrong role, wrong branch, empty reason, and already-cancelled",
    async () => {
      const branch = await seedBranch(uniq("YL-NR"));
      const otherBranch = await seedBranch(uniq("YL-NRX"));
      const outIng = await seedIngredient(uniq("YL-NROUT"));
      const producedIng = await seedIngredient(uniq("YL-NRPROD"));

      const ba = await seedUser("branch_admin", branch);
      const otherBa = await seedUser("branch_admin", otherBranch);
      const am = await seedUser("area_manager", undefined, [branch]);
      const superAdmin = await seedUser("super_admin");

      const { conversion } = await createConversion(ba, branch, outIng, producedIng);

      // area_manager cannot request (only branch_admin / central_kitchen / super_admin)
      await expect(
        yieldApi.requestYieldCancelCore(am, { yieldConversionId: conversion.id, reason: "x" }),
      ).rejects.toThrow(
        "Unauthorized: only branch_admin, central_kitchen, or super_admin may request cancel",
      );
      // branch_admin of another branch is scoped out
      await expect(
        yieldApi.requestYieldCancelCore(otherBa, {
          yieldConversionId: conversion.id,
          reason: "x",
        }),
      ).rejects.toThrow("Unauthorized branch");
      // empty reason is refused
      await expect(
        yieldApi.requestYieldCancelCore(ba, { yieldConversionId: conversion.id, reason: "  " }),
      ).rejects.toThrow("Alasan pembatalan wajib diisi");

      // A real request succeeds…
      const req = await requestCancel(ba, conversion.id);
      // …and a duplicate Pending request is short-circuited, not duplicated
      const dup = await requestCancel(ba, conversion.id, "lagi");
      expect("alreadyPending" in dup && dup.alreadyPending).toBe(true);
      expect(dup.id).toBe(req.id);

      // After super_admin approves, requesting again is refused (already cancelled)
      await yieldApi.approveYieldCancelRequestCore(superAdmin, { requestId: req.id });
      await expect(
        yieldApi.requestYieldCancelCore(ba, { yieldConversionId: conversion.id, reason: "x" }),
      ).rejects.toThrow("Produksi sudah dibatalkan");
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "approve/reject reject wrong roles and unassigned area managers, without side effects",
    async () => {
      const branch = await seedBranch(uniq("YL-NA"));
      const otherBranch = await seedBranch(uniq("YL-NAX"));
      const outIng = await seedIngredient(uniq("YL-NAOUT"));
      const producedIng = await seedIngredient(uniq("YL-NAPROD"));

      const ba = await seedUser("branch_admin", branch);
      const otherBa = await seedUser("branch_admin", otherBranch);
      const assignedAm = await seedUser("area_manager", undefined, [branch]);
      const unassignedAm = await seedUser("area_manager", undefined, [otherBranch]);

      const { conversion } = await createConversion(ba, branch, outIng, producedIng);
      const req = await requestCancel(ba, conversion.id);

      // branch_admin cannot approve or reject
      await expect(
        yieldApi.approveYieldCancelRequestCore(otherBa, { requestId: req.id }),
      ).rejects.toThrow("Unauthorized: only super_admin or area_manager may approve");
      await expect(
        yieldApi.rejectYieldCancelRequestCore(otherBa, { requestId: req.id }),
      ).rejects.toThrow("Unauthorized: only super_admin or area_manager may reject");

      // AM not assigned to this branch cannot approve or reject
      await expect(
        yieldApi.approveYieldCancelRequestCore(unassignedAm, { requestId: req.id }),
      ).rejects.toThrow(
        "Unauthorized: Area Manager hanya dapat menyetujui untuk cabang yang ditugaskan",
      );
      await expect(
        yieldApi.rejectYieldCancelRequestCore(unassignedAm, { requestId: req.id }),
      ).rejects.toThrow(
        "Unauthorized: Area Manager hanya dapat menolak untuk cabang yang ditugaskan",
      );

      // None of the failed attempts had side effects
      const [stillPending] = await db
        .select()
        .from(schema.yieldCancelRequests)
        .where(eq(schema.yieldCancelRequests.id, req.id));
      expect(stillPending.status).toBe("Pending");
      expect((await conversionStatus(conversion.id)).status).toBe("Active");

      // The assigned AM can reject
      const rejected = await yieldApi.rejectYieldCancelRequestCore(assignedAm, {
        requestId: req.id,
      });
      expect(rejected.status).toBe("Rejected");

      // Processing a non-Pending request is refused
      await expect(
        yieldApi.approveYieldCancelRequestCore(assignedAm, { requestId: req.id }),
      ).rejects.toThrow("Request sudah diproses");
      await expect(
        yieldApi.rejectYieldCancelRequestCore(assignedAm, { requestId: req.id }),
      ).rejects.toThrow("Request sudah diproses");
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "direct cancel rejects non-super-admins, empty reason, and already-cancelled",
    async () => {
      const branch = await seedBranch(uniq("YL-ND"));
      const outIng = await seedIngredient(uniq("YL-NDOUT"));
      const producedIng = await seedIngredient(uniq("YL-NDPROD"));

      const ba = await seedUser("branch_admin", branch);
      const superAdmin = await seedUser("super_admin");

      const { conversion } = await createConversion(ba, branch, outIng, producedIng);

      // Only super_admin may cancel directly
      await expect(
        yieldApi.directCancelYieldConversionCore(ba, {
          yieldConversionId: conversion.id,
          reason: "x",
        }),
      ).rejects.toThrow("Forbidden: insufficient role");
      // Empty reason refused
      await expect(
        yieldApi.directCancelYieldConversionCore(superAdmin, {
          yieldConversionId: conversion.id,
          reason: "",
        }),
      ).rejects.toThrow("Alasan pembatalan wajib diisi");

      // Still Active after the failed attempts
      expect((await conversionStatus(conversion.id)).status).toBe("Active");

      // Real cancel succeeds; a second one is refused
      await yieldApi.directCancelYieldConversionCore(superAdmin, {
        yieldConversionId: conversion.id,
        reason: "batal",
      });
      await expect(
        yieldApi.directCancelYieldConversionCore(superAdmin, {
          yieldConversionId: conversion.id,
          reason: "lagi",
        }),
      ).rejects.toThrow("Produksi sudah dibatalkan");
    },
  );
});
