import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import { usePageTitle } from "#/hooks/usePageTitle";
import { useAuth } from "#/lib/auth-context";
import { getDashboardData } from "#/lib/server/dashboard";
import { Skeleton } from "#/components/ui/skeleton";
import { StatsCards } from "#/components/dashboard/StatsCards";
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

  const { data, isLoading, dataUpdatedAt } = useQuery({
    queryKey: ["dashboard-data"],
    queryFn: async () => {
      const result = await getDashboardData();
      return result;
    },
    refetchInterval: 60000,
  });

  if (isLoading || !data) {
    return (
      <RoleGuard allowedRoles={["super_admin", "admin_pusat", "area_manager"]}>
        <div className="space-y-6">
          {/* Stats skeletons */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-lg border p-4 space-y-3">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-8 w-32" />
              </div>
            ))}
          </div>
          {/* Chart skeletons */}
          <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-2">
            <div className="rounded-lg border p-4 space-y-3">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-48 w-full" />
            </div>
            <div className="rounded-lg border p-4 space-y-3">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-48 w-full" />
            </div>
          </div>
          {/* Table skeleton */}
          <div className="rounded-lg border p-4 space-y-3">
            <Skeleton className="h-4 w-40" />
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
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

  const isSuperAdmin = user?.role === "super_admin";

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

  // Anomaly detection
  const anomalies: { type: string; message: string; severity: "error" | "warning"; detail?: string[] }[] = [];
  if (voidCount > todayOrders.length * 0.1 && todayOrders.length > 5) {
    anomalies.push({
      type: "Void Anomaly",
      message: `Tingkat pembatalan tinggi (${voidCount} pesanan)`,
      severity: "warning",
    });
  }
  const lowStock = inventory.filter((i) => i.quantity < 100);
  const lowStockItems = lowStock
    .map((i) => {
      const ing = ingredients.find((ig) => ig.id === i.ingredientId);
      return { ...i, ingredientName: ing?.name ?? i.ingredientId, rop: ing?.rop ?? 0 };
    })
    .sort((a, b) => a.quantity - b.quantity)
    .slice(0, 10);
  if (lowStock.length > 0) {
    anomalies.push({
      type: "Stock Alert",
      message: `${lowStock.length} bahan baku di bawah batas aman`,
      severity: "error",
      detail: lowStockItems.map(
        (item) => `${item.ingredientName}: ${item.quantity} (ROP: ${item.rop})`,
      ),
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
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">Dashboard</h1>
            <p className="text-sm text-muted-foreground">Analitik & ikhtisar</p>
          </div>
          {dataUpdatedAt && (
            <p className="text-xs text-muted-foreground">
              Terakhir diperbarui:{" "}
              {new Date(dataUpdatedAt).toLocaleString("id-ID", {
                day: "2-digit",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          )}
        </div>

        {/* 2. Stats Cards */}
        <StatsCards
          totalSales={totalSales}
          completedCount={completedCount}
          voidCount={voidCount}
          anomalies={anomalies}
        />

        {/* 3. COGS Analysis (super_admin only) */}
        {isSuperAdmin && <CogsAnalysisTable data={cogsData} />}

        {/* 4. Charts Row 1 */}
        <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-2">
          <SalesTrendChart data={salesTrend} />
          <ChannelPieChart data={channelData} />
        </div>

        {/* 5. Charts Row 2 (super_admin only) */}
        {isSuperAdmin && (
          <>
            <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-2">
              <SalesByBranchChart data={salesByBranch} />
              <BrandPerformanceChart data={salesByBrand} />
            </div>

            {/* 6. HPP + Discrepancy + Waste Row */}
            <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-3">
              <HppAlertCards data={hppAlerts} />
              <div className="lg:col-span-2">
                <DiscrepancyTable data={discrepancies} />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-2">
              <WasteLossTable data={wasteLoss} />
            </div>
          </>
        )}

        {/* 6. Order History */}
        <OrderHistoryTable
          orders={ordersWithItems}
          recipes={recipes}
          branches={branches}
          showBranch={isSuperAdmin}
        />
      </div>
    </RoleGuard>
  );
}
