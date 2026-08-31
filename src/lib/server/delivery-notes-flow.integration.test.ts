/* oxlint-disable anti-slop/no-console -- effects log progress; not assertions */
/**
 * Delivery Notes (Surat Jalan) full-flow integration test.
 *
 * Drives the real user-parameterized cores from `scm.ts`
 * (`createDeliveryNoteCore`, `updateDeliveryNoteCore`, `shipDeliveryNoteCore`,
 * `receiveDeliveryNoteCore`, `cancelDeliveryNoteCore`,
 * `reviewDeliveryNoteCore`) against the local dockerized test Postgres. Each
 * core is the exact business logic the `createServerFn` transport endpoint
 * runs — the only thing bypassed is `requireAuth()` / `requireRole()` (HTTP
 * session), replaced by an explicit `user` argument per call, so role and
 * state guards are fully exercised. All cores throw on failure.
 *
 * Lifecycle: Picking → (pick quantities) → In Transit (source OUT + in-transit)
 * → Received / Partial Received (destination IN + reject handling) → review.
 * Cancel from Picking or In Transit (reverses source stock when in transit).
 *
 * Isolation: the cores hit the module-level `db` from `#/lib/server/db`, so
 * that module is mocked to return a drizzle instance over a connection to the
 * local test database, and shared tables are TRUNCATE-d between tests.
 *
 * Run:  TEST_DATABASE_URL=postgresql://omoiyari_test:omoiyari_test@localhost:5433/omoiyari_pos_test DATABASE_URL= vp test run src/lib/server/delivery-notes-flow.integration.test.ts
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

async function seedIngredient(code: string, averageCost = 1000): Promise<string> {
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

async function seedUser(role: UserRole): Promise<AppUser> {
  const id = crypto.randomUUID();
  await db.insert(schema.users).values({
    id,
    name: `ITS ${role}`,
    email: `its-${id}@pos.test`,
    role,
  });
  return { id, email: `its-${id}@pos.test`, name: `ITS ${role}`, role, status: "Active" };
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

async function dnStatus(id: string): Promise<{ status: string; reviewed: boolean }> {
  const [row] = await db
    .select({
      status: schema.deliveryNotes.status,
      reviewed: schema.deliveryNotes.reviewedByAdminPusat,
    })
    .from(schema.deliveryNotes)
    .where(eq(schema.deliveryNotes.id, id))
    .limit(1);
  if (!row) throw new Error(`delivery note ${id} not found`);
  return row;
}

async function createDn(
  admin: AppUser,
  fromBranchId: string,
  toBranchId: string,
  ingredientId: string,
  qty: number,
) {
  return scm.createDeliveryNoteCore(admin, {
    code: uniq("SJ"),
    fromBranchId,
    toBranchId,
    driverName: "Pak Sopir",
    items: [{ ingredientId, quantity: qty, readyQuantity: qty }],
  });
}

async function shipDn(admin: AppUser, dnId: string) {
  const res = await scm.shipDeliveryNoteCore(admin, { dnId });
  expect(res.success).toBe(true);
}

async function receiveDn(
  user: AppUser,
  dnId: string,
  itemId: string,
  received: number,
  rejected: number,
  disposition?: "Return to Source" | "Scrap" | "Quarantine",
) {
  return scm.receiveDeliveryNoteCore(user, {
    dnId,
    items: [
      {
        itemId,
        receivedQuantity: received,
        rejectedQuantity: rejected,
        rejectionDisposition: disposition,
      },
    ],
  });
}

beforeAll(async () => {
  if (!hasTestDatabaseUrl) return;
  // SAFETY: guarded by hasTestDatabaseUrl; when the test DB is absent beforeAll returns early and every test is skipped, so db is never read unset.
  db = dbHolder.db as TestDb;
  scm = await import("./scm");
});

describe("Delivery notes — full lifecycle via the real server-function cores", () => {
  it.skipIf(!hasTestDatabaseUrl)(
    "happy path: create → pick → ship → full receive → review",
    async () => {
      const fromBranch = await seedBranch(uniq("DN-AF"));
      const toBranch = await seedBranch(uniq("DN-AT"));
      const ingredient = await seedIngredient(uniq("DN-AING"));
      await seedInventory(fromBranch, ingredient, 10);

      const adminPusat = await seedUser("admin_pusat");

      // 1. Create — Picking with items
      const dn = await createDn(adminPusat, fromBranch, toBranch, ingredient, 5);
      expect(dn.status).toBe("Picking");

      const [item] = await db
        .select()
        .from(schema.deliveryNoteItems)
        .where(eq(schema.deliveryNoteItems.deliveryNoteId, dn.id));
      expect(item.quantity).toBe(5);
      expect(item.readyQuantity).toBe(5);

      // 2. Pick — update pickedQuantity
      await scm.updateDeliveryNoteCore(adminPusat, {
        dnId: dn.id,
        items: [{ itemId: item.id, pickedQuantity: 5 }],
        driverName: "Pak Sopir Baru",
      });
      const [picked] = await db
        .select({ pickedQuantity: schema.deliveryNoteItems.pickedQuantity })
        .from(schema.deliveryNoteItems)
        .where(eq(schema.deliveryNoteItems.id, item.id));
      expect(picked.pickedQuantity).toBe(5);

      // 3. Ship — source stock OUT, in-transit created, status In Transit
      await shipDn(adminPusat, dn.id);
      expect((await dnStatus(dn.id)).status).toBe("In Transit");
      expect(await getStock(fromBranch, ingredient)).toBe(5);

      const [inTransit] = await db
        .select()
        .from(schema.inTransitInventory)
        .where(eq(schema.inTransitInventory.deliveryNoteId, dn.id));
      expect(inTransit).toBeTruthy();
      expect(inTransit.ingredientId).toBe(ingredient);
      expect(inTransit.quantity).toBe(5);

      const outLedger = await db
        .select()
        .from(schema.stockLedger)
        .where(and(eq(schema.stockLedger.reference, dn.id), eq(schema.stockLedger.type, "OUT")));
      expect(outLedger).toHaveLength(1);
      expect(outLedger[0].balance).toBe(5);

      // 4. Receive in full — destination IN, in-transit removed, status Received
      const received = await receiveDn(adminPusat, dn.id, item.id, 5, 0);
      expect(received.status).toBe("Received");
      expect(await getStock(toBranch, ingredient)).toBe(5);
      const [inTransitAfter] = await db
        .select()
        .from(schema.inTransitInventory)
        .where(eq(schema.inTransitInventory.deliveryNoteId, dn.id));
      expect(inTransitAfter).toBeUndefined();

      // 5. Review — marks reviewedByAdminPusat
      await scm.reviewDeliveryNoteCore(adminPusat, { dnId: dn.id });
      expect((await dnStatus(dn.id)).reviewed).toBe(true);
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "partial receive with scrap rejection: Partial Received + waste entry, still reviewable",
    async () => {
      const fromBranch = await seedBranch(uniq("DN-SF"));
      const toBranch = await seedBranch(uniq("DN-ST"));
      const ingredient = await seedIngredient(uniq("DN-SING"));
      await seedInventory(fromBranch, ingredient, 10);

      const adminPusat = await seedUser("admin_pusat");

      const dn = await createDn(adminPusat, fromBranch, toBranch, ingredient, 5);
      await shipDn(adminPusat, dn.id);

      // 2 received + 1 rejected as Scrap → Partial Received (rejected counts
      // toward fulfillment, so received+rejected must stay under picked).
      const [item] = await db
        .select()
        .from(schema.deliveryNoteItems)
        .where(eq(schema.deliveryNoteItems.deliveryNoteId, dn.id));
      const received = await receiveDn(adminPusat, dn.id, item.id, 2, 1, "Scrap");
      expect(received.status).toBe("Partial Received");

      expect(await getStock(toBranch, ingredient)).toBe(2);
      const [waste] = await db
        .select()
        .from(schema.wasteEntries)
        .where(eq(schema.wasteEntries.branchId, toBranch));
      expect(waste).toBeTruthy();
      expect(waste.quantity).toBe(1);
      expect(waste.category).toBe("Biaya Operasional");

      // Partial Received is reviewable
      await scm.reviewDeliveryNoteCore(adminPusat, { dnId: dn.id });
      expect((await dnStatus(dn.id)).reviewed).toBe(true);
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "cancel from Picking (no stock effect) and from In Transit (reverses stock)",
    async () => {
      const fromBranch = await seedBranch(uniq("DN-XF"));
      const toBranch = await seedBranch(uniq("DN-XT"));
      const ingredient = await seedIngredient(uniq("DN-XING"));
      await seedInventory(fromBranch, ingredient, 10);

      const adminPusat = await seedUser("admin_pusat");

      // Cancel from Picking — no stock touched
      const dn1 = await createDn(adminPusat, fromBranch, toBranch, ingredient, 5);
      await scm.cancelDeliveryNoteCore(adminPusat, { dnId: dn1.id, reason: "batal" });
      expect((await dnStatus(dn1.id)).status).toBe("Cancelled");
      expect(await getStock(fromBranch, ingredient)).toBe(10);

      // Cancel from In Transit — source stock restored, in-transit cleared
      const dn2 = await createDn(adminPusat, fromBranch, toBranch, ingredient, 5);
      await shipDn(adminPusat, dn2.id);
      expect(await getStock(fromBranch, ingredient)).toBe(5);
      await scm.cancelDeliveryNoteCore(adminPusat, { dnId: dn2.id, reason: "batal jalan" });
      expect((await dnStatus(dn2.id)).status).toBe("Cancelled");
      expect(await getStock(fromBranch, ingredient)).toBe(10);
      const [inTransitAfter] = await db
        .select()
        .from(schema.inTransitInventory)
        .where(eq(schema.inTransitInventory.deliveryNoteId, dn2.id));
      expect(inTransitAfter).toBeUndefined();
    },
  );
});

describe("Delivery notes — wrong-role and state-guard negatives", () => {
  it.skipIf(!hasTestDatabaseUrl)(
    "create/update/ship/cancel/review reject non-central roles",
    async () => {
      const fromBranch = await seedBranch(uniq("DN-NF"));
      const toBranch = await seedBranch(uniq("DN-NT"));
      const ingredient = await seedIngredient(uniq("DN-NING"));
      await seedInventory(fromBranch, ingredient, 10);

      const adminPusat = await seedUser("admin_pusat");
      const branchAdmin = await seedUser("branch_admin");

      const createInput = {
        code: uniq("SJ-N"),
        fromBranchId: fromBranch,
        toBranchId: toBranch,
        driverName: "Sopir",
        items: [{ ingredientId: ingredient, quantity: 5, readyQuantity: 5 }],
      };

      await expect(scm.createDeliveryNoteCore(branchAdmin, createInput)).rejects.toThrow(
        "Forbidden: insufficient role",
      );

      const dn = await scm.createDeliveryNoteCore(adminPusat, createInput);
      const [item] = await db
        .select()
        .from(schema.deliveryNoteItems)
        .where(eq(schema.deliveryNoteItems.deliveryNoteId, dn.id));

      await expect(
        scm.updateDeliveryNoteCore(branchAdmin, {
          dnId: dn.id,
          items: [{ itemId: item.id, pickedQuantity: 5 }],
        }),
      ).rejects.toThrow("Forbidden: insufficient role");
      await expect(scm.shipDeliveryNoteCore(branchAdmin, { dnId: dn.id })).rejects.toThrow(
        "Forbidden: insufficient role",
      );
      await expect(
        scm.cancelDeliveryNoteCore(branchAdmin, { dnId: dn.id, reason: "x" }),
      ).rejects.toThrow("Forbidden: insufficient role");
      await expect(scm.reviewDeliveryNoteCore(branchAdmin, { dnId: dn.id })).rejects.toThrow(
        "Forbidden: insufficient role",
      );

      // No side effects — still Picking, stock untouched
      expect((await dnStatus(dn.id)).status).toBe("Picking");
      expect(await getStock(fromBranch, ingredient)).toBe(10);
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "state guards and quantity validation reject invalid transitions",
    async () => {
      const fromBranch = await seedBranch(uniq("DN-GF"));
      const toBranch = await seedBranch(uniq("DN-GT"));
      const ingredient = await seedIngredient(uniq("DN-GING"));
      await seedInventory(fromBranch, ingredient, 10);

      const adminPusat = await seedUser("admin_pusat");
      const missing = crypto.randomUUID();

      await expect(
        scm.updateDeliveryNoteCore(adminPusat, { dnId: missing, items: [] }),
      ).rejects.toThrow("Delivery note not found");
      await expect(scm.shipDeliveryNoteCore(adminPusat, { dnId: missing })).rejects.toThrow(
        "Delivery note not found",
      );
      await expect(
        scm.receiveDeliveryNoteCore(adminPusat, { dnId: missing, items: [] }),
      ).rejects.toThrow("Delivery note not found");
      await expect(
        scm.cancelDeliveryNoteCore(adminPusat, { dnId: missing, reason: "x" }),
      ).rejects.toThrow("Delivery note not found");
      await expect(scm.reviewDeliveryNoteCore(adminPusat, { dnId: missing })).rejects.toThrow(
        "Delivery note not found",
      );

      const dn = await createDn(adminPusat, fromBranch, toBranch, ingredient, 5);
      const [item] = await db
        .select()
        .from(schema.deliveryNoteItems)
        .where(eq(schema.deliveryNoteItems.deliveryNoteId, dn.id));

      // review requires Received/Partial Received
      await expect(scm.reviewDeliveryNoteCore(adminPusat, { dnId: dn.id })).rejects.toThrow(
        "Only Received or Partial Received SJ can be reviewed",
      );
      // receive requires In Transit
      await expect(receiveDn(adminPusat, dn.id, item.id, 5, 0)).rejects.toThrow(
        "SJ must be In Transit or Partial Received to receive",
      );

      await shipDn(adminPusat, dn.id);

      // received + rejected must not exceed picked quantity
      await expect(receiveDn(adminPusat, dn.id, item.id, 4, 2)).rejects.toThrow(
        "tidak boleh melebihi jumlah dikirim",
      );
      // invalid item id
      await expect(
        scm.receiveDeliveryNoteCore(adminPusat, {
          dnId: dn.id,
          items: [{ itemId: crypto.randomUUID(), receivedQuantity: 1, rejectedQuantity: 0 }],
        }),
      ).rejects.toThrow("Invalid item ID");

      // cancel only from Picking/In Transit — Received is refused
      await receiveDn(adminPusat, dn.id, item.id, 5, 0);
      await expect(
        scm.cancelDeliveryNoteCore(adminPusat, { dnId: dn.id, reason: "x" }),
      ).rejects.toThrow("Can only cancel SJ in Picking or In Transit status");
    },
  );
});
