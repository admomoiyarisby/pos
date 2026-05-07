import { createServerFn } from "@tanstack/react-start";
import { db } from "#/db/index";
import {
  manualRevenues,
  manualRevenueBrandBreakdowns,
  channelRevenues,
  orders,
  orderItems,
  recipes,
  periodLogs,
  periodBalances,
  stockOpnames,
  scmInvoices,
  cancelRequests,
  inventory,
  systemNotifications,
  users,
} from "#/db/schema";
import { eq, and, gte, lte, sql, desc } from "drizzle-orm";
import { requireAuth, requireRole } from "./auth";
import { logSystemAction, logAudit } from "./logging";

export interface FinanceSummary {
  totalSales: number;
  totalMerchantDiscount: number;
  totalCogs: number;
  totalMdr: number;
  netSales: number;
  orderCount: number;
  manualRevenue: number;
  grossProfit: number;
}

export const getFinanceSummary = createServerFn({ method: "GET" })
  .inputValidator((data: { branchId?: string; dateFrom?: string; dateTo?: string }) => data)
  .handler(async ({ data }): Promise<FinanceSummary> => {
    await requireRole("super_admin");

    const conditions = [];
    if (data.branchId) conditions.push(eq(orders.branchId, data.branchId));
    if (data.dateFrom) conditions.push(gte(orders.createdAt, new Date(data.dateFrom)));
    if (data.dateTo) conditions.push(lte(orders.createdAt, new Date(data.dateTo)));

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
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    const manualRev = await db
      .select({
        total: sql<number>`COALESCE(SUM(${manualRevenues.amount}), 0)`,
      })
      .from(manualRevenues)
      .where(
        and(
          data.branchId ? eq(manualRevenues.branchId, data.branchId) : undefined,
          data.dateFrom ? gte(manualRevenues.date, data.dateFrom) : undefined,
          data.dateTo ? lte(manualRevenues.date, data.dateTo) : undefined,
        ),
      );

    const toNum = (v: string | number | null | undefined): number =>
      typeof v === "string" ? Number(v) : (v ?? 0);
    const totalSales = toNum(orderData[0]?.totalSales);
    const totalMerchantDiscount = toNum(orderData[0]?.totalMerchantDiscount);
    const totalCogs = toNum(orderData[0]?.totalCogs);
    const totalMdr = toNum(orderData[0]?.totalMdr);
    const netSales = toNum(orderData[0]?.netSales);
    return {
      totalSales,
      totalMerchantDiscount,
      totalCogs,
      totalMdr,
      netSales,
      orderCount: toNum(orderData[0]?.count),
      manualRevenue: toNum(manualRev[0]?.total),
      grossProfit: netSales - totalCogs,
    };
  });

export const createManualRevenue = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      branchId: string;
      date: string;
      amount: number;
      brandBreakdown?: { brandId: string; amount: number }[];
      notes?: string;
    }) => data,
  )
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin");

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
    await logAudit(
      user,
      "revenues",
      revenue.id,
      "CREATE",
      undefined,
      revenue as Record<string, unknown>,
    );

    return revenue;
  });

export const getChannelRevenues = createServerFn({ method: "GET" })
  .inputValidator((data: { branchId?: string; date?: string }) => data)
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

export const createChannelRevenue = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      branchId: string;
      date: string;
      channel: "Gofood" | "Grabfood" | "ShopeeFood" | "Dine-in";
      amount: number;
      notes?: string;
    }) => data,
  )
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin");

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
    await logAudit(
      user,
      "revenues",
      revenue.id,
      "CREATE",
      undefined,
      revenue as Record<string, unknown>,
    );

    return revenue;
  });

// ─── Analytics ───

export interface SalesAnalytics {
  channelData: { channel: string; total: number; count: number }[];
  topSales: { recipeId: string; totalQty: number; totalRevenue: number; name: string }[];
  dateRange: { from: string; to: string };
}

export const getSalesAnalytics = createServerFn({ method: "GET" })
  .inputValidator(
    (data: { branchId?: string; dateFrom: string; dateTo: string; category?: string }) => data,
  )
  .handler(async ({ data }): Promise<SalesAnalytics> => {
    await requireRole("super_admin");

    // Validate max 31 days
    const fromDate = new Date(data.dateFrom);
    const toDate = new Date(data.dateTo);
    const daysDiff = (toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24);
    if (daysDiff > 31) throw new Error("Maksimal rentang waktu 31 hari");

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
          gte(orders.createdAt, fromDate),
          lte(orders.createdAt, toDate),
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
          gte(orders.createdAt, fromDate),
          lte(orders.createdAt, toDate),
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
  .inputValidator((data: { id: string }) => data)
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

export const openPeriod = createServerFn({ method: "POST" })
  .inputValidator((data: { periodName: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin");

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
    await logAudit(
      user,
      "periodLogs",
      period.id,
      "CREATE",
      undefined,
      period as Record<string, unknown>,
    );

    return period;
  });

export const closePeriod = createServerFn({ method: "POST" })
  .inputValidator((data: { periodId: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin");

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
      .select({ count: sql<number>`COUNT(*)` })
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
      .select({ count: sql<number>`COUNT(*)` })
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
      .select({ count: sql<number>`COUNT(*)` })
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
      .select({ count: sql<number>`COUNT(*)` })
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
    await logAudit(
      user,
      "periodLogs",
      data.periodId,
      "UPDATE",
      period as Record<string, unknown>,
      updatedPeriod as Record<string, unknown>,
    );

    return { success: true, checks, message: "Periode berhasil ditutup" };
  });

export interface HourlyDataPoint {
  hour: number;
  count: number;
  revenue: number;
}

export const getHourlyAnalytics = createServerFn({ method: "GET" })
  .inputValidator((data: { branchId?: string; dateFrom: string; dateTo: string }) => data)
  .handler(async ({ data }): Promise<HourlyDataPoint[]> => {
    await requireRole("super_admin");

    const fromDate = new Date(data.dateFrom);
    const toDate = new Date(data.dateTo);
    const daysDiff = (toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24);
    if (daysDiff > 31) throw new Error("Maksimal rentang waktu 31 hari");

    const result = await db
      .select({
        hour: sql<number>`EXTRACT(HOUR FROM ${orders.createdAt})`,
        count: sql<number>`COUNT(*)`,
        revenue: sql<number>`COALESCE(SUM(${orders.totalAmount}), 0)`,
      })
      .from(orders)
      .where(
        and(
          gte(orders.createdAt, fromDate),
          lte(orders.createdAt, toDate),
          data.branchId ? eq(orders.branchId, data.branchId) : undefined,
        ),
      )
      .groupBy(sql`EXTRACT(HOUR FROM ${orders.createdAt})`)
      .orderBy(sql`EXTRACT(HOUR FROM ${orders.createdAt})`);

    return result.map((r) => ({
      hour: Number(r.hour),
      count: Number(r.count),
      revenue: Number(r.revenue),
    }));
  });
