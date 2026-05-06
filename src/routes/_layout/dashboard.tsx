import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import { usePageTitle } from "#/hooks/usePageTitle";
import { useAuth } from "#/lib/auth-context";
import { getDashboardData } from "#/lib/server/dashboard";
import { Skeleton } from "#/components/ui/skeleton";
import { StatsCards } from "#/components/dashboard/StatsCards";
import { CogsAnalysisTable, computeCogsData } from "#/components/dashboard/CogsAnalysisTable";
import { RopRoqTable, computeRopData } from "#/components/dashboard/RopRoqTable";
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
  usePageTitle("Dashboard", "Analytics & overview");

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard-data"],
    queryFn: async () => {
      const result = await getDashboardData();
      return result;
    },
    refetchInterval: 60000,
  });

  if (isLoading || !data) {
    return (
      <RoleGuard allowedRoles={["super_admin", "admin_pusat", "area_manager", "branch_admin"]}>
        <div className="space-y-6">
          {/* Stats skeletons */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
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
  const isBranchAdmin = user?.role === "branch_admin";
  const branchId = user?.branchId;

  // ─── Stats ───
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayOrders = ordersWithItems.filter((o) => new Date(o.createdAt) >= today);
  const todayManual =
    manualRevenues?.filter(
      (mr) => (isBranchAdmin ? mr.branchId === branchId : true) && new Date(mr.date) >= today,
    ) ?? [];

  const totalSales =
    todayOrders.reduce((acc, o) => acc + o.totalAmount, 0) +
    todayManual.reduce((acc, mr) => acc + mr.amount, 0);
  const completedCount =
    todayOrders.filter((o) => o.status === "Completed").length + todayManual.length;
  const voidCount = todayOrders.filter((o) => o.status === "Void").length;

  // Anomaly detection
  const anomalies: { type: string; message: string; severity: "error" | "warning" }[] = [];
  if (voidCount > todayOrders.length * 0.1 && todayOrders.length > 5) {
    anomalies.push({
      type: "Void Anomaly",
      message: `Tingkat pembatalan tinggi (${voidCount} pesanan)`,
      severity: "warning",
    });
  }
  const lowStock = inventory.filter((i) => i.quantity < 100);
  if (lowStock.length > 0) {
    anomalies.push({
      type: "Stock Alert",
      message: `${lowStock.length} bahan baku di bawah batas aman`,
      severity: "error",
    });
  }

  // ─── COGS ───
  const cogsData = computeCogsData(recipes, ingredients);

  // ─── ROP/ROQ (branch_admin only) ───
  const ropData =
    isBranchAdmin && branchId
      ? computeRopData(ordersWithItems, recipes, inventory, ingredients, branchId)
      : [];

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
  const discrepancies = computeDiscrepancies(stockOpnames as any, ingredients, branches);

  // ─── Waste Loss ───
  const wasteLoss = computeWasteLoss(wasteEntries, ingredients);

  return (
    <RoleGuard allowedRoles={["super_admin", "admin_pusat", "area_manager", "branch_admin"]}>
      <div className="space-y-6">
        {/* 1. Stats Cards */}
        <StatsCards
          totalSales={totalSales}
          completedCount={completedCount}
          voidCount={voidCount}
          anomalies={anomalies}
        />

        {/* 2. COGS Analysis (super_admin only) */}
        {isSuperAdmin && <CogsAnalysisTable data={cogsData} />}

        {/* 3. ROP/ROQ (branch_admin only) */}
        {isBranchAdmin && <RopRoqTable data={ropData} />}

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

        {/* 7. Order History */}
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
