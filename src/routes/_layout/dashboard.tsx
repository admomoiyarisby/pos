import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import { usePageTitle } from "#/hooks/usePageTitle";
import { useAuth } from "#/lib/auth-context";
import { getDashboardData } from "#/lib/server/dashboard";
import { Skeleton } from "#/components/ui/skeleton";
import { StatsCards } from "#/components/dashboard/StatsCards";
import { AnomalyAlerts, type Anomaly } from "#/components/dashboard/AnomalyAlerts";
import {
  UnsafeStockTable,
  type UnsafeStockItem,
} from "#/components/dashboard/UnsafeStockTable";
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
        <DashboardSkeleton isSuperAdmin={user?.role === "super_admin"} />
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
        {/* Freshness strip — moved out of the duplicate header.
            The page h1 + subtitle already live in the AppShell. */}
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

        {/* 1. Stats Cards (3-col) */}
        <StatsCards
          totalSales={totalSales}
          completedCount={completedCount}
          voidCount={voidCount}
        />

        {/* 2. Anomaly Alerts (full-width, stacked rows) */}
        <AnomalyAlerts anomalies={anomalies} />

        {/* 3. Top 10 Unsafe Stock (full-width table) — only when there are unsafe items */}
        {lowStockItems.length > 0 && <UnsafeStockTable data={lowStockItems} />}

        {/* 4. COGS Analysis (super_admin only) */}
        {isSuperAdmin && <CogsAnalysisTable data={cogsData} />}

        {/* 5. Sales Trend + Channel Pie (2-col) */}
        <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-2">
          <SalesTrendChart data={salesTrend} />
          <ChannelPieChart data={channelData} />
        </div>

        {/* 6. Sales by Branch + Brand Performance (super_admin only) */}
        {isSuperAdmin && (
          <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-2">
            <SalesByBranchChart data={salesByBranch} />
            <BrandPerformanceChart data={salesByBrand} />
          </div>
        )}

        {/* 7. HPP + Discrepancy (super_admin only) — equal 1+1 columns, replaces the prior off-balance 1+2 split */}
        {isSuperAdmin && (
          <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-2">
            <HppAlertCards data={hppAlerts} />
            <DiscrepancyTable data={discrepancies} />
          </div>
        )}

        {/* 8. Waste Loss (super_admin only) — full-width, was previously alone in a 2-col grid with a dead cell */}
        {isSuperAdmin && <WasteLossTable data={wasteLoss} />}

        {/* 9. Order History */}
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

// ─── Loading skeleton — mirrors the real layout to avoid a content jump on load ───
function DashboardSkeleton({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  return (
    <div className="space-y-6">
      {/* Stats (3) */}
      <div className="grid grid-cols-1 gap-4 md:gap-6 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-lg border bg-card p-6 shadow-sm space-y-3">
            <Skeleton className="h-5 w-5" />
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-7 w-32" />
          </div>
        ))}
      </div>

      {/* Anomaly alert rows */}
      <div className="space-y-3">
        <Skeleton className="h-4 w-40" />
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="flex items-start gap-3 rounded-lg border bg-card p-4">
            <Skeleton className="h-8 w-8 rounded-md" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-3 w-56" />
            </div>
          </div>
        ))}
      </div>

      {/* Unsafe stock table */}
      <div className="rounded-lg border bg-card p-6 shadow-sm space-y-3">
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-3 w-72" />
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>

      {isSuperAdmin && (
        <div className="rounded-lg border bg-card p-6 shadow-sm space-y-3">
          <Skeleton className="h-4 w-48" />
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      )}

      {/* Sales trend + channel pie (2-col) */}
      <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-lg border bg-card p-4 shadow-sm space-y-3">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-64 w-full" />
          </div>
        ))}
      </div>

      {isSuperAdmin && (
        <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="rounded-lg border bg-card p-4 shadow-sm space-y-3">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-56 w-full" />
            </div>
          ))}
        </div>
      )}

      {isSuperAdmin && (
        <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-2">
          <div className="rounded-lg border bg-card p-6 shadow-sm space-y-3">
            <Skeleton className="h-4 w-40" />
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
          <div className="rounded-lg border bg-card p-6 shadow-sm space-y-3">
            <Skeleton className="h-4 w-40" />
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        </div>
      )}

      {isSuperAdmin && (
        <div className="rounded-lg border bg-card p-6 shadow-sm space-y-3">
          <Skeleton className="h-4 w-48" />
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      )}

      {/* Order history */}
      <div className="rounded-lg border bg-card p-6 shadow-sm space-y-3">
        <Skeleton className="h-4 w-40" />
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </div>
  );
}
