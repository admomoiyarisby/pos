import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import { usePageTitle } from "#/hooks/usePageTitle";
import { useAuth } from "#/lib/auth-context";
import { getDashboardDetails, getDashboardOverview } from "#/lib/server/dashboard";
import type { DashboardOverview } from "#/lib/server/dashboard";
import { dashboardSearchSchema, resolveDashboardSearch, shiftIsoDay } from "#/lib/dashboard-range";
import type { DashboardPeriod, DashboardSearch } from "#/lib/dashboard-range";
import type { DashboardFilter } from "#/lib/dashboard-filter";
import type { UnknownRecord } from "#/lib/unknown-record";
import { toDateInputValue } from "#/lib/utils";
import { channelLabel } from "#/lib/order-channels";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "#/components/ui/tabs";
import { StatsCards } from "#/components/dashboard/StatsCards";
import { AnomalyAlerts, type Anomaly } from "#/components/dashboard/AnomalyAlerts";
import { UnsafeStockTable } from "#/components/dashboard/UnsafeStockTable";
import { CogsAnalysisTable, computeCogsData } from "#/components/dashboard/CogsAnalysisTable";
import {
  SalesTrendChart,
  ChannelPieChart,
  SalesByBranchChart,
  BrandPerformanceChart,
} from "#/components/dashboard/Charts";
import { HppAlertCards, computeHppAlerts } from "#/components/dashboard/HppAlertCards";
import { DiscrepancyTable, computeDiscrepancies } from "#/components/dashboard/DiscrepancyTable";
import { WasteLossTable, computeWasteLoss } from "#/components/dashboard/WasteLossTable";
import { OrderHistoryTable } from "#/components/dashboard/OrderHistoryTable";
import { ProductionTrackingSection } from "#/components/dashboard/ProductionTracking";
import { WasteBreakdownSection } from "#/components/dashboard/WasteBreakdown";
import DashboardFilterBar from "#/components/dashboard/DashboardFilterBar";

export const Route = createFileRoute("/_layout/dashboard")({
  validateSearch: (search: UnknownRecord) => dashboardSearchSchema.parse(search),
  component: DashboardPage,
});

const DASHBOARD_TABS = ["ringkasan", "operasional", "produksi-waste", "keuangan", "inventaris"];

function DashboardPage() {
  const { user } = useAuth();
  usePageTitle("Dashboard", "Analitik & ikhtisar");

  const isSuperAdmin = user?.role === "super_admin";
  const navigate = Route.useNavigate();
  const search = Route.useSearch();
  const range = React.useMemo(() => resolveDashboardSearch(search), [search]);
  const branchId = search.branch;

  const [activeTab, setActiveTab] = React.useState(function () {
    try {
      const stored = localStorage.getItem("dashboard-tab");
      if (stored && DASHBOARD_TABS.includes(stored)) {
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

  const needsDetails = activeTab !== "ringkasan";
  const queryKey = [range.from ?? "all", range.to ?? "all", branchId ?? "all"];

  const overviewQuery = useQuery({
    queryKey: ["dashboard-overview", ...queryKey],
    queryFn: () =>
      getDashboardOverview({
        data: { from: range.from, to: range.to, branchId },
      }),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
    retry: 1,
  });

  const detailsQuery = useQuery({
    queryKey: ["dashboard-details", ...queryKey],
    queryFn: () =>
      getDashboardDetails({
        data: { from: range.from, to: range.to, branchId },
      }),
    enabled: needsDetails,
    placeholderData: keepPreviousData,
    retry: 1,
  });

  // Merge URL patches into the existing search, dropping keys that return to
  // their default so a clean filter produces a clean URL.
  const updateSearch = React.useCallback(
    function (patch: Partial<DashboardSearch>) {
      void navigate({
        search: function (prev) {
          const next: DashboardSearch = { ...prev, ...patch };
          // Clean URLs: drop keys that returned to their default.
          if (!next.period) delete next.period;
          if (!next.from) delete next.from;
          if (!next.to) delete next.to;
          if (!next.branch) delete next.branch;
          return next;
        },
        replace: true,
      });
    },
    [navigate],
  );

  function handleTabChange(value: string) {
    setActiveTab(value);
    try {
      localStorage.setItem("dashboard-tab", value);
    } catch {}
  }

  function handlePeriodChange(period: DashboardPeriod) {
    if (period === "custom") {
      updateSearch({ period: "custom", from: range.from, to: range.to });
      return;
    }
    // Presets are derived; keeping stale custom ends in the URL would fight
    // the preset's resolved range.
    updateSearch({ period, from: undefined, to: undefined });
  }

  function handleFromChange(from: string) {
    if (!from) {
      updateSearch({ period: "custom", from: undefined });
      return;
    }
    const to = range.to ?? toDateInputValue(new Date());
    updateSearch({ period: "custom", from, to: from > to ? from : to });
  }

  function handleToChange(to: string) {
    if (!to) {
      updateSearch({ period: "custom", to: undefined });
      return;
    }
    const from = range.from ?? shiftIsoDay(to, -29);
    updateSearch({ period: "custom", from: to < from ? to : from, to });
  }

  function handleBranchChange(nextBranch: string) {
    updateSearch({ branch: nextBranch || undefined });
  }

  function handleRefresh() {
    void overviewQuery.refetch();
    if (needsDetails) void detailsQuery.refetch();
  }

  if (overviewQuery.isPending) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="h-24 animate-pulse rounded-lg bg-muted" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map(function (_, i) {
            return <div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />;
          })}
        </div>
      </div>
    );
  }

  if (overviewQuery.isError || !overviewQuery.data) {
    return <DashboardError message={overviewQuery.error} onRetry={handleRefresh} />;
  }

  const overview: DashboardOverview = overviewQuery.data;
  const details = detailsQuery.data;
  const dataUpdatedAt = overviewQuery.dataUpdatedAt;

  const isBranchAdmin = user?.role === "branch_admin";
  const showBranchFilter = !isBranchAdmin && overview.branches.length > 0;

  // ─── Anomalies (range-scoped except stock, which is a current-state read) ───
  const totalOrders = overview.stats.orderCount + overview.stats.voidCount;
  const anomalies: Anomaly[] = [];
  if (overview.stats.voidCount > totalOrders * 0.1 && totalOrders > 5) {
    anomalies.push({
      type: "Void Anomaly",
      message: `Tingkat pembatalan tinggi (${overview.stats.voidCount} pesanan)`,
      severity: "warning",
    });
  }
  if (overview.lowStock.length > 0) {
    anomalies.push({
      type: "Stock Alert",
      message: `${overview.lowStock.length} bahan baku di bawah batas aman`,
      severity: "error",
    });
  }

  // ─── Chart inputs (already aggregated by the server over the full range) ───
  const salesTrend = overview.salesTrend.map(function (point) {
    return { name: point.label, sales: point.revenue / 1000 };
  });
  const channelData = [...overview.channelData]
    .sort(function (a, b) {
      return b.count - a.count;
    })
    .map(function (row) {
      return { name: channelLabel(row.channel), value: row.count };
    });
  const salesByBranch = overview.branchSales;
  const salesByBrand = overview.brandSales;

  // ─── Tab row sets ───
  // Plain computation, not a hook: this sits after the loading/error early
  // returns, and a hook here would change the hook order between renders.
  const itemsByOrder = new Map<string, { recipeId: string; quantity: number }[]>();
  for (const item of details?.orderItems ?? []) {
    const list = itemsByOrder.get(item.orderId) ?? [];
    list.push({ recipeId: item.recipeId, quantity: item.quantity });
    itemsByOrder.set(item.orderId, list);
  }

  const ordersWithItems = (details?.orders ?? []).map(function (order) {
    return {
      ...order,
      items: itemsByOrder.get(order.id) ?? [],
    };
  });

  const cogsData = details ? computeCogsData(details.recipes, details.ingredients) : [];
  const hppAlerts = details ? computeHppAlerts(details.recipes, details.ingredients) : [];
  const discrepancies = details
    ? computeDiscrepancies(details.stockOpnames, details.ingredients, overview.branches)
    : [];
  const wasteLoss = details ? computeWasteLoss(details.wasteEntries, details.ingredients) : [];

  const productionWasteFilter: DashboardFilter = {
    from: range.from,
    to: range.to,
    branchId,
  };

  return (
    <RoleGuard allowedRoles={["super_admin", "admin_pusat", "area_manager", "auditor"]}>
      <div className="space-y-6">
        <DashboardFilterBar
          period={range.period}
          from={range.from}
          to={range.to}
          branchId={branchId}
          branches={overview.branches}
          showBranchFilter={showBranchFilter}
          dateLabel={range.dateLabel}
          isFetching={overviewQuery.isFetching || detailsQuery.isFetching}
          onPeriodChange={handlePeriodChange}
          onFromChange={handleFromChange}
          onToChange={handleToChange}
          onBranchChange={handleBranchChange}
          onRefresh={handleRefresh}
        />

        {dataUpdatedAt > 0 && (
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
          <div className="overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <TabsList className="w-max">
              <TabsTrigger value="ringkasan">Ringkasan</TabsTrigger>
              <TabsTrigger value="operasional">Operasional</TabsTrigger>
              {isSuperAdmin && <TabsTrigger value="produksi-waste">Produksi & Waste</TabsTrigger>}
              {isSuperAdmin && <TabsTrigger value="keuangan">Keuangan</TabsTrigger>}
              {isSuperAdmin && <TabsTrigger value="inventaris">Inventaris</TabsTrigger>}
            </TabsList>
          </div>

          {/* ─── Ringkasan (Overview) ─── */}
          <TabsContent value="ringkasan">
            <div className="space-y-6">
              <StatsCards
                totalSales={overview.stats.totalSales}
                completedCount={overview.stats.completedCount}
                voidCount={overview.stats.voidCount}
                salesLabel={range.period === "today" ? "Penjualan Hari Ini" : "Penjualan"}
              />
              <AnomalyAlerts anomalies={anomalies} />
              <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-2">
                <SalesTrendChart data={salesTrend} rangeLabel={range.dateLabel} />
                <ChannelPieChart data={channelData} rangeLabel={range.dateLabel} />
              </div>
            </div>
          </TabsContent>

          {/* ─── Operasional (Operations) ─── */}
          <TabsContent value="operasional">
            <div className="space-y-6">
              {detailsQuery.isError ? (
                <DashboardError message={detailsQuery.error} onRetry={handleRefresh} />
              ) : !details ? (
                <TabSkeleton />
              ) : (
                <>
                  {overview.lowStock.length > 0 && <UnsafeStockTable data={overview.lowStock} />}
                  <OrderHistoryTable
                    orders={ordersWithItems}
                    recipes={details.recipes}
                    branches={overview.branches}
                    showBranch={overview.branches.length > 1}
                  />
                </>
              )}
            </div>
          </TabsContent>

          {/* ─── Produksi & Waste — super_admin only ─── */}
          {isSuperAdmin && (
            <TabsContent value="produksi-waste">
              <div className="space-y-8">
                <p className="text-sm text-muted-foreground">
                  Menampilkan produksi dan waste pada {range.dateLabel}.
                  {branchId
                    ? ` Cabang: ${overview.branches.find((b) => b.id === branchId)?.name ?? "—"}.`
                    : " Semua cabang."}
                </p>
                {detailsQuery.isError ? (
                  <DashboardError message={detailsQuery.error} onRetry={handleRefresh} />
                ) : !details ? (
                  <TabSkeleton />
                ) : (
                  <>
                    {(details.truncated.production || details.truncated.waste) && (
                      <p className="text-xs text-muted-foreground">
                        Sebagian catatan dibatasi ke 500 baris terbaru pada rentang ini. Persempit
                        tanggal untuk melihat sisanya.
                      </p>
                    )}
                    <ProductionTrackingSection
                      records={details.production}
                      filter={productionWasteFilter}
                    />
                    <WasteBreakdownSection
                      entries={details.wasteEntries}
                      filter={productionWasteFilter}
                    />
                  </>
                )}
              </div>
            </TabsContent>
          )}

          {/* ─── Keuangan (Financials) — super_admin only ─── */}
          {isSuperAdmin && (
            <TabsContent value="keuangan">
              {detailsQuery.isError ? (
                <DashboardError message={detailsQuery.error} onRetry={handleRefresh} />
              ) : !details ? (
                <TabSkeleton />
              ) : (
                <div className="space-y-6">
                  <p className="text-xs text-muted-foreground">
                    COGS dan HPP memakai resep serta biaya bahan saat ini; chart penjualan mengikuti{" "}
                    {range.dateLabel}.
                  </p>
                  <CogsAnalysisTable data={cogsData} />
                  <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-2">
                    <SalesByBranchChart data={salesByBranch} rangeLabel={range.dateLabel} />
                    <BrandPerformanceChart data={salesByBrand} rangeLabel={range.dateLabel} />
                  </div>
                  <HppAlertCards data={hppAlerts} />
                </div>
              )}
            </TabsContent>
          )}

          {/* ─── Inventaris (Inventory) — super_admin only ─── */}
          {isSuperAdmin && (
            <TabsContent value="inventaris">
              {detailsQuery.isError ? (
                <DashboardError message={detailsQuery.error} onRetry={handleRefresh} />
              ) : !details ? (
                <TabSkeleton />
              ) : (
                <div className="space-y-6">
                  {details.truncated.stockOpnames && (
                    <p className="text-xs text-muted-foreground">
                      Menampilkan 200 stock opname terbaru pada rentang ini.
                    </p>
                  )}
                  <DiscrepancyTable data={discrepancies} />
                  <WasteLossTable data={wasteLoss} />
                </div>
              )}
            </TabsContent>
          )}
        </Tabs>
      </div>
    </RoleGuard>
  );
}

function DashboardError({ message, onRetry }: { message: Error | null; onRetry: () => void }) {
  const text = message instanceof Error ? message.message : null;
  return (
    <div className="flex h-64 flex-col items-center justify-center gap-3 px-4 text-center">
      <p className="text-muted-foreground">Gagal memuat data dashboard</p>
      {text && (
        <p className="max-w-2xl font-mono text-xs text-destructive" role="alert">
          {text}
        </p>
      )}
      <button
        type="button"
        onClick={onRetry}
        className="h-9 rounded-md border px-4 text-sm font-medium hover:bg-muted"
      >
        Coba lagi
      </button>
    </div>
  );
}

function TabSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-28 animate-pulse rounded-lg bg-muted" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="h-64 animate-pulse rounded-lg bg-muted" />
        <div className="h-64 animate-pulse rounded-lg bg-muted" />
      </div>
    </div>
  );
}
