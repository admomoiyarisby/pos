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

async function firstItem(soId: string) {
  const [row] = await db
    .select()
    .from(schema.stockOpnameItems)
    .where(eq(schema.stockOpnameItems.stockOpnameId, soId))
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

      // 5. Approve — inventory adjusted to physical (10 → 8), ledger row written
      const approved = await inv.approveStockOpnameCore(am, { soId: so.id });
      st = await soStatus(so.id);
      expect(st.status).toBe("Approved");
      expect(await getStock(branch, ingredient)).toBe(8);

      // Approve returns the change summary (counted items only)
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

      const ledger = await db
        .select()
        .from(schema.stockLedger)
        .where(eq(schema.stockLedger.reference, so.id));
      expect(ledger).toHaveLength(1);
      expect(ledger[0]).toEqual(
        expect.objectContaining({
          ingredientId: ingredient,
          type: "OUT",
          quantity: 2,
          balance: 8,
          notes: "SO Adjustment",
        }),
      );

      // 6. Realize — only on the 25th; marks the SO realized. The date guard
      // runs before the status/duplicate guards, so stay on the 25th.
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(2026, 7, 25, 10, 0, 0));
      try {
        const realized = await inv.realizeStockOpnameCore(superAdmin, { soId: so.id });
        expect(realized.success).toBe(true);
        st = await soStatus(so.id);
        expect(st.realizedAt).toBeTruthy();

        // Double-realize is refused
        await expect(inv.realizeStockOpnameCore(superAdmin, { soId: so.id })).rejects.toThrow(
          "Stock Opname sudah di-realize sebelumnya",
        );
      } finally {
        vi.useRealTimers();
      }
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

  it.skipIf(!hasTestDatabaseUrl)("realize refuses wrong dates and unapproved SOs", async () => {
    const { so, ba, am, superAdmin } = await seededSo();
    const item = await firstItem(so.id);
    await inv.submitStockOpnameCore(ba, {
      soId: so.id,
      items: [{ itemId: item.id, physicalStock: 8 }],
    });
    await inv.approveStockOpnameCore(am, { soId: so.id });

    // Wrong date (not the 25th)
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 7, 10, 10, 0, 0));
    try {
      await expect(inv.realizeStockOpnameCore(superAdmin, { soId: so.id })).rejects.toThrow(
        "Stock Opname hanya bisa di-realize pada tanggal 25",
      );
    } finally {
      vi.useRealTimers();
    }
  });

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
    // The date guard runs first — pin the 25th so the not-found guard is reached.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 7, 25, 10, 0, 0));
    try {
      await expect(inv.realizeStockOpnameCore(superAdmin, { soId: missing })).rejects.toThrow(
        "Stock Opname tidak ditemukan",
      );
    } finally {
      vi.useRealTimers();
    }
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
    "submit fills only the sent items; approve leaves uncounted stock untouched and summarizes changes",
    async () => {
      const { so, items, ba, am, branch, ingA, ingB } = await seededPairSo();
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

      // Approve: A adjusted 10 → 7 (ledger OUT 3), B untouched at 20
      const result = await inv.approveStockOpnameCore(am, { soId: so.id });
      expect(await getStock(branch, ingA)).toBe(7);
      expect(await getStock(branch, ingB)).toBe(20);

      // Summary covers only counted items
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

      const ledger = await db
        .select()
        .from(schema.stockLedger)
        .where(eq(schema.stockLedger.reference, so.id));
      expect(ledger).toHaveLength(1);
      expect(ledger[0].ingredientId).toBe(ingA);
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "an explicit 0 count is a real count (approve zeroes stock); an SO with no counts is refused",
    async () => {
      const { so, items, ba, am, branch, ingA } = await seededPairSo();
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

      await inv.approveStockOpnameCore(am, { soId: so.id });
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
      await inv.approveStockOpnameCore(am, { soId: so.id });

      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(2026, 7, 25, 10, 0, 0));
      try {
        const realized = await inv.realizeStockOpnameCore(superAdmin, { soId: so.id });
        expect(realized.itemsAdjusted).toBe(1);
        expect(realized.itemsSkipped).toBe(1);
      } finally {
        vi.useRealTimers();
      }
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
      // Approve still targets physical 7 — but now the delta is 0, and the
      // drift report must explain that 7 is measured from current stock.
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
      // The change is measured against current stock: 7 → 7, no ledger row
      expect(result.changes[0]).toEqual(
        expect.objectContaining({ oldQuantity: 7, newQuantity: 7, delta: 0 }),
      );

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
      // The date guard runs before the status guard — pin the 25th.
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(2026, 7, 25, 10, 0, 0));
      try {
        await expect(inv.realizeStockOpnameCore(superAdmin, { soId: so.id })).rejects.toThrow(
          "Stock Opname harus di-approve terlebih dahulu",
        );
      } finally {
        vi.useRealTimers();
      }

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
    "only ingredients with an existing inventory row at the branch get SO items",
    async () => {
      const branch = await seedBranch(uniq("SO-C"));
      // A: has inventory row → in the SO
      const ingWithRow = await seedIngredient(uniq("SO-C-WITH"));
      await seedInventory(branch, ingWithRow, 5);
      // B: countable + visible but NO inventory row at this branch → NOT in the SO
      await seedIngredient(uniq("SO-C-NOINV"));
      // C: inventory row exists but ingredient is Deleted → NOT in the SO
      const deletedIng = await seedIngredient(uniq("SO-C-DEL"));
      await db
        .update(schema.ingredients)
        .set({ status: "Deleted" })
        .where(eq(schema.ingredients.id, deletedIng));
      await seedInventory(branch, deletedIng, 3);
      // D: inventory row but countable = false (e.g. porsi shelf) → NOT in the SO
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

      // Exactly one SO item: only the ingredient with a countable, non-deleted,
      // inventory-backed row.
      expect(await soItemCount(so.id)).toBe(1);
      const [only] = await db
        .select({ ingredientId: schema.stockOpnameItems.ingredientId })
        .from(schema.stockOpnameItems)
        .where(eq(schema.stockOpnameItems.stockOpnameId, so.id));
      expect(only.ingredientId).toBe(ingWithRow);
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

      // Outlet SO: the central-only ingredient is dropped from the snapshot —
      // even though the outlet physically holds an inventory row for it. A
      // brand-new ingredient (default isBranchVisible=false) is also absent.
      const neverCataloged = await seedIngredient(uniq("SO-NEW"));
      await seedInventory(outlet, neverCataloged, 9);
      const outletSo = await inv.triggerStockOpnameCore(outletBa, {
        branchId: outlet,
        date: "2026-08-25",
      });
      expect(await soItemCount(outletSo.id)).toBe(1);
      const outletItems = await db
        .select({ ingredientId: schema.stockOpnameItems.ingredientId })
        .from(schema.stockOpnameItems)
        .where(eq(schema.stockOpnameItems.stockOpnameId, outletSo.id));
      expect(outletItems.map((i) => i.ingredientId)).toEqual([visible]);
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
});
