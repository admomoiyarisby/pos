/* oxlint-disable anti-slop/no-console -- effects log progress; not assertions */
/**
 * Finance flows full-flow integration test.
 *
 * Drives the real user-parameterized cores from `finance.ts`
 * (`openPeriodCore`, `closePeriodCore`, `createManualRevenueCore`,
 * `createChannelRevenueCore`, `createManualExpenseCore`,
 * `deleteManualExpenseCore`, `upsertDailyOverrideCore`, `saveFixedCostsCore`)
 * against the local dockerized test Postgres. Each core re-mirrors its
 * wrapper's `requireRole` guard (super_admin, or super_admin | admin_pusat for
 * manual expenses; saveFixedCosts has no role guard), so wrong-role rejection
 * and the period close verification are exercised.
 *
 * Lifecycles:
 *  - Period: open (snapshots opening balances) → close (runs a 7-check audit,
 *    saves closing balances, notifies active users). Cannot open over an open
 *    period; cannot close an already-closed period.
 *  - Manual entries: manual revenue (+ brand breakdown), channel revenue,
 *    manual expense create/delete, daily-override upsert, fixed-costs save.
 *
 * Isolation: cores hit `#/lib/server/db` (mocked), tables TRUNCATE-d between
 * tests (period_logs / revenues / expenses cascade off branches / users).
 *
 * Run:
 *   TEST_DATABASE_URL=postgresql://omoiyari_test:omoiyari_test@localhost:5433/omoiyari_pos_test DATABASE_URL= vp test run src/lib/server/finance-flow.integration.test.ts
 */

import { beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { eq, and } from "drizzle-orm";
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
  getCurrentUserRaw: async () => null,
}));

setupFlowHarness(dbHolder);

let db: TestDb;
let financeApi: typeof import("./finance");
let seedCounter = 0;

function uniq(prefix: string): string {
  return `${prefix}-${seedCounter++}-${crypto.randomUUID().slice(0, 8)}`;
}

async function seedUser(role: UserRole): Promise<AppUser> {
  const id = crypto.randomUUID();
  await db.insert(schema.users).values({
    id,
    name: `ITS ${role}`,
    email: `its-${id}@finance.test`,
    role,
  });
  return { id, email: `its-${id}@finance.test`, name: `ITS ${role}`, role, status: "Active" };
}

async function seedBranch(): Promise<string> {
  const [row] = await db
    .insert(schema.branches)
    .values({ code: uniq("BR"), name: "Cabang", location: "Jakarta", type: "Outlet" })
    .returning({ id: schema.branches.id });
  return row.id;
}

async function seedIngredient(branchId: string): Promise<string> {
  const [row] = await db
    .insert(schema.ingredients)
    .values({
      code: uniq("ING"),
      name: "Bahan",
      category: "Fresh",
      skuType: "RM",
      purchaseUnit: "kg",
      stockUnit: "kg",
      conversionFactor: 1,
      averageCost: 1000,
    })
    .returning({ id: schema.ingredients.id });
  await db.insert(schema.inventory).values({ branchId, ingredientId: row.id, quantity: 50 });
  return row.id;
}

async function periodStatus(id: string): Promise<string | null> {
  const [row] = await db
    .select({ status: schema.periodLogs.status })
    .from(schema.periodLogs)
    .where(eq(schema.periodLogs.id, id))
    .limit(1);
  return row?.status ?? null;
}

async function openingBalanceCount(periodId: string): Promise<number> {
  const rows = await db
    .select({ id: schema.periodBalances.id })
    .from(schema.periodBalances)
    .where(
      and(
        eq(schema.periodBalances.periodLogId, periodId),
        eq(schema.periodBalances.balanceType, "opening"),
      ),
    );
  return rows.length;
}

beforeAll(async () => {
  if (!hasTestDatabaseUrl) return;
  // SAFETY: guarded by hasTestDatabaseUrl; when the test DB is absent beforeAll returns early and every test is skipped, so db is never read unset.
  db = dbHolder.db as TestDb;
  financeApi = await import("./finance");
});

describe("Finance — period lifecycle via the real server-function cores", () => {
  it.skipIf(!hasTestDatabaseUrl)(
    "open (snapshots opening balances) → close (runs the 7-check audit)",
    async () => {
      const superAdmin = await seedUser("super_admin");
      const branchId = await seedBranch();
      await seedIngredient(branchId); // creates one inventory row → one opening balance

      // 1. Open — writes an Open period + opening balance snapshot
      const period = await financeApi.openPeriodCore(superAdmin, {
        periodName: "Juli 2026",
      });
      expect(period.status).toBe("Open");
      expect(await periodStatus(period.id)).toBe("Open");
      expect(await openingBalanceCount(period.id)).toBe(1); // one inventory row

      // Cannot open a second period while one is open
      await expect(
        financeApi.openPeriodCore(superAdmin, { periodName: "Agustus 2026" }),
      ).rejects.toThrow("Tutup periode yang sedang aktif terlebih dahulu");

      // 2. Close — 7 checks pass (no SO/invoices/cancels/waste/transfers/SJ in a
      //    clean DB), closing balances saved, period marked Closed.
      const closed = await financeApi.closePeriodCore(superAdmin, { periodId: period.id });
      expect(closed.success).toBe(true);
      expect(closed.checks).toHaveLength(7);
      expect(closed.checks.every((c: { passed: boolean }) => c.passed)).toBe(true);
      expect(await periodStatus(period.id)).toBe("Closed");

      // Closing again refused
      await expect(financeApi.closePeriodCore(superAdmin, { periodId: period.id })).rejects.toThrow(
        "Periode sudah ditutup",
      );

      // Closing a missing period refused
      await expect(
        financeApi.closePeriodCore(superAdmin, { periodId: crypto.randomUUID() }),
      ).rejects.toThrow("Periode tidak ditemukan");
    },
  );

  it.skipIf(!hasTestDatabaseUrl)(
    "open-period snaps opening balances from current inventory",
    async () => {
      const superAdmin = await seedUser("super_admin");
      const branchId = await seedBranch();
      await seedIngredient(branchId);
      await seedIngredient(branchId); // two inventory rows total

      const period = await financeApi.openPeriodCore(superAdmin, { periodName: "Periode X" });
      expect(await openingBalanceCount(period.id)).toBe(2);
    },
  );
});

describe("Finance — manual entries via the real server-function cores", () => {
  it.skipIf(!hasTestDatabaseUrl)(
    "manual revenue (with brand breakdown), channel revenue, manual expense create/delete, daily override, fixed costs",
    async () => {
      const superAdmin = await seedUser("super_admin");
      const branchId = await seedBranch();
      const [brandRow] = await db
        .insert(schema.brands)
        .values({ code: uniq("BRAND"), name: "Partner", status: "Active" })
        .returning({ id: schema.brands.id });
      const brandId = brandRow.id;

      // Manual revenue + brand breakdown
      const revenue = await financeApi.createManualRevenueCore(superAdmin, {
        branchId,
        date: "2026-07-01",
        amount: 500000,
        notes: "tunai masuk",
        brandBreakdown: [{ brandId, amount: 300000 }],
      });
      expect(revenue.amount).toBe(500000);
      const brk = await db
        .select()
        .from(schema.manualRevenueBrandBreakdowns)
        .where(eq(schema.manualRevenueBrandBreakdowns.manualRevenueId, revenue.id));
      expect(brk).toHaveLength(1);
      expect(brk[0].amount).toBe(300000);

      // Channel revenue
      const ch = await financeApi.createChannelRevenueCore(superAdmin, {
        branchId,
        date: "2026-07-01",
        channel: "Gofood",
        amount: 250000,
        notes: "gofood",
      });
      expect(ch.channel).toBe("Gofood");
      expect(ch.amount).toBe(250000);

      // Manual expense create + delete
      const expense = await financeApi.createManualExpenseCore(superAdmin, {
        branchId,
        date: "2026-07-01",
        category: "Operasional",
        amount: 100000,
        notes: "listrik",
      });
      expect(expense.amount).toBe(100000);

      const del = await financeApi.deleteManualExpenseCore(superAdmin, { id: expense.id });
      expect(del.success).toBe(true);
      const gone = await db
        .select({ id: schema.operationalExpenses.id })
        .from(schema.operationalExpenses)
        .where(eq(schema.operationalExpenses.id, expense.id))
        .limit(1);
      expect(gone).toHaveLength(0);

      // Deleting a missing expense refused
      await expect(
        financeApi.deleteManualExpenseCore(superAdmin, { id: crypto.randomUUID() }),
      ).rejects.toThrow("Pengeluaran tidak ditemukan");

      // Daily override upsert (create then update)
      await financeApi.upsertDailyOverrideCore(superAdmin, {
        branchId,
        date: "2026-07-01",
        field: "omzet",
        value: 900000,
      });
      await financeApi.upsertDailyOverrideCore(superAdmin, {
        branchId,
        date: "2026-07-01",
        field: "omzet",
        value: 950000,
      });
      const [override] = await db
        .select()
        .from(schema.dailyOverrides)
        .where(
          and(
            eq(schema.dailyOverrides.branchId, branchId),
            eq(schema.dailyOverrides.date, "2026-07-01"),
          ),
        );
      expect(override.value).toBe(950000); // upserted, not duplicated

      // Fixed costs save (four categories; zero-value ones produce no rows)
      await financeApi.saveFixedCostsCore(superAdmin, {
        branchId,
        dateFrom: "2026-07-01",
        dateTo: "2026-07-31",
        gaji: 5_000_000,
        listrikAir: 0,
        wifi: 0,
        sewa: 1_000_000,
      });
      const fixed = await db
        .select({ category: schema.operationalExpenses.category })
        .from(schema.operationalExpenses)
        .where(eq(schema.operationalExpenses.branchId, branchId));
      const cats = fixed.map((f) => f.category);
      expect(cats).toContain("Gaji");
      expect(cats).toContain("Sewa");
      expect(cats).not.toContain("ListrikAir");
    },
  );
});

describe("Finance — wrong-role negatives", () => {
  it.skipIf(!hasTestDatabaseUrl)(
    "period + revenue mutations require super_admin; expenses allow admin_pusat",
    async () => {
      const adminPusat = await seedUser("admin_pusat");
      const branchAdmin = await seedUser("branch_admin");
      const branchId = await seedBranch();

      for (const wrong of [branchAdmin, adminPusat]) {
        await expect(financeApi.openPeriodCore(wrong, { periodName: "P" })).rejects.toThrow(
          "Forbidden: insufficient role",
        );
        await expect(
          financeApi.createManualRevenueCore(wrong, {
            branchId,
            date: "2026-07-01",
            amount: 1000,
          }),
        ).rejects.toThrow("Forbidden: insufficient role");
        await expect(
          financeApi.createChannelRevenueCore(wrong, {
            branchId,
            date: "2026-07-01",
            channel: "Dine-in",
            amount: 1000,
          }),
        ).rejects.toThrow("Forbidden: insufficient role");
        await expect(
          financeApi.upsertDailyOverrideCore(wrong, {
            branchId,
            date: "2026-07-01",
            field: "omzet",
            value: 1,
          }),
        ).rejects.toThrow("Forbidden: insufficient role");
      }

      // Manual expenses allow admin_pusat too
      const expense = await financeApi.createManualExpenseCore(adminPusat, {
        branchId,
        date: "2026-07-01",
        category: "Gaji",
        amount: 1000,
      });
      expect(expense.amount).toBe(1000);

      // branch_admin refused for expenses
      await expect(
        financeApi.createManualExpenseCore(branchAdmin, {
          branchId,
          date: "2026-07-01",
          category: "Gaji",
          amount: 1000,
        }),
      ).rejects.toThrow("Forbidden: insufficient role");

      // saveFixedCosts has no role guard (any authenticated user)
      const ok = await financeApi.saveFixedCostsCore(branchAdmin, {
        branchId,
        dateFrom: "2026-07-01",
        dateTo: "2026-07-31",
        gaji: 0,
        listrikAir: 0,
        wifi: 0,
        sewa: 0,
      });
      expect(ok.success).toBe(true);

      // No period leaked from rejected opens
      expect(await db.select().from(schema.periodLogs)).toHaveLength(0);
    },
  );
});
