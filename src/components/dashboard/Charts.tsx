import {
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

const CHANNEL_COLORS = ["#10b981", "#3b82f6", "#f59e0b", "#ef4444"];

interface Order {
  id: string;
  channel: string;
  totalAmount: number;
  branchId: string;
  createdAt: Date;
  brandId?: string | null;
  status: string;
}

interface Branch {
  id: string;
  name: string;
}

interface Brand {
  id: string;
  name: string;
}

interface ManualRevenue {
  id: string;
  branchId: string;
  amount: number;
  date: string;
  brandBreakdown?: { brandId: string; amount: number }[];
}

export function computeSalesTrend(orders: Order[]) {
  const days: { name: string; sales: number }[] = [];
  const dayNames = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const dayOrders = orders.filter(
      (o) => new Date(o.createdAt).toDateString() === d.toDateString(),
    );
    days.push({
      name: dayNames[d.getDay()],
      sales: dayOrders.reduce((acc, o) => acc + o.totalAmount, 0) / 1000,
    });
  }
  return days;
}

export function computeChannelData(orders: Order[], platformChannels?: string[]) {
  const channels = platformChannels ?? ["Gofood", "Grabfood", "ShopeeFood", "Dine-in"];
  return channels
    .map((c) => ({
      name: c,
      value: orders.filter((o) => o.channel === c).length,
    }))
    .filter((d) => d.value > 0);
}

export function computeSalesByBranch(
  orders: Order[],
  branches: Branch[],
  manualRevenues: ManualRevenue[],
) {
  const completedOrders = orders.filter((o) => o.status === "Completed");
  return branches
    .map((b) => {
      const branchOrders = completedOrders.filter((o) => o.branchId === b.id);
      const branchManual = manualRevenues.filter((mr) => mr.branchId === b.id);
      const revenue =
        branchOrders.reduce((sum, o) => sum + o.totalAmount, 0) +
        branchManual.reduce((sum, mr) => sum + mr.amount, 0);
      return { name: b.name, revenue, count: branchOrders.length + branchManual.length };
    })
    .filter((b) => b.revenue > 0);
}

export function computeSalesByBrand(
  orders: Order[],
  brands: Brand[],
  manualRevenues: ManualRevenue[],
) {
  const completedOrders = orders.filter((o) => o.status === "Completed");
  const brandSales: Record<string, { name: string; revenue: number; count: number }> = {};
  brands.forEach((b) => {
    brandSales[b.id] = { name: b.name, revenue: 0, count: 0 };
  });

  completedOrders.forEach((o) => {
    if (o.brandId && brandSales[o.brandId]) {
      brandSales[o.brandId].revenue += o.totalAmount;
    }
  });

  manualRevenues.forEach((mr) => {
    if (mr.brandBreakdown) {
      mr.brandBreakdown.forEach((bb) => {
        if (brandSales[bb.brandId]) {
          brandSales[bb.brandId].revenue += bb.amount;
          brandSales[bb.brandId].count += 1;
        }
      });
    }
  });

  return Object.values(brandSales).filter((b) => b.revenue > 0);
}

export function SalesTrendChart({ data }: { data: { name: string; sales: number }[] }) {
  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="mb-2">
        <h3 className="text-base font-bold text-foreground">Tren Penjualan (7 Hari Terakhir)</h3>
        <p className="text-sm text-muted-foreground">Dalam ribuan Rupiah</p>
      </div>
      <div style={{ width: "100%", height: 320 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis
              dataKey="name"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#64748b", fontSize: 12 }}
            />
            <YAxis axisLine={false} tickLine={false} tick={{ fill: "#64748b", fontSize: 12 }} />
            <Tooltip
              contentStyle={{
                borderRadius: "12px",
                border: "none",
                boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
              }}
            />
            <Area
              type="monotone"
              dataKey="sales"
              stroke="#10b981"
              strokeWidth={3}
              fillOpacity={1}
              fill="url(#colorSales)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function ChannelPieChart({ data }: { data: { name: string; value: number }[] }) {
  const chartData = data.length > 0 ? data : [{ name: "Belum Ada Data", value: 1 }];

  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="mb-2">
        <h3 className="text-base font-bold text-foreground">Distribusi Channel</h3>
        <p className="text-sm text-muted-foreground">Berdasarkan volume pesanan</p>
      </div>
      <div className="flex items-center justify-center" style={{ width: "100%", height: 320 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={100}
              paddingAngle={5}
              dataKey="value"
              nameKey="name"
              label={({ name, percent }: any) =>
                percent > 0.08 ? `${name} ${(percent * 100).toFixed(0)}%` : ""
              }
            >
              {chartData.map((_entry, index) => (
                <Cell key={`cell-${index}`} fill={CHANNEL_COLORS[index % CHANNEL_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip formatter={((value: number) => [value, "Pesanan"]) as any} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      {data.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-3 border-t pt-4">
          {data.map((entry, index) => (
            <div key={entry.name} className="flex items-center gap-1.5">
              <span
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: CHANNEL_COLORS[index % CHANNEL_COLORS.length] }}
              />
              <span className="text-sm text-muted-foreground">{entry.name}</span>
              <span className="text-sm font-semibold text-foreground">({entry.value})</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function SalesByBranchChart({
  data,
}: {
  data: { name: string; revenue: number; count: number }[];
}) {
  if (data.length === 0) return null;

  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="mb-2">
        <h3 className="text-base font-bold text-foreground">Penjualan per Cabang</h3>
        <p className="text-sm text-muted-foreground">Total pendapatan kotor per outlet</p>
      </div>
      <div style={{ width: "100%", height: 256 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 10 }} />
            <YAxis
              tickFormatter={(value: number) => `Rp${value / 1000}k`}
              tick={{ fontSize: 10 }}
            />
            <Tooltip
              formatter={
                ((value: number) => [`Rp ${value.toLocaleString("id-ID")}`, "Revenue"]) as any
              }
            />
            <Bar dataKey="revenue" fill="#059669" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function BrandPerformanceChart({
  data,
}: {
  data: { name: string; revenue: number; count: number }[];
}) {
  if (data.length === 0) return null;

  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="mb-2">
        <h3 className="text-base font-bold text-foreground">Brand Performance</h3>
        <p className="text-sm text-muted-foreground">
          Kontribusi pendapatan per Brand (Inc. Manual)
        </p>
      </div>
      <div style={{ width: "100%", height: 256 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 10 }} />
            <YAxis
              tickFormatter={(value: number) => `Rp${value / 1000}k`}
              tick={{ fontSize: 10 }}
            />
            <Tooltip
              formatter={
                ((value: number) => [`Rp ${value.toLocaleString("id-ID")}`, "Revenue"]) as any
              }
            />
            <Bar dataKey="revenue" fill="#3b82f6" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
