import { useMemo } from "react";
import { barX, defineChart } from "@tanstack/charts";
import { scaleBand } from "@tanstack/charts/scales/band";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { tooltip } from "@tanstack/charts/tooltip";
import { Chart } from "@tanstack/charts/react";
import { formatQuantity, formatRp } from "#/lib/utils";

export interface RankedBarDatum {
  id: string;
  name: string;
  value: number;
}

const MAX_BARS = 10;

/**
 * Horizontal ranked bar for a "who is biggest" comparison. Horizontal because
 * item and branch names are long while the values share one axis — a vertical
 * bar would rotate the labels or clip them.
 */
export function RankedBarChart({
  data,
  color,
  valueKind,
  ariaLabel,
}: {
  data: RankedBarDatum[];
  color: string;
  valueKind: "currency" | "quantity";
  ariaLabel: string;
}) {
  const chartData = useMemo(
    () =>
      data
        .filter((datum) => datum.value > 0)
        .slice(0, MAX_BARS)
        .map((datum) => ({
          ...datum,
          displayName: datum.name.length > 28 ? `${datum.name.slice(0, 27)}…` : datum.name,
        })),
    [data],
  );

  const height = Math.max(180, chartData.length * 32 + 24);

  const definition = useMemo(
    () =>
      defineChart({
        marks: [
          barX(chartData, {
            x: "value",
            y: "displayName",
            fill: color,
            radius: 4,
            inset: 2,
            key: "id",
          }),
        ],
        scales: {
          x: {
            scale: scaleLinear,
            nice: true,
            grid: true,
            axis: {
              line: false,
              ticks: {
                size: 0,
                format: (value) =>
                  valueKind === "currency" ? formatRp(Number(value)) : String(value),
              },
              tickLabels: { fontSize: 10 },
            },
          },
          y: {
            scale: () => scaleBand<string>().padding(0.28),
            axis: { line: false, ticks: { size: 0 }, tickLabels: { fontSize: 11 } },
          },
        },
        theme: {
          grid: "var(--color-border)",
          muted: "var(--color-muted-foreground)",
        },
        tooltip: {
          use: tooltip,
          items: [
            { field: "name", label: "Item" },
            {
              id: "value",
              label: valueKind === "currency" ? "Subtotal" : "Jumlah",
              text: (point) =>
                valueKind === "currency"
                  ? formatRp(Number(point.xValue))
                  : formatQuantity(Number(point.xValue)),
            },
          ],
        },
      }),
    [chartData, color, valueKind],
  );

  if (chartData.length === 0) {
    return (
      <div className="flex h-44 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
        Belum ada data
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height }} className="min-w-0">
      <Chart definition={definition} height={height} ariaLabel={ariaLabel} />
    </div>
  );
}
