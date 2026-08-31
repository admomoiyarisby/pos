/* oxlint-disable anti-slop/no-console -- effects log progress; not assertions */
/**
 * Pengadaan (scm-procurements) full-flow integration test.
 *
 * Walks real procurements through **all 10 FSM states** using the actual
 * user-parameterized server-function cores from `scm-queries.ts`
 * (`createProcurementCore`, `transitionProcurementCore`,
 * `updateProcurementItemCore`). Each core is the exact business logic the
 * `createServerFn` transport endpoint runs — the only thing bypassed is
 * `requireAuth()` / `requireRole()` (HTTP session), replaced by an explicit
 * `user` argument per call, so role and branch guards are fully exercised.
 *
 * Unlike Mutasi, Pengadaan's `transition()` returns
 * `{ success: false, error }` instead of throwing, so negative cases assert
 * on the returned error. `createProcurementCore` throws.
 *
 * Isolation: the cores hit the module-level `db` from `#/lib/server/db`, so
 * that module is mocked to return a drizzle instance over a connection to the
 * local test database, and shared tables are TRUNCATE-d between tests. No
 * outer transaction is held open, so the cores' own `db.transaction()` calls
 * behave normally and a failing inner transition only rolls back its own work.
 *
 * Run:  TEST_DATABASE_URL=postgresql://omoiyari_test:omoiyari_test@localhost:5433/omoiyari_pos_test DATABASE_URL= vp test run src/lib/server/scm-procurements-flow.integration.test.ts
 */

import { beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { and, eq } from "drizzle-orm";
import type { ScmProcurementEvent } from "./scm-fsm";
import * as schema from "#/db/schema";
import { getTestDatabaseUrl } from "./test-database";
import type { TestDb } from "./integration-test-harness";
import { setupFlowHarness } from "./integration-test-harness";
import type { UserRole } from "./auth";
import type { FsmPayload } from "./scm-effects";

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
let scm: typeof import("./scm-queries");
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

async function seedInventory(
  branchId: string,
  ingredientId: string,
  quantity: number,
): Promise<void> {
  await db.insert(schema.inventory).values({ branchId, ingredientId, quantity });
}

/** Persist a real `users` row for an actor (the `*_by_id` FKs require it). */
async function seedUser(
  role: UserRole,
  branchId?: string,
): Promise<{ id: string; role: UserRole; branchId?: string }> {
  const id = crypto.randomUUID();
  await db.insert(schema.users).values({
    id,
    name: `ITS ${role}`,
    email: `its-${id}@pos.test`,
    role,
    branchId,
  });
  return { id, role, branchId };
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

async function procurementStatus(id: string): Promise<{ status: string }> {
  const [row] = await db
    .select({ status: schema.scmProcurements.status })
    .from(schema.scmProcurements)
    .where(eq(schema.scmProcurements.id, id))
    .limit(1);
  if (!row) throw new Error(`procurement ${id} not found`);
  return row;
}

async function createDraft(
  requester: { id: string; role: UserRole; branchId?: string },
  branchId: string,
  ingredientId: string,
) {
  return scm.createProcurementCore(requester, {
    branchId,
    items: [{ ingredientId, quantity: 5 }],
    notes: "integration flow",
  });
}

/** A successful transition, returning the new status (throws on failure). */
async function t(
  user: { id: string; role: string },
  procurementId: string,
  event: ScmProcurementEvent,
  payload: FsmPayload = {},
): Promise<string> {
  const res = await scm.transitionProcurementCore(user, {
    procurementId,
    event,
    payload,
  });
  if (!res.success) throw new Error(`transition ${event} failed: ${res.error.message}`);
  return res.status;
}

/** A transition expected to fail: returns the error message. */
async function failingTransition(
  user: { id: string; role: string },
  procurementId: string,
  event: ScmProcurementEvent,
  payload: FsmPayload = {},
): Promise<string> {
  const res = await scm.transitionProcurementCore(user, {
    procurementId,
    event,
    payload,
  });
  expect(res.success).toBe(false);
  return res.success === false ? res.error.message : "";
}

beforeAll(async () => {
  if (!hasTestDatabaseUrl) return;
  // SAFETY: guarded by hasTestDatabaseUrl; when the test DB is absent beforeAll returns early and every test is skipped, so db is never read unset.
  db = dbHolder.db as TestDb;
  scm = await import("./scm-queries");
});

describe("Pengadaan — full 10-state flow via the real server-function cores", () => {
  it.skipIf(!hasTestDatabaseUrl)(
    "happy path: Draft → Pending → UnderReview → InTransit → Delivered → ReviewingSJ → WaitingForPayment → Finished",
    async () => {
      const central = await seedBranch(uniq("PR-C"), "Central");
      const outlet = await seedBranch(uniq("PR-O"), "Outlet");
      const ingredient = await seedIngredient(uniq("PR-ING"));
      await seedInventory(central, ingredient, 10); // Central's stock

      const requester = await seedUser("branch_admin", outlet);
      const centralAdmin = await seedUser("admin_pusat");

      // 1. Draft — requester branch admin creates the PR
      const { id: procurementId, code } = await createDraft(requester, outlet, ingredient);
      expect(code).toMatch(/^PR\//);
      expect((await procurementStatus(procurementId)).status).toBe("Draft");

      // 2. Pending — requester submits
      expect(await t(requester, procurementId, "submit")).toBe("Pending");

      // 3. UnderReview — central admin opens review
      expect(await t(centralAdmin, procurementId, "open-review")).toBe("UnderReview");

      // Central admin approves the line for shipping (CA decision, UnderReview-only)
      const [item] = await db
        .select()
        .from(schema.scmProcurementItems)
        .where(eq(schema.scmProcurementItems.scmProcurementId, procurementId))
        .limit(1);
      const updateRes = await scm.updateProcurementItemCore(centralAdmin, {
        procurementId,
        itemId: item.id,
        patch: { caDecision: "approved", readyQuantity: 5 },
      });
      expect(updateRes.success).toBe(true);

      // 4. InTransit — central admin accepts & ships; Central stock decremented
      expect(await t(centralAdmin, procurementId, "accept-and-ship")).toBe("InTransit");
      expect(await getStock(central, ingredient)).toBe(5);

      // 5. Delivered — requester confirms arrival
      expect(await t(requester, procurementId, "mark-delivered")).toBe("Delivered");

      // 6. ReviewingSJ — requester opens receive
      expect(await t(requester, procurementId, "open-receive")).toBe("ReviewingSJ");

      // 7. WaitingForPayment — requester finishes receiving; stock IN + invoice
      expect(
        await t(requester, procurementId, "finish-receive", {
          items: [{ id: item.id, receivedQuantity: 5, rejectedQuantity: 0 }],
        }),
      ).toBe("WaitingForPayment");
      expect(await getStock(outlet, ingredient)).toBe(5);
      const [invoice] = await db
        .select()
        .from(schema.scmProcurementInvoices)
        .where(eq(schema.scmProcurementInvoices.scmProcurementId, procurementId));
      expect(invoice).toBeTruthy();
      expect(invoice.totalAmount).toBe(5000); // 5 × 1000

      // 8. Finished — central admin confirms payment
      expect(await t(centralAdmin, procurementId, "mark-paid")).toBe("Finished");
      const [paidInvoice] = await db
        .select()
        .from(schema.scmProcurementInvoices)
        .where(eq(schema.scmProcurementInvoices.scmProcurementId, procurementId));
      expect(paidInvoice.paidAt).toBeTruthy();

      // Audit trail covers the walk (create + item-update are extra events).
      const audit = await db
        .select({ event: schema.scmProcurementAuditLog.event })
        .from(schema.scmProcurementAuditLog)
        .where(eq(schema.scmProcurementAuditLog.scmProcurementId, procurementId));
      expect(audit.map((a) => a.event)).toEqual(
        expect.arrayContaining([
          "submit",
          "open-review",
          "accept-and-ship",
          "mark-delivered",
          "open-receive",
          "finish-receive",
          "mark-paid",
        ]),
      );
    },
  );

  it.skipIf(!hasTestDatabaseUrl)("rejection path reaches the Rejected terminal state", async () => {
    const outlet = await seedBranch(uniq("PR-RO"), "Outlet");
    const ingredient = await seedIngredient(uniq("PR-RING"));

    const requester = await seedUser("branch_admin", outlet);
    const centralAdmin = await seedUser("admin_pusat");

    const { id: procurementId } = await createDraft(requester, outlet, ingredient);
    await t(requester, procurementId, "submit");
    await t(centralAdmin, procurementId, "open-review");

    await expect(
      scm.transitionProcurementCore(centralAdmin, {
        procurementId,
        event: "reject",
        payload: { reason: "Stok gudang cukup" },
      }),
    ).resolves.toMatchObject({ success: true, status: "Rejected" });

    expect((await procurementStatus(procurementId)).status).toBe("Rejected");
  });

  it.skipIf(!hasTestDatabaseUrl)(
    "cancellation path reaches the Cancelled terminal state",
    async () => {
      const outlet = await seedBranch(uniq("PR-CO"), "Outlet");
      const ingredient = await seedIngredient(uniq("PR-CING"));

      const requester = await seedUser("branch_admin", outlet);
      const centralAdmin = await seedUser("admin_pusat");

      // Cancel from Draft by the requester (allowed for branch_admin).
      const { id: procurementId } = await createDraft(requester, outlet, ingredient);
      await expect(
        scm.transitionProcurementCore(requester, {
          procurementId,
          event: "cancel",
          payload: { reason: "Tidak jadi belanja" },
        }),
      ).resolves.toMatchObject({ success: true, status: "Cancelled" });
      expect((await procurementStatus(procurementId)).status).toBe("Cancelled");

      // Cancel from Pending by central admin (allowed for admin_pusat).
      const second = await createDraft(requester, outlet, ingredient);
      await t(requester, second.id, "submit");
      await expect(
        scm.transitionProcurementCore(centralAdmin, {
          procurementId: second.id,
          event: "cancel",
          payload: { reason: "Dibatalkan admin pusat" },
        }),
      ).resolves.toMatchObject({ success: true, status: "Cancelled" });
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "withdraw returns a Pending procurement to Draft, staying re-drivable",
    async () => {
      const outlet = await seedBranch(uniq("PR-WO"), "Outlet");
      const ingredient = await seedIngredient(uniq("PR-WING"));

      const requester = await seedUser("branch_admin", outlet);

      const { id: procurementId } = await createDraft(requester, outlet, ingredient);
      await t(requester, procurementId, "submit");
      expect(await t(requester, procurementId, "withdraw")).toBe("Draft");
      expect((await procurementStatus(procurementId)).status).toBe("Draft");

      // Still re-drivable.
      expect(await t(requester, procurementId, "submit")).toBe("Pending");
    },
  );
});

describe("Pengadaan — wrong-role and wrong-branch actors are rejected", () => {
  it.skipIf(!hasTestDatabaseUrl)(
    "create rejects non-creator roles and branch admins of other branches",
    async () => {
      const outlet = await seedBranch(uniq("PR-NCO"), "Outlet");
      const otherOutlet = await seedBranch(uniq("PR-NOX"), "Outlet");
      const ingredient = await seedIngredient(uniq("PR-NCING"));

      const centralAdmin = await seedUser("admin_pusat");
      const otherBranchBa = await seedUser("branch_admin", otherOutlet);

      const input = {
        branchId: outlet,
        items: [{ ingredientId: ingredient, quantity: 5 }],
      };

      // admin_pusat is not a creator role
      await expect(scm.createProcurementCore(centralAdmin, input)).rejects.toThrow(
        "Only branch_admin or super_admin can create a procurement",
      );
      // branch_admin of a different branch cannot request for this one
      await expect(scm.createProcurementCore(otherBranchBa, input)).rejects.toThrow(
        "Forbidden: branch_admin can only access their own branch's procurements",
      );
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "transitions reject the wrong role at each state (FSM is role-only for Pengadaan)",
    async () => {
      const central = await seedBranch(uniq("PR-NWC"), "Central");
      const outlet = await seedBranch(uniq("PR-NWO"), "Outlet");
      const ingredient = await seedIngredient(uniq("PR-NWING"));
      await seedInventory(central, ingredient, 10);

      const requester = await seedUser("branch_admin", outlet);
      const centralAdmin = await seedUser("admin_pusat");

      const { id: procurementId } = await createDraft(requester, outlet, ingredient);

      // Draft: submit is branch_admin-only
      expect(await failingTransition(centralAdmin, procurementId, "submit")).toMatch(
        "admin_pusat is not authorized to perform submit",
      );

      await t(requester, procurementId, "submit");

      // Pending: open-review is admin_pusat-only; withdraw is branch_admin-only
      expect(await failingTransition(requester, procurementId, "open-review")).toMatch(
        "branch_admin is not authorized to perform open-review",
      );
      expect(await failingTransition(centralAdmin, procurementId, "withdraw")).toMatch(
        "admin_pusat is not authorized to perform withdraw",
      );

      await t(centralAdmin, procurementId, "open-review");

      // UnderReview: reject / accept-and-ship are admin_pusat-only
      expect(await failingTransition(requester, procurementId, "reject")).toMatch(
        "branch_admin is not authorized to perform reject",
      );
      expect(await failingTransition(requester, procurementId, "accept-and-ship")).toMatch(
        "branch_admin is not authorized to perform accept-and-ship",
      );
      expect((await procurementStatus(procurementId)).status).toBe("UnderReview");

      // CA edit is only allowed while UnderReview
      const [item] = await db
        .select()
        .from(schema.scmProcurementItems)
        .where(eq(schema.scmProcurementItems.scmProcurementId, procurementId))
        .limit(1);

      await t(centralAdmin, procurementId, "accept-and-ship", {
        caDecisions: [{ id: item.id, caDecision: "approved", readyQuantity: 5 }],
      });

      // InTransit: mark-delivered is branch_admin-only
      expect(await failingTransition(centralAdmin, procurementId, "mark-delivered")).toMatch(
        "admin_pusat is not authorized to perform mark-delivered",
      );

      await t(requester, procurementId, "mark-delivered");
      await t(requester, procurementId, "open-receive");

      // ReviewingSJ: finish-receive is branch_admin-only
      expect(await failingTransition(centralAdmin, procurementId, "finish-receive")).toMatch(
        "admin_pusat is not authorized to perform finish-receive",
      );
      await t(requester, procurementId, "finish-receive", {
        items: [{ id: item.id, receivedQuantity: 5, rejectedQuantity: 0 }],
      });

      // WaitingForPayment: mark-paid is admin_pusat-only
      expect(await failingTransition(requester, procurementId, "mark-paid")).toMatch(
        "branch_admin is not authorized to perform mark-paid",
      );
      await t(centralAdmin, procurementId, "mark-paid");
      expect((await procurementStatus(procurementId)).status).toBe("Finished");

      // CA edit outside UnderReview is refused (state guard, not role).
      const res = await scm.updateProcurementItemCore(centralAdmin, {
        procurementId,
        itemId: item.id,
        patch: { caDecision: "rejected" },
      });
      expect(res.success).toBe(false);
      if (!res.success) expect(res.error.message).toMatch("Cannot edit CA fields");
    },
  );
});
