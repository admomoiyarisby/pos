/**
 * Kartu Stok pagination determinism — the ORDER BY / LIMIT-OFFSET contract.
 *
 * `getStockLedgerCore` pages with OFFSET over `ORDER BY created_at DESC, id`.
 * `created_at` is `defaultNow()` — a *transaction* timestamp — so every row
 * written in one transaction (POS order lines, stock-opname adjustments,
 * yield, waste BOM) shares it, and Postgres orders such ties arbitrarily.
 * The `id` tiebreaker is what keeps those pages deterministic; without it a
 * row could land on two pages or be skipped entirely — the client report:
 * "the item I saw on page 5 also appears on page 1".
 *
 * Pinned contracts:
 *  - pages over a fully tied created_at are disjoint and complete,
 *  - repeated reads of a page are byte-identical,
 *  - a new row joining the tied block never reshuffles the rows already seen.
 *
 * Drives the ADR 0015 core seam (`getStockLedgerCore`) — a vitest process has
 * no Start request context, so `requireAuth()` can't run here — against the
 * local dockerized test Postgres.
 *
 * Run:
 *   TEST_DATABASE_URL=postgresql://omoiyari_test:omoiyari_test@localhost:5433/omoiyari_pos_test DATABASE_URL= vp test run src/lib/server/stock-ledger-pagination.integration.test.ts
 */

import { describe, expect, it, vi } from "vite-plus/test";
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

const PAGE_SIZE = 15;

/** Read-side actor: a global auditor (no branch scoping applies). */
const auditor: AppUser = {
  id: crypto.randomUUID(),
  email: "auditor@test.local",
  name: "Ledger Auditor",
  role: "super_admin",
  status: "Active",
};

function testDb(): TestDb {
  if (!dbHolder.db) throw new Error("db holder not initialized — beforeAll must run first");
  return dbHolder.db;
}

/** Branch + ingredient + `count` ledger rows that ALL share one `created_at`
 *  — the tie a single-transaction write produces in production. */
async function seedTiedLedger(count: number, tiedAt: Date): Promise<void> {
  const db = testDb();
  const branchId = crypto.randomUUID();
  await db.insert(schema.branches).values({
    id: branchId,
    code: "TIE",
    name: "Tie Branch",
    location: "Test",
    type: "Outlet",
  });
  const ingredientId = crypto.randomUUID();
  await db.insert(schema.ingredients).values({
    id: ingredientId,
    code: "TIE-001",
    name: "Tied Ingredient",
    category: "Fresh",
    skuType: "RM",
    purchaseUnit: "pcs",
    stockUnit: "pcs",
    conversionFactor: 1,
    averageCost: 1000,
  });
  await db.insert(schema.stockLedger).values(
    Array.from({ length: count }, (_, i) => {
      // Annotated so the literal type doesn't widen to `string` (no cast needed).
      const type: "IN" | "OUT" = i % 2 === 0 ? "IN" : "OUT";
      return {
        branchId,
        ingredientId,
        type,
        quantity: i + 1,
        balance: 1000 - i,
        reference: `TIE-${i}`,
        notes: "all rows share one created_at",
        createdAt: tiedAt,
      };
    }),
  );
}

/** Insert one more row into the same tied `created_at` block. */
async function insertTiedRow(tiedAt: Date, reference: string): Promise<string> {
  const db = testDb();
  const [anchor] = await db
    .select({
      branchId: schema.stockLedger.branchId,
      ingredientId: schema.stockLedger.ingredientId,
    })
    .from(schema.stockLedger)
    .limit(1);
  const [row] = await db
    .insert(schema.stockLedger)
    .values({
      branchId: anchor.branchId,
      ingredientId: anchor.ingredientId,
      type: "IN",
      quantity: 99,
      balance: 555,
      reference,
      notes: "joins the tied block",
      createdAt: tiedAt,
    })
    .returning({ id: schema.stockLedger.id });
  return row.id;
}

describe.skipIf(!hasTestDatabaseUrl)(
  "Kartu Stok pagination — ORDER BY determinism under tied created_at",
  () => {
    it("pages are disjoint and complete when every row shares one created_at", async () => {
      const tiedAt = new Date("2026-03-10T10:00:00.000Z");
      await seedTiedLedger(40, tiedAt);

      const page = (n: number, extra: { sortBy?: string; sortDir?: string } = {}) =>
        getStockLedgerCore(auditor, { page: n, limit: PAGE_SIZE, ...extra });

      const p0 = await page(0);
      const p1 = await page(1);
      const p2 = await page(2);

      expect(p0.data).toHaveLength(PAGE_SIZE);
      expect(p1.data).toHaveLength(PAGE_SIZE);
      expect(p2.data).toHaveLength(10);
      expect([p0.total, p1.total, p2.total]).toEqual([40, 40, 40]);

      const seen = [...p0.data, ...p1.data, ...p2.data].map((r) => r.id);
      expect(seen).toHaveLength(40);
      // No row rendered on two pages; no row skipped between them.
      expect(new Set(seen).size).toBe(40);
      expect(new Set(seen)).toEqual(
        new Set(
          (await testDb().select({ id: schema.stockLedger.id }).from(schema.stockLedger)).map(
            (r) => r.id,
          ),
        ),
      );

      // Re-reading the same page is byte-identical.
      const p0again = await page(0);
      expect(p0again.data.map((r) => r.id)).toEqual(p0.data.map((r) => r.id));

      // The type-grouped sort carries the same tiebreaker contract.
      const t0 = await page(0, { sortBy: "type", sortDir: "desc" });
      const t1 = await page(1, { sortBy: "type", sortDir: "desc" });
      const t2 = await page(2, { sortBy: "type", sortDir: "desc" });
      const typeSeen = [...t0.data, ...t1.data, ...t2.data].map((r) => r.id);
      expect(typeSeen).toHaveLength(40);
      expect(new Set(typeSeen).size).toBe(40);

      // A new row joining the tied block must not reshuffle the rows already
      // seen — the client-facing symptom was a row drifting between pages.
      const insertedId = await insertTiedRow(tiedAt, "TIE-late");
      const after = [await page(0), await page(1), await page(2)];
      const afterIds = after
        .flatMap((p) => p.data.map((r) => r.id))
        .filter((id) => id !== insertedId);
      expect(afterIds).toEqual(seen);
      expect(after[0].total).toBe(41);
    });
  },
);

// =============================================================================
// Time-of-day filter (Kartu Stok `timeFrom` / `timeTo`)
// =============================================================================

describe.skipIf(!hasTestDatabaseUrl)(
  "Kartu Stok time-of-day filter — WIB window over an overnight range",
  () => {
    /**
     * One ingredient's movements spread across two WIB days, with a deliberate
     * ~12h no-activity gap between them — the shape a closed outlet leaves, and
     * the shape that made the Royal Plaza rice variance impossible to read from
     * a date-only filter (2026-10-04/05).
     *
     * `stock_ledger.created_at` is a NAIVE column storing UTC wall-clock, so the
     * UTC instants below are what the server converts to WIB before comparing.
     */
    async function seedOvernightLedger(): Promise<{
      branchId: string;
      ingredientId: string;
      /** WIB "HH:MM" of each seeded row, in insertion order. */
      wibTimes: string[];
    }> {
      const db = testDb();
      const branchId = crypto.randomUUID();
      await db.insert(schema.branches).values({
        id: branchId,
        code: "TWM",
        name: "Time Window Branch",
        location: "Test",
        type: "Outlet",
      });
      const ingredientId = crypto.randomUUID();
      await db.insert(schema.ingredients).values({
        id: ingredientId,
        code: "TWM-001",
        name: "Nasi Putih",
        category: "Fresh",
        skuType: "FG",
        purchaseUnit: "gr",
        stockUnit: "gr",
        conversionFactor: 1,
        averageCost: 1000,
      });

      // 2026-10-04 13:00WIB = 06:00Z … 2026-10-05 12:00WIB = 05:00Z, with the
      // 22:00WIB→10:00WIB stretch deliberately empty.
      const utcInstants = [
        "2026-10-04T06:00:00.000Z", // 13:00 WIB day 1
        "2026-10-04T12:00:00.000Z", // 19:00 WIB day 1
        "2026-10-04T15:10:00.000Z", // 22:10 WIB day 1  (last movement)
        "2026-10-05T03:44:00.000Z", // 10:44 WIB day 2  (first movement after the gap)
        "2026-10-05T05:35:00.000Z", // 12:35 WIB day 2
      ];
      const wibTimes = ["13:00", "19:00", "22:10", "10:44", "12:35"];

      await db.insert(schema.stockLedger).values(
        utcInstants.map((iso, i) => ({
          branchId,
          ingredientId,
          type: "OUT" as const,
          quantity: 180,
          balance: 1000 - i * 180,
          reference: `TWM-${i}`,
          notes: "overnight spread",
          createdAt: new Date(iso),
        })),
      );
      return { branchId, ingredientId, wibTimes };
    }

    it("narrows to a WIB window on each day of the range", async () => {
      const { branchId, ingredientId } = await seedOvernightLedger();

      // A time window is a *clock* filter applied per day, not a 24h-spanning
      // range: 19:00-23:59 on the 4th keeps the two evening rows, and the
      // overnight gap means the 5th contributes nothing inside that clock band.
      const evening = await getStockLedgerCore(auditor, {
        branchId,
        ingredientId,
        dateFrom: "2026-10-04",
        dateTo: "2026-10-05",
        timeFrom: "19:00",
        timeTo: "23:59",
        page: 0,
        limit: 50,
      });
      expect(evening.total).toBe(2);
      expect(evening.data.map((r) => r.reference).sort()).toEqual(["TWM-1", "TWM-2"]);

      // And the morning band on the 5th keeps the two rows after the gap.
      const morning = await getStockLedgerCore(auditor, {
        branchId,
        ingredientId,
        dateFrom: "2026-10-04",
        dateTo: "2026-10-05",
        timeFrom: "00:00",
        timeTo: "12:35",
        page: 0,
        limit: 50,
      });
      expect(morning.total).toBe(2);
      expect(morning.data.map((r) => r.reference).sort()).toEqual(["TWM-3", "TWM-4"]);
    });

    it("excludes rows outside the window while keeping the date range", async () => {
      const { branchId, ingredientId } = await seedOvernightLedger();

      // Two rows sit in this band — 13:00 on the 4th and 12:35 on the 5th — and the
      // other three must drop out. A clock band is per-day, so it can legitimately
      // match on both dates in the range; that is why this is pinned as a set
      // rather than a single row.
      const res = await getStockLedgerCore(auditor, {
        branchId,
        ingredientId,
        dateFrom: "2026-10-04",
        dateTo: "2026-10-05",
        timeFrom: "12:00",
        timeTo: "14:00",
        page: 0,
        limit: 50,
      });
      expect(res.total).toBe(2);
      expect(res.data.map((r) => r.reference).sort()).toEqual(["TWM-0", "TWM-4"]);
    });

    it("ignores a clock time that has no matching date bound", async () => {
      const { branchId, ingredientId } = await seedOvernightLedger();

      // A bare `timeFrom` would otherwise match 13:00 on *every* date in scope.
      // With no date bound the server must ignore it and return everything.
      const res = await getStockLedgerCore(auditor, {
        branchId,
        ingredientId,
        timeFrom: "13:00",
        page: 0,
        limit: 50,
      });
      expect(res.total).toBe(5);

      // Same for the upper bound alone.
      const res2 = await getStockLedgerCore(auditor, {
        branchId,
        ingredientId,
        timeTo: "12:35",
        page: 0,
        limit: 50,
      });
      expect(res2.total).toBe(5);
    });

    it("still honours the date bounds when no clock time is given", async () => {
      const { branchId, ingredientId } = await seedOvernightLedger();

      const res = await getStockLedgerCore(auditor, {
        branchId,
        ingredientId,
        dateFrom: "2026-10-04",
        dateTo: "2026-10-04",
        page: 0,
        limit: 50,
      });
      expect(res.total).toBe(3);
    });
  },
);
