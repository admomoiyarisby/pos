import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import { usePageTitle } from "#/hooks/usePageTitle";
import { useAuth } from "#/lib/auth-context";
import { getDashboardData } from "#/lib/server/dashboard";
import type { DashboardFilter } from "#/lib/dashboard-filter";
import { currentDateValue, currentMonthValue, lastDayOfMonth } from "#/lib/report-period";
import { toDateInputValue } from "#/lib/utils";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "#/components/ui/tabs";
import { StatsCards } from "#/components/dashboard/StatsCards";
import { AnomalyAlerts, type Anomaly } from "#/components/dashboard/AnomalyAlerts";
import { UnsafeStockTable, type UnsafeStockItem } from "#/components/dashboard/UnsafeStockTable";
import { CogsAnalysisTable, computeCogsData } from "#/components/dashboard/CogsAnalysisTable";
import {
  SalesTrendChart,
  ChannelPieChart,
  SalesByBranchChart,
  BrandPerformanceChart,
  computeSalesTrend,
  computeChannelData,
  computeSalesByBranch,
  computeSalesByBrand,
} from "#/components/dashboard/Charts";
import { HppAlertCards, computeHppAlerts } from "#/components/dashboard/HppAlertCards";
import { DiscrepancyTable, computeDiscrepancies } from "#/components/dashboard/DiscrepancyTable";
import { WasteLossTable, computeWasteLoss } from "#/components/dashboard/WasteLossTable";
import { OrderHistoryTable } from "#/components/dashboard/OrderHistoryTable";
import { ProductionTrackingSection } from "#/components/dashboard/ProductionTracking";
import { WasteBreakdownSection } from "#/components/dashboard/WasteBreakdown";

export const Route = createFileRoute("/_layout/dashboard")({
  component: DashboardPage,
});

type DashboardPeriod = "bulan-ini" | "bulan-lalu" | "30-hari" | "semua" | "custom";

interface DateRange {
  from: string;
  to: string;
}

const PERIOD_OPTIONS: { value: DashboardPeriod; label: string }[] = [
  { value: "bulan-ini", label: "Bulan ini" },
  { value: "bulan-lalu", label: "Bulan lalu" },
  { value: "30-hari", label: "30 hari terakhir" },
  { value: "semua", label: "Semua waktu" },
  { value: "custom", label: "Rentang khusus" },
];

/** Jakarta calendar month as an inclusive `YYYY-MM-DD` range. */
function monthRange(monthOffset: number, now = new Date()): DateRange {
  const [year, month] = currentMonthValue(now).split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + monthOffset, 1));
  const targetYear = target.getUTCFullYear();
  const targetMonth = target.getUTCMonth() + 1;
  const ym = `${targetYear}-${String(targetMonth).padStart(2, "0")}`;
  const lastDay = lastDayOfMonth(targetYear, targetMonth);
  return {
    from: `${ym}-01`,
    to: `${ym}-${String(lastDay).padStart(2, "0")}`,
  };
}

/** Inclusive rolling 30-day window ending today (Jakarta). */
function thirtyDayRange(now = new Date()): DateRange {
  return {
    from: toDateInputValue(new Date(now.getTime() - 29 * 86400000)),
    to: currentDateValue(now),
  };
}

function presetRange(
  period: Exclude<DashboardPeriod, "custom" | "semua">,
  now = new Date(),
): DateRange {
  switch (period) {
    case "bulan-ini":
      return monthRange(0, now);
    case "bulan-lalu":
      return monthRange(-1, now);
    case "30-hari":
      return thirtyDayRange(now);
  }
}

function DashboardPage() {
  const { user } = useAuth();
  usePageTitle("Dashboard", "Analitik & ikhtisar");

  const isSuperAdmin = user?.role === "super_admin";

  const { data, isLoading, error } = useQuery({
    queryKey: ["dashboard-data"],
    queryFn: () => getDashboardData(),
    retry: 1,
    refetchInterval: 60_000,
  });

  const dataUpdatedAt = data ? Date.now() : null;

  const [activeTab, setActiveTab] = React.useState(() => {
    try {
      const stored = localStorage.getItem("dashboard-tab");
      if (
        stored &&
        ["ringkasan", "operasional", "produksi-waste", "keuangan", "inventaris"].includes(stored)
      ) {
        if (
          (stored === "keuangan" || stored === "inventaris" || stored === "produksi-waste") &&
          !isSuperAdmin
        ) {
          return "ringkasan";
        }
        return stored;
      }
    } catch {}
    return "ringkasan";
  });

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    try {
      localStorage.setItem("dashboard-tab", value);
    } catch {}
  };

  const [productionWastePeriod, setProductionWastePeriod] =
    React.useState<DashboardPeriod>("bulan-ini");
  const [productionWasteRange, setProductionWasteRange] = React.useState<DateRange>(() =>
    monthRange(0),
  );
  const [productionWasteBranchId, setProductionWasteBranchId] = React.useState("");

  const productionWasteFilter: DashboardFilter = React.useMemo(
    () => ({
      from: productionWasteRange.from || undefined,
      to: productionWasteRange.to || undefined,
      branchId: productionWasteBranchId || undefined,
    }),
    [productionWasteRange, productionWasteBranchId],
  );

  const handlePeriodChange = (value: string) => {
    const next = PERIOD_OPTIONS.find((option) => option.value === value)?.value;
    if (!next) return;

    setProductionWastePeriod(next);
    if (next === "semua") {
      setProductionWasteRange({ from: "", to: "" });
      return;
    }
    if (next === "custom") return;
    setProductionWasteRange(presetRange(next));
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    // SAFETY: React Query surfaces server-function rejections here; the only
    // shape with a string `message` field is an Error-like, so reading it via
    // a structured check (no typeof narrowing beyond Error itself) is sound.
    const message = error instanceof Error ? error.message : null;
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 px-4 text-center">
        <p className="text-muted-foreground">Gagal memuat data dashboard</p>
        {message && (
          <p className="max-w-2xl font-mono text-xs text-destructive" role="alert">
            {message}
          </p>
        )}
      </div>
    );
  }

  // Loader data is always available — no loading/error states needed
  const {
    orders,
    orderItems,
    inventory,
    recipes,
    ingredients,
    branches,
    brands,
    platformFees,
    stockOpnames,
    wasteEntries,
    manualRevenues,
    production,
  } = data;

  // Hydrate orders with items
  const ordersWithItems = orders.map((o) => ({
    ...o,
    items: orderItems.filter((oi) => oi.orderId === o.id),
  }));

  // ─── Stats ───
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayOrders = ordersWithItems.filter((o) => new Date(o.createdAt) >= today);
  const todayManual = manualRevenues?.filter((mr) => new Date(mr.date) >= today) ?? [];

  const totalSales =
    todayOrders.reduce((acc, o) => acc + o.totalAmount, 0) +
    todayManual.reduce((acc, mr) => acc + mr.amount, 0);
  const completedCount =
    todayOrders.filter((o) => o.status === "Completed").length + todayManual.length;
  const voidCount = todayOrders.filter((o) => o.status === "Void").length;

  // ─── Anomalies (no per-item detail anymore — the Unsafe Stock table is the source of truth) ───
  const anomalies: Anomaly[] = [];
  if (voidCount > todayOrders.length * 0.1 && todayOrders.length > 5) {
    anomalies.push({
      type: "Void Anomaly",
      message: `Tingkat pembatalan tinggi (${voidCount} pesanan)`,
      severity: "warning",
    });
  }
  // Aggregate per ingredient. The dashboard inventory spans branches, so the
  // same ingredientId can appear once per branch, but UnsafeStockItem is
  // ingredient-level (no branch column). Collapse to one row per ingredient
  // using the worst-case (lowest) stock so the ingredientId React keys stay
  // unique and the table reflects where each item is most at risk.
  const byIngredient = new Map<string, UnsafeStockItem>();
  for (const i of inventory) {
    if (i.quantity >= 100) continue;
    const existing = byIngredient.get(i.ingredientId);
    if (existing) {
      existing.quantity = Math.min(existing.quantity, i.quantity);
      continue;
    }
    const ing = ingredients.find((ig) => ig.id === i.ingredientId);
    byIngredient.set(i.ingredientId, {
      ingredientId: i.ingredientId,
      ingredientName: ing?.name ?? i.ingredientId,
      quantity: i.quantity,
      rop: ing?.rop ?? 0,
      stockUnit: ing?.stockUnit,
    });
  }
  const lowStockItems: UnsafeStockItem[] = [...byIngredient.values()]
    .sort((a, b) => a.quantity - b.quantity)
    .slice(0, 10);
  if (lowStockItems.length > 0) {
    anomalies.push({
      type: "Stock Alert",
      message: `${lowStockItems.length} bahan baku di bawah batas aman`,
      severity: "error",
    });
  }

  // ─── COGS ───
  const cogsData = computeCogsData(recipes, ingredients);

  // ─── Charts ───
  const salesTrend = computeSalesTrend(ordersWithItems);
  const channelData = computeChannelData(
    ordersWithItems,
    platformFees.map((pf) => pf.channel),
  );
  const salesByBranch = isSuperAdmin
    ? computeSalesByBranch(ordersWithItems, branches, manualRevenues ?? [])
    : [];
  const salesByBrand = isSuperAdmin
    ? computeSalesByBrand(ordersWithItems, brands, manualRevenues ?? [])
    : [];

  // ─── HPP Alerts ───
  const hppAlerts = computeHppAlerts(recipes, ingredients);

  // ─── Discrepancies ───
  const discrepancies = computeDiscrepancies(stockOpnames, ingredients, branches);

  // ─── Waste Loss ───
  const wasteLoss = computeWasteLoss(wasteEntries, ingredients);

  return (
    <RoleGuard allowedRoles={["super_admin", "admin_pusat", "area_manager"]}>
      <div className="space-y-6">
        {dataUpdatedAt && (
          <div className="flex items-center justify-end">
            <p className="text-xs text-muted-foreground">
              Terakhir diperbarui:{" "}
              {new Date(dataUpdatedAt).toLocaleString("id-ID", {
                timeZone: "Asia/Jakarta",
                day: "2-digit",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          </div>
        )}

        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <TabsList>
            <TabsTrigger value="ringkasan">Ringkasan</TabsTrigger>
            <TabsTrigger value="operasional">Operasional</TabsTrigger>
            {isSuperAdmin && <TabsTrigger value="produksi-waste">Produksi & Waste</TabsTrigger>}
            {isSuperAdmin && <TabsTrigger value="keuangan">Keuangan</TabsTrigger>}
            {isSuperAdmin && <TabsTrigger value="inventaris">Inventaris</TabsTrigger>}
          </TabsList>

          {/* ─── Ringkasan (Overview) ─── */}
          <TabsContent value="ringkasan">
            <div className="space-y-6">
              <StatsCards
                totalSales={totalSales}
                completedCount={completedCount}
                voidCount={voidCount}
              />
              <AnomalyAlerts anomalies={anomalies} />
              <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-2">
                <SalesTrendChart data={salesTrend} />
                <ChannelPieChart data={channelData} />
              </div>
            </div>
          </TabsContent>

          {/* ─── Operasional (Operations) ─── */}
          <TabsContent value="operasional">
            <div className="space-y-6">
              {lowStockItems.length > 0 && <UnsafeStockTable data={lowStockItems} />}
              <OrderHistoryTable
                orders={ordersWithItems}
                recipes={recipes}
                branches={branches}
                showBranch={isSuperAdmin}
              />
            </div>
          </TabsContent>

          {/* ─── Produksi & Waste — super_admin only ─── */}
          {isSuperAdmin && (
            <TabsContent value="produksi-waste">
              <div className="space-y-8">
                <div className="rounded-lg border bg-card p-3 shadow-sm md:p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
                    <div className="w-full space-y-1 sm:w-44">
                      <label
                        htmlFor="produksi-waste-period"
                        className="text-xs font-medium text-muted-foreground"
                      >
                        Periode
                      </label>
                      <select
                        id="produksi-waste-period"
                        value={productionWastePeriod}
                        onChange={(e) => handlePeriodChange(e.target.value)}
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm sm:h-9"
                      >
                        {PERIOD_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="grid flex-1 grid-cols-2 gap-2 sm:flex-none">
                      <div className="space-y-1">
                        <label
                          htmlFor="produksi-waste-from"
                          className="text-xs font-medium text-muted-foreground"
                        >
                          Dari
                        </label>
                        <input
                          id="produksi-waste-from"
                          type="date"
                          value={productionWasteRange.from}
                          onChange={(e) => {
                            setProductionWastePeriod("custom");
                            setProductionWasteRange((prev) => ({ ...prev, from: e.target.value }));
                          }}
                          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm sm:h-9 sm:w-36"
                        />
                      </div>
                      <div className="space-y-1">
                        <label
                          htmlFor="produksi-waste-to"
                          className="text-xs font-medium text-muted-foreground"
                        >
                          Sampai
                        </label>
                        <input
                          id="produksi-waste-to"
                          type="date"
                          value={productionWasteRange.to}
                          onChange={(e) => {
                            setProductionWastePeriod("custom");
                            setProductionWasteRange((prev) => ({ ...prev, to: e.target.value }));
                          }}
                          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm sm:h-9 sm:w-36"
                        />
                      </div>
                    </div>

                    <div className="w-full space-y-1 sm:w-56">
                      <label
                        htmlFor="produksi-waste-branch"
                        className="text-xs font-medium text-muted-foreground"
                      >
                        Cabang
                      </label>
                      <select
                        id="produksi-waste-branch"
                        value={productionWasteBranchId}
                        onChange={(e) => setProductionWasteBranchId(e.target.value)}
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm sm:h-9"
                      >
                        <option value="">Semua Cabang</option>
                        {branches.map((branch) => (
                          <option key={branch.id} value={branch.id}>
                            {branch.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <p className="text-xs text-muted-foreground sm:ml-auto sm:pb-2">
                      {productionWastePeriod === "semua"
                        ? "Semua waktu"
                        : `${productionWasteRange.from || "…"} — ${productionWasteRange.to || "…"}`}
                    </p>
                  </div>
                </div>

                <ProductionTrackingSection records={production} filter={productionWasteFilter} />
                <WasteBreakdownSection entries={wasteEntries} filter={productionWasteFilter} />
              </div>
            </TabsContent>
          )}

          {/* ─── Keuangan (Financials) — super_admin only ─── */}
          {isSuperAdmin && (
            <TabsContent value="keuangan">
              <div className="space-y-6">
                <CogsAnalysisTable data={cogsData} />
                <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-2">
                  <SalesByBranchChart data={salesByBranch} />
                  <BrandPerformanceChart data={salesByBrand} />
                </div>
                <HppAlertCards data={hppAlerts} />
              </div>
            </TabsContent>
          )}

          {/* ─── Inventaris (Inventory) — super_admin only ─── */}
          {isSuperAdmin && (
            <TabsContent value="inventaris">
              <div className="space-y-6">
                <DiscrepancyTable data={discrepancies} />
                <WasteLossTable data={wasteLoss} />
              </div>
            </TabsContent>
          )}
        </Tabs>
      </div>
    </RoleGuard>
  );
}
