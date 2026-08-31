import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import { usePageTitle } from "#/hooks/usePageTitle";
import { getSalesAnalytics } from "#/lib/server/finance";
import { formatRp } from "#/lib/utils";
import { getBranches } from "#/lib/server/branches";
import { BarChart3, AlertCircle, RefreshCw, Calendar, PieChart as PieIcon } from "lucide-react";
import { Button } from "#/components/ui/button";
import { Skeleton } from "#/components/ui/skeleton";
import { barX, defineChart } from "@tanstack/charts";
import { scaleBand } from "@tanstack/charts/scales/band";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { tooltip } from "@tanstack/charts/tooltip";
import { Chart } from "@tanstack/charts/react";
import { pie, polar, radialArc } from "@tanstack/charts/polar";

const COLORS = ["#0088FE", "#00C49F", "#FFBB28", "#FF8042", "#8884d8", "#82ca9d"];

export const Route = createFileRoute("/_layout/analytics/")({
  component: AnalyticsPage,
  loader: async () => {
    const branches = await getBranches({ data: {} });
    return { branches };
  },
});

function toDateInputValue(d: Date): string {
  return d.toISOString().split("T")[0];
}

function getDefaultRange() {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return toDateInputValue(d);
}

function getThirtyDayRange() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  return { from: toDateInputValue(from), to: toDateInputValue(to) };
}

function AnalyticsPage() {
  const { branches } = Route.useLoaderData();
  const [dateFrom, setDateFrom] = useState(getDefaultRange);
  const [dateTo, setDateTo] = useState(() => toDateInputValue(new Date()));
  const [selectedBranch, setSelectedBranch] = useState("");

  const {
    data: analytics,
    isPending,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["analytics", dateFrom, dateTo, selectedBranch],
    queryFn: () =>
      getSalesAnalytics({ data: { dateFrom, dateTo, branchId: selectedBranch || undefined } }),
    enabled: !!dateFrom && !!dateTo,
  });

  usePageTitle("Dashboard Analitik", "Analisis penjualan & performa");

  const channelData =
    analytics?.channelData.map((c) => ({
      name: c.channel,
      value: c.total,
      count: c.count,
    })) ?? [];
  const topSales = analytics?.topSales ?? [];
  const topSalesChartData = topSales.map((t) => ({
    recipeId: t.recipeId,
    name: t.name.length > 15 ? t.name.slice(0, 15) + "..." : t.name,
    qty: t.totalQty,
    revenue: t.totalRevenue,
  }));
  const isPageEmpty = !isPending && !isError && channelData.length === 0 && topSales.length === 0;

  const channelDonutDefinition = useMemo(() => {
    const slices = pie(channelData, {
      value: "value",
      gapAngle: (5 * Math.PI) / 180,
    });
    return defineChart({
      marks: [
        polar({
          radiusRatio: 0.62,
          scales: {
            angle: null,
            radius: null,
          },
          marks: [
            radialArc(slices, {
              key: "name",
              color: "name",
              innerRadius: ({ radius }) => radius * 0.75,
            }),
          ],
        }),
      ],
      scales: { x: null, y: null },
      color: {
        domain: channelData.map((d) => d.name),
        range: COLORS,
      },
      margin: 0,
      theme: { muted: "var(--color-muted-foreground)" },
      tooltip: {
        use: tooltip,
        items: [
          { field: "name", label: "Channel" },
          {
            id: "revenue",
            label: "Pendapatan",
            text: (point) => formatRp(point.datum.value),
          },
        ],
      },
    });
  }, [channelData]);

  const topSalesDefinition = useMemo(
    () =>
      defineChart({
        marks: [
          barX(topSalesChartData, {
            x: "qty",
            y: "name",
            fill: "#0088FE",
            radius: 4,
            inset: 2,
            key: "recipeId",
          }),
        ],
        scales: {
          x: {
            scale: scaleLinear,
            nice: true,
            grid: true,
            axis: { line: false, ticks: { size: 0 }, tickLabels: { fontSize: 10 } },
          },
          y: {
            scale: () => scaleBand<string>().padding(0.3),
            axis: { line: false, ticks: { size: 0 }, tickLabels: { fontSize: 11 } },
          },
        },
        theme: {
          grid: "var(--color-border)",
          muted: "var(--color-muted-foreground)",
        },
        tooltip: {
          use: tooltip,
          items: [{ id: "qty", label: "Qty Terjual", text: (point) => String(point.xValue) }],
        },
      }),
    [topSalesChartData],
  );

  function handleResetRange() {
    const next = getThirtyDayRange();
    setDateFrom(next.from);
    setDateTo(next.to);
  }

  return (
    <RoleGuard allowedRoles={["super_admin"]}>
      <div className="space-y-6">
        {/* Filters */}
        <div className="flex items-center gap-3">
          <select
            value={selectedBranch}
            onChange={(e) => setSelectedBranch(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Semua Cabang</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          />
          <span className="text-muted-foreground">sampai</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          />
          <span className="text-xs text-muted-foreground ml-auto">Maks 31 hari</span>
        </div>

        {isPending ? (
          <AnalyticsSkeleton />
        ) : isError ? (
          <ErrorState
            message={error instanceof Error ? error.message : undefined}
            onRetry={() => refetch()}
          />
        ) : isPageEmpty ? (
          <EmptyState onResetRange={handleResetRange} />
        ) : (
          <>
            {/* Channel Distribution */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="rounded-lg border p-4">
                <h3 className="text-sm font-semibold mb-4">Distribusi Channel</h3>
                {channelData.length === 0 ? (
                  <ChartEmpty
                    icon={<PieIcon className="h-5 w-5 text-muted-foreground" />}
                    message="Belum ada data channel pada rentang ini"
                  />
                ) : (
                  <>
                    <div className="h-64">
                      <Chart
                        definition={channelDonutDefinition}
                        height={256}
                        ariaLabel="Distribusi channel pada rentang tanggal terpilih"
                      />
                    </div>
                    <div className="flex flex-wrap justify-center gap-3 mt-2">
                      {channelData.map((c, i) => (
                        <div key={c.name} className="flex items-center gap-1 text-xs">
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: COLORS[i % COLORS.length] }}
                          />
                          {c.name} ({c.count})
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* Top Sales */}
              <div className="rounded-lg border p-4">
                <h3 className="text-sm font-semibold mb-4">Top Sales (Qty)</h3>
                {topSales.length === 0 ? (
                  <ChartEmpty
                    icon={<BarChart3 className="h-5 w-5 text-muted-foreground" />}
                    message="Belum ada data menu pada rentang ini"
                  />
                ) : (
                  <div className="h-64">
                    <Chart
                      definition={topSalesDefinition}
                      height={256}
                      ariaLabel="Top menu berdasarkan kuantitas terjual pada rentang tanggal terpilih"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Top Sales Table */}
            <div className="rounded-md border overflow-x-auto">
              <table className="w-full text-sm min-w-[480px]">
                <thead className="border-b bg-muted/50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Menu</th>
                    <th className="px-4 py-3 text-right font-medium">Qty Terjual</th>
                    <th className="px-4 py-3 text-right font-medium">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {topSales.length === 0 ? (
                    <tr>
                      <td
                        colSpan={3}
                        className="px-4 py-8 text-center text-sm text-muted-foreground"
                      >
                        Belum ada data menu pada rentang ini
                      </td>
                    </tr>
                  ) : (
                    topSales.map((item) => (
                      <tr key={item.recipeId} className="border-b">
                        <td className="px-4 py-3">{item.name}</td>
                        <td className="px-4 py-3 text-right">
                          {item.totalQty.toLocaleString("id-ID")}
                        </td>
                        <td className="px-4 py-3 text-right">{formatRp(item.totalRevenue)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Hourly Heatmap */}
            {/* {hourlyData && hourlyData.length > 0 && (
              <div className="rounded-lg border p-4">
                <h3 className="text-sm font-semibold mb-4">Beban Kerja Dapur per Jam</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={(() => {
                        const filled: { hour: string; count: number; revenue: number }[] = [];
                        for (let h = 0; h < 24; h++) {
                          const found = hourlyData.find((d: { hour: number }) => d.hour === h);
                          filled.push({
                            hour: h.toString().padStart(2, "0") + ":00",
                            count: found ? found.count : 0,
                            revenue: found ? found.revenue : 0,
                          });
                        }
                        return filled;
                      })()}
                      margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="hour" tick={{ fontSize: 10 }} interval={2} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip
                        formatter={(value: any) => formatRp(value)}
                        labelFormatter={(label: any) => `Jam ${label}`}
                      />
                      <Bar dataKey="count" fill="#8884d8" radius={[2, 2, 0, 0]} name="Pesanan" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )} */}
          </>
        )}
      </div>
    </RoleGuard>
  );
}

function AnalyticsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="rounded-lg border p-4 space-y-3">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-64 w-full" />
        </div>
        <div className="rounded-lg border p-4 space-y-3">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
      <div className="rounded-md border p-4 space-y-3">
        <Skeleton className="h-4 w-40" />
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message?: string; onRetry: () => void }) {
  return (
    <div className="rounded-lg border border-dashed p-8 text-center">
      <div className="mx-auto h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-3">
        <AlertCircle className="h-6 w-6 text-muted-foreground" />
      </div>
      <h3 className="font-semibold text-foreground mb-1">Gagal memuat analitik</h3>
      <p className="text-sm text-muted-foreground mb-4">
        {message ?? "Periksa rentang tanggal dan koneksi, lalu coba lagi."}
      </p>
      <Button variant="outline" onClick={onRetry}>
        <RefreshCw className="h-4 w-4" />
        Coba lagi
      </Button>
    </div>
  );
}

function EmptyState({ onResetRange }: { onResetRange: () => void }) {
  return (
    <div className="rounded-lg border border-dashed p-8 text-center">
      <div className="mx-auto h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-3">
        <BarChart3 className="h-6 w-6 text-muted-foreground" />
      </div>
      <h3 className="font-semibold text-foreground mb-1">
        Tidak ada penjualan pada rentang waktu ini
      </h3>
      <p className="text-sm text-muted-foreground mb-4">
        Coba perluas rentang tanggal, pilih cabang lain, atau hapus filter cabang.
      </p>
      <Button variant="outline" onClick={onResetRange}>
        <Calendar className="h-4 w-4" />
        Reset rentang ke 30 hari terakhir
      </Button>
    </div>
  );
}

function ChartEmpty({ icon, message }: { icon: React.ReactNode; message: string }) {
  return (
    <div className="h-64 flex flex-col items-center justify-center text-center gap-2">
      {icon}
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
