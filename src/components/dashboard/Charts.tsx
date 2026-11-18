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

export function SalesTrendChart({
  data,
  rangeLabel,
}: {
  data: { name: string; sales: number }[];
  rangeLabel?: string;
}) {
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
        <h3 className="text-base font-bold text-foreground">Tren Penjualan</h3>
        <p className="text-sm text-muted-foreground">
          Dalam ribuan Rupiah{rangeLabel ? ` · ${rangeLabel}` : ""}
        </p>
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

export function ChannelPieChart({
  data,
  rangeLabel,
}: {
  data: { name: string; value: number }[];
  rangeLabel?: string;
}) {
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
        <p className="text-sm text-muted-foreground">
          Berdasarkan volume pesanan{rangeLabel ? ` · ${rangeLabel}` : ""}
        </p>
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
  rangeLabel,
}: {
  data: { name: string; revenue: number; count: number }[];
  rangeLabel?: string;
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
        <p className="text-sm text-muted-foreground">
          Total pendapatan kotor per outlet{rangeLabel ? ` · ${rangeLabel}` : ""}
        </p>
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
  rangeLabel,
}: {
  data: { name: string; revenue: number; count: number }[];
  rangeLabel?: string;
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
          {rangeLabel ? ` · ${rangeLabel}` : ""}
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
