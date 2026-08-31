/* oxlint-disable anti-slop/no-console -- effects log progress; not assertions */
/**
 * Purchase Requisitions full-flow integration test.
 *
 * Drives the real user-parameterized cores from `scm.ts`
 * (`createPurchaseRequisitionCore`, `updatePurchaseRequisitionCore`,
 * `processPurchaseRequisitionCore`) against the local dockerized test Postgres,
 * plus the delivery-note cores (`shipDeliveryNoteCore`, `receiveDeliveryNoteCore`,
 * `reviewDeliveryNoteCore`) to walk a PR all the way to Fulfilled via the
 * auto-created Surat Jalan. Each core is the exact business logic the
 * `createServerFn` transport endpoint runs — the only thing bypassed is
 * `requireAuth()` / `requireRole()` (HTTP session), replaced by an explicit
 * `user` argument per call. All cores throw on failure.
 *
 * Lifecycle: Pending (created by the branch admin) → Approved / Rejected →
 * Processed (admin pusat / AM, optionally auto-creating an SJ) → Fulfilled
 * (when the linked SJ is received and reviewed).
 *
 * Isolation: the cores hit the module-level `db` from `#/lib/server/db`, so
 * that module is mocked to return a drizzle instance over a connection to the
 * local test database, and shared tables are TRUNCATE-d between tests.
 *
 * Run:  TEST_DATABASE_URL=postgresql://omoiyari_test:omoiyari_test@localhost:5433/omoiyari_pos_test DATABASE_URL= vp test run src/lib/server/purchase-requisitions-flow.integration.test.ts
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

async function seedIngredient(code: string, moq = 1): Promise<string> {
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
    moq,
  });
  return id;
}

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

async function prStatus(id: string): Promise<{ status: string; rejectionReason: string | null }> {
  const [row] = await db
    .select({
      status: schema.purchaseRequisitions.status,
      rejectionReason: schema.purchaseRequisitions.rejectionReason,
    })
    .from(schema.purchaseRequisitions)
    .where(eq(schema.purchaseRequisitions.id, id))
    .limit(1);
  if (!row) throw new Error(`PR ${id} not found`);
  return row;
}

async function createPr(ba: AppUser, branchId: string, ingredientId: string) {
  return scm.createPurchaseRequisitionCore(ba, {
    branchId,
    code: uniq("PR"),
    items: [{ ingredientId, quantity: 5 }],
    notes: "restock rutin",
  });
}

beforeAll(async () => {
  if (!hasTestDatabaseUrl) return;
  // SAFETY: guarded by hasTestDatabaseUrl; when the test DB is absent beforeAll returns early and every test is skipped, so db is never read unset.
  db = dbHolder.db as TestDb;
  scm = await import("./scm");
});

describe("Purchase requisitions — full lifecycle via the real server-function cores", () => {
  it.skipIf(!hasTestDatabaseUrl)(
    "happy path: create → approve → process with SJ → receive → review → Fulfilled",
    async () => {
      const central = await seedBranch(uniq("PR-C"), "Central");
      const outlet = await seedBranch(uniq("PR-O"), "Outlet");
      const ingredient = await seedIngredient(uniq("PR-ING"));

      const ba = await seedUser("branch_admin", outlet);
      const am = await seedUser("area_manager", undefined, [outlet]);
      const adminPusat = await seedUser("admin_pusat");

      // 1. Create — Pending by the branch admin
      const pr = await createPr(ba, outlet, ingredient);
      expect(pr.status).toBe("Pending");
      expect(pr.requestedBy).toBe(ba.id);

      const [item] = await db
        .select()
        .from(schema.purchaseRequisitionItems)
        .where(eq(schema.purchaseRequisitionItems.purchaseRequisitionId, pr.id));
      expect(item.ingredientId).toBe(ingredient);

      // 2. Approve — AM sets Approved
      await scm.updatePurchaseRequisitionCore(am, { id: pr.id, status: "Approved" });
      expect((await prStatus(pr.id)).status).toBe("Approved");

      // 3. Process — admin pusat processes with an auto-created SJ (from Central)
      const processed = await scm.processPurchaseRequisitionCore(adminPusat, {
        id: pr.id,
        alsoCreateSJ: true,
        driverName: "Pak Sopir",
      });
      expect(processed.success).toBe(true);
      expect((await prStatus(pr.id)).status).toBe("Processed");

      const [dn] = await db
        .select()
        .from(schema.deliveryNotes)
        .where(eq(schema.deliveryNotes.id, processed.dnId!));
      expect(dn).toBeTruthy();
      expect(dn.code).toBe(`SJ-${pr.code}`);
      expect(dn.fromBranchId).toBe(central);
      expect(dn.toBranchId).toBe(outlet);
      expect(dn.status).toBe("Picking");

      const [dnItem] = await db
        .select()
        .from(schema.deliveryNoteItems)
        .where(eq(schema.deliveryNoteItems.deliveryNoteId, dn.id));
      expect(dnItem.ingredientId).toBe(ingredient);
      expect(dnItem.quantity).toBe(5);

      // 4. Pick the SJ quantities, ship, receive, review → PR auto-fulfilled
      await scm.updateDeliveryNoteCore(adminPusat, {
        dnId: dn.id,
        items: [{ itemId: dnItem.id, pickedQuantity: 5 }],
      });
      await scm.shipDeliveryNoteCore(adminPusat, { dnId: dn.id });
      await scm.receiveDeliveryNoteCore(adminPusat, {
        dnId: dn.id,
        items: [{ itemId: dnItem.id, receivedQuantity: 5, rejectedQuantity: 0 }],
      });
      await scm.reviewDeliveryNoteCore(adminPusat, { dnId: dn.id });

      expect((await prStatus(pr.id)).status).toBe("Fulfilled");
    },
  );

  it.skipIf(!hasTestDatabaseUrl)("rejection path: AM rejects with a reason", async () => {
    const outlet = await seedBranch(uniq("PR-RO"));
    const ingredient = await seedIngredient(uniq("PR-RING"));
    const ba = await seedUser("branch_admin", outlet);
    const am = await seedUser("area_manager", undefined, [outlet]);

    const pr = await createPr(ba, outlet, ingredient);
    await scm.updatePurchaseRequisitionCore(am, {
      id: pr.id,
      status: "Rejected",
      rejectionReason: "anggaran belum tersedia",
    });

    const st = await prStatus(pr.id);
    expect(st.status).toBe("Rejected");
    expect(st.rejectionReason).toBe("anggaran belum tersedia");
  });
});

describe("Purchase requisitions — wrong-role and wrong-branch actors are rejected", () => {
  it.skipIf(!hasTestDatabaseUrl)(
    "create/edit/process reject wrong roles, other branches, and processed PRs",
    async () => {
      const outlet = await seedBranch(uniq("PR-NO"));
      const otherOutlet = await seedBranch(uniq("PR-NX"));
      const ingredient = await seedIngredient(uniq("PR-NING"));

      const ba = await seedUser("branch_admin", outlet);
      const otherBa = await seedUser("branch_admin", otherOutlet);
      const am = await seedUser("area_manager", undefined, [otherOutlet]);
      const adminPusat = await seedUser("admin_pusat");

      // Create: other-branch admin cannot request for this branch
      await expect(
        scm.createPurchaseRequisitionCore(otherBa, {
          branchId: outlet,
          code: uniq("PR-N"),
          items: [{ ingredientId: ingredient, quantity: 5 }],
        }),
      ).rejects.toThrow("Unauthorized branch");

      // MOQ validation
      const moqIngredient = await seedIngredient(uniq("PR-MOQ"), 2);
      await expect(
        scm.createPurchaseRequisitionCore(ba, {
          branchId: outlet,
          code: uniq("PR-M"),
          items: [{ ingredientId: moqIngredient, quantity: 5 }], // 5 % 2 ≠ 0
        }),
      ).rejects.toThrow("harus kelipatan MOQ");

      const pr = await createPr(ba, outlet, ingredient);

      // Edit: other-branch BA cannot touch someone else's PR
      await expect(
        scm.updatePurchaseRequisitionCore(otherBa, { id: pr.id, status: "Draft" }),
      ).rejects.toThrow("Unauthorized: can only edit your own PR");

      // BA cannot move status to Approved (supervisor-only)
      await expect(
        scm.updatePurchaseRequisitionCore(ba, { id: pr.id, status: "Approved" }),
      ).rejects.toThrow("Unauthorized: cannot change to this status");

      // AM outside the branch cannot approve
      await expect(
        scm.updatePurchaseRequisitionCore(am, { id: pr.id, status: "Approved" }),
      ).rejects.toThrow("Forbidden: you do not have access to this branch");

      // Process: BA is not a processor role
      await expect(
        scm.processPurchaseRequisitionCore(ba, { id: pr.id, alsoCreateSJ: false }),
      ).rejects.toThrow("Forbidden: insufficient role to process PR");

      // None of the failed attempts had side effects
      expect((await prStatus(pr.id)).status).toBe("Pending");

      // The right AM approves, then processing an already-processed PR is refused
      const rightAm = await seedUser("area_manager", undefined, [outlet]);
      await scm.updatePurchaseRequisitionCore(rightAm, { id: pr.id, status: "Approved" });
      await scm.processPurchaseRequisitionCore(adminPusat, { id: pr.id, alsoCreateSJ: false });
      expect((await prStatus(pr.id)).status).toBe("Processed");

      // BA can no longer edit a processed PR (the guard fires on the PR state
      // regardless of what field is being changed)
      await expect(scm.updatePurchaseRequisitionCore(ba, { id: pr.id })).rejects.toThrow(
        "Cannot modify PR that is already processed",
      );
      // And a Pending/Approved check blocks re-processing
      await expect(
        scm.processPurchaseRequisitionCore(adminPusat, { id: pr.id, alsoCreateSJ: false }),
      ).rejects.toThrow("PR must be Pending or Approved to process");

      // Not found
      await expect(
        scm.updatePurchaseRequisitionCore(rightAm, { id: crypto.randomUUID(), status: "Approved" }),
      ).rejects.toThrow("PR not found");
      await expect(
        scm.processPurchaseRequisitionCore(adminPusat, {
          id: crypto.randomUUID(),
          alsoCreateSJ: false,
        }),
      ).rejects.toThrow("PR not found");
    },
  );
});
