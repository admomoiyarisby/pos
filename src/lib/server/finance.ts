import { createServerFn } from "@tanstack/react-start";
import { db } from "#/lib/server/db";
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
  wasteEntries,
  stockTransfers,
  deliveryNotes,
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
  .validator((data: { branchId?: string; dateFrom?: string; dateTo?: string }) => data)
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

export const createChannelRevenue = createServerFn({ method: "POST" })
  .validator(
    (data: {
      branchId: string;
      date: string;
      channel: "Gofood" | "Grabfood" | "ShopeeFood" | "Dine-in" | "TikTok";
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
  .validator(
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

export const openPeriod = createServerFn({ method: "POST" })
  .validator((data: { periodName: string }) => data)
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
  .validator((data: { periodId: string }) => data)
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
        and(
          gte(stockTransfers.createdAt, period.openedAt),
          eq(stockTransfers.status, "In Transit"),
        ),
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
  .validator((data: { branchId?: string; dateFrom: string; dateTo: string }) => data)
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

// ID13: Print Finance page to PDF (HTML + browser print)
export const printFinancePage = createServerFn({ method: "GET" })
  .validator(
    (data: {
      dateFrom?: string;
      dateTo?: string;
      branchId?: string;
    }) => data,
  )
  .handler(async ({ data }) => {
    await requireAuth();
    const summary = await getFinanceSummary({ data });

    // Build conditions for channel breakdown
    const conds: ReturnType<typeof and> = and(
      data.dateFrom ? gte(orders.createdAt, new Date(data.dateFrom)) : undefined,
      data.dateTo ? lte(orders.createdAt, new Date(data.dateTo + "T23:59:59")) : undefined,
      data.branchId ? eq(orders.branchId, data.branchId) : undefined,
    );

    const channelBreakdown = await db
      .select({
        channel: orders.channel,
        totalAmount: sql<number>`COALESCE(SUM(${orders.totalAmount}), 0)`,
        count: sql<number>`COUNT(*)`,
      })
      .from(orders)
      .where(conds)
      .groupBy(orders.channel)
      .orderBy(orders.channel);

    const channelRows = channelBreakdown
      .map(
        (ch) =>
          `<tr>
          <td>${escapeHtml(ch.channel)}</td>
          <td style="text-align:right;">${ch.count}</td>
          <td style="text-align:right;">${formatRupiah(ch.totalAmount)}</td>
          <td style="text-align:right;">${(summary.totalSales > 0 ? ((ch.totalAmount / summary.totalSales) * 100).toFixed(1) : "0.0")}%</td>
        </tr>`,
      )
      .join("\n");

    const periodLabel =
      data.dateFrom || data.dateTo
        ? `${data.dateFrom ?? "-"} s.d. ${data.dateTo ?? "-"}`
        : "Semua Periode";

    const gpClass = summary.grossProfit >= 0 ? "green" : "red";
    const gpSign = summary.grossProfit >= 0 ? "" : "-";

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
  <div class="subtitle">Omoiyari POS — ${escapeHtml(periodLabel)}</div>
</div>

<div class="cards">
  <div class="card">
    <div class="card-label">Total Penjualan</div>
    <div class="card-value green">${formatRupiah(summary.totalSales)}</div>
  </div>
  <div class="card">
    <div class="card-label">HPP</div>
    <div class="card-value red">${formatRupiah(summary.totalCogs)}</div>
  </div>
  <div class="card">
    <div class="card-label">Net Sales</div>
    <div class="card-value green">${formatRupiah(summary.netSales)}</div>
  </div>
  <div class="card">
    <div class="card-label">Gross Profit</div>
    <div class="card-value ${gpClass}">${gpSign}${formatRupiah(Math.abs(summary.grossProfit))}</div>
  </div>
</div>

<div class="section-title">Total Pesanan: ${summary.orderCount}</div>

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
  <tr><td class="label">Total Penjualan</td><td class="value">${formatRupiah(summary.totalSales)}</td></tr>
  <tr><td class="label">Diskon Merchant</td><td class="value">${formatRupiah(summary.totalMerchantDiscount)}</td></tr>
  <tr><td class="label">HPP</td><td class="value">${formatRupiah(summary.totalCogs)}</td></tr>
  <tr><td class="label">MDR</td><td class="value">${formatRupiah(summary.totalMdr)}</td></tr>
  <tr><td class="label">Pendapatan Manual</td><td class="value">${formatRupiah(summary.manualRevenue)}</td></tr>
  <tr><td class="label" style="color: ${gpClass};">Gross Profit</td><td class="value" style="color: ${gpClass};">${gpSign}${formatRupiah(Math.abs(summary.grossProfit))}</td></tr>
</table>

<div class="footer">Dicetak dari Omoiyari POS — ${new Date().toLocaleDateString("id-ID")}</div>
<script>window.print();window.close();</script>
</body></html>`;

    return { html };
  });

function formatRupiah(v: number): string {
  return `Rp${Math.abs(v).toLocaleString("id-ID")}`;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
