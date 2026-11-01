import { useMemo } from "react";
import type { ReactNode } from "react";
import { ArrowRightLeft, PackageMinus, PackagePlus, Store } from "lucide-react";
import { formatQuantity } from "#/lib/utils";
import { matchesDashboardFilter, type DashboardFilter } from "#/lib/dashboard-filter";
import { RankedBarChart, type RankedBarDatum } from "#/components/dashboard/RankedBarChart";

export interface ProductionItem {
  ingredientId: string;
  ingredientName: string | null;
  stockUnit: string | null;
  quantity: number;
}

export interface ProductionRecord {
  id: string;
  branchId: string;
  branchName: string | null;
  status?: "Active" | "Cancelled";
  productionDate?: Date | string;
  createdAt?: Date | string;
  out: ProductionItem[];
  produced: ProductionItem[];
}

export interface ProductionItemRow {
  ingredientId: string;
  name: string;
  unit: string | null;
  quantity: number;
  branchCount: number;
}

export interface ProductionBranchRow {
  branchId: string;
  branchName: string;
  batches: number;
  producedTotal: number;
  outTotal: number;
  produced: ProductionItemRow[];
  out: ProductionItemRow[];
}

export interface ProductionSummary {
  branches: ProductionBranchRow[];
  topProduced: ProductionItemRow[];
  totalBatches: number;
  totalProduced: number;
  totalOut: number;
}

interface ItemAccumulator {
  ingredientId: string;
  name: string;
  unit: string | null;
  quantity: number;
  branchIds: Set<string>;
}

interface BranchAccumulator {
  branchId: string;
  branchName: string;
  batches: number;
  producedTotal: number;
  outTotal: number;
  produced: Map<string, ItemAccumulator>;
  out: Map<string, ItemAccumulator>;
}

function addItems(
  target: Map<string, ItemAccumulator>,
  items: ProductionItem[],
  branchId: string,
): number {
  let total = 0;
  for (const item of items) {
    const quantity = Number(item.quantity) || 0;
    if (quantity <= 0) continue;
    total += quantity;
    const existing = target.get(item.ingredientId);
    if (existing) {
      existing.quantity += quantity;
      existing.branchIds.add(branchId);
    } else {
      target.set(item.ingredientId, {
        ingredientId: item.ingredientId,
        name: item.ingredientName ?? item.ingredientId,
        unit: item.stockUnit,
        quantity,
        branchIds: new Set([branchId]),
      });
    }
  }
  return total;
}

function toRows(items: Map<string, ItemAccumulator>): ProductionItemRow[] {
  return [...items.values()]
    .map((item) => ({
      ingredientId: item.ingredientId,
      name: item.name,
      unit: item.unit,
      quantity: item.quantity,
      branchCount: item.branchIds.size,
    }))
    .sort((a, b) => b.quantity - a.quantity);
}

/**
 * Aggregate Active production records into per-branch cooked-item totals.
 * Cancelled records are excluded (their stock effect is reversed) and the
 * item rows keep the ingredient's stock unit so quantities are never compared
 * across units silently.
 */
export function computeProductionSummary(
  records: ProductionRecord[],
  filter: DashboardFilter = {},
): ProductionSummary {
  const branchMap = new Map<string, BranchAccumulator>();
  const itemMap = new Map<string, ItemAccumulator>();
  let totalBatches = 0;
  let totalProduced = 0;
  let totalOut = 0;

  for (const record of records) {
    if (record.status !== undefined && record.status !== "Active") continue;
    if (
      !matchesDashboardFilter(record.productionDate ?? record.createdAt, record.branchId, filter)
    ) {
      continue;
    }

    let branch = branchMap.get(record.branchId);
    if (!branch) {
      branch = {
        branchId: record.branchId,
        branchName: record.branchName ?? record.branchId,
        batches: 0,
        producedTotal: 0,
        outTotal: 0,
        produced: new Map(),
        out: new Map(),
      };
      branchMap.set(record.branchId, branch);
    }

    branch.batches += 1;
    totalBatches += 1;

    const produced = addItems(branch.produced, record.produced, record.branchId);
    const out = addItems(branch.out, record.out, record.branchId);
    branch.producedTotal += produced;
    branch.outTotal += out;
    totalProduced += produced;
    totalOut += out;

    for (const item of record.produced) {
      const quantity = Number(item.quantity) || 0;
      if (quantity <= 0) continue;
      const existing = itemMap.get(item.ingredientId);
      if (existing) {
        existing.quantity += quantity;
        existing.branchIds.add(record.branchId);
      } else {
        itemMap.set(item.ingredientId, {
          ingredientId: item.ingredientId,
          name: item.ingredientName ?? item.ingredientId,
          unit: item.stockUnit,
          quantity,
          branchIds: new Set([record.branchId]),
        });
      }
    }
  }

  const branches = [...branchMap.values()]
    .map((branch) => ({
      branchId: branch.branchId,
      branchName: branch.branchName,
      batches: branch.batches,
      producedTotal: branch.producedTotal,
      outTotal: branch.outTotal,
      produced: toRows(branch.produced),
      out: toRows(branch.out),
    }))
    .sort((a, b) => b.producedTotal - a.producedTotal);

  return {
    branches,
    topProduced: toRows(itemMap),
    totalBatches,
    totalProduced,
    totalOut,
  };
}

function StatCard({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-bold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

export function ProductionTrackingSection({
  records,
  filter,
}: {
  records: ProductionRecord[];
  filter?: DashboardFilter;
}) {
  const summary = useMemo(() => computeProductionSummary(records, filter), [records, filter]);

  const branchChartData: RankedBarDatum[] = summary.branches.map((branch) => ({
    id: branch.branchId,
    name: branch.branchName,
    value: branch.producedTotal,
  }));

  const itemChartData: RankedBarDatum[] = summary.topProduced.map((item) => ({
    id: item.ingredientId,
    name: item.name,
    value: item.quantity,
  }));

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-foreground">Tracking Produksi</h2>
        <p className="text-sm text-muted-foreground">
          Total masak per cabang — barang dihasilkan dan jumlahnya, dari seluruh catatan produksi
          aktif.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          icon={<ArrowRightLeft className="h-4 w-4" />}
          label="Total Batch"
          value={formatQuantity(summary.totalBatches)}
        />
        <StatCard
          icon={<PackagePlus className="h-4 w-4" />}
          label="Barang Dihasilkan"
          value={formatQuantity(summary.totalProduced)}
        />
        <StatCard
          icon={<PackageMinus className="h-4 w-4" />}
          label="Barang Keluar"
          value={formatQuantity(summary.totalOut)}
        />
        <StatCard
          icon={<Store className="h-4 w-4" />}
          label="Cabang Produksi"
          value={formatQuantity(summary.branches.length)}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border bg-card p-3 shadow-sm md:p-4">
          <div className="mb-2">
            <h3 className="text-base font-bold text-foreground">Total Produksi per Cabang</h3>
            <p className="text-sm text-muted-foreground">
              Jumlah barang dihasilkan (unit)
              {summary.branches.length > 10 ? " — 10 cabang terbesar" : ""}
            </p>
          </div>
          <RankedBarChart
            data={branchChartData}
            color="var(--color-chart-1)"
            valueKind="quantity"
            ariaLabel="Total barang dihasilkan per cabang"
          />
        </div>

        <div className="rounded-lg border bg-card p-3 shadow-sm md:p-4">
          <div className="mb-2">
            <h3 className="text-base font-bold text-foreground">Barang Paling Banyak Dihasilkan</h3>
            <p className="text-sm text-muted-foreground">
              Akumulasi seluruh cabang (unit)
              {summary.topProduced.length > 10 ? " — 10 item terbesar" : ""}
            </p>
          </div>
          <RankedBarChart
            data={itemChartData}
            color="var(--color-chart-2)"
            valueKind="quantity"
            ariaLabel="Barang yang paling banyak dihasilkan"
          />
        </div>
      </div>

      <div className="rounded-lg border bg-card p-3 shadow-sm md:p-4">
        <div className="mb-3">
          <h3 className="text-base font-bold text-foreground">Rincian Produksi per Cabang</h3>
          <p className="text-sm text-muted-foreground">Apa saja yang dimasak dan totalnya</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left">
            <thead>
              <tr className="border-b">
                <th className="whitespace-nowrap px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Cabang
                </th>
                <th className="w-20 whitespace-nowrap px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Batch
                </th>
                <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Barang Dihasilkan
                </th>
                <th className="w-32 whitespace-nowrap px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {summary.branches.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-3 py-8 text-center text-sm italic text-muted-foreground"
                  >
                    Belum ada catatan produksi aktif.
                  </td>
                </tr>
              ) : (
                summary.branches.map((branch) => (
                  <tr key={branch.branchId} className="border-b last:border-0 hover:bg-muted/50">
                    <td className="whitespace-nowrap px-3 py-3 text-sm font-medium text-foreground">
                      {branch.branchName}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right text-sm tabular-nums text-muted-foreground">
                      {formatQuantity(branch.batches)}
                    </td>
                    <td className="px-3 py-3 text-sm">
                      {branch.produced.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <div className="space-y-0.5">
                          {branch.produced.map((item) => (
                            <div
                              key={item.ingredientId}
                              className="flex items-baseline justify-between gap-3"
                            >
                              <span className="truncate">{item.name}</span>
                              <span className="whitespace-nowrap tabular-nums text-muted-foreground">
                                {formatQuantity(item.quantity)}
                                {item.unit ? ` ${item.unit}` : ""}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right text-sm font-semibold tabular-nums text-foreground">
                      {formatQuantity(branch.producedTotal)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
