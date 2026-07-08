import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import { usePageTitle } from "#/hooks/usePageTitle";
import { useAuth } from "#/lib/auth-context";
import { getDashboardData } from "#/lib/server/dashboard";
import { Skeleton } from "#/components/ui/skeleton";
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

export const Route = createFileRoute("/_layout/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  const { user } = useAuth();
  usePageTitle("Dashboard", "Analitik & ikhtisar");

  const isSuperAdmin = user?.role === "super_admin";

  const { data, isLoading, dataUpdatedAt, error } = useQuery({
    queryKey: ["dashboard-data"],
    queryFn: async () => {
      const result = await getDashboardData();
      return result;
    },
    refetchInterval: 60000,
    retry: 1,
  });

  const [activeTab, setActiveTab] = React.useState(() => {
    try {
      const stored = localStorage.getItem("dashboard-tab");
      if (stored && ["ringkasan", "operasional", "keuangan", "inventaris"].includes(stored)) {
        if ((stored === "keuangan" || stored === "inventaris") && !isSuperAdmin) return "ringkasan";
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

  if (isLoading || !data) {
    return (
      <RoleGuard allowedRoles={["super_admin", "admin_pusat", "area_manager"]}>
        <DashboardSkeleton />
      </RoleGuard>
    );
  }

  if (error) {
    return (
      <RoleGuard allowedRoles={["super_admin", "admin_pusat", "area_manager"]}>
        <div className="flex h-64 items-center justify-center">
          <div className="text-center">
            <p className="text-destructive font-medium">Gagal memuat dashboard</p>
            <p className="text-sm text-muted-foreground mt-1">{error.message}</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm"
            >
              Muat Ulang
            </button>
          </div>
        </div>
      </RoleGuard>
    );
  }

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
  const lowStockItems: UnsafeStockItem[] = inventory
    .filter((i) => i.quantity < 100)
    .map((i) => {
      const ing = ingredients.find((ig) => ig.id === i.ingredientId);
      return {
        ingredientId: i.ingredientId,
        ingredientName: ing?.name ?? i.ingredientId,
        quantity: i.quantity,
        rop: ing?.rop ?? 0,
        stockUnit: ing?.stockUnit,
      };
    })
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

// ─── Loading skeleton — tab bar + generic content area ───
function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      {/* Tab bar skeleton */}
      <div className="inline-flex h-10 items-center gap-1 rounded-lg border bg-muted p-1">
        {["ringkasan", "operasional"].map((id) => (
          <div key={id} className="rounded-md px-3 py-1.5">
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-1 gap-4 md:gap-6 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-lg border bg-card p-6 shadow-sm space-y-3">
            <Skeleton className="h-5 w-5" />
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-7 w-32" />
          </div>
        ))}
      </div>

      {/* Charts placeholder (2-col) */}
      <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-lg border bg-card p-4 shadow-sm space-y-3">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-64 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
