import { useMemo } from "react";
import { areaY, barY, defineChart, lineY } from "@tanstack/charts";
import { scaleBand } from "@tanstack/charts/scales/band";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { scalePoint } from "@tanstack/charts/scales/point";
import { tooltip } from "@tanstack/charts/tooltip";
import { Chart } from "@tanstack/charts/react";
import { pie, polar, radialArc, radialRule, radialText } from "@tanstack/charts/polar";
import { d3Curve } from "@tanstack/charts/d3/shape";
import { curveMonotoneX } from "d3-shape";

const CHANNEL_COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
];

const monotone = d3Curve(curveMonotoneX);

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
    // Use UTC date strings to avoid TZ mismatch between server (UTC)
    // and client (any TZ). toDateString() uses local timezone, which
    // can include/exclude orders depending on the viewer's locale.
    const d = new Date(Date.now() - i * 86400000);
    const dStr = d.toISOString().slice(0, 10);
    const dayOrders = orders.filter(
      (o) => new Date(o.createdAt).toISOString().slice(0, 10) === dStr,
    );
    days.push({
      name: dayNames[d.getDay()],
      sales: dayOrders.reduce((acc, o) => acc + o.totalAmount, 0) / 1000,
    });
  }
  return days;
}

export function computeChannelData(orders: Order[], platformChannels?: string[]) {
  const channels = platformChannels ?? [
    "Gofood",
    "Grabfood",
    "ShopeeFood",
    "Dine-in",
    "TikTok",
    "Perlengkapan",
  ];
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
  const definition = useMemo(
    () =>
      defineChart({
        marks: [
          areaY(data, {
            x: "name",
            y: "sales",
            fill: "url(#colorSales)",
            fillOpacity: 1,
            curve: monotone,
            key: "name",
          }),
          lineY(data, {
            x: "name",
            y: "sales",
            stroke: "var(--color-chart-2)",
            strokeWidth: 3,
            curve: monotone,
            key: "name",
          }),
        ],
        scales: {
          x: {
            scale: () => scalePoint<string>().padding(0.2),
            axis: { line: false, ticks: { size: 0 }, tickLabels: { fontSize: 12 } },
          },
          y: {
            scale: scaleLinear,
            nice: true,
            grid: true,
            axis: { line: false, ticks: { size: 0 }, tickLabels: { fontSize: 12 } },
          },
        },
        gradients: [
          {
            id: "colorSales",
            x1: 0,
            y1: 0,
            x2: 0,
            y2: 1,
            stops: [
              { offset: 0.05, color: "var(--color-chart-1)", opacity: 0.3 },
              { offset: 0.95, color: "var(--color-chart-1)", opacity: 0 },
            ],
          },
        ],
        clip: true,
        theme: {
          grid: "var(--color-border)",
          muted: "var(--color-muted-foreground)",
        },
        tooltip: {
          use: tooltip,
          items: [
            {
              id: "sales",
              label: "Penjualan (ribu Rp)",
              text: (point) => String(point.yValue),
            },
          ],
        },
      }),
    [data],
  );

  return (
    <div className="rounded-lg border bg-card p-3 md:p-4 shadow-sm">
      <div className="mb-2">
        <h3 className="text-base font-bold text-foreground">Tren Penjualan (7 Hari Terakhir)</h3>
        <p className="text-sm text-muted-foreground">Dalam ribuan Rupiah</p>
      </div>
      <div style={{ width: "100%", height: 320 }} className="min-w-0">
        <Chart
          definition={definition}
          height={320}
          ariaLabel="Tren penjualan 7 hari terakhir dalam ribuan rupiah"
        />
      </div>
    </div>
  );
}

export function ChannelPieChart({ data }: { data: { name: string; value: number }[] }) {
  const chartData = data.length > 0 ? data : [{ name: "Belum Ada Data", value: 1 }];

  const definition = useMemo(() => {
    const slices = pie(chartData, {
      value: "value",
      gapAngle: (5 * Math.PI) / 180,
    });
    const labeledSlices = slices.filter((row) => row.fraction > 0.08);

    return defineChart({
      marks: [
        polar({
          radiusRatio: 0.62,
          scales: {
            angle: { scale: scaleLinear().domain([0, Math.PI * 2]) },
            radius: { scale: scaleLinear().domain([0, 1]) },
          },
          marks: [
            radialArc(slices, {
              key: "name",
              color: "name",
              innerRadius: ({ radius }) => radius * 0.6,
            }),
            radialRule(labeledSlices, {
              angle: "angle",
              radius1: 1,
              radius2: 1,
              radius2Offset: 8,
              key: "name",
              stroke: "var(--color-muted-foreground)",
              strokeOpacity: 0.6,
              strokeWidth: 1,
            }),
            radialText(labeledSlices, {
              angle: "angle",
              radius: 1,
              radiusOffset: 8,
              text: (row) => `${row.name} ${(row.fraction * 100).toFixed(0)}%`,
              key: "name",
              fontSize: 11,
              fontWeight: 500,
              anchor: "outside",
            }),
          ],
        }),
      ],
      scales: { x: null, y: null },
      color: {
        domain: chartData.map((d) => d.name),
        range: CHANNEL_COLORS,
      },
      margin: 0,
      theme: { muted: "var(--color-muted-foreground)" },
      tooltip: {
        use: tooltip,
        items: [
          { field: "name", label: "Channel" },
          {
            id: "count",
            label: "Pesanan",
            text: (point) => String(point.datum.value),
          },
        ],
      },
    });
  }, [chartData]);

  return (
    <div className="rounded-lg border bg-card p-3 md:p-4 shadow-sm">
      <div className="mb-2">
        <h3 className="text-base font-bold text-foreground">Distribusi Channel</h3>
        <p className="text-sm text-muted-foreground">Berdasarkan volume pesanan</p>
      </div>
      <div style={{ width: "100%", height: 320 }} className="min-w-0">
        <Chart
          definition={definition}
          height={320}
          ariaLabel="Distribusi channel berdasarkan volume pesanan"
        />
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

  const definition = useMemo(
    () =>
      defineChart({
        marks: [
          barY(data, {
            x: "name",
            y: "revenue",
            fill: "var(--color-chart-1)",
            radius: 4,
            inset: 2,
            key: "name",
          }),
        ],
        scales: {
          x: {
            scale: () => scaleBand<string>().padding(0.25),
            axis: { line: false, ticks: { size: 0 }, tickLabels: { fontSize: 10 } },
          },
          y: {
            scale: scaleLinear,
            nice: true,
            grid: true,
            axis: {
              line: false,
              ticks: { size: 0, format: (value) => `Rp${value / 1000}k` },
              tickLabels: { fontSize: 10 },
            },
          },
        },
        theme: {
          grid: "var(--color-border)",
          muted: "var(--color-muted-foreground)",
        },
        tooltip: {
          use: tooltip,
          items: [
            {
              id: "revenue",
              label: "Pendapatan",
              text: (point) => `Rp ${Number(point.yValue).toLocaleString("id-ID")}`,
            },
          ],
        },
      }),
    [data],
  );

  return (
    <div className="rounded-lg border bg-card p-3 md:p-4 shadow-sm">
      <div className="mb-2">
        <h3 className="text-base font-bold text-foreground">Penjualan per Cabang</h3>
        <p className="text-sm text-muted-foreground">Total pendapatan kotor per outlet</p>
      </div>
      <div style={{ width: "100%", height: 256 }} className="min-w-0">
        <Chart
          definition={definition}
          height={256}
          ariaLabel="Penjualan per cabang, total pendapatan kotor per outlet"
        />
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

  const definition = useMemo(
    () =>
      defineChart({
        marks: [
          barY(data, {
            x: "name",
            y: "revenue",
            fill: "var(--color-chart-3)",
            radius: 4,
            inset: 2,
            key: "name",
          }),
        ],
        scales: {
          x: {
            scale: () => scaleBand<string>().padding(0.25),
            axis: { line: false, ticks: { size: 0 }, tickLabels: { fontSize: 10 } },
          },
          y: {
            scale: scaleLinear,
            nice: true,
            grid: true,
            axis: {
              line: false,
              ticks: { size: 0, format: (value) => `Rp${value / 1000}k` },
              tickLabels: { fontSize: 10 },
            },
          },
        },
        theme: {
          grid: "var(--color-border)",
          muted: "var(--color-muted-foreground)",
        },
        tooltip: {
          use: tooltip,
          items: [
            {
              id: "revenue",
              label: "Pendapatan",
              text: (point) => `Rp ${Number(point.yValue).toLocaleString("id-ID")}`,
            },
          ],
        },
      }),
    [data],
  );

  return (
    <div className="rounded-lg border bg-card p-3 md:p-4 shadow-sm">
      <div className="mb-2">
        <h3 className="text-base font-bold text-foreground">Performa Brand</h3>
        <p className="text-sm text-muted-foreground">
          Kontribusi pendapatan per Brand (Termasuk Manual)
        </p>
      </div>
      <div style={{ width: "100%", height: 256 }} className="min-w-0">
        <Chart
          definition={definition}
          height={256}
          ariaLabel="Performa brand, kontribusi pendapatan per brand termasuk manual"
        />
      </div>
    </div>
  );
}
