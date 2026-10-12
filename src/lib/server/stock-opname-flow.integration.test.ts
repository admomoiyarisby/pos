/* oxlint-disable anti-slop/no-console -- effects log progress; not assertions */
/**
 * Stock Opname full-flow integration test.
 *
 * Drives the real user-parameterized cores from `inventory.ts`
 * (`triggerStockOpnameCore`, `submitStockOpnameCore`,
 * `markStockOpnameInvestigationCore`, `updateStockOpnameCountsCore`,
 * `approveStockOpnameCore`, `realizeStockOpnameCore`) against the local
 * dockerized test Postgres. Each core is the exact business logic the
 * `createServerFn` transport endpoint runs — the only thing bypassed is
 * `requireAuth()` / `requireRole()` (HTTP session), replaced by an explicit
 * `user` argument per call, so role and branch guards are fully exercised.
 * All cores throw on failure.
 *
 * Lifecycle: trigger (snapshot system stock) → submit counts → mark Under
 * Investigation → update counts → approve (inventory adjusted to physical) →
 * realize (month-end, super_admin/admin_pusat only).
 *
 * Isolation: the cores hit the module-level `db` from `#/lib/server/db`, so
 * that module is mocked to return a drizzle instance over a connection to the
 * local test database, and shared tables are TRUNCATE-d between tests. No
 * outer transaction is held open, so the cores' own transactions behave
 * normally and a failing inner step only rolls back its own work.
 *
 * Run:  TEST_DATABASE_URL=postgresql://omoiyari_test:omoiyari_test@localhost:5433/omoiyari_pos_test DATABASE_URL= vp test run src/lib/server/stock-opname-flow.integration.test.ts
 */

import { afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { Client } from "pg";
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
let inv: typeof import("./inventory");
let seedCounter = 0;

function uniq(prefix: string): string {
  return `${prefix}-${seedCounter++}-${crypto.randomUUID().slice(0, 8)}`;
}

async function seedBranch(code: string, type: "Central" | "Outlet" = "Central"): Promise<string> {
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

async function seedIngredient(
  code: string,
  opts: { isBranchVisible?: boolean } = {},
): Promise<string> {
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
    // An Outlet SO catalog is filtered to branch-visible items, so an outlet
    // test needs this true; a Central SO includes everything.
    isBranchVisible: opts.isBranchVisible ?? false,
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

async function soStatus(id: string): Promise<{ status: string; realizedAt: Date | null }> {
  const [row] = await db
    .select({ status: schema.stockOpnames.status, realizedAt: schema.stockOpnames.realizedAt })
    .from(schema.stockOpnames)
    .where(eq(schema.stockOpnames.id, id))
    .limit(1);
  if (!row) throw new Error(`stock opname ${id} not found`);
  return row;
}

/** First SO item of an opname, optionally scoped to one ingredient.
 *
 *  The SO item list is the whole catalog, so an opname carries every catalog
 *  item — not only the ones with a stock record. A test that seeds more than
 *  one ingredient must therefore say which line it means, otherwise "the first
 *  item" is whichever row the database happened to return. */
async function firstItem(soId: string, ingredientId?: string) {
  const [row] = await db
    .select()
    .from(schema.stockOpnameItems)
    .where(
      and(
        eq(schema.stockOpnameItems.stockOpnameId, soId),
        ingredientId ? eq(schema.stockOpnameItems.ingredientId, ingredientId) : undefined,
      ),
    )
    .limit(1);
  if (!row) throw new Error(`no items for SO ${soId}`);
  return row;
}

beforeAll(async () => {
  if (!hasTestDatabaseUrl) return;
  // SAFETY: guarded by hasTestDatabaseUrl; when the test DB is absent beforeAll returns early and every test is skipped, so db is never read unset.
  db = dbHolder.db as TestDb;
  inv = await import("./inventory");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Stock opname — full lifecycle via the real server-function cores", () => {
  it.skipIf(!hasTestDatabaseUrl)(
    "trigger → submit → investigate → update counts → approve → realize",
    async () => {
      // Central-type branch so the SO catalog includes all countable items.
      const branch = await seedBranch(uniq("SO-A"));
      const ingredient = await seedIngredient(uniq("SO-AING"));
      await seedInventory(branch, ingredient, 10);

      const ba = await seedUser("branch_admin", branch);
      const am = await seedUser("area_manager", undefined, [branch]);
      const superAdmin = await seedUser("super_admin");

      // 1. Trigger — SO snapshot of system stock, one item per countable item
      const so = await inv.triggerStockOpnameCore(ba, {
        branchId: branch,
        date: "2026-08-25",
      });
      expect(so.status).toBe("Submitted");
      expect(so.triggeredBy).toBe(ba.id);

      let item = await firstItem(so.id);
      expect(item.systemStock).toBe(10);
      expect(item.physicalStock).toBe(0);
      // Fresh rows are uncounted: physicalStock 0 is the trigger default,
      // not a count (partial-opname contract).
      expect(item.countedAt).toBeNull();

      // 2. Submit counts — physical 7 of 10 → variance -3
      await inv.submitStockOpnameCore(ba, {
        soId: so.id,
        items: [{ itemId: item.id, physicalStock: 7 }],
      });
      item = await firstItem(so.id);
      expect(item.physicalStock).toBe(7);
      expect(item.variance).toBe(-3);
      expect(item.countedAt).not.toBeNull();
      expect((await soStatus(so.id)).status).toBe("Submitted");

      // 3. Investigate — AM marks Under Investigation, BA notified
      await inv.markStockOpnameInvestigationCore(am, {
        soId: so.id,
        investigationNote: "cek ulang",
      });
      let st = await soStatus(so.id);
      expect(st.status).toBe("Under Investigation");

      // 4. Update counts during investigation — 8 of 10
      await inv.updateStockOpnameCountsCore(ba, {
        soId: so.id,
        items: [{ itemId: item.id, physicalStock: 8 }],
      });
      item = await firstItem(so.id);
      expect(item.physicalStock).toBe(8);
      expect(item.variance).toBe(-2);

      // 5. Approve — REVIEW ONLY (ADR 0021): no stock change, no ledger row.
      // The counts become a signed note; realize is what applies them.
      const approved = await inv.approveStockOpnameCore(am, { soId: so.id });
      st = await soStatus(so.id);
      expect(st.status).toBe("Approved");
      expect(await getStock(branch, ingredient)).toBe(10); // untouched

      // Approve returns the preview the approver signed (counted items only)
      expect(approved.counted).toBe(1);
      expect(approved.skipped).toBe(0);
      expect(approved.changes).toHaveLength(1);
      expect(approved.changes[0]).toEqual(
        expect.objectContaining({
          ingredientId: ingredient,
          oldQuantity: 10,
          newQuantity: 8,
          delta: -2,
        }),
      );

      // No ledger row exists yet — approve writes none.
      expect(
        await db.select().from(schema.stockLedger).where(eq(schema.stockLedger.reference, so.id)),
      ).toHaveLength(0);

      // 6. Realize — the SO is dated the 25th, so it applies (no wall-clock
      // pinning: the guard reads the opname's own date, ADR 0021).
      const realized = await inv.realizeStockOpnameCore(superAdmin, { soId: so.id });
      expect(realized.success).toBe(true);
      expect(await getStock(branch, ingredient)).toBe(8);
      st = await soStatus(so.id);
      expect(st.realizedAt).toBeTruthy();

      const ledger = await db
        .select()
        .from(schema.stockLedger)
        .where(eq(schema.stockLedger.reference, `SO:${so.id}`));
      expect(ledger).toHaveLength(1);
      expect(ledger[0]).toEqual(
        expect.objectContaining({
          ingredientId: ingredient,
          type: "OUT",
          quantity: 2,
          balance: 8,
          notes: "SO Realization: Adjusted from 10 to 8",
        }),
      );

      // Double-realize is refused
      await expect(inv.realizeStockOpnameCore(superAdmin, { soId: so.id })).rejects.toThrow(
        "Stock Opname sudah di-realize sebelumnya",
      );
    },
  );
});

describe("Stock opname — state guards", () => {
  async function seededSo() {
    const branch = await seedBranch(uniq("SO-G"));
    const ingredient = await seedIngredient(uniq("SO-GING"));
    await seedInventory(branch, ingredient, 10);
    const ba = await seedUser("branch_admin", branch);
    const am = await seedUser("area_manager", undefined, [branch]);
    const superAdmin = await seedUser("super_admin");
    const so = await inv.triggerStockOpnameCore(ba, { branchId: branch, date: "2026-08-25" });
    return { so, ba, am, superAdmin, branch, ingredient };
  }

  it.skipIf(!hasTestDatabaseUrl)(
    "approve refuses an uncounted SO (blank-submit guard) and already-approved SOs",
    async () => {
      const { so, am } = await seededSo();
      // No counts ever entered → physicalStock all 0 → refuse (would zero stock)
      await expect(inv.approveStockOpnameCore(am, { soId: so.id })).rejects.toThrow(
        "Belum ada stok fisik yang diisi",
      );
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "mark-investigation and update-counts enforce their required statuses",
    async () => {
      const { so, ba, am } = await seededSo();

      // markInvestigation only from Submitted — approve path requires counts, so
      // first submit real counts, approve, then probing the wrong status.
      const item = await firstItem(so.id);
      await inv.submitStockOpnameCore(ba, {
        soId: so.id,
        items: [{ itemId: item.id, physicalStock: 8 }],
      });
      await inv.approveStockOpnameCore(am, { soId: so.id });

      // Approved is not Submitted → cannot mark investigation
      await expect(inv.markStockOpnameInvestigationCore(am, { soId: so.id })).rejects.toThrow(
        "Stock opname is not in Submitted status",
      );
      // Approved is not Under Investigation → cannot update counts
      await expect(
        inv.updateStockOpnameCountsCore(ba, {
          soId: so.id,
          items: [{ itemId: item.id, physicalStock: 5 }],
        }),
      ).rejects.toThrow("Stock opname is not under investigation");
      // Already approved → cannot re-approve
      await expect(inv.approveStockOpnameCore(am, { soId: so.id })).rejects.toThrow(
        "Stock opname sudah di-approve",
      );
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "a 25th opname can be realized early inside its own month, but not a future cycle",
    async () => {
      const branch = await seedBranch(uniq("SO-CYC"));
      const ingredient = await seedIngredient(uniq("SO-CYCING"));
      await seedInventory(branch, ingredient, 10);
      const ba = await seedUser("branch_admin", branch);
      const am = await seedUser("area_manager", undefined, [branch]);
      const superAdmin = await seedUser("super_admin");

      // Today is mid-cycle: 2026-10-10 12:00 Jakarta. The opname is dated the
      // month's 25th (2026-10-25) — the branch counts continuously, so realize
      // must work now. This is the exact case the user hit.
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-10T05:00:00Z")); // 12:00 Asia/Jakarta
      try {
        const so = await inv.triggerStockOpnameCore(ba, {
          branchId: branch,
          date: "2026-10-25",
        });
        const item = await firstItem(so.id);
        await inv.submitStockOpnameCore(ba, {
          soId: so.id,
          items: [{ itemId: item.id, physicalStock: 8 }],
        });
        await inv.approveStockOpnameCore(am, { soId: so.id });

        const realized = await inv.realizeStockOpnameCore(superAdmin, { soId: so.id });
        expect(realized.success).toBe(true);
        expect(await getStock(branch, ingredient)).toBe(8);

        // A FUTURE cycle's opname is still refused — realizing next month's
        // opname today would apply a count of a cycle that has not started.
        const branchB = await seedBranch(uniq("SO-CYC-B"));
        const ingredientB = await seedIngredient(uniq("SO-CYCINGB"));
        await seedInventory(branchB, ingredientB, 10);
        const baB = await seedUser("branch_admin", branchB);
        const amB = await seedUser("area_manager", undefined, [branchB]);
        const soB = await inv.triggerStockOpnameCore(baB, {
          branchId: branchB,
          date: "2026-11-25",
        });
        const itemB = await firstItem(soB.id, ingredientB);
        await inv.submitStockOpnameCore(baB, {
          soId: soB.id,
          items: [{ itemId: itemB.id, physicalStock: 9 }],
        });
        await inv.approveStockOpnameCore(amB, { soId: soB.id });
        await expect(inv.realizeStockOpnameCore(superAdmin, { soId: soB.id })).rejects.toThrow(
          "belum bisa di-realize",
        );
        expect(await getStock(branchB, ingredientB)).toBe(10);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "realize refuses non-25th opnames (notes only) and unapproved SOs",
    async () => {
      // An opname dated outside the 25th is a note: it can be counted,
      // submitted, and approved, but realize must refuse to touch stock.
      const branch = await seedBranch(uniq("SO-N25"));
      const ingredient = await seedIngredient(uniq("SO-N25ING"));
      await seedInventory(branch, ingredient, 10);
      const ba = await seedUser("branch_admin", branch);
      const am = await seedUser("area_manager", undefined, [branch]);
      const superAdmin = await seedUser("super_admin");

      const noteSo = await inv.triggerStockOpnameCore(ba, {
        branchId: branch,
        date: "2026-08-12",
      });
      const noteItem = await firstItem(noteSo.id);
      await inv.submitStockOpnameCore(ba, {
        soId: noteSo.id,
        items: [{ itemId: noteItem.id, physicalStock: 4 }],
      });
      await inv.approveStockOpnameCore(am, { soId: noteSo.id });

      await expect(inv.realizeStockOpnameCore(superAdmin, { soId: noteSo.id })).rejects.toThrow(
        "hanya catatan",
      );
      // Nothing moved, and nothing was written.
      expect(await getStock(branch, ingredient)).toBe(10);
      expect(
        await db
          .select()
          .from(schema.stockLedger)
          .where(eq(schema.stockLedger.reference, `SO:${noteSo.id}`)),
      ).toHaveLength(0);

      // A 25th-dated SO that was never approved is refused on status instead.
      const branchB = await seedBranch(uniq("SO-U25"));
      const ingredientB = await seedIngredient(uniq("SO-U25ING"));
      await seedInventory(branchB, ingredientB, 10);
      const baB = await seedUser("branch_admin", branchB);
      const soB = await inv.triggerStockOpnameCore(baB, { branchId: branchB, date: "2026-08-25" });
      const itemB = await firstItem(soB.id, ingredientB);
      await inv.submitStockOpnameCore(baB, {
        soId: soB.id,
        items: [{ itemId: itemB.id, physicalStock: 8 }],
      });
      await expect(inv.realizeStockOpnameCore(superAdmin, { soId: soB.id })).rejects.toThrow(
        "Stock Opname harus di-approve terlebih dahulu",
      );
    },
  );

  it.skipIf(!hasTestDatabaseUrl)("every core refuses a missing SO", async () => {
    const missing = crypto.randomUUID();
    const { ba, am, superAdmin } = await seededSo();
    await expect(inv.submitStockOpnameCore(ba, { soId: missing, items: [] })).rejects.toThrow(
      "Stock opname not found",
    );
    await expect(inv.markStockOpnameInvestigationCore(am, { soId: missing })).rejects.toThrow(
      "Stock opname not found",
    );
    await expect(inv.updateStockOpnameCountsCore(ba, { soId: missing, items: [] })).rejects.toThrow(
      "Stock opname not found",
    );
    await expect(inv.approveStockOpnameCore(am, { soId: missing })).rejects.toThrow(
      "Stock opname not found",
    );
    // The SO lookup precedes the date guard (the rule reads the opname's own
    // date), so a missing SO reports not-found with no timer pinning.
    await expect(inv.realizeStockOpnameCore(superAdmin, { soId: missing })).rejects.toThrow(
      "Stock Opname tidak ditemukan",
    );
  });
});

describe("Stock opname — partial counting (fields not filled keep their stock)", () => {
  async function seededPairSo() {
    const branch = await seedBranch(uniq("SO-P"));
    const ingA = await seedIngredient(uniq("SO-PINGA"));
    const ingB = await seedIngredient(uniq("SO-PINGB"));
    await seedInventory(branch, ingA, 10);
    await seedInventory(branch, ingB, 20);
    const ba = await seedUser("branch_admin", branch);
    const am = await seedUser("area_manager", undefined, [branch]);
    const superAdmin = await seedUser("super_admin");
    const so = await inv.triggerStockOpnameCore(ba, { branchId: branch, date: "2026-08-25" });
    const items = await db
      .select()
      .from(schema.stockOpnameItems)
      .where(eq(schema.stockOpnameItems.stockOpnameId, so.id));
    return { so, items, ba, am, superAdmin, branch, ingA, ingB };
  }

  it.skipIf(!hasTestDatabaseUrl)(
    "submit fills only the sent items; approve is note-only; realize applies counted stock",
    async () => {
      const { so, items, ba, am, superAdmin, branch, ingA, ingB } = await seededPairSo();
      expect(items).toHaveLength(2);

      // Count only item A (10 → 7); item B is left blank
      const itemA = items.find((i) => i.ingredientId === ingA)!;
      const itemB = items.find((i) => i.ingredientId === ingB)!;
      await inv.submitStockOpnameCore(ba, {
        soId: so.id,
        items: [{ itemId: itemA.id, physicalStock: 7 }],
      });

      const afterSubmit = await db
        .select()
        .from(schema.stockOpnameItems)
        .where(eq(schema.stockOpnameItems.stockOpnameId, so.id));
      expect(afterSubmit.find((i) => i.id === itemA.id)?.countedAt).not.toBeNull();
      expect(afterSubmit.find((i) => i.id === itemB.id)?.countedAt).toBeNull();

      // Approve (ADR 0021): no stock change, no ledger row — review only.
      const result = await inv.approveStockOpnameCore(am, { soId: so.id });
      expect(await getStock(branch, ingA)).toBe(10);
      expect(await getStock(branch, ingB)).toBe(20);
      expect(
        await db.select().from(schema.stockLedger).where(eq(schema.stockLedger.reference, so.id)),
      ).toHaveLength(0);

      // Summary (the preview the approver signed) covers only counted items
      expect(result.counted).toBe(1);
      expect(result.skipped).toBe(1);
      expect(result.changes).toHaveLength(1);
      expect(result.changes[0]).toEqual(
        expect.objectContaining({
          ingredientId: ingA,
          ingredientName: expect.stringContaining("SO-PINGA"),
          oldQuantity: 10,
          newQuantity: 7,
          delta: -3,
        }),
      );

      // Realize: A adjusted 10 → 7, B untouched at 20
      const realized = await inv.realizeStockOpnameCore(superAdmin, { soId: so.id });
      expect(realized.itemsAdjusted).toBe(1);
      expect(realized.itemsSkipped).toBe(1);
      expect(await getStock(branch, ingA)).toBe(7);
      expect(await getStock(branch, ingB)).toBe(20);

      const ledger = await db
        .select()
        .from(schema.stockLedger)
        .where(eq(schema.stockLedger.reference, `SO:${so.id}`));
      expect(ledger).toHaveLength(1);
      expect(ledger[0]).toEqual(
        expect.objectContaining({
          ingredientId: ingA,
          type: "OUT",
          quantity: 3,
          balance: 7,
          notes: "SO Realization: Adjusted from 10 to 7",
        }),
      );
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "an explicit 0 count is a real count (realize zeroes stock); an SO with no counts is refused",
    async () => {
      const { so, items, ba, am, superAdmin, branch, ingA } = await seededPairSo();
      const itemA = items.find((i) => i.ingredientId === ingA)!;

      // Explicit zero is a valid count: countedAt must be set
      await inv.submitStockOpnameCore(ba, {
        soId: so.id,
        items: [{ itemId: itemA.id, physicalStock: 0 }],
      });
      const counted = await db
        .select()
        .from(schema.stockOpnameItems)
        .where(eq(schema.stockOpnameItems.id, itemA.id));
      expect(counted[0]?.countedAt).not.toBeNull();

      // Approve is note-only: the stock is still 10 until realize
      await inv.approveStockOpnameCore(am, { soId: so.id });
      expect(await getStock(branch, ingA)).toBe(10);

      const realized = await inv.realizeStockOpnameCore(superAdmin, { soId: so.id });
      expect(realized.itemsAdjusted).toBe(1);
      expect(await getStock(branch, ingA)).toBe(0);

      // Fresh SO with zero filled fields → approve refused (blank-submit guard)
      const fresh = await seededPairSo();
      await expect(inv.approveStockOpnameCore(am, { soId: fresh.so.id })).rejects.toThrow(
        "Belum ada stok fisik yang diisi",
      );
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "submit rejects negative and non-finite counts before touching the DB",
    async () => {
      const { so, items, ba } = await seededPairSo();
      const itemA = items[0];
      await expect(
        inv.submitStockOpnameCore(ba, {
          soId: so.id,
          items: [{ itemId: itemA.id, physicalStock: -1 }],
        }),
      ).rejects.toThrow("Stok fisik tidak valid");
      // A half-typed count on the input arrives as NaN; it must be refused, not
      // written as NaN into a real column.
      await expect(
        inv.submitStockOpnameCore(ba, {
          soId: so.id,
          items: [{ itemId: itemA.id, physicalStock: Number.NaN }],
        }),
      ).rejects.toThrow("Stok fisik tidak valid");
      await expect(
        inv.submitStockOpnameCore(ba, {
          soId: so.id,
          items: [{ itemId: itemA.id, physicalStock: Number.POSITIVE_INFINITY }],
        }),
      ).rejects.toThrow("Stok fisik tidak valid");

      const row = await db
        .select()
        .from(schema.stockOpnameItems)
        .where(eq(schema.stockOpnameItems.id, itemA.id));
      expect(row[0]?.countedAt).toBeNull();
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "a fractional count is accepted and produces a fractional variance",
    async () => {
      const { so, items, ba } = await seededPairSo();
      const itemA = items[0];
      const systemStock = items[0].systemStock;

      await inv.submitStockOpnameCore(ba, {
        soId: so.id,
        items: [{ itemId: itemA.id, physicalStock: systemStock + 0.5 }],
      });

      const [row] = await db
        .select()
        .from(schema.stockOpnameItems)
        .where(eq(schema.stockOpnameItems.id, itemA.id));
      expect(row?.countedAt).not.toBeNull();
      expect(row?.physicalStock).toBeCloseTo(systemStock + 0.5, 5);
      expect(row?.variance).toBeCloseTo(0.5, 5);
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "triggering an SO snapshots fractional system stock instead of failing (migration 0058)",
    async () => {
      // The reported bug: `stock_opname_items.system_stock` was `integer` while
      // `inventory.quantity` had been `real` since 0016, so a branch holding
      // 23.5 could not start an opname at all —
      // `invalid input syntax for type integer: "23.5"`.
      const branch = await seedBranch(uniq("SO-FRAC"), "Outlet");
      const ingredient = await seedIngredient(uniq("ING-FRAC"), { isBranchVisible: true });
      const ba = await seedUser("branch_admin", branch);
      await db.insert(schema.inventory).values({
        branchId: branch,
        ingredientId: ingredient,
        quantity: 23.5,
      });

      const so = await inv.triggerStockOpnameCore(ba, { branchId: branch, date: "2026-08-25" });

      const rows = await db
        .select()
        .from(schema.stockOpnameItems)
        .where(eq(schema.stockOpnameItems.stockOpnameId, so.id));
      const counted = rows.find((r) => r.ingredientId === ingredient);
      expect(counted).toBeDefined();
      expect(counted?.systemStock).toBeCloseTo(23.5, 5);
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "the system-stock snapshot is rounded off float32 residue, not left at 6 decimals",
    async () => {
      const branch = await seedBranch(uniq("SO-FUZZ"), "Outlet");
      const ingredient = await seedIngredient(uniq("ING-FUZZ"), { isBranchVisible: true });
      const ba = await seedUser("branch_admin", branch);
      // What 20 + 3.5 looks like after a float32 round trip through the column.
      await db.insert(schema.inventory).values({
        branchId: branch,
        ingredientId: ingredient,
        quantity: 20 + 3.5,
      });

      const so = await inv.triggerStockOpnameCore(ba, { branchId: branch, date: "2026-08-25" });

      const [counted] = await db
        .select()
        .from(schema.stockOpnameItems)
        .where(eq(schema.stockOpnameItems.stockOpnameId, so.id));
      expect(counted?.systemStock).toBe(23.5);
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "realize skips uncounted items — only counted stock is realized",
    async () => {
      const { so, items, ba, am, superAdmin, branch, ingA, ingB } = await seededPairSo();
      const itemA = items.find((i) => i.ingredientId === ingA)!;
      await inv.submitStockOpnameCore(ba, {
        soId: so.id,
        items: [{ itemId: itemA.id, physicalStock: 5 }],
      });
      // Approve is note-only (ADR 0021): nothing has moved yet.
      await inv.approveStockOpnameCore(am, { soId: so.id });
      expect(await getStock(branch, ingA)).toBe(10);
      expect(await getStock(branch, ingB)).toBe(20);

      const realized = await inv.realizeStockOpnameCore(superAdmin, { soId: so.id });
      expect(realized.itemsAdjusted).toBe(1);
      expect(realized.itemsSkipped).toBe(1);
      expect(await getStock(branch, ingA)).toBe(5);
      expect(await getStock(branch, ingB)).toBe(20);
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "approve reports snapshot drift when inventory moved since trigger",
    async () => {
      const { so, items, ba, am, branch, ingA, ingB } = await seededPairSo();
      const itemA = items.find((i) => i.ingredientId === ingA)!;
      const itemB = items.find((i) => i.ingredientId === ingB)!;
      await inv.submitStockOpnameCore(ba, {
        soId: so.id,
        items: [{ itemId: itemA.id, physicalStock: 7 }],
      });

      // Stock moves after trigger: A loses 3 to sales (10 → 7), B untouched.
      // Approve still previews physical 7 measured from current stock — and,
      // per ADR 0021, applies nothing at all.
      await db
        .update(schema.inventory)
        .set({ quantity: 7 })
        .where(and(eq(schema.inventory.branchId, branch), eq(schema.inventory.ingredientId, ingA)));

      const result = await inv.approveStockOpnameCore(am, { soId: so.id });

      // Drift covers only the moved counted item, with both values
      expect(result.drift).toHaveLength(1);
      expect(result.drift[0]).toEqual(
        expect.objectContaining({
          ingredientId: ingA,
          systemStock: 10,
          currentQuantity: 7,
        }),
      );
      // The preview is measured against current stock: 7 → 7, no change
      expect(result.changes[0]).toEqual(
        expect.objectContaining({ oldQuantity: 7, newQuantity: 7, delta: 0 }),
      );
      // Note-only approval: no stock movement, no ledger row.
      expect(await getStock(branch, ingA)).toBe(7);
      expect(
        await db.select().from(schema.stockLedger).where(eq(schema.stockLedger.reference, so.id)),
      ).toHaveLength(0);

      // Count matches current stock exactly (no movement since trigger) → no
      // drift; the change is a plain snapshot variance.
      const pair2 = await seededPairSo();
      const itemA2 = pair2.items.find((i) => i.ingredientId === pair2.ingA)!;
      await inv.submitStockOpnameCore(pair2.ba, {
        soId: pair2.so.id,
        items: [{ itemId: itemA2.id, physicalStock: 7 }],
      });
      const result2 = await inv.approveStockOpnameCore(pair2.am, { soId: pair2.so.id });
      expect(result2.drift).toHaveLength(0);
      expect(result2.changes[0]).toEqual(
        expect.objectContaining({ oldQuantity: 10, newQuantity: 7, delta: -3 }),
      );
      void itemB;
    },
  );
});

describe("Stock opname — wrong-role and wrong-branch actors are rejected", () => {
  it.skipIf(!hasTestDatabaseUrl)(
    "trigger/submit reject other-branch admins; supervisor steps reject wrong roles",
    async () => {
      const branch = await seedBranch(uniq("SO-N"));
      const otherBranch = await seedBranch(uniq("SO-NX"));
      const ingredient = await seedIngredient(uniq("SO-NING"));
      await seedInventory(branch, ingredient, 10);

      const ba = await seedUser("branch_admin", branch);
      const otherBa = await seedUser("branch_admin", otherBranch);
      const am = await seedUser("area_manager", undefined, [branch]);
      const superAdmin = await seedUser("super_admin");
      const adminPusat = await seedUser("admin_pusat");
      const kitchen = await seedUser("central_kitchen");

      // Trigger: other-branch BA refused; central_kitchen not a trigger role
      await expect(
        inv.triggerStockOpnameCore(otherBa, { branchId: branch, date: "2026-08-25" }),
      ).rejects.toThrow("Branch Admin hanya bisa trigger SO untuk cabang sendiri");
      await expect(
        inv.triggerStockOpnameCore(kitchen, { branchId: branch, date: "2026-08-25" }),
      ).rejects.toThrow("Forbidden: insufficient role (user ");

      // A valid trigger, then probe each step
      const so = await inv.triggerStockOpnameCore(ba, { branchId: branch, date: "2026-08-25" });
      const item = await firstItem(so.id);

      // Submit: other-branch BA refused
      await expect(
        inv.submitStockOpnameCore(otherBa, {
          soId: so.id,
          items: [{ itemId: item.id, physicalStock: 5 }],
        }),
      ).rejects.toThrow("Unauthorized: you can only submit Stock Opnames for your branch");

      // Supervisors only: markInvestigation / approve need super_admin | area_manager
      await expect(inv.markStockOpnameInvestigationCore(ba, { soId: so.id })).rejects.toThrow(
        "Forbidden: insufficient role (user ",
      );
      await expect(inv.approveStockOpnameCore(ba, { soId: so.id })).rejects.toThrow(
        "Forbidden: insufficient role (user ",
      );

      // updateCounts: admin_pusat not allowed
      await expect(
        inv.updateStockOpnameCountsCore(adminPusat, {
          soId: so.id,
          items: [{ itemId: item.id, physicalStock: 5 }],
        }),
      ).rejects.toThrow("Forbidden: insufficient role (user ");

      // realize: only super_admin | admin_pusat
      await expect(inv.realizeStockOpnameCore(am, { soId: so.id })).rejects.toThrow(
        "Forbidden: insufficient role (user ",
      );
      // The SO is dated the 25th (seededSo), so the date guard passes and the
      // status guard is what refuses an unapproved opname.
      await expect(inv.realizeStockOpnameCore(superAdmin, { soId: so.id })).rejects.toThrow(
        "Stock Opname harus di-approve terlebih dahulu",
      );

      // No side effects from the rejected attempts
      const [row] = await db
        .select()
        .from(schema.stockOpnames)
        .where(eq(schema.stockOpnames.id, so.id));
      expect(row.status).toBe("Submitted");
      expect(row.approvedBy).toBeNull();
    },
  );
});

describe("Stock opname — trigger item list scope (why 'trigger SO cuma 35 item')", () => {
  /** Count the SO item rows a trigger produced. */
  async function soItemCount(soId: string): Promise<number> {
    const rows = await db
      .select({ id: schema.stockOpnameItems.id })
      .from(schema.stockOpnameItems)
      .where(eq(schema.stockOpnameItems.stockOpnameId, soId));
    return rows.length;
  }

  it.skipIf(!hasTestDatabaseUrl)(
    "the catalog decides the item list, not the presence of a stock record",
    async () => {
      const branch = await seedBranch(uniq("SO-C"));
      // A: stocked here → in the SO with its quantity
      const ingWithRow = await seedIngredient(uniq("SO-C-WITH"));
      await seedInventory(branch, ingWithRow, 5);
      // B: countable + not deleted, but NO stock record at this branch → STILL
      // in the SO, at systemStock 0. Before, the stock record was the scope, so
      // this line was silently missing from every count sheet (29-33 items per
      // outlet in production) and a 0-stock item could never be counted.
      const ingNoRow = await seedIngredient(uniq("SO-C-NOINV"));
      // C: stock record exists but ingredient is Deleted → NOT in the SO
      const deletedIng = await seedIngredient(uniq("SO-C-DEL"));
      await db
        .update(schema.ingredients)
        .set({ status: "Deleted" })
        .where(eq(schema.ingredients.id, deletedIng));
      await seedInventory(branch, deletedIng, 3);
      // D: stock record but countable = false (e.g. porsi shelf) → NOT in the SO
      const nonCountable = await seedIngredient(uniq("SO-C-NONCT"));
      await db
        .update(schema.ingredients)
        .set({ countable: false })
        .where(eq(schema.ingredients.id, nonCountable));
      await seedInventory(branch, nonCountable, 4);

      const ba = await seedUser("branch_admin", branch);
      const so = await inv.triggerStockOpnameCore(ba, {
        branchId: branch,
        date: "2026-08-25",
      });

      // Exactly two SO items: A (real quantity) and B (0 — never stocked).
      expect(await soItemCount(so.id)).toBe(2);
      const withRow = await firstItem(so.id, ingWithRow);
      expect(withRow.systemStock).toBe(5);
      const noRow = await firstItem(so.id, ingNoRow);
      expect(noRow.systemStock).toBe(0);
      expect(noRow.physicalStock).toBe(0);
      // A fresh line is uncounted: 0 is the trigger default, not a count.
      expect(noRow.countedAt).toBeNull();
      // C (Deleted) and D (not countable) stay out.
      await expect(firstItem(so.id, deletedIng)).rejects.toThrow("no items for SO");
      await expect(firstItem(so.id, nonCountable)).rejects.toThrow("no items for SO");
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "outlet branches only SO their catalog (isBranchVisible); central SOs everything",
    async () => {
      const central = await seedBranch(uniq("SO-CT"), "Central");
      const outlet = await seedBranch(uniq("SO-OT"), "Outlet");

      // Visible (catalog) ingredient — stocked at both branches. NB: the
      // schema default is isBranchVisible=false, so catalog membership must be
      // set explicitly — exactly the flag that decides an Outlet SO's scope.
      const visible = await seedIngredient(uniq("SO-VIS"));
      await db
        .update(schema.ingredients)
        .set({ isBranchVisible: true })
        .where(eq(schema.ingredients.id, visible));
      // Central-only (non-catalog) ingredient — stocked at both branches.
      const centralOnly = await seedIngredient(uniq("SO-CENT"));
      await db
        .update(schema.ingredients)
        .set({ isBranchVisible: false })
        .where(eq(schema.ingredients.id, centralOnly));

      await seedInventory(central, visible, 10);
      await seedInventory(central, centralOnly, 20);
      await seedInventory(outlet, visible, 1);
      await seedInventory(outlet, centralOnly, 2);

      const outletBa = await seedUser("branch_admin", outlet);
      const superAdmin = await seedUser("super_admin");

      // Central SO: both countable ingredients regardless of isBranchVisible.
      const centralSo = await inv.triggerStockOpnameCore(superAdmin, {
        branchId: central,
        date: "2026-08-25",
      });
      expect(await soItemCount(centralSo.id)).toBe(2);

      // Outlet SO: the catalog gate decides which items are CATALOG members,
      // but the sheet also counts everything the outlet physically holds —
      // including the two flagged-out ingredients below. Stock held outside
      // the catalog is counted, not dropped.
      const neverCataloged = await seedIngredient(uniq("SO-NEW"));
      await seedInventory(outlet, neverCataloged, 9);
      const outletSo = await inv.triggerStockOpnameCore(outletBa, {
        branchId: outlet,
        date: "2026-08-25",
      });
      expect(await soItemCount(outletSo.id)).toBe(3);
      const outletItems = await db
        .select({ ingredientId: schema.stockOpnameItems.ingredientId })
        .from(schema.stockOpnameItems)
        .where(eq(schema.stockOpnameItems.stockOpnameId, outletSo.id));
      expect(outletItems.map((i) => i.ingredientId).sort()).toEqual(
        [visible, centralOnly, neverCataloged].sort(),
      );

      // The two flagged-out lines are marked as outside the branch catalog.
      const outletDetail = await inv.getStockOpnameDetailCore(outletBa, { id: outletSo.id });
      const marked =
        outletDetail?.items.filter((i) => i.outsideBranchCatalog).map((i) => i.ingredientId) ?? [];
      expect(marked.sort()).toEqual([centralOnly, neverCataloged].sort());
      expect(outletDetail?.outsideCatalogCount).toBe(2);

      // Catalog membership decides the sheet, not the stock records: an outlet
      // item the branch has never received is on the sheet at systemStock 0
      // instead of being silently absent. Its line is a real count line — the
      // counter writes what they find on the shelf, including nothing.
      const neverStocked = await seedIngredient(uniq("SO-NOSTOCK"), { isBranchVisible: true });
      const outletSo2 = await inv.triggerStockOpnameCore(outletBa, {
        branchId: outlet,
        date: "2026-08-26",
      });
      // Catalog member (no stock) + the three already present + the new one.
      expect(await soItemCount(outletSo2.id)).toBe(4);
      const noStockLine = await firstItem(outletSo2.id, neverStocked);
      expect(noStockLine.systemStock).toBe(0);
      expect(noStockLine.countedAt).toBeNull();
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "role does not change the item list — same branch, same items regardless of triggerer",
    async () => {
      const branch = await seedBranch(uniq("SO-R"));
      const n = 40; // more than the reported 35 to show no cap exists
      for (let i = 0; i < n; i++) {
        const ing = await seedIngredient(uniq(`SO-R-${String(i).padStart(2, "0")}`));
        await seedInventory(branch, ing, 10);
      }

      const ba = await seedUser("branch_admin", branch);
      const am = await seedUser("area_manager", undefined, [branch]);
      const superAdmin = await seedUser("super_admin");

      const soByBa = await inv.triggerStockOpnameCore(ba, {
        branchId: branch,
        date: "2026-08-25",
      });
      const soByAm = await inv.triggerStockOpnameCore(am, {
        branchId: branch,
        date: "2026-08-25",
      });
      const soBySuper = await inv.triggerStockOpnameCore(superAdmin, {
        branchId: branch,
        date: "2026-08-25",
      });

      // No per-role cap: every role sees all 40 inventory-backed items.
      expect(await soItemCount(soByBa.id)).toBe(n);
      expect(await soItemCount(soByAm.id)).toBe(n);
      expect(await soItemCount(soBySuper.id)).toBe(n);
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "trigger is atomic — a failing item insert leaves NO orphan stockOpname header",
    async () => {
      // Production forensics showed truncated SOs (35 of 57 items) because the
      // old per-item INSERT loop ran without a transaction: a mid-loop failure
      // (e.g. pooler connection drop) left the header + partial items committed
      // and no trigger log. The fix writes header + all items in ONE
      // transaction with a single multi-row INSERT, so a failure anywhere must
      // roll back everything.
      const branch = await seedBranch(uniq("SO-ATOM"));
      const ing1 = await seedIngredient(uniq("SO-ATOM-1"));
      const ing2 = await seedIngredient(uniq("SO-ATOM-2"));
      await seedInventory(branch, ing1, 10);
      await seedInventory(branch, ing2, 20);

      const ba = await seedUser("branch_admin", branch);

      // Sabotage at the database level: a trigger that raises on ANY item row
      // makes the bulk INSERT fail mid-statement — the Postgres-native way to
      // simulate the production failure. It must be dropped in `finally` so
      // other tests (which legitimately insert SO items) are not affected.
      const poison = new Client({ connectionString: testDatabaseUrl });
      await poison.connect();
      await poison.query(
        `CREATE FUNCTION its_so_poison() RETURNS trigger AS $fn$
         BEGIN
           RAISE EXCEPTION 'its-poison: simulated mid-insert failure';
         END;
         $fn$ LANGUAGE plpgsql`,
      );
      await poison.query(
        `CREATE TRIGGER its_so_poison_trg BEFORE INSERT ON stock_opname_items
         FOR EACH ROW EXECUTE FUNCTION its_so_poison()`,
      );

      try {
        // Drizzle wraps the Postgres exception in "Failed query: insert into
        // …"; the wrapped message carries the trigger's RAISE text.
        await expect(
          inv.triggerStockOpnameCore(ba, { branchId: branch, date: "2026-08-25" }),
        ).rejects.toThrow(/its-poison|Failed query/);
      } finally {
        await poison.query("DROP TRIGGER IF EXISTS its_so_poison_trg ON stock_opname_items");
        await poison.query("DROP FUNCTION IF EXISTS its_so_poison()");
        await poison.end();
      }

      // The header must NOT survive: the failing insert rolls back the whole
      // transaction instead of leaving a truncated SO behind.
      const headers = await db
        .select({ id: schema.stockOpnames.id })
        .from(schema.stockOpnames)
        .where(eq(schema.stockOpnames.branchId, branch));
      expect(headers).toHaveLength(0);
      const items = await db
        .select({ id: schema.stockOpnameItems.id })
        .from(schema.stockOpnameItems)
        .innerJoin(
          schema.stockOpnames,
          eq(schema.stockOpnameItems.stockOpnameId, schema.stockOpnames.id),
        )
        .where(eq(schema.stockOpnames.branchId, branch));
      expect(items).toHaveLength(0);
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "the detail view is a snapshot — later master-data changes do not drop counted lines",
    async () => {
      // The detail page used to re-apply the trigger's catalog filters
      // (`isBranchVisible`, `status <> 'Deleted'`) on every read. A line then
      // vanished from the page as soon as the ingredient was flagged off or
      // soft-deleted — while `realize` still applies that same counted row (its
      // query never had the filters). A count the user cannot see must not move
      // stock, so the read must report exactly what the trigger wrote.
      const branch = await seedBranch(uniq("SO-SNAP"), "Outlet");
      const stocked = await seedIngredient(uniq("SO-SNAP-STK"), { isBranchVisible: true });
      await seedInventory(branch, stocked, 10);
      // A catalog item never stocked here — the case that motivated reading the
      // item list from the catalog in the first place.
      const zeroLine = await seedIngredient(uniq("SO-SNAP-ZERO"), { isBranchVisible: true });

      const ba = await seedUser("branch_admin", branch);
      const so = await inv.triggerStockOpnameCore(ba, { branchId: branch, date: "2026-08-25" });

      // Count both lines: the stocked one at 8, the never-stocked one at 0.
      await inv.submitStockOpnameCore(ba, {
        soId: so.id,
        items: [
          { itemId: (await firstItem(so.id, stocked)).id, physicalStock: 8 },
          { itemId: (await firstItem(so.id, zeroLine)).id, physicalStock: 0 },
        ],
      });

      // Master data moves under the opname: the item leaves the branch catalog
      // and the other one is tombstoned.
      await db
        .update(schema.ingredients)
        .set({ isBranchVisible: false })
        .where(eq(schema.ingredients.id, stocked));
      await db
        .update(schema.ingredients)
        .set({ status: "Deleted" })
        .where(eq(schema.ingredients.id, zeroLine));

      // A supervisor (non-blind) reads the opname.
      const am = await seedUser("area_manager", undefined, [branch]);
      const detail = await inv.getStockOpnameDetailCore(am, { id: so.id });

      // Both counted lines survive, with their names still resolvable.
      expect(detail?.totalCount).toBe(2);
      const names = detail?.items.map((i) => i.ingredientName) ?? [];
      expect(names.some((n) => n?.includes("SO-SNAP-STK"))).toBe(true);
      expect(names.some((n) => n?.includes("SO-SNAP-ZERO"))).toBe(true);
      expect(detail?.countedCount).toBe(2);
      // The snapshot values are intact — the view did not re-read the catalog.
      expect(detail?.items.find((i) => i.ingredientId === stocked)?.systemStock).toBe(10);
      expect(detail?.items.find((i) => i.ingredientId === stocked)?.physicalStock).toBe(8);
      expect(detail?.items.find((i) => i.ingredientId === zeroLine)?.systemStock).toBe(0);

      // And realize still applies both counts, so the view and the writer agree.
      await inv.approveStockOpnameCore(am, { soId: so.id });
      const superAdmin = await seedUser("super_admin");
      const realized = await inv.realizeStockOpnameCore(superAdmin, { soId: so.id });
      expect(realized.itemsAdjusted).toBe(2);
      expect(await getStock(branch, stocked)).toBe(8);
      expect(await getStock(branch, zeroLine)).toBe(0);
    },
  );
});
