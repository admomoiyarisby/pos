import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import { usePageTitle } from "#/hooks/usePageTitle";
import { getSalesAnalytics } from "#/lib/server/finance";
import { getBranches } from "#/lib/server/branches";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";

const COLORS = ["#0088FE", "#00C49F", "#FFBB28", "#FF8042", "#8884d8", "#82ca9d"];

export const Route = createFileRoute("/_layout/analytics/")({
  component: AnalyticsPage,
  loader: async () => {
    const branches = await getBranches({ data: {} });
    return { branches };
  },
});

function AnalyticsPage() {
  const { branches } = Route.useLoaderData();
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().split("T")[0];
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split("T")[0]);
  const [selectedBranch, setSelectedBranch] = useState("");

  const { data: analytics } = useQuery({
    queryKey: ["analytics", dateFrom, dateTo, selectedBranch],
    queryFn: () =>
      getSalesAnalytics({ data: { dateFrom, dateTo, branchId: selectedBranch || undefined } }),
    enabled: !!dateFrom && !!dateTo,
  });

  const channelData =
    analytics?.channelData.map((c) => ({
      name: c.channel,
      value: c.total,
      count: c.count,
    })) ?? [];

  const topSalesData =
    analytics?.topSales.map((t) => ({
      name: t.name.length > 15 ? t.name.slice(0, 15) + "..." : t.name,
      qty: t.totalQty,
      revenue: t.totalRevenue,
    })) ?? [];
  usePageTitle("Dashboard Analytics", "Analisis penjualan & performa");

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

        {analytics && (
          <>
            {/* Channel Distribution */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="rounded-lg border p-4">
                <h3 className="text-sm font-semibold mb-4">Distribusi Channel</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={channelData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={5}
                        dataKey="value"
                      >
                        {channelData.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value) => `Rp ${Number(value).toLocaleString("id-ID")}`}
                      />
                    </PieChart>
                  </ResponsiveContainer>
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
              </div>

              {/* Top Sales */}
              <div className="rounded-lg border p-4">
                <h3 className="text-sm font-semibold mb-4">Top Sales (Qty)</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={topSalesData} layout="vertical" margin={{ left: 80 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" />
                      <YAxis dataKey="name" type="category" width={100} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="qty" fill="#0088FE" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
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
                  {analytics.topSales.map((item) => (
                    <tr key={item.recipeId} className="border-b">
                      <td className="px-4 py-3">{item.name}</td>
                      <td className="px-4 py-3 text-right">
                        {item.totalQty.toLocaleString("id-ID")}
                      </td>
                      <td className="px-4 py-3 text-right">
                        Rp {item.totalRevenue.toLocaleString("id-ID")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </RoleGuard>
  );
}
