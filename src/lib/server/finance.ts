import { createServerFn } from "@tanstack/react-start";
import { db } from "#/lib/server/db";
import {
  manualRevenues,
  manualRevenueBrandBreakdowns,
  channelRevenues,
  operationalExpenses,
  orders,
  orderItems,
  recipes,
  ingredients,
  periodLogs,
  periodBalances,
  stockOpnames,
  scmInvoices,
  cancelRequests,
  inventory,
  systemNotifications,
  users,
  branches,
  wasteEntries,
  stockTransfers,
  deliveryNotes,
  dailyOverrides,
  shifts,
  shiftEdits,
  ORDER_CHANNEL_VALUES,
} from "#/db/schema";
import { eq, and, gte, lte, sql, desc, isNotNull, isNull, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, requireRole } from "./auth";
import type { AppUser } from "./auth";
import { resolvePersistedItemIngredients } from "./ingredient-resolver";
import { logSystemAction, logAudit } from "./logging";
import { escapeHtml, formatRupiah } from "./html-utils";

/**
 * Validate a `dateFrom`/`dateTo` pair of Jakarta-local ("YYYY-MM-DD") dates and
 * cap the inclusive range length.
 *
 * Both bounds must be strict `YYYY-MM-DD` calendar dates (no time component) —
 * anything else is a client bug or tampering. The day count is done with
 * Date.UTC on the parsed calendar components, so it is timezone-independent:
 * `new Date("YYYY-MM-DD")` would instead parse as UTC midnight and make the
 * diff depend on nothing but luck (and DST-free UTC still miscounts nothing
 * here, but a locale-shifted parse would). Rejected as errors:
 * malformed dates, dateTo < dateFrom, and ranges over `maxDays` inclusive days.
 *
 * Returns the validated bounds so handlers use exactly what was checked.
 */
interface ValidatedDateRange {
  dateFrom: string;
  dateTo: string;
}
function validateDateRange(dateFrom: string, dateTo: string, maxDays: number): ValidatedDateRange {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateOnly.test(dateFrom) || !dateOnly.test(dateTo)) {
    throw new Error("Format tanggal tidak valid (harus YYYY-MM-DD)");
  }
  const [fy, fm, fd] = dateFrom.split("-").map(Number);
  const [ty, tm, td] = dateTo.split("-").map(Number);
  // Calendar validity (rejects e.g. 2026-02-30) — roundtrip through Date.UTC.
  const fromUtc = Date.UTC(fy, fm - 1, fd);
  const toUtc = Date.UTC(ty, tm - 1, td);
  if (new Date(fromUtc).toISOString().slice(0, 10) !== dateFrom) {
    throw new Error("Tanggal awal tidak valid");
  }
  if (new Date(toUtc).toISOString().slice(0, 10) !== dateTo) {
    throw new Error("Tanggal akhir tidak valid");
  }
  if (toUtc < fromUtc) {
    throw new Error("Tanggal akhir tidak boleh sebelum tanggal awal");
  }
  const daysDiff = (toUtc - fromUtc) / (1000 * 60 * 60 * 24);
  if (daysDiff > maxDays) {
    throw new Error(`Maksimal rentang waktu ${maxDays} hari`);
  }
  return { dateFrom, dateTo };
}

/**
 * Period-level P&L summary (ADR 0017 canonical definitions).
 *
 * All order aggregates exclude Void (and soft-deleted) orders. Omzet is NET:
 * Σ orders.netSales (after merchant discount + MDR) + manual revenue flagged
 * includeInPnl. Gross Profit = omzet − HPP; Operating Profit = Gross − opex
 * (all operationalExpenses, waste-derived included).
 */
export interface FinanceSummary {
  /** Σ orders.totalAmount, non-void — the gross figure before discounts. */
  totalSales: number;
  totalMerchantDiscount: number;
  totalCogs: number;
  totalMdr: number;
  /** Σ orders.netSales, non-void — order component of omzet. */
  netSales: number;
  /** Σ manual/channel revenue where includeInPnl (ADR 0017). */
  manualRevenue: number;
  /** Σ manual/channel revenue flagged memo-only (excluded from omzet). */
  manualRevenueMemo: number;
  orderCount: number;
  voidCount: number;
  voidAmount: number;
  manualExpenses: number;
  /** Omzet − HPP. Opex never touches this (ADR 0017 #4). */
  grossProfit: number;
  /** Gross Profit − opex. */
  operatingProfit: number;
}

export const getFinanceSummary = createServerFn({ method: "GET" })
  .validator((data: { branchId?: string; dateFrom?: string; dateTo?: string }) => data)
  .handler(async ({ data }): Promise<FinanceSummary> => {
    await requireRole("super_admin", "admin_pusat");

    const conditions = [];
    if (data.branchId) conditions.push(eq(orders.branchId, data.branchId));
    if (data.dateFrom)
      conditions.push(
        sql`DATE((${orders.createdAt} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta') >= ${data.dateFrom}`,
      );
    if (data.dateTo)
      conditions.push(
        sql`DATE((${orders.createdAt} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta') <= ${data.dateTo}`,
      );

    // ADR 0017: Void orders are excluded from every aggregate; voids are
    // reported separately so the gap vs the POS journal stays explainable.
    const orderConditions = [...conditions, ne(orders.status, "Void"), isNull(orders.deletedAt)];
    const orderData = await db
      .select({
        totalSales: sql<number>`COALESCE(SUM(${orders.totalAmount}), 0)`,
        totalMerchantDiscount: sql<number>`COALESCE(SUM(${orders.merchantDiscount}), 0)`,
        totalCogs: sql<number>`COALESCE(SUM(${orders.totalCogs}), 0)`,
        totalMdr: sql<number>`COALESCE(SUM(${orders.mdrFee}), 0)`,
        netSales: sql<number>`COALESCE(SUM(${orders.netSales}), 0)`,
        count: sql<number>`COUNT(*)`,
      })
      .from(orders)
      .where(and(...orderConditions));

    const voidData = await db
      .select({
        count: sql<number>`COUNT(*)`,
        amount: sql<number>`COALESCE(SUM(${orders.totalAmount}), 0)`,
      })
      .from(orders)
      .where(and(...conditions, eq(orders.status, "Void"), isNull(orders.deletedAt)));

    // Manual revenue split by intent (ADR 0017): includeInPnl rows are
    // incremental sales (enter omzet); the rest are memo-only.
    const manualRev = await db
      .select({
        pnl: sql<number>`COALESCE(SUM(CASE WHEN ${manualRevenues.includeInPnl} THEN ${manualRevenues.amount} ELSE 0 END), 0)`,
        memo: sql<number>`COALESCE(SUM(CASE WHEN ${manualRevenues.includeInPnl} THEN 0 ELSE ${manualRevenues.amount} END), 0)`,
      })
      .from(manualRevenues)
      .where(
        and(
          data.branchId ? eq(manualRevenues.branchId, data.branchId) : undefined,
          data.dateFrom ? gte(manualRevenues.date, data.dateFrom) : undefined,
          data.dateTo ? lte(manualRevenues.date, data.dateTo) : undefined,
        ),
      );

    const channelRev = await db
      .select({
        pnl: sql<number>`COALESCE(SUM(CASE WHEN ${channelRevenues.includeInPnl} THEN ${channelRevenues.amount} ELSE 0 END), 0)`,
        memo: sql<number>`COALESCE(SUM(CASE WHEN ${channelRevenues.includeInPnl} THEN 0 ELSE ${channelRevenues.amount} END), 0)`,
      })
      .from(channelRevenues)
      .where(
        and(
          data.branchId ? eq(channelRevenues.branchId, data.branchId) : undefined,
          data.dateFrom ? gte(channelRevenues.date, data.dateFrom) : undefined,
          data.dateTo ? lte(channelRevenues.date, data.dateTo) : undefined,
        ),
      );

    const manualExp = await db
      .select({
        total: sql<number>`COALESCE(SUM(${operationalExpenses.amount}), 0)`,
      })
      .from(operationalExpenses)
      .where(
        and(
          data.branchId ? eq(operationalExpenses.branchId, data.branchId) : undefined,
          data.dateFrom ? gte(operationalExpenses.date, data.dateFrom) : undefined,
          data.dateTo ? lte(operationalExpenses.date, data.dateTo) : undefined,
        ),
      );

    const toNum = (v: string | number | null | undefined): number => Number(v ?? 0);
    const totalSales = toNum(orderData[0]?.totalSales);
    const totalMerchantDiscount = toNum(orderData[0]?.totalMerchantDiscount);
    const totalCogs = toNum(orderData[0]?.totalCogs);
    const totalMdr = toNum(orderData[0]?.totalMdr);
    const netSales = toNum(orderData[0]?.netSales);
    const manualRevenuePnl = toNum(manualRev[0]?.pnl) + toNum(channelRev[0]?.pnl);
    const manualRevenueMemo = toNum(manualRev[0]?.memo) + toNum(channelRev[0]?.memo);
    const manualExpensesTotal = toNum(manualExp[0]?.total);
    // ADR 0017: omzet = net order sales + includeInPnl manual revenue.
    const omzet = netSales + manualRevenuePnl;
    const grossProfit = omzet - totalCogs;
    return {
      totalSales,
      totalMerchantDiscount,
      totalCogs,
      totalMdr,
      netSales,
      manualRevenue: manualRevenuePnl,
      manualRevenueMemo,
      orderCount: toNum(orderData[0]?.count),
      voidCount: toNum(voidData[0]?.count),
      voidAmount: toNum(voidData[0]?.amount),
      manualExpenses: manualExpensesTotal,
      grossProfit,
      operatingProfit: grossProfit - manualExpensesTotal,
    };
  });

export interface DailyFinanceRow {
  tanggal: string;
  hpp: number;
  /** Net omzet (ADR 0017): orders.netSales + includeInPnl manual revenue, or override. */
  omzet: number;
  /** Order-derived net component before any override (for the breakdown). */
  computedOmzet: number;
  grossProfit: number;
  margin: number;
  hasOmzetOverride: boolean;
}

export interface HppBreakdownRow {
  ingredientId: string;
  name: string;
  category: string;
  quantity: number;
  cost: number;
}

// Per-day HPP breakdown, reconciled with the ledger's HPP column.
//
// The ledger's HPP column reads orders.totalCogs — the COGS recorded at sale
// time (BOGO doubling, add-on modifiers, exclusions, and ingredient costs as
// of the transaction). Recomputing from the current BOM (the previous
// implementation) ignores all of that, so the parts never summed to the
// column. Instead, each order item's persisted composition is re-resolved the
// same way the POS resolved it at sale time, and the resulting ingredient
// costs are scaled so they sum exactly to the item's recorded COGS
// (cogsAtTransaction × quantity). The breakdown therefore always adds up to
// the HPP column, up to rounding (spread over the largest-cost ingredient).

export const getDailyFinanceSummary = createServerFn({ method: "GET" })
  .validator(
    (data: { branchId?: string; dateFrom?: string; dateTo?: string; channel?: string }) => ({
      ...data,
      channel: z.enum(ORDER_CHANNEL_VALUES).optional().catch(undefined).parse(data.channel),
    }),
  )
  .handler(async ({ data }): Promise<DailyFinanceRow[]> => {
    await requireRole("super_admin", "admin_pusat");

    const conditions = [];
    if (data.branchId) conditions.push(eq(orders.branchId, data.branchId));
    if (data.dateFrom)
      conditions.push(
        sql`DATE((${orders.createdAt} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta') >= ${data.dateFrom}`,
      );
    if (data.dateTo)
      conditions.push(
        sql`DATE((${orders.createdAt} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta') <= ${data.dateTo}`,
      );
    if (data.channel) conditions.push(eq(orders.channel, data.channel));

    // ADR 0017: Void and soft-deleted orders never enter the ledger.
    const orderConditions = [...conditions, ne(orders.status, "Void"), isNull(orders.deletedAt)];

    const result = await db
      .select({
        tanggal: sql<string>`DATE((${orders.createdAt} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta')`,
        hpp: sql<number>`COALESCE(SUM(${orders.totalCogs}), 0)`,
        omzet: sql<number>`COALESCE(SUM(${orders.netSales}), 0)`,
      })
      .from(orders)
      .where(and(...orderConditions))
      .groupBy(sql`DATE((${orders.createdAt} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta')`)
      .orderBy(sql`DATE((${orders.createdAt} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta')`);

    // Manual revenue per day, split by intent (ADR 0017). Channel filter
    // applies to channel revenues only; no-channel manual revenue is
    // excluded when a specific channel is selected.
    const manualRevConditions = [
      data.dateFrom ? gte(manualRevenues.date, data.dateFrom) : undefined,
      data.dateTo ? lte(manualRevenues.date, data.dateTo) : undefined,
      data.branchId ? eq(manualRevenues.branchId, data.branchId) : undefined,
    ];
    const manualRevRows = await db
      .select({
        date: manualRevenues.date,
        pnl: sql<number>`COALESCE(SUM(CASE WHEN ${manualRevenues.includeInPnl} THEN ${manualRevenues.amount} ELSE 0 END), 0)`,
      })
      .from(manualRevenues)
      .where(and(...manualRevConditions))
      .groupBy(manualRevenues.date);

    const channelRevConditions = [
      data.dateFrom ? gte(channelRevenues.date, data.dateFrom) : undefined,
      data.dateTo ? lte(channelRevenues.date, data.dateTo) : undefined,
      data.branchId ? eq(channelRevenues.branchId, data.branchId) : undefined,
      data.channel ? eq(channelRevenues.channel, data.channel) : undefined,
    ];
    const channelRevRows = await db
      .select({
        date: channelRevenues.date,
        pnl: sql<number>`COALESCE(SUM(CASE WHEN ${channelRevenues.includeInPnl} THEN ${channelRevenues.amount} ELSE 0 END), 0)`,
      })
      .from(channelRevenues)
      .where(and(...channelRevConditions))
      .groupBy(channelRevenues.date);

    const manualPnlByDate = new Map<string, number>();
    for (const r of manualRevRows) {
      manualPnlByDate.set(r.date, (manualPnlByDate.get(r.date) ?? 0) + Number(r.pnl));
    }
    for (const r of channelRevRows) {
      manualPnlByDate.set(r.date, (manualPnlByDate.get(r.date) ?? 0) + Number(r.pnl));
    }

    // Fetch overrides for this branch/date range
    const overrideConditions = [];
    if (data.branchId) overrideConditions.push(eq(dailyOverrides.branchId, data.branchId));
    if (data.dateFrom) overrideConditions.push(gte(dailyOverrides.date, data.dateFrom));
    if (data.dateTo) overrideConditions.push(lte(dailyOverrides.date, data.dateTo));

    const overrides = await db
      .select()
      .from(dailyOverrides)
      .where(overrideConditions.length > 0 ? and(...overrideConditions) : undefined);

    // Build override map: date -> { field -> value }
    const overrideMap = new Map<string, Record<string, number>>();
    for (const o of overrides) {
      if (!overrideMap.has(o.date)) overrideMap.set(o.date, {});
      overrideMap.get(o.date)![o.field] = o.value;
    }

    // Days with manual revenue but no orders must still appear in the ledger.
    const ordersByDate = new Map<string, { hpp: number; omzet: number }>();
    for (const r of result) {
      ordersByDate.set(r.tanggal, { hpp: Number(r.hpp), omzet: Number(r.omzet) });
    }
    const dates = new Set<string>([...ordersByDate.keys(), ...manualPnlByDate.keys()]);

    return [...dates].sort().map((tanggal) => {
      const dayOverrides = overrideMap.get(tanggal) ?? {};
      const orderRow = ordersByDate.get(tanggal);
      const computedOmzet = (orderRow?.omzet ?? 0) + (manualPnlByDate.get(tanggal) ?? 0);
      const omzet = dayOverrides.omzet ?? computedOmzet;
      const hpp = orderRow?.hpp ?? 0;
      const grossProfit = omzet - hpp;
      const margin = omzet > 0 ? grossProfit / omzet : 0;
      return {
        tanggal,
        hpp,
        omzet,
        computedOmzet,
        grossProfit,
        margin,
        hasOmzetOverride: dayOverrides.omzet !== undefined,
      };
    });
  });

export interface ShiftCashVarianceRow {
  /** Shift close date (Asia/Jakarta). */
  tanggal: string;
  branchId: string;
  branchName: string | null;
  shiftId: string;
  /** Opening cash float (initial "Uang Kas"). */
  cashFloat: number;
  /** Sum of non-void Cash-method order totals recorded during the shift. */
  cashSales: number;
  /** Net mid-shift float adjustments (adds positive, drops negative). */
  cashAdjustments: number;
  /** cashFloat + cashSales + cashAdjustments — matches shifts.expectedCash. */
  expectedCash: number;
  actualCash: number;
  variance: number;
  /** NULL until the shift is closed with expectedCash computed. */
  closedAt: Date | null;
}

// Per-shift cash reconciliation: variance between the physical cash the
// kasir counted at close and the expected drawer total (float + cash sales).
// Only closed shifts with an expectedCash value appear — shifts closed before
// the reconciliation feature shipped have expectedCash NULL and are excluded.
export const getShiftCashVariance = createServerFn({ method: "GET" })
  .validator((data: { branchId?: string; dateFrom?: string; dateTo?: string }) => data)
  .handler(async ({ data }): Promise<ShiftCashVarianceRow[]> => {
    // Mirrors the finance page's RoleGuard (super_admin + admin_pusat) — a
    // narrower guard here surfaces as a mysterious empty state in the UI.
    await requireRole("super_admin", "admin_pusat");

    const conditions = [
      eq(shifts.status, "Closed"),
      isNotNull(shifts.expectedCash),
      isNotNull(shifts.actualCash),
      isNotNull(shifts.endTime),
    ];
    if (data.branchId) conditions.push(eq(shifts.branchId, data.branchId));
    if (data.dateFrom)
      conditions.push(
        sql`DATE((${shifts.endTime} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta') >= ${data.dateFrom}`,
      );
    if (data.dateTo)
      conditions.push(
        sql`DATE((${shifts.endTime} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta') <= ${data.dateTo}`,
      );

    const rows = await db
      .select({
        tanggal: sql<string>`DATE((${shifts.endTime} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta')`,
        branchId: shifts.branchId,
        branchName: branches.name,
        shiftId: shifts.id,
        cashFloat: shifts.cashFloat,
        expectedCash: shifts.expectedCash,
        actualCash: shifts.actualCash,
        closedAt: shifts.endTime,
      })
      .from(shifts)
      .innerJoin(branches, eq(branches.id, shifts.branchId))
      .where(and(...conditions))
      .orderBy(desc(shifts.endTime));

    // Per-shift cash order totals — one aggregate query for the whole set,
    // mapped back by shiftId (avoids a correlated subquery per row).
    const shiftIds = rows.map((r) => r.shiftId);
    const salesRows =
      shiftIds.length > 0
        ? await db
            .select({
              shiftId: orders.shiftId,
              total: sql<number>`COALESCE(SUM(${orders.totalAmount}), 0)`,
            })
            .from(orders)
            .where(
              and(
                inArray(orders.shiftId, shiftIds),
                eq(orders.paymentMethod, "Cash"),
                ne(orders.status, "Void"),
              ),
            )
            .groupBy(orders.shiftId)
        : [];
    const salesByShift = new Map(salesRows.map((s) => [s.shiftId, Number(s.total)]));

    // Net mid-shift adjustments per shift from the shiftEdits audit rows
    // (new − old, summed: adds positive, drops negative).
    const editRows =
      shiftIds.length > 0
        ? await db
            .select({
              shiftId: shiftEdits.shiftId,
              oldValue: shiftEdits.oldValue,
              newValue: shiftEdits.newValue,
            })
            .from(shiftEdits)
            .where(
              and(inArray(shiftEdits.shiftId, shiftIds), eq(shiftEdits.fieldName, "cashFloat")),
            )
        : [];
    const adjustmentsByShift = new Map<string, number>();
    for (const e of editRows) {
      const delta = Number(e.newValue) - Number(e.oldValue ?? "0");
      adjustmentsByShift.set(e.shiftId, (adjustmentsByShift.get(e.shiftId) ?? 0) + delta);
    }

    return rows.map((r) => {
      const cashSales = salesByShift.get(r.shiftId) ?? 0;
      const cashAdjustments = adjustmentsByShift.get(r.shiftId) ?? 0;
      return {
        tanggal: r.tanggal,
        branchId: r.branchId,
        branchName: r.branchName,
        shiftId: r.shiftId,
        cashFloat: r.cashFloat,
        cashSales,
        cashAdjustments,
        expectedCash: r.expectedCash!,
        actualCash: r.actualCash!,
        variance: r.actualCash! - r.expectedCash!,
        closedAt: r.closedAt,
      };
    });
  });

export interface ShiftCashTransactionRow {
  /** "order" = cash sale (in), "float_adjust" = mid-shift add/drop (±). */
  type: "order" | "float_adjust";
  amount: number;
  /** Direction relative to the drawer: in (sale/setor masuk) or out. */
  direction: "in" | "out";
  /** Order code or adjustment reason. */
  label: string | null;
  occurredAt: Date;
}

// Detailed cash movements within one shift: each non-void Cash order and each
// mid-shift float adjustment (from the shiftEdits audit rows). Used by the
// finance reconciliation detail view.
export const getShiftCashTransactions = createServerFn({ method: "GET" })
  .validator((data: { shiftId: string }) => data)
  .handler(async ({ data }): Promise<ShiftCashTransactionRow[]> => {
    // Same guard as getShiftCashVariance — the detail feeds its table.
    await requireRole("super_admin", "admin_pusat");

    const orderRows = await db
      .select({
        orderCode: orders.orderCode,
        totalAmount: orders.totalAmount,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .where(
        and(
          eq(orders.shiftId, data.shiftId),
          eq(orders.paymentMethod, "Cash"),
          ne(orders.status, "Void"),
        ),
      )
      .orderBy(orders.createdAt);

    const editRows = await db
      .select({
        oldValue: shiftEdits.oldValue,
        newValue: shiftEdits.newValue,
        createdAt: shiftEdits.createdAt,
      })
      .from(shiftEdits)
      .where(and(eq(shiftEdits.shiftId, data.shiftId), eq(shiftEdits.fieldName, "cashFloat")))
      .orderBy(shiftEdits.createdAt);

    const txs: ShiftCashTransactionRow[] = [
      ...orderRows.map((o) => ({
        type: "order" as const,
        amount: o.totalAmount,
        direction: "in" as const,
        label: o.orderCode ?? null,
        occurredAt: o.createdAt,
      })),
      ...editRows.map((e) => {
        const delta = Number(e.newValue) - Number(e.oldValue ?? "0");
        return {
          type: "float_adjust" as const,
          amount: Math.abs(delta),
          direction: delta >= 0 ? ("in" as const) : ("out" as const),
          label: delta >= 0 ? "Tambah kas" : "Ambil dari laci",
          occurredAt: e.createdAt,
        };
      }),
    ];

    return txs.sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
  });

// ─── Manual ledger entries (finance page "Manual" column) ───

export interface ManualFinanceEntry {
  id: string;
  date: string;
  kind: "revenue" | "expense";
  /** Channel for channel revenues; null for manual (no-channel) revenues. */
  channel: string | null;
  /** Expense category (expenses only). */
  category: string | null;
  amount: number;
  /** ADR 0017: incremental sales (in omzet) vs memo-only. Expenses: false. */
  includeInPnl: boolean;
  notes: string | null;
}

// Flat feed of manually-input finance entries for the finance page's Manual
// column: manual + channel revenues (via "Input Revenue") and operational
// expenses (via "Input Pengeluaran"). Waste-derived expenses are excluded —
// they are system-generated, not input through the buttons.
export const getManualFinanceEntries = createServerFn({ method: "GET" })
  .validator((data: { branchId?: string; dateFrom: string; dateTo: string }) => data)
  .handler(async ({ data }): Promise<ManualFinanceEntry[]> => {
    await requireRole("super_admin", "admin_pusat");
    validateDateRange(data.dateFrom, data.dateTo, 366);

    const revenueConditions = [
      gte(manualRevenues.date, data.dateFrom),
      lte(manualRevenues.date, data.dateTo),
      data.branchId ? eq(manualRevenues.branchId, data.branchId) : undefined,
    ];
    const manualRevenueRows = await db
      .select({
        id: manualRevenues.id,
        date: manualRevenues.date,
        amount: manualRevenues.amount,
        includeInPnl: manualRevenues.includeInPnl,
        notes: manualRevenues.notes,
      })
      .from(manualRevenues)
      .where(and(...revenueConditions));

    const channelConditions = [
      gte(channelRevenues.date, data.dateFrom),
      lte(channelRevenues.date, data.dateTo),
      data.branchId ? eq(channelRevenues.branchId, data.branchId) : undefined,
    ];
    const channelRevenueRows = await db
      .select({
        id: channelRevenues.id,
        date: channelRevenues.date,
        amount: channelRevenues.amount,
        includeInPnl: channelRevenues.includeInPnl,
        notes: channelRevenues.notes,
        channel: channelRevenues.channel,
      })
      .from(channelRevenues)
      .where(and(...channelConditions));

    const expenseConditions = [
      isNull(operationalExpenses.wasteEntryId),
      gte(operationalExpenses.date, data.dateFrom),
      lte(operationalExpenses.date, data.dateTo),
      data.branchId ? eq(operationalExpenses.branchId, data.branchId) : undefined,
    ];
    const expenseRows = await db
      .select({
        id: operationalExpenses.id,
        date: operationalExpenses.date,
        amount: operationalExpenses.amount,
        notes: operationalExpenses.notes,
        category: operationalExpenses.category,
      })
      .from(operationalExpenses)
      .where(and(...expenseConditions));

    return [
      ...manualRevenueRows.map((r) => ({
        ...r,
        kind: "revenue" as const,
        channel: null,
        category: null,
      })),
      ...channelRevenueRows.map((r) => ({
        ...r,
        kind: "revenue" as const,
        channel: r.channel,
        category: null,
      })),
      ...expenseRows.map((r) => ({
        ...r,
        kind: "expense" as const,
        channel: null,
        category: r.category,
        includeInPnl: false,
      })),
    ].sort((a, b) => a.date.localeCompare(b.date));
  });

export const getDailyHppBreakdown = createServerFn({ method: "GET" })
  .validator((data: { branchId?: string; date: string; channel?: string }) => ({
    ...data,
    channel: z.enum(ORDER_CHANNEL_VALUES).optional().catch(undefined).parse(data.channel),
  }))
  .handler(async ({ data }): Promise<HppBreakdownRow[]> => {
    await requireRole("super_admin", "admin_pusat");

    const orderConditions = [];
    if (data.branchId) orderConditions.push(eq(orders.branchId, data.branchId));
    if (data.channel) orderConditions.push(eq(orders.channel, data.channel));
    orderConditions.push(
      sql`DATE((${orders.createdAt} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta') = ${data.date}`,
    );

    // All order items for the day — deliberately including Void orders, to
    // match the ledger's HPP column: voiding flips status and restores
    // inventory but does not reset orders.totalCogs, which the column sums.
    const itemRows = await db
      .select({
        orderItemId: orderItems.id,
        recipeId: orderItems.recipeId,
        quantity: orderItems.quantity,
        cogsAtTransaction: orderItems.cogsAtTransaction,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .where(orderConditions.length > 0 ? and(...orderConditions) : undefined);

    // The number the breakdown must reconcile against: the exact aggregate the
    // ledger's HPP column shows for the same filters.
    const [dayCogsRow] = await db
      .select({
        totalCogs: sql<number>`COALESCE(SUM(${orders.totalCogs}), 0)`,
      })
      .from(orders)
      .where(orderConditions.length > 0 ? and(...orderConditions) : undefined);
    const dayTotalCogs = Number(dayCogsRow?.totalCogs ?? 0);

    if (itemRows.length === 0 || dayTotalCogs === 0) return [];

    // Re-resolve each item's persisted composition (BOM + modifiers −
    // exclusions, BOGO-aware) exactly like the POS did at sale time, with
    // current ingredient costs as the proportional split basis.
    //
    // Per-item COGS cannot be used as the scaling target: orders created via
    // "Data Penjualan" (createSalesRecord) carry a hand-entered totalCogs with
    // no items at all, and updateSalesRecord can edit totalCogs without
    // touching items. So the item-level costs only provide the *proportions*;
    // the whole day's pool is then scaled once to the day's actual
    // SUM(orders.totalCogs), guaranteeing the parts always sum to the HPP
    // column regardless of how the orders were created or edited.
    const ingredientTotals = new Map<string, { name: string; cost: number }>();
    let resolvedPool = 0;
    for (const item of itemRows) {
      const resolved = await resolvePersistedItemIngredients(item.orderItemId, {
        includeCost: true,
      });
      for (const ing of resolved.ingredients) {
        const cost = Math.max(0, ing.cost ?? 0);
        if (cost === 0) continue;
        resolvedPool += cost;
        const existing = ingredientTotals.get(ing.ingredientId);
        if (existing) {
          existing.cost += cost;
        } else {
          ingredientTotals.set(ing.ingredientId, { name: ing.ingredientName, cost });
        }
      }
    }

    if (ingredientTotals.size === 0) return [];

    // Day-level scale: resolved proportions -> the ledger's actual HPP total.
    const scale = resolvedPool > 0 ? dayTotalCogs / resolvedPool : 0;
    const scaled = [...ingredientTotals.entries()]
      .map(([ingredientId, agg]) => ({
        ingredientId,
        name: agg.name,
        scaled: agg.cost * scale,
      }))
      .sort((a, b) => b.scaled - a.scaled);

    // Round every share proportionally, then push the rounding remainder into
    // the largest-cost ingredient, so the parts sum exactly to the day's HPP
    // column value. (Computing the largest as "total minus the rest" instead
    // would discard its own share and double-count the total.)
    let allocated = 0;
    const result: HppBreakdownRow[] = scaled.map((entry) => {
      const cost = Math.round(entry.scaled);
      allocated += cost;
      return {
        ingredientId: entry.ingredientId,
        name: entry.name,
        category: "", // filled in below, batched
        quantity: 0,
        cost,
      };
    });
    result[0].cost += dayTotalCogs - allocated;

    // Batch category lookup for the distinct ingredients.
    const ids = result.map((r) => r.ingredientId);
    const categoryMap = new Map<string, string>();
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const rows = await db
        .select({ id: ingredients.id, category: ingredients.category })
        .from(ingredients)
        .where(inArray(ingredients.id, chunk));
      for (const r of rows) categoryMap.set(r.id, r.category);
    }
    for (const r of result) r.category = categoryMap.get(r.ingredientId) ?? "";

    return result;
  });

export interface OmzetChannelRow {
  channel: string;
  orderCount: number;
  totalAmount: number;
}

export interface OmzetBreakdown {
  /** Gross order sales (Σ totalAmount), non-void — before discount/MDR. */
  grossSales: number;
  /** Σ merchantDiscount, non-void. */
  merchantDiscount: number;
  /** Σ mdrFee, non-void. */
  mdrFee: number;
  /** Net order sales (Σ netSales), non-void — the order component of omzet. */
  orderNetSales: number;
  /** Manual revenue counted into omzet (includeInPnl, ADR 0017). */
  manualRevenue: number;
  /** computedOmzet = orderNetSales + manualRevenue. */
  computedOmzet: number;
  /** Day-level manual override, if any — this is what the Omzet column shows. */
  override: number | null;
  /** The value the Omzet column displays. */
  effectiveOmzet: number;
  orderCount: number;
  /** Void orders excluded from omzet (ADR 0017 #3) — shown for auditability. */
  voidCount: number;
  voidAmount: number;
  perChannel: OmzetChannelRow[];
}

// Per-day Omzet detail so the user can verify the ledger: the gross → net
// derivation (discount, MDR), the includeInPnl manual revenue, the manual
// override (if any), and the per-channel order totals behind the sum. Void
// orders are excluded (ADR 0017) but reported so the gap vs the POS journal
// stays explainable.
export const getOmzetBreakdown = createServerFn({ method: "GET" })
  .validator((data: { branchId?: string; date: string; channel?: string }) => ({
    ...data,
    channel: z.enum(ORDER_CHANNEL_VALUES).optional().catch(undefined).parse(data.channel),
  }))
  .handler(async ({ data }): Promise<OmzetBreakdown> => {
    await requireRole("super_admin", "admin_pusat");

    const conditions = [];
    if (data.branchId) conditions.push(eq(orders.branchId, data.branchId));
    if (data.channel) conditions.push(eq(orders.channel, data.channel));
    conditions.push(
      sql`DATE((${orders.createdAt} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta') = ${data.date}`,
    );
    const nonVoid = [...conditions, ne(orders.status, "Void"), isNull(orders.deletedAt)];
    const voidOnly = [...conditions, eq(orders.status, "Void"), isNull(orders.deletedAt)];

    const [totalsRow] = await db
      .select({
        grossSales: sql<number>`COALESCE(SUM(${orders.totalAmount}), 0)`,
        merchantDiscount: sql<number>`COALESCE(SUM(${orders.merchantDiscount}), 0)`,
        mdrFee: sql<number>`COALESCE(SUM(${orders.mdrFee}), 0)`,
        netSales: sql<number>`COALESCE(SUM(${orders.netSales}), 0)`,
        orderCount: sql<number>`COUNT(*)`,
      })
      .from(orders)
      .where(and(...nonVoid));

    const [voidRow] = await db
      .select({
        count: sql<number>`COUNT(*)`,
        amount: sql<number>`COALESCE(SUM(${orders.totalAmount}), 0)`,
      })
      .from(orders)
      .where(and(...voidOnly));

    const perChannelRows = await db
      .select({
        channel: orders.channel,
        orderCount: sql<number>`COUNT(*)`,
        totalAmount: sql<number>`COALESCE(SUM(${orders.netSales}), 0)`,
      })
      .from(orders)
      .where(and(...nonVoid))
      .groupBy(orders.channel)
      .orderBy(sql`COALESCE(SUM(${orders.netSales}), 0) DESC`);

    // Manual revenue split by intent (ADR 0017). No-channel manual revenue is
    // omitted when a specific channel is selected, mirroring the ledger.
    const manualRevConditions = [
      eq(manualRevenues.date, data.date),
      data.branchId ? eq(manualRevenues.branchId, data.branchId) : undefined,
    ];
    const [manualRevRow] = data.channel
      ? [undefined]
      : await db
          .select({
            pnl: sql<number>`COALESCE(SUM(CASE WHEN ${manualRevenues.includeInPnl} THEN ${manualRevenues.amount} ELSE 0 END), 0)`,
          })
          .from(manualRevenues)
          .where(and(...manualRevConditions));

    const channelRevConditions = [
      eq(channelRevenues.date, data.date),
      data.branchId ? eq(channelRevenues.branchId, data.branchId) : undefined,
      data.channel ? eq(channelRevenues.channel, data.channel) : undefined,
    ];
    const [channelRevRow] = await db
      .select({
        pnl: sql<number>`COALESCE(SUM(CASE WHEN ${channelRevenues.includeInPnl} THEN ${channelRevenues.amount} ELSE 0 END), 0)`,
      })
      .from(channelRevenues)
      .where(and(...channelRevConditions));

    const manualRevenue = Number(manualRevRow?.pnl ?? 0) + Number(channelRevRow?.pnl ?? 0);

    const overrideConditions = [
      eq(dailyOverrides.date, data.date),
      eq(dailyOverrides.field, "omzet"),
      data.branchId ? eq(dailyOverrides.branchId, data.branchId) : undefined,
    ];
    const [overrideRow] = await db
      .select({ value: dailyOverrides.value })
      .from(dailyOverrides)
      .where(and(...overrideConditions))
      .limit(1);

    const computedOmzet = Number(totalsRow?.netSales ?? 0) + manualRevenue;
    const override = overrideRow ? Number(overrideRow.value) : null;
    return {
      grossSales: Number(totalsRow?.grossSales ?? 0),
      merchantDiscount: Number(totalsRow?.merchantDiscount ?? 0),
      mdrFee: Number(totalsRow?.mdrFee ?? 0),
      orderNetSales: Number(totalsRow?.netSales ?? 0),
      manualRevenue,
      computedOmzet,
      override,
      effectiveOmzet: override ?? computedOmzet,
      orderCount: Number(totalsRow?.orderCount ?? 0),
      voidCount: Number(voidRow?.count ?? 0),
      voidAmount: Number(voidRow?.amount ?? 0),
      perChannel: perChannelRows.map((r) => ({
        channel: r.channel,
        orderCount: Number(r.orderCount),
        totalAmount: Number(r.totalAmount),
      })),
    };
  });

// User-parameterized core (ADR-0015). Mirrors the wrapper's requireRole guard.
export async function upsertDailyOverrideCore(
  user: AppUser,
  data: { branchId: string; date: string; field: string; value: number },
) {
  if (user.role !== "super_admin" && user.role !== "admin_pusat") {
    throw new Error(
      `Forbidden: insufficient role (user ${user.id} has role "${user.role}", required: super_admin | admin_pusat)`,
    );
  }

  const existing = await db
    .select()
    .from(dailyOverrides)
    .where(
      and(
        eq(dailyOverrides.branchId, data.branchId),
        eq(dailyOverrides.date, data.date),
        eq(dailyOverrides.field, data.field),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(dailyOverrides)
      .set({ value: data.value, updatedAt: new Date() })
      .where(eq(dailyOverrides.id, existing[0].id));
  } else {
    await db.insert(dailyOverrides).values({
      branchId: data.branchId,
      date: data.date,
      field: data.field,
      value: data.value,
    });
  }

  return { success: true };
}

export const upsertDailyOverride = createServerFn({ method: "POST" })
  .validator((data: { branchId: string; date: string; field: string; value: number }) => data)
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");
    return upsertDailyOverrideCore(user, data);
  });

// User-parameterized core (ADR-0015). Mirrors the wrapper's requireRole guard.
export async function createManualRevenueCore(
  user: AppUser,
  data: {
    branchId: string;
    date: string;
    amount: number;
    brandBreakdown?: { brandId: string; amount: number }[];
    notes?: string;
  },
) {
  if (user.role !== "super_admin" && user.role !== "admin_pusat") {
    throw new Error(
      `Forbidden: insufficient role (user ${user.id} has role "${user.role}", required: super_admin | admin_pusat)`,
    );
  }

  const [revenue] = await db
    .insert(manualRevenues)
    .values({
      branchId: data.branchId,
      date: data.date,
      amount: data.amount,
      notes: data.notes,
      submittedBy: user.id,
    })
    .returning();

  if (data.brandBreakdown?.length) {
    await db.insert(manualRevenueBrandBreakdowns).values(
      data.brandBreakdown.map((b) => ({
        manualRevenueId: revenue.id,
        brandId: b.brandId,
        amount: b.amount,
      })),
    );
  }

  await logSystemAction(
    user,
    "Create Manual Revenue",
    `Manual revenue Rp${data.amount.toLocaleString()} (${data.branchId}) dicatat oleh ${user.name}`,
  );
  await logAudit(user, "revenues", revenue.id, "CREATE", undefined, revenue);

  return revenue;
}

export const createManualRevenue = createServerFn({ method: "POST" })
  .validator(
    (data: {
      branchId: string;
      date: string;
      amount: number;
      brandBreakdown?: { brandId: string; amount: number }[];
      notes?: string;
    }) => data,
  )
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");
    return createManualRevenueCore(user, data);
  });

export const getChannelRevenues = createServerFn({ method: "GET" })
  .validator((data: { branchId?: string; date?: string }) => data)
  .handler(async ({ data }) => {
    await requireRole("super_admin");

    const result = await db
      .select()
      .from(channelRevenues)
      .where(
        and(
          data.branchId ? eq(channelRevenues.branchId, data.branchId) : undefined,
          data.date ? eq(channelRevenues.date, data.date) : undefined,
        ),
      )
      .orderBy(channelRevenues.channel);

    return result;
  });

// User-parameterized core (ADR-0015). Mirrors the wrapper's requireRole guard.
export async function createChannelRevenueCore(
  user: AppUser,
  data: {
    branchId: string;
    date: string;
    channel: (typeof ORDER_CHANNEL_VALUES)[number];
    amount: number;
    notes?: string;
  },
) {
  if (user.role !== "super_admin" && user.role !== "admin_pusat") {
    throw new Error(
      `Forbidden: insufficient role (user ${user.id} has role "${user.role}", required: super_admin | admin_pusat)`,
    );
  }

  const [revenue] = await db
    .insert(channelRevenues)
    .values({
      branchId: data.branchId,
      date: data.date,
      channel: data.channel,
      amount: data.amount,
      notes: data.notes,
      submittedBy: user.id,
    })
    .returning();

  await logSystemAction(
    user,
    "Create Channel Revenue",
    `Channel revenue Rp${data.amount.toLocaleString()} (${data.channel}) dicatat oleh ${user.name}`,
  );
  await logAudit(user, "revenues", revenue.id, "CREATE", undefined, revenue);

  return revenue;
}

export const createChannelRevenue = createServerFn({ method: "POST" })
  .validator(
    (data: {
      branchId: string;
      date: string;
      channel: (typeof ORDER_CHANNEL_VALUES)[number];
      amount: number;
      notes?: string;
    }) => data,
  )
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");
    return createChannelRevenueCore(user, data);
  });

// ADR 0017: flip a revenue entry between incremental-sale (includeInPnl) and
// memo-only. Same guard as the create paths.
export const setRevenueIncludeInPnl = createServerFn({ method: "POST" })
  .validator((data: { kind: "manual" | "channel"; id: string; includeInPnl: boolean }) => data)
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");
    if (data.kind === "manual") {
      await db
        .update(manualRevenues)
        .set({ includeInPnl: data.includeInPnl })
        .where(eq(manualRevenues.id, data.id));
    } else {
      await db
        .update(channelRevenues)
        .set({ includeInPnl: data.includeInPnl })
        .where(eq(channelRevenues.id, data.id));
    }
    await logAudit(
      user,
      "revenues",
      data.id,
      "UPDATE",
      { includeInPnl: !data.includeInPnl },
      { includeInPnl: data.includeInPnl },
    );
    return { success: true };
  });

// ─── Manual Expenses ───

export const getManualExpenses = createServerFn({ method: "GET" })
  .validator((data: { branchId?: string; dateFrom?: string; dateTo?: string }) => data)
  .handler(async ({ data }) => {
    await requireRole("super_admin", "admin_pusat");

    const conditions = [];
    if (data.branchId) conditions.push(eq(operationalExpenses.branchId, data.branchId));
    if (data.dateFrom) conditions.push(gte(operationalExpenses.date, data.dateFrom));
    if (data.dateTo) conditions.push(lte(operationalExpenses.date, data.dateTo));

    const result = await db
      .select({
        id: operationalExpenses.id,
        branchId: operationalExpenses.branchId,
        branchName: branches.name,
        date: operationalExpenses.date,
        category: operationalExpenses.category,
        amount: operationalExpenses.amount,
        notes: operationalExpenses.notes,
        createdAt: operationalExpenses.createdAt,
      })
      .from(operationalExpenses)
      .leftJoin(branches, eq(operationalExpenses.branchId, branches.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(operationalExpenses.date));

    return result;
  });

// User-parameterized core (ADR-0015). Mirrors the wrapper's requireRole guard.
export async function createManualExpenseCore(
  user: AppUser,
  data: { branchId: string; date: string; category: string; amount: number; notes?: string },
) {
  if (user.role !== "super_admin" && user.role !== "admin_pusat") {
    throw new Error(
      `Forbidden: insufficient role (user ${user.id} has role "${user.role}", required: super_admin | admin_pusat)`,
    );
  }

  const [expense] = await db
    .insert(operationalExpenses)
    .values({
      branchId: data.branchId,
      date: data.date,
      category: data.category,
      amount: data.amount,
      notes: data.notes,
      submittedBy: user.id,
    })
    .returning();

  await logSystemAction(
    user,
    "Create Manual Expense",
    `Manual expense Rp${data.amount.toLocaleString()} (${data.category}) dicatat oleh ${user.name}`,
  );
  await logAudit(user, "expenses", expense.id, "CREATE", undefined, expense);

  return expense;
}

export const createManualExpense = createServerFn({ method: "POST" })
  .validator(
    (data: { branchId: string; date: string; category: string; amount: number; notes?: string }) =>
      data,
  )
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");
    return createManualExpenseCore(user, data);
  });

// User-parameterized core (ADR-0015). Mirrors the wrapper's requireRole guard.
export async function deleteManualExpenseCore(user: AppUser, data: { id: string }) {
  if (user.role !== "super_admin" && user.role !== "admin_pusat") {
    throw new Error(
      `Forbidden: insufficient role (user ${user.id} has role "${user.role}", required: super_admin | admin_pusat)`,
    );
  }

  const [expense] = await db
    .select()
    .from(operationalExpenses)
    .where(eq(operationalExpenses.id, data.id))
    .limit(1);

  if (!expense) {
    throw new Error("Pengeluaran tidak ditemukan");
  }

  await db.delete(operationalExpenses).where(eq(operationalExpenses.id, data.id));

  await logSystemAction(
    user,
    "Delete Manual Expense",
    `Manual expense Rp${expense.amount.toLocaleString()} (${expense.category}) dihapus oleh ${user.name}`,
  );
  await logAudit(user, "expenses", expense.id, "DELETE", expense, undefined);

  return { success: true };
}

export const deleteManualExpense = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");
    return deleteManualExpenseCore(user, data);
  });

// ─── Analytics ───

export interface SalesAnalytics {
  channelData: { channel: string; total: number; count: number }[];
  topSales: { recipeId: string; totalQty: number; totalRevenue: number; name: string }[];
  dateRange: { from: string; to: string };
}

export const getSalesAnalytics = createServerFn({ method: "GET" })
  .validator(
    (data: { branchId?: string; dateFrom: string; dateTo: string; category?: string }) => data,
  )
  .handler(async ({ data }): Promise<SalesAnalytics> => {
    await requireRole("super_admin");
    validateDateRange(data.dateFrom, data.dateTo, 31);

    // Channel distribution
    const channelData = await db
      .select({
        channel: orders.channel,
        total: sql<number>`COALESCE(SUM(${orders.totalAmount}), 0)`,
        count: sql<number>`COUNT(*)`,
      })
      .from(orders)
      .where(
        and(
          sql`DATE((${orders.createdAt} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta') >= ${data.dateFrom}`,
          sql`DATE((${orders.createdAt} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta') <= ${data.dateTo}`,
          data.branchId ? eq(orders.branchId, data.branchId) : undefined,
        ),
      )
      .groupBy(orders.channel);

    // Top sales by recipe
    const topSales = await db
      .select({
        recipeId: orderItems.recipeId,
        totalQty: sql<number>`SUM(${orderItems.quantity})`,
        totalRevenue: sql<number>`COALESCE(SUM(${orderItems.price} * ${orderItems.quantity}), 0)`,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .where(
        and(
          sql`DATE((${orders.createdAt} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta') >= ${data.dateFrom}`,
          sql`DATE((${orders.createdAt} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta') <= ${data.dateTo}`,
          data.branchId ? eq(orders.branchId, data.branchId) : undefined,
        ),
      )
      .groupBy(orderItems.recipeId)
      .orderBy(sql`SUM(${orderItems.quantity}) DESC`)
      .limit(10);

    // Get recipe names
    const recipeIds = topSales.map((t) => t.recipeId);
    const recipeNames: Record<string, string> = {};
    for (const id of recipeIds) {
      const [r] = await db
        .select({ name: recipes.name })
        .from(recipes)
        .where(eq(recipes.id, id))
        .limit(1);
      if (r) recipeNames[id] = r.name;
    }

    return {
      channelData: channelData.map((c) => ({
        ...c,
        total: Number(c.total),
        count: Number(c.count),
      })),
      topSales: topSales.map((t) => ({
        ...t,
        totalQty: Number(t.totalQty),
        totalRevenue: Number(t.totalRevenue),
        name: recipeNames[t.recipeId] ?? t.recipeId,
      })),
      dateRange: { from: data.dateFrom, to: data.dateTo },
    };
  });

// ─── Period Control ───

export const getPeriods = createServerFn({ method: "GET" }).handler(async () => {
  await requireAuth();

  const result = await db.select().from(periodLogs).orderBy(desc(periodLogs.openedAt));

  return result;
});

export const getPeriodDetail = createServerFn({ method: "GET" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    await requireRole("super_admin");

    const [period] = await db.select().from(periodLogs).where(eq(periodLogs.id, data.id)).limit(1);

    if (!period) return null;

    const balances = await db
      .select()
      .from(periodBalances)
      .where(eq(periodBalances.periodLogId, data.id));

    return { ...period, balances };
  });

// User-parameterized core (ADR-0015). Mirrors the wrapper's requireRole guard.
export async function openPeriodCore(user: AppUser, data: { periodName: string }) {
  if (user.role !== "super_admin") {
    throw new Error(
      `Forbidden: insufficient role (user ${user.id} has role "${user.role}", required: super_admin)`,
    );
  }

  // Check if there's an existing open period
  const [existingOpen] = await db
    .select()
    .from(periodLogs)
    .where(eq(periodLogs.status, "Open"))
    .limit(1);

  if (existingOpen) {
    throw new Error("Tutup periode yang sedang aktif terlebih dahulu");
  }

  // Get current inventory as opening balances
  const currentInv = await db.select().from(inventory);

  const [period] = await db
    .insert(periodLogs)
    .values({
      periodName: data.periodName,
      status: "Open",
      openedAt: new Date(),
      openedBy: user.id,
    })
    .returning();

  // Create opening balances
  for (const inv of currentInv) {
    await db.insert(periodBalances).values({
      periodLogId: period.id,
      branchId: inv.branchId,
      ingredientId: inv.ingredientId,
      balanceType: "opening",
      quantity: inv.quantity,
    });
  }

  await logSystemAction(
    user,
    "Open Period",
    `Periode "${data.periodName}" dibuka oleh ${user.name}`,
  );
  await logAudit(user, "periodLogs", period.id, "CREATE", undefined, period);

  return period;
}

export const openPeriod = createServerFn({ method: "POST" })
  .validator((data: { periodName: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin");
    return openPeriodCore(user, data);
  });

// User-parameterized core (ADR-0015). Mirrors the wrapper's requireRole guard.
export async function closePeriodCore(user: AppUser, data: { periodId: string }) {
  if (user.role !== "super_admin") {
    throw new Error(
      `Forbidden: insufficient role (user ${user.id} has role "${user.role}", required: super_admin)`,
    );
  }

  const [period] = await db
    .select()
    .from(periodLogs)
    .where(eq(periodLogs.id, data.periodId))
    .limit(1);

  if (!period) throw new Error("Periode tidak ditemukan");
  if (period.status !== "Open") throw new Error("Periode sudah ditutup");

  // Exhaustive verification checklist
  const checks: { name: string; passed: boolean; message: string }[] = [];

  // 1. Check all SO are approved
  const pendingSO = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(stockOpnames)
    .where(
      and(
        gte(stockOpnames.createdAt, period.openedAt),
        eq(stockOpnames.status, "Under Investigation"),
      ),
    );
  const soPassed = (pendingSO[0]?.count ?? 0) === 0;
  checks.push({
    name: "Stock Opname",
    passed: soPassed,
    message: soPassed
      ? "Semua SO sudah approved"
      : `${pendingSO[0]?.count ?? 0} SO masih Under Investigation`,
  });

  // 2. Check no pending cancel requests
  const pendingCancels = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(cancelRequests)
    .where(eq(cancelRequests.status, "Pending"));
  const cancelPassed = (pendingCancels[0]?.count ?? 0) === 0;
  checks.push({
    name: "Cancel Requests",
    passed: cancelPassed,
    message: cancelPassed
      ? "Tidak ada request cancel pending"
      : `${pendingCancels[0]?.count ?? 0} cancel request pending`,
  });

  // 3. Check no unpaid SCM invoices
  const unpaidInvoices = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(scmInvoices)
    .where(eq(scmInvoices.status, "Unpaid"));
  const invoicePassed = (unpaidInvoices[0]?.count ?? 0) === 0;
  checks.push({
    name: "Invoice SCM",
    passed: invoicePassed,
    message: invoicePassed
      ? "Semua invoice sudah dibayar"
      : `${unpaidInvoices[0]?.count ?? 0} invoice belum dibayar`,
  });

  // 4. Check no negative inventory
  const negativeInv = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(inventory)
    .where(lte(inventory.quantity, 0));
  const negInvPassed = (negativeInv[0]?.count ?? 0) === 0;
  checks.push({
    name: "Stok Negatif",
    passed: negInvPassed,
    message: negInvPassed
      ? "Tidak ada stok negatif"
      : `${negativeInv[0]?.count ?? 0} item stok negatif`,
  });

  // 5. Check waste >5% has investigation comments
  const highWasteNoComment = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(wasteEntries)
    .leftJoin(
      inventory,
      and(
        eq(inventory.branchId, wasteEntries.branchId),
        eq(inventory.ingredientId, wasteEntries.ingredientId),
      ),
    )
    .where(
      and(
        gte(wasteEntries.createdAt, period.openedAt),
        sql`${wasteEntries.investigationNote} IS NULL OR ${wasteEntries.investigationNote} = ''`,
        sql`COALESCE(${inventory.quantity}, 0) > 0`,
        sql`(${wasteEntries.quantity}::float / (${wasteEntries.quantity} + COALESCE(${inventory.quantity}, 0))::float * 100) > 5`,
      ),
    );
  const wastePassed = (highWasteNoComment[0]?.count ?? 0) === 0;
  checks.push({
    name: "Waste Investigation",
    passed: wastePassed,
    message: wastePassed
      ? "Semua waste entry memiliki komentar investigasi"
      : `${highWasteNoComment[0]?.count ?? 0} waste entry tanpa komentar investigasi`,
  });

  // 6. Check no pending stock transfers
  const pendingTransfers = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(stockTransfers)
    .where(
      and(gte(stockTransfers.createdAt, period.openedAt), eq(stockTransfers.status, "In Transit")),
    );
  const transferPassed = (pendingTransfers[0]?.count ?? 0) === 0;
  checks.push({
    name: "Mutasi Stok",
    passed: transferPassed,
    message: transferPassed
      ? "Tidak ada mutasi stok dalam perjalanan"
      : `${pendingTransfers[0]?.count ?? 0} mutasi stok masih In Transit`,
  });

  // 7. Check no SJ still in In Transit
  const pendingSJs = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(deliveryNotes)
    .where(
      and(gte(deliveryNotes.createdAt, period.openedAt), eq(deliveryNotes.status, "In Transit")),
    );
  const sjPassed = (pendingSJs[0]?.count ?? 0) === 0;
  checks.push({
    name: "Surat Jalan",
    passed: sjPassed,
    message: sjPassed
      ? "Tidak ada SJ dalam perjalanan"
      : `${pendingSJs[0]?.count ?? 0} SJ masih In Transit`,
  });

  const allPassed = checks.every((c) => c.passed);

  if (!allPassed) {
    return { success: false, checks, message: "Verifikasi gagal. Perbaiki masalah di atas." };
  }

  // Save closing balances
  const currentInv = await db.select().from(inventory);
  for (const inv of currentInv) {
    await db.insert(periodBalances).values({
      periodLogId: period.id,
      branchId: inv.branchId,
      ingredientId: inv.ingredientId,
      balanceType: "closing",
      quantity: inv.quantity,
    });
  }

  // Close period
  await db
    .update(periodLogs)
    .set({
      status: "Closed",
      closedAt: new Date(),
      closedBy: user.id,
    })
    .where(eq(periodLogs.id, data.periodId));

  const [updatedPeriod] = await db
    .select()
    .from(periodLogs)
    .where(eq(periodLogs.id, data.periodId))
    .limit(1);

  // Notify all active users that period is closed
  const allActiveUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.status, "Active"));
  for (const u of allActiveUsers) {
    await db.insert(systemNotifications).values({
      userId: u.id,
      title: "Periode Ditutup",
      message: `Periode "${period.periodName}" telah ditutup oleh ${user.name}`,
      type: "warning",
    });
  }

  await logSystemAction(
    user,
    "Close Period",
    `Periode "${period.periodName}" ditutup oleh ${user.name}`,
  );
  await logAudit(user, "periodLogs", data.periodId, "UPDATE", period, updatedPeriod);

  return { success: true, checks, message: "Periode berhasil ditutup" };
}

export const closePeriod = createServerFn({ method: "POST" })
  .validator((data: { periodId: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin");
    return closePeriodCore(user, data);
  });

export interface HourlyDataPoint {
  hour: number;
  count: number;
  revenue: number;
}

export const getHourlyAnalytics = createServerFn({ method: "GET" })
  .validator((data: { branchId?: string; dateFrom: string; dateTo: string }) => data)
  .handler(async ({ data }): Promise<HourlyDataPoint[]> => {
    await requireRole("super_admin");
    validateDateRange(data.dateFrom, data.dateTo, 31);

    const result = await db
      .select({
        hour: sql<number>`EXTRACT(HOUR FROM (${orders.createdAt} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta')`,
        count: sql<number>`COUNT(*)`,
        revenue: sql<number>`COALESCE(SUM(${orders.totalAmount}), 0)`,
      })
      .from(orders)
      .where(
        and(
          sql`DATE((${orders.createdAt} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta') >= ${data.dateFrom}`,
          sql`DATE((${orders.createdAt} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta') <= ${data.dateTo}`,
          data.branchId ? eq(orders.branchId, data.branchId) : undefined,
        ),
      )
      .groupBy(
        sql`EXTRACT(HOUR FROM (${orders.createdAt} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta')`,
      )
      .orderBy(
        sql`EXTRACT(HOUR FROM (${orders.createdAt} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta')`,
      );

    return result.map((r) => ({
      hour: Number(r.hour),
      count: Number(r.count),
      revenue: Number(r.revenue),
    }));
  });

// ID13: Print Finance page to PDF (HTML + browser print)
export const printFinancePage = createServerFn({ method: "GET" })
  .validator(
    (data: { dateFrom?: string; dateTo?: string; branchId?: string; channel?: string }) => ({
      ...data,
      channel: z.enum(ORDER_CHANNEL_VALUES).optional().catch(undefined).parse(data.channel),
    }),
  )
  .handler(async ({ data }) => {
    await requireAuth();
    const summary = await getFinanceSummary({ data });

    // Fetch branch name if branchId provided
    let branchName = "Semua Cabang";
    if (data.branchId) {
      const [branch] = await db
        .select({ name: branches.name })
        .from(branches)
        .where(eq(branches.id, data.branchId))
        .limit(1);
      branchName = branch?.name ?? "-";
    }

    // Build conditions for channel breakdown
    const conds: ReturnType<typeof and> = and(
      data.dateFrom
        ? sql`DATE((${orders.createdAt} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta') >= ${data.dateFrom}`
        : undefined,
      data.dateTo
        ? sql`DATE((${orders.createdAt} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta') <= ${data.dateTo}`
        : undefined,
      data.branchId ? eq(orders.branchId, data.branchId) : undefined,
      data.channel ? eq(orders.channel, data.channel) : undefined,
    );

    const channelBreakdown = await db
      .select({
        channel: orders.channel,
        totalAmount: sql<number>`COALESCE(SUM(${orders.netSales}), 0)`,
        count: sql<number>`COUNT(*)`,
      })
      .from(orders)
      .where(and(conds, ne(orders.status, "Void"), isNull(orders.deletedAt)))
      .groupBy(orders.channel)
      .orderBy(orders.channel);

    const channelRows = channelBreakdown
      .map(
        (ch) =>
          `<tr>
          <td>${escapeHtml(ch.channel)}</td>
          <td style="text-align:right;">${ch.count}</td>
          <td style="text-align:right;">${formatRupiah(ch.totalAmount)}</td>
          <td style="text-align:right;">${summary.totalSales > 0 ? ((ch.totalAmount / summary.totalSales) * 100).toFixed(1) : "0.0"}%</td>
        </tr>`,
      )
      .join("\n");

    const periodLabel =
      data.dateFrom || data.dateTo
        ? `${data.dateFrom ?? "-"} s.d. ${data.dateTo ?? "-"}`
        : "Semua Periode";

    const channelLabel = data.channel || "Semua Channel";

    const gpClass = summary.grossProfit >= 0 ? "green" : "red";
    const gpSign = summary.grossProfit >= 0 ? "" : "-";
    const opClass = summary.operatingProfit >= 0 ? "green" : "red";
    const opSign = summary.operatingProfit >= 0 ? "" : "-";

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Laporan Keuangan</title>
<style>
  @page { size: A4; margin: 1.5cm; }
  body { font-family: 'Helvetica', 'Arial', sans-serif; font-size: 10pt; color: #000; margin: 0; padding: 0; }
  .header { border-bottom: 2px solid #000; padding-bottom: 8pt; margin-bottom: 16pt; }
  .title { font-size: 18pt; font-weight: bold; }
  .subtitle { font-size: 9pt; color: #555; margin-top: 2pt; }
  .cards { display: flex; flex-wrap: wrap; gap: 12pt; margin-bottom: 16pt; }
  .card { border: 1px solid #ddd; border-radius: 4pt; padding: 10pt 14pt; flex: 1; min-width: 140pt; }
  .card-label { font-size: 8pt; color: #888; text-transform: uppercase; letter-spacing: 0.5pt; }
  .card-value { font-size: 14pt; font-weight: bold; margin-top: 4pt; }
  .card-value.green { color: #16a34a; }
  .card-value.red { color: #dc2626; }
  .section-title { font-size: 12pt; font-weight: bold; margin-top: 20pt; margin-bottom: 8pt; border-bottom: 1px solid #eee; padding-bottom: 4pt; }
  table { width: 100%; border-collapse: collapse; margin-top: 8pt; }
  th { background: #f0f0f0; font-weight: bold; padding: 6pt 8pt; border: 1px solid #ccc; text-align: left; font-size: 9pt; }
  td { padding: 5pt 8pt; border: 1px solid #ddd; font-size: 9pt; }
  .summary-table { margin-top: 16pt; }
  .summary-table td.label { font-weight: bold; padding: 4pt 8pt; border: none; }
  .summary-table td.value { text-align: right; font-weight: bold; padding: 4pt 8pt; border: none; }
  .footer { position: fixed; bottom: 0; left: 0; right: 0; text-align: center; font-size: 8pt; color: #999; padding: 8pt; border-top: 1px solid #eee; }
</style>
</head><body>
<div class="header">
  <div class="title">Laporan Keuangan</div>
  <div class="subtitle">Omoiyari POS</div>
  <div style="margin-top: 8pt; font-size: 10pt;">
    <div><strong>Periode:</strong> ${escapeHtml(periodLabel)}</div>
    <div><strong>Cabang:</strong> ${escapeHtml(branchName)}</div>
    <div><strong>Channel:</strong> ${escapeHtml(channelLabel)}</div>
  </div>
</div>

<div class="cards">
  <div class="card">
    <div class="card-label">Total Penjualan (Gross)</div>
    <div class="card-value green">${formatRupiah(summary.totalSales)}</div>
  </div>
  <div class="card">
    <div class="card-label">HPP</div>
    <div class="card-value red">${formatRupiah(summary.totalCogs)}</div>
  </div>
  <div class="card">
    <div class="card-label">Omzet (Net + Manual)</div>
    <div class="card-value green">${formatRupiah(summary.netSales + summary.manualRevenue)}</div>
  </div>
  <div class="card">
    <div class="card-label">Gross Profit</div>
    <div class="card-value ${gpClass}">${gpSign}${formatRupiah(Math.abs(summary.grossProfit))}</div>
  </div>
  <div class="card">
    <div class="card-label">Operating Profit</div>
    <div class="card-value ${opClass}">${opSign}${formatRupiah(Math.abs(summary.operatingProfit))}</div>
  </div>
</div>

<div class="section-title">Total Pesanan: ${summary.orderCount}${summary.voidCount > 0 ? ` (void: ${summary.voidCount})` : ""}</div>

<div class="section-title">Rincian per Channel</div>
<table>
<thead><tr>
  <th>Channel</th>
  <th style="text-align:right;width:80pt;">Pesanan</th>
  <th style="text-align:right;width:100pt;">Total</th>
  <th style="text-align:right;width:60pt;">%</th>
</tr></thead>
<tbody>${channelRows}</tbody>
</table>

<table class="summary-table">
  <tr><td class="label">Total Penjualan (Gross)</td><td class="value">${formatRupiah(summary.totalSales)}</td></tr>
  <tr><td class="label">Diskon Merchant</td><td class="value">-${formatRupiah(summary.totalMerchantDiscount)}</td></tr>
  <tr><td class="label">MDR</td><td class="value">-${formatRupiah(summary.totalMdr)}</td></tr>
  <tr><td class="label">Net Sales (Order)</td><td class="value">${formatRupiah(summary.netSales)}</td></tr>
  <tr><td class="label">Pendapatan Manual (masuk omzet)</td><td class="value">+${formatRupiah(summary.manualRevenue)}</td></tr>
  ${summary.manualRevenueMemo > 0 ? `<tr><td class="label">Pendapatan Manual (memo)</td><td class="value">${formatRupiah(summary.manualRevenueMemo)}</td></tr>` : ""}
  <tr><td class="label">HPP</td><td class="value">-${formatRupiah(summary.totalCogs)}</td></tr>
  <tr><td class="label" style="color: ${gpClass};">Gross Profit</td><td class="value" style="color: ${gpClass};">${gpSign}${formatRupiah(Math.abs(summary.grossProfit))}</td></tr>
  <tr><td class="label">Beban Operasional</td><td class="value">-${formatRupiah(summary.manualExpenses)}</td></tr>
  <tr><td class="label" style="color: ${opClass};">Operating Profit</td><td class="value" style="color: ${opClass};">${opSign}${formatRupiah(Math.abs(summary.operatingProfit))}</td></tr>
</table>

<div class="footer">Dicetak dari Omoiyari POS — ${new Date().toLocaleDateString("id-ID")}</div>
<script>window.onload = function() { window.print(); };</script>
</body></html>`;

    return { html };
  });

// ─── Pencatatan Manual Functions ───

export interface RecipeHpp {
  id: string;
  name: string;
  code: string;
  totalCogs: number;
}

export const getRecipesWithHpp = createServerFn({ method: "GET" })
  .validator((data: { branchId?: string }) => data)
  .handler(async ({ data: _data }): Promise<RecipeHpp[]> => {
    await requireRole("super_admin");

    const result = await db
      .select({
        id: recipes.id,
        name: recipes.name,
        code: recipes.code,
        totalCogs: recipes.totalCogs,
      })
      .from(recipes)
      .where(eq(recipes.status, "Active"))
      .orderBy(recipes.name);

    return result.map((r) => ({
      ...r,
      totalCogs: Number(r.totalCogs),
    }));
  });

export interface EmployeeMealSummary {
  staffName: string;
  ingredientName: string;
  quantity: number;
  valuation: number;
}

export const getEmployeeMealSummary = createServerFn({ method: "GET" })
  .validator((data: { branchId?: string; dateFrom?: string; dateTo?: string }) => data)
  .handler(async ({ data }): Promise<EmployeeMealSummary[]> => {
    await requireRole("super_admin");

    const conditions = [eq(wasteEntries.category, "Beban Makan")];
    if (data.branchId) conditions.push(eq(wasteEntries.branchId, data.branchId));
    if (data.dateFrom)
      conditions.push(
        sql`DATE((${wasteEntries.createdAt} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta') >= ${data.dateFrom}`,
      );
    if (data.dateTo)
      conditions.push(
        sql`DATE((${wasteEntries.createdAt} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta') <= ${data.dateTo}`,
      );

    const result = await db
      .select({
        staffName: wasteEntries.staffName,
        ingredientName: ingredients.name,
        quantity: wasteEntries.quantity,
        valuation: wasteEntries.valuation,
      })
      .from(wasteEntries)
      .leftJoin(ingredients, eq(wasteEntries.ingredientId, ingredients.id))
      .where(and(...conditions));

    return result.map((r) => ({
      staffName: r.staffName ?? "Unknown",
      ingredientName: r.ingredientName ?? "Unknown",
      quantity: Number(r.quantity),
      valuation: Number(r.valuation),
    }));
  });

export interface ExpenseByCategory {
  category: string;
  total: number;
  items: { id: string; date: string; notes: string | null; amount: number }[];
}

export const getExpensesByCategory = createServerFn({ method: "GET" })
  .validator((data: { branchId?: string; dateFrom?: string; dateTo?: string }) => data)
  .handler(async ({ data }): Promise<ExpenseByCategory[]> => {
    await requireRole("super_admin");

    const conditions = [];
    if (data.branchId) conditions.push(eq(operationalExpenses.branchId, data.branchId));
    if (data.dateFrom) conditions.push(gte(operationalExpenses.date, data.dateFrom));
    if (data.dateTo) conditions.push(lte(operationalExpenses.date, data.dateTo));

    const result = await db
      .select({
        id: operationalExpenses.id,
        category: operationalExpenses.category,
        amount: operationalExpenses.amount,
        date: operationalExpenses.date,
        notes: operationalExpenses.notes,
      })
      .from(operationalExpenses)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(operationalExpenses.category, operationalExpenses.date);

    const grouped = new Map<string, ExpenseByCategory>();
    for (const row of result) {
      const existing = grouped.get(row.category);
      if (existing) {
        existing.total += Number(row.amount);
        existing.items.push({
          id: row.id,
          date: row.date,
          notes: row.notes,
          amount: Number(row.amount),
        });
      } else {
        grouped.set(row.category, {
          category: row.category,
          total: Number(row.amount),
          items: [
            {
              id: row.id,
              date: row.date,
              notes: row.notes,
              amount: Number(row.amount),
            },
          ],
        });
      }
    }

    return Array.from(grouped.values());
  });

export interface PencatatanManualSummary {
  biayaMakanStaff: number;
  biayaOperasional: number;
  biayaGaji: number;
  biayaListrikAir: number;
  biayaWifi: number;
  biayaSewa: number;
  total: number;
  hpp: number;
  piutangPenjualan: number;
  profitMargin: number;
  nettProfit: number;
  biayaFranchise: number;
  christopher: number;
  pusat: number;
}

export const getPencatatanManualSummary = createServerFn({ method: "GET" })
  .validator(
    (data: { branchId?: string; dateFrom?: string; dateTo?: string; christopher?: number }) => data,
  )
  .handler(async ({ data }): Promise<PencatatanManualSummary> => {
    await requireRole("super_admin");

    // Get expenses by category
    const expenseConditions = [];
    if (data.branchId) expenseConditions.push(eq(operationalExpenses.branchId, data.branchId));
    if (data.dateFrom) expenseConditions.push(gte(operationalExpenses.date, data.dateFrom));
    if (data.dateTo) expenseConditions.push(lte(operationalExpenses.date, data.dateTo));

    const expenses = await db
      .select({
        category: operationalExpenses.category,
        total: sql<number>`COALESCE(SUM(${operationalExpenses.amount}), 0)`,
      })
      .from(operationalExpenses)
      .where(expenseConditions.length > 0 ? and(...expenseConditions) : undefined)
      .groupBy(operationalExpenses.category);

    const expenseMap = new Map<string, number>();
    for (const row of expenses) {
      expenseMap.set(row.category, Number(row.total));
    }

    // Get employee meal total from waste
    const wasteConditions = [eq(wasteEntries.category, "Beban Makan")];
    if (data.branchId) wasteConditions.push(eq(wasteEntries.branchId, data.branchId));
    if (data.dateFrom)
      wasteConditions.push(
        sql`DATE((${wasteEntries.createdAt} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta') >= ${data.dateFrom}`,
      );
    if (data.dateTo)
      wasteConditions.push(
        sql`DATE((${wasteEntries.createdAt} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta') <= ${data.dateTo}`,
      );

    const [wasteResult] = await db
      .select({ total: sql<number>`COALESCE(SUM(${wasteEntries.valuation}), 0)` })
      .from(wasteEntries)
      .where(and(...wasteConditions));

    // Get order totals
    const orderConditions = [];
    if (data.branchId) orderConditions.push(eq(orders.branchId, data.branchId));
    if (data.dateFrom)
      orderConditions.push(
        sql`DATE((${orders.createdAt} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta') >= ${data.dateFrom}`,
      );
    if (data.dateTo)
      orderConditions.push(
        sql`DATE((${orders.createdAt} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta') <= ${data.dateTo}`,
      );

    const [orderResult] = await db
      .select({
        totalCogs: sql<number>`COALESCE(SUM(${orders.totalCogs}), 0)`,
        totalAmount: sql<number>`COALESCE(SUM(${orders.totalAmount}), 0)`,
      })
      .from(orders)
      .where(orderConditions.length > 0 ? and(...orderConditions) : undefined);

    const biayaMakanStaff = Number(wasteResult?.total ?? 0);
    const biayaOperasional = expenseMap.get("Operasional") ?? 0;
    const biayaGaji = expenseMap.get("Gaji") ?? 0;
    const biayaListrikAir = expenseMap.get("ListrikAir") ?? 0;
    const biayaWifi = expenseMap.get("Wifi") ?? 0;
    const biayaSewa = expenseMap.get("Sewa") ?? 0;
    const total =
      biayaMakanStaff + biayaOperasional + biayaGaji + biayaListrikAir + biayaWifi + biayaSewa;

    const hpp = Number(orderResult?.totalCogs ?? 0);
    const piutangPenjualan = Number(orderResult?.totalAmount ?? 0);
    const profitMargin = piutangPenjualan - hpp;
    const nettProfit = profitMargin - total;
    const biayaFranchise = piutangPenjualan * 0.05;
    const christopher = data.christopher ?? 0;
    const pusat = nettProfit - biayaFranchise - christopher;

    return {
      biayaMakanStaff,
      biayaOperasional,
      biayaGaji,
      biayaListrikAir,
      biayaWifi,
      biayaSewa,
      total,
      hpp,
      piutangPenjualan,
      profitMargin,
      nettProfit,
      biayaFranchise,
      christopher,
      pusat,
    };
  });

/**
 * Save fixed costs (Gaji, ListrikAir, Wifi, Sewa) for a branch + month.
 * Deletes existing entries in that category/date range and creates a single new one.
 */
// User-parameterized core (ADR-0015). Mirrors the wrapper's auth (any
// authenticated user may save fixed costs — no role guard).
export async function saveFixedCostsCore(
  user: AppUser,
  data: {
    branchId: string;
    dateFrom: string;
    dateTo: string;
    gaji: number;
    listrikAir: number;
    wifi: number;
    sewa: number;
  },
) {
  const categories = [
    { category: "Gaji", value: data.gaji },
    { category: "ListrikAir", value: data.listrikAir },
    { category: "Wifi", value: data.wifi },
    { category: "Sewa", value: data.sewa },
  ];

  for (const cat of categories) {
    // Delete existing entries for this category + branch + date range
    await db
      .delete(operationalExpenses)
      .where(
        and(
          eq(operationalExpenses.branchId, data.branchId),
          eq(operationalExpenses.category, cat.category),
          gte(operationalExpenses.date, data.dateFrom),
          lte(operationalExpenses.date, data.dateTo),
        ),
      );

    // Create new entry if value > 0
    if (cat.value > 0) {
      await db.insert(operationalExpenses).values({
        branchId: data.branchId,
        category: cat.category,
        amount: cat.value,
        date: data.dateFrom,
        notes: cat.category,
        submittedBy: user.id,
      });
    }
  }

  return { success: true };
}

export const saveFixedCosts = createServerFn({ method: "POST" })
  .validator(
    (data: {
      branchId: string;
      dateFrom: string;
      dateTo: string;
      gaji: number;
      listrikAir: number;
      wifi: number;
      sewa: number;
    }) => data,
  )
  .handler(async ({ data }) => {
    const user = await requireAuth();
    return saveFixedCostsCore(user, data);
  });
