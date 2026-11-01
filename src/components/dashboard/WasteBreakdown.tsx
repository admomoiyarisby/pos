import { useMemo } from "react";
import type { ReactNode } from "react";
import { AlertTriangle, ReceiptText, Utensils, Wallet } from "lucide-react";
import { pie, polar, radialArc } from "@tanstack/charts/polar";
import { defineChart } from "@tanstack/charts";
import { tooltip } from "@tanstack/charts/tooltip";
import { Chart } from "@tanstack/charts/react";
import { formatQuantity, formatRp } from "#/lib/utils";
import { matchesDashboardFilter, type DashboardFilter } from "#/lib/dashboard-filter";
import { RankedBarChart, type RankedBarDatum } from "#/components/dashboard/RankedBarChart";

export type WasteCategory = "Beban Makan" | "Biaya Operasional" | "Spoiled" | "Denda";

export interface WasteEntry {
  id: string;
  branchId: string;
  ingredientId: string | null;
  ingredientName: string | null;
  ingredientUnit: string | null;
  recipeId: string | null;
  recipeName: string | null;
  quantity: number;
  category: WasteCategory;
  valuation: number;
  createdAt?: Date | string;
  status?: "Active" | "Cancelled";
  staffName?: string | null;
}

export interface WasteItemRow {
  id: string;
  name: string;
  unit: string | null;
  quantity: number;
  subtotal: number;
  entries: number;
}

export interface WasteCategorySummary {
  key: WasteCategory;
  label: string;
  color: string;
  total: number;
  entries: number;
  items: WasteItemRow[];
}

export interface WasteSummary {
  total: number;
  entries: number;
  categories: WasteCategorySummary[];
}

interface CategoryMeta {
  key: WasteCategory;
  label: string;
  color: string;
}

const CATEGORY_META: CategoryMeta[] = [
  { key: "Biaya Operasional", label: "Biaya Operasional", color: "var(--color-chart-1)" },
  { key: "Beban Makan", label: "Biaya Makan Staff", color: "var(--color-chart-2)" },
  { key: "Spoiled", label: "Spoiled", color: "var(--color-chart-3)" },
  { key: "Denda", label: "Denda", color: "var(--color-chart-4)" },
];

interface ItemAccumulator {
  id: string;
  name: string;
  unit: string | null;
  quantity: number;
  subtotal: number;
  entries: number;
}

interface CategoryAccumulator {
  total: number;
  entries: number;
  items: Map<string, ItemAccumulator>;
}

/**
 * Group Active waste entries by category and then by item. Each item's
 * `subtotal` is the sum of the entry valuations, so the category total is the
 * sum of its item subtotals (never a count of mixed units).
 */
export function computeWasteSummary(
  entries: WasteEntry[],
  filter: DashboardFilter = {},
): WasteSummary {
  const grouped = new Map<WasteCategory, CategoryAccumulator>();

  for (const entry of entries) {
    if (entry.status !== undefined && entry.status !== "Active") continue;
    if (!matchesDashboardFilter(entry.createdAt, entry.branchId, filter)) continue;

    let category = grouped.get(entry.category);
    if (!category) {
      category = { total: 0, entries: 0, items: new Map() };
      grouped.set(entry.category, category);
    }

    const valuation = Number(entry.valuation) || 0;
    const quantity = Number(entry.quantity) || 0;
    const baseItemId = entry.recipeId
      ? `recipe:${entry.recipeId}`
      : `ingredient:${entry.ingredientId ?? entry.id}`;
    const baseName = entry.recipeId
      ? (entry.recipeName ?? "Menu")
      : (entry.ingredientName ?? "Bahan");
    // Denda is assigned to a person, so the staff name is part of the item —
    // otherwise every fine on the same ingredient collapses into one row with
    // no way to see who it was for.
    const staffSuffix = entry.category === "Denda" && entry.staffName ? `:${entry.staffName}` : "";
    const itemId = `${baseItemId}${staffSuffix}`;
    const name =
      entry.category === "Denda" && entry.staffName ? `${baseName} — ${entry.staffName}` : baseName;
    const unit = entry.recipeId ? "porsi" : entry.ingredientUnit;

    category.total += valuation;
    category.entries += 1;

    const item = category.items.get(itemId);
    if (item) {
      item.quantity += quantity;
      item.subtotal += valuation;
      item.entries += 1;
    } else {
      category.items.set(itemId, {
        id: itemId,
        name,
        unit,
        quantity,
        subtotal: valuation,
        entries: 1,
      });
    }
  }

  const categories = CATEGORY_META.map((meta) => {
    const accumulator = grouped.get(meta.key);
    const items = accumulator ? [...accumulator.items.values()] : [];
    items.sort(
      (a, b) => b.subtotal - a.subtotal || b.quantity - a.quantity || a.name.localeCompare(b.name),
    );
    return {
      key: meta.key,
      label: meta.label,
      color: meta.color,
      total: accumulator?.total ?? 0,
      entries: accumulator?.entries ?? 0,
      items,
    };
  });

  return {
    total: categories.reduce((sum, category) => sum + category.total, 0),
    entries: categories.reduce((sum, category) => sum + category.entries, 0),
    categories,
  };
}

function WasteCategoryDonut({
  categories,
  total,
}: {
  categories: WasteCategorySummary[];
  total: number;
}) {
  const chartData = categories
    .filter((category) => category.total > 0)
    .map((category) => ({
      name: category.label,
      value: category.total,
      color: category.color,
    }));

  const definition = useMemo(() => {
    const slices = pie(chartData, {
      value: "value",
      gapAngle: (4 * Math.PI) / 180,
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
              innerRadius: ({ radius }) => radius * 0.72,
            }),
          ],
        }),
      ],
      scales: { x: null, y: null },
      color: {
        domain: chartData.map((datum) => datum.name),
        range: chartData.map((datum) => datum.color),
      },
      margin: 0,
      theme: { muted: "var(--color-muted-foreground)" },
      tooltip: {
        use: tooltip,
        items: [
          { field: "name", label: "Kategori" },
          {
            id: "value",
            label: "Total",
            text: (point) => formatRp(Number(point.datum.value)),
          },
        ],
      },
    });
  }, [chartData]);

  if (chartData.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
        Belum ada waste aktif.
      </div>
    );
  }

  return (
    <div className="relative">
      <Chart definition={definition} height={224} ariaLabel="Komposisi total waste per kategori" />
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xs text-muted-foreground">Total Waste</span>
        <span className="text-lg font-bold tabular-nums text-foreground">{formatRp(total)}</span>
      </div>
    </div>
  );
}

function WasteCategoryCard({ category }: { category: WasteCategorySummary }) {
  const chartData: RankedBarDatum[] = category.items.map((item) => ({
    id: item.id,
    name: item.name,
    value: item.subtotal,
  }));

  return (
    <div className="rounded-lg border bg-card p-3 shadow-sm md:p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-base font-bold text-foreground">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: category.color }}
              aria-hidden="true"
            />
            {category.label}
          </h3>
          <p className="text-sm text-muted-foreground">
            {formatQuantity(category.entries)} entri · {formatQuantity(category.items.length)} item
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total</p>
          <p className="text-lg font-bold tabular-nums text-foreground">
            {formatRp(category.total)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Subtotal per Item
          </p>
          <RankedBarChart
            data={chartData}
            color={category.color}
            valueKind="currency"
            ariaLabel={`Subtotal ${category.label} per item`}
          />
          {category.items.length > 10 && (
            <p className="mt-1 text-xs text-muted-foreground">
              Grafik menampilkan 10 item terbesar; tabel memuat semua item.
            </p>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[360px] border-collapse text-left">
            <thead>
              <tr className="border-b">
                <th className="px-2 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Item
                </th>
                <th className="w-24 px-2 py-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Qty
                </th>
                <th className="w-32 px-2 py-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Subtotal
                </th>
              </tr>
            </thead>
            <tbody>
              {category.items.length === 0 ? (
                <tr>
                  <td
                    colSpan={3}
                    className="px-2 py-8 text-center text-sm italic text-muted-foreground"
                  >
                    Belum ada data.
                  </td>
                </tr>
              ) : (
                category.items.map((item) => (
                  <tr key={item.id} className="border-b last:border-0 hover:bg-muted/50">
                    <td className="px-2 py-2 text-sm">
                      <div className="font-medium text-foreground">{item.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatQuantity(item.entries)} entri
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-right text-sm tabular-nums text-muted-foreground">
                      {formatQuantity(item.quantity)}
                      {item.unit ? ` ${item.unit}` : ""}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-right text-sm font-semibold tabular-nums text-foreground">
                      {formatRp(item.subtotal)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {category.items.length > 0 && (
              <tfoot>
                <tr className="border-t-2">
                  <td className="px-2 py-2 text-sm font-semibold text-foreground">Total</td>
                  <td />
                  <td className="whitespace-nowrap px-2 py-2 text-right text-sm font-bold tabular-nums text-foreground">
                    {formatRp(category.total)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}

const CATEGORY_ICONS = {
  "Biaya Operasional": <Wallet className="h-4 w-4" />,
  "Beban Makan": <Utensils className="h-4 w-4" />,
  Spoiled: <AlertTriangle className="h-4 w-4" />,
  Denda: <ReceiptText className="h-4 w-4" />,
} satisfies Record<WasteCategory, ReactNode>;

export function WasteBreakdownSection({
  entries,
  filter,
}: {
  entries: WasteEntry[];
  filter?: DashboardFilter;
}) {
  const summary = useMemo(() => computeWasteSummary(entries, filter), [entries, filter]);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-foreground">Waste</h2>
        <p className="text-sm text-muted-foreground">
          Total kerugian waste aktif dan rincian item per kategori. Entri dibatalkan atau dihapus
          tidak dihitung.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <div className="rounded-lg border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <AlertTriangle className="h-4 w-4" />
            <span className="text-xs font-medium uppercase tracking-wide">Total Waste</span>
          </div>
          <p className="mt-2 text-2xl font-bold tabular-nums text-foreground">
            {formatRp(summary.total)}
          </p>
          <p className="text-xs text-muted-foreground">{formatQuantity(summary.entries)} entri</p>
        </div>

        {summary.categories.map((category) => (
          <div key={category.key} className="rounded-lg border bg-card p-4 shadow-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              {CATEGORY_ICONS[category.key]}
              <span className="truncate text-xs font-medium uppercase tracking-wide">
                {category.label}
              </span>
            </div>
            <p className="mt-2 text-lg font-bold tabular-nums text-foreground">
              {formatRp(category.total)}
            </p>
            <p className="text-xs text-muted-foreground">
              {formatQuantity(category.entries)} entri · {formatQuantity(category.items.length)}{" "}
              item
            </p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border bg-card p-3 shadow-sm md:p-4">
          <div className="mb-2">
            <h3 className="text-base font-bold text-foreground">Komposisi Waste</h3>
            <p className="text-sm text-muted-foreground">Berdasarkan nilai kerugian</p>
          </div>
          <WasteCategoryDonut categories={summary.categories} total={summary.total} />
        </div>

        <div className="rounded-lg border bg-card p-3 shadow-sm md:p-4">
          <div className="mb-2">
            <h3 className="text-base font-bold text-foreground">Ringkasan Kategori</h3>
            <p className="text-sm text-muted-foreground">Total dan jumlah item per kategori</p>
          </div>
          <div className="divide-y">
            {summary.categories.map((category) => (
              <div key={category.key} className="flex items-center justify-between gap-3 py-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: category.color }}
                    aria-hidden="true"
                  />
                  <span className="truncate text-sm font-medium text-foreground">
                    {category.label}
                  </span>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold tabular-nums text-foreground">
                    {formatRp(category.total)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatQuantity(category.items.length)} item
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {summary.categories.map((category) => (
        <WasteCategoryCard key={category.key} category={category} />
      ))}
    </section>
  );
}
