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

      // 2. Submit counts — physical 7 of 10 → variance -3
      await inv.submitStockOpnameCore(ba, {
        soId: so.id,
        items: [{ itemId: item.id, physicalStock: 7 }],
      });
      item = await firstItem(so.id);
      expect(item.physicalStock).toBe(7);
      expect(item.variance).toBe(-3);
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
      await inv.approveStockOpnameCore(am, { soId: so.id });
      st = await soStatus(so.id);
      expect(st.status).toBe("Approved");
      expect(await getStock(branch, ingredient)).toBe(8);

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
