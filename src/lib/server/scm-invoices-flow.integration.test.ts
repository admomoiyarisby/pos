/* oxlint-disable anti-slop/no-console -- effects log progress; not assertions */
/**
 * SCM Invoices full-flow integration test.
 *
 * Drives the real user-parameterized cores from `scm.ts`
 * (`generateSCMInvoiceCore`, `paySCMInvoiceCore`, `cancelSCMInvoiceCore`)
 * against the local dockerized test Postgres. Each core is the exact business
 * logic the `createServerFn` transport endpoint runs — the only thing bypassed
 * is `requireRole()` (HTTP session), replaced by an explicit `user` argument
 * per call, so role guards are fully exercised. All cores throw on failure.
 *
 * Lifecycle: Unpaid (generated from a received delivery note, value =
 * receivedQuantity × ingredient.averageCost) → Paid; cancel from Unpaid only.
 *
 * Isolation: the cores hit the module-level `db` from `#/lib/server/db`, so
 * that module is mocked to return a drizzle instance over a connection to the
 * local test database, and shared tables are TRUNCATE-d between tests.
 *
 * Run:  TEST_DATABASE_URL=postgresql://omoiyari_test:omoiyari_test@localhost:5433/omoiyari_pos_test DATABASE_URL= vp test run src/lib/server/scm-invoices-flow.integration.test.ts
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

/** Walk a delivery note to Received so an invoice can be generated from it. */
async function receivedDn(
  admin: AppUser,
  fromBranchId: string,
  toBranchId: string,
  ingredientId: string,
  receivedQty: number,
): Promise<{ dnId: string }> {
  const dn = await scm.createDeliveryNoteCore(admin, {
    code: uniq("SJ-INV"),
    fromBranchId,
    toBranchId,
    driverName: "Sopir",
    items: [{ ingredientId, quantity: 5, readyQuantity: 5 }],
  });
  const [item] = await db
    .select()
    .from(schema.deliveryNoteItems)
    .where(eq(schema.deliveryNoteItems.deliveryNoteId, dn.id));
  await scm.shipDeliveryNoteCore(admin, { dnId: dn.id });
  await scm.receiveDeliveryNoteCore(admin, {
    dnId: dn.id,
    items: [
      {
        itemId: item.id,
        receivedQuantity: receivedQty,
        rejectedQuantity: 0,
      },
    ],
  });
  return { dnId: dn.id };
}

beforeAll(async () => {
  if (!hasTestDatabaseUrl) return;
  // SAFETY: guarded by hasTestDatabaseUrl; when the test DB is absent beforeAll returns early and every test is skipped, so db is never read unset.
  db = dbHolder.db as TestDb;
  scm = await import("./scm");
});

describe("SCM invoices — full lifecycle via the real server-function cores", () => {
  it.skipIf(!hasTestDatabaseUrl)(
    "generate from a received delivery note → pay → Paid",
    async () => {
      const fromBranch = await seedBranch(uniq("INV-AF"));
      const toBranch = await seedBranch(uniq("INV-AT"));
      const ingredient = await seedIngredient(uniq("INV-AING"), 2000);

      const adminPusat = await seedUser("admin_pusat");

      const { dnId } = await receivedDn(adminPusat, fromBranch, toBranch, ingredient, 5);

      // Generate — value = received 5 × averageCost 2000
      const invoice = await scm.generateSCMInvoiceCore(adminPusat, { dnId });
      expect(invoice.status).toBe("Unpaid");
      expect(invoice.totalAmount).toBe(10000);
      expect(invoice.code).toBe(
        `INV-${(await db.select({ code: schema.deliveryNotes.code }).from(schema.deliveryNotes).where(eq(schema.deliveryNotes.id, dnId)))[0].code}`,
      );

      const [line] = await db
        .select()
        .from(schema.scmInvoiceItems)
        .where(eq(schema.scmInvoiceItems.scmInvoiceId, invoice.id));
      expect(line.ingredientId).toBe(ingredient);
      expect(line.quantity).toBe(5);
      expect(line.unitPrice).toBe(2000);
      expect(line.totalPrice).toBe(10000);

      // Duplicate generation for the same DN is refused
      await expect(scm.generateSCMInvoiceCore(adminPusat, { dnId })).rejects.toThrow(
        "Invoice already exists for this delivery note",
      );

      // Pay → Paid
      const paid = await scm.paySCMInvoiceCore(adminPusat, { id: invoice.id });
      expect(paid.status).toBe("Paid");
      expect(paid.paidAt).toBeTruthy();

      // Paid invoice cannot be cancelled
      await expect(scm.cancelSCMInvoiceCore(adminPusat, { id: invoice.id })).rejects.toThrow(
        "Only Unpaid invoices can be cancelled",
      );
    },
  );

  it.skipIf(!hasTestDatabaseUrl)("cancel from Unpaid reaches Cancelled", async () => {
    const fromBranch = await seedBranch(uniq("INV-CF"));
    const toBranch = await seedBranch(uniq("INV-CT"));
    const ingredient = await seedIngredient(uniq("INV-CING"), 1000);
    const adminPusat = await seedUser("admin_pusat");

    const { dnId } = await receivedDn(adminPusat, fromBranch, toBranch, ingredient, 3);
    const invoice = await scm.generateSCMInvoiceCore(adminPusat, { dnId });

    const cancelled = await scm.cancelSCMInvoiceCore(adminPusat, { id: invoice.id });
    expect(cancelled.status).toBe("Cancelled");
  });
});

describe("SCM invoices — wrong-role and guard negatives", () => {
  it.skipIf(!hasTestDatabaseUrl)(
    "generate/pay/cancel reject non-central roles without side effects",
    async () => {
      const fromBranch = await seedBranch(uniq("INV-NF"));
      const toBranch = await seedBranch(uniq("INV-NT"));
      const ingredient = await seedIngredient(uniq("INV-NING"), 1000);

      const adminPusat = await seedUser("admin_pusat");
      const branchAdmin = await seedUser("branch_admin");
      const areaManager = await seedUser("area_manager");

      const { dnId } = await receivedDn(adminPusat, fromBranch, toBranch, ingredient, 5);
      const invoice = await scm.generateSCMInvoiceCore(adminPusat, { dnId });

      await expect(scm.generateSCMInvoiceCore(branchAdmin, { dnId })).rejects.toThrow(
        "Forbidden: insufficient role",
      );
      await expect(scm.paySCMInvoiceCore(areaManager, { id: invoice.id })).rejects.toThrow(
        "Forbidden: insufficient role",
      );
      await expect(scm.cancelSCMInvoiceCore(branchAdmin, { id: invoice.id })).rejects.toThrow(
        "Forbidden: insufficient role",
      );

      // No side effects — still Unpaid
      const [row] = await db
        .select({ status: schema.scmInvoices.status })
        .from(schema.scmInvoices)
        .where(eq(schema.scmInvoices.id, invoice.id));
      expect(row.status).toBe("Unpaid");
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "generate refuses missing DNs, itemless DNs, and zero-amount receipts",
    async () => {
      const fromBranch = await seedBranch(uniq("INV-GF"));
      const toBranch = await seedBranch(uniq("INV-GT"));
      const ingredient = await seedIngredient(uniq("INV-GING"), 1000);
      const adminPusat = await seedUser("admin_pusat");

      await expect(
        scm.generateSCMInvoiceCore(adminPusat, { dnId: crypto.randomUUID() }),
      ).rejects.toThrow("Delivery note not found");

      // DN with no items → cannot invoice
      const emptyDn = await scm.createDeliveryNoteCore(adminPusat, {
        code: uniq("SJ-EMPTY"),
        fromBranchId: fromBranch,
        toBranchId: toBranch,
        driverName: "Sopir",
        items: [],
      });
      await expect(scm.generateSCMInvoiceCore(adminPusat, { dnId: emptyDn.id })).rejects.toThrow(
        "No items found in delivery note",
      );

      // Fully received with zero quantity → zero amount refused
      const zeroDn = await receivedDn(adminPusat, fromBranch, toBranch, ingredient, 0);
      await expect(scm.generateSCMInvoiceCore(adminPusat, { dnId: zeroDn.dnId })).rejects.toThrow(
        "Cannot create invoice with zero amount",
      );
    },
  );

  it.skipIf(!hasTestDatabaseUrl)("pay/cancel refuse missing invoices", async () => {
    const adminPusat = await seedUser("admin_pusat");
    const missing = crypto.randomUUID();

    await expect(scm.paySCMInvoiceCore(adminPusat, { id: missing })).rejects.toThrow(
      "Invoice not found",
    );
    await expect(scm.cancelSCMInvoiceCore(adminPusat, { id: missing })).rejects.toThrow(
      "Invoice not found",
    );
  });
});
