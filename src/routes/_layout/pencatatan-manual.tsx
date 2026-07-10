import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import { usePageTitle } from "#/hooks/usePageTitle";
import { getBranches } from "#/lib/server/branches";
import {
  getRecipesWithHpp,
  getEmployeeMealSummary,
  getExpensesByCategory,
  getPencatatanManualSummary,
} from "#/lib/server/finance";
import { formatRp } from "#/lib/utils";

export const Route = createFileRoute("/_layout/pencatatan-manual")({
  component: PencatatanManualPage,
  loader: async () => {
    const branches = await getBranches({ data: {} });
    return { branches };
  },
});

function PencatatanManualPage() {
  const { branches } = Route.useLoaderData();
  usePageTitle("Pencatatan Manual", "Rekap biaya operasional, beban makan, dan laporan keuangan");

  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(() => {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [selectedBranchId, setSelectedBranchId] = useState<string>("");
  const [christopher, setChristopher] = useState<number>(0);

  const branchId = selectedBranchId || undefined;

  // Compute date range from month
  const { dateFrom, dateTo } = useMemo(() => {
    const [y, m] = selectedMonth.split("-").map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    return {
      dateFrom: `${selectedMonth}-01`,
      dateTo: `${selectedMonth}-${String(lastDay).padStart(2, "0")}`,
    };
  }, [selectedMonth]);

  // Fetch all data
  const { data: recipes } = useQuery({
    queryKey: ["recipes-hpp"],
    queryFn: () => getRecipesWithHpp({ data: {} }),
  });

  const { data: meals, isLoading: mealsLoading } = useQuery({
    queryKey: ["employee-meals", branchId, dateFrom, dateTo],
    queryFn: () => getEmployeeMealSummary({ data: { branchId, dateFrom, dateTo } }),
  });

  const { data: expenses } = useQuery({
    queryKey: ["expenses-by-category", branchId, dateFrom, dateTo],
    queryFn: () => getExpensesByCategory({ data: { branchId, dateFrom, dateTo } }),
  });

  const { data: summary } = useQuery({
    queryKey: ["pencatatan-summary", branchId, dateFrom, dateTo, christopher],
    queryFn: () =>
      getPencatatanManualSummary({
        data: { branchId, dateFrom, dateTo, christopher },
      }),
  });

  // Aggregate employee meals by staff
  const mealsByStaff = useMemo(() => {
    if (!meals) return [];
    const map = new Map<string, { staffName: string; items: Map<string, number>; total: number }>();
    for (const m of meals) {
      const existing = map.get(m.staffName);
      if (existing) {
        existing.items.set(
          m.ingredientName,
          (existing.items.get(m.ingredientName) ?? 0) + m.quantity,
        );
        existing.total += m.valuation;
      } else {
        map.set(m.staffName, {
          staffName: m.staffName,
          items: new Map([[m.ingredientName, m.quantity]]),
          total: m.valuation,
        });
      }
    }
    return Array.from(map.values());
  }, [meals]);

  // Get unique ingredient names for columns
  const mealColumns = useMemo(() => {
    if (!meals) return [];
    const names = new Set<string>();
    for (const m of meals) {
      names.add(m.ingredientName);
    }
    return Array.from(names).sort();
  }, [meals]);

  // Get operational expenses (non-fixed-cost categories)
  const operasionalExpenses = useMemo(() => {
    return expenses?.find((e) => e.category === "Operasional")?.items ?? [];
  }, [expenses]);

  // Get fixed cost categories
  const fixedCosts = useMemo(() => {
    const gaji = expenses?.find((e) => e.category === "Gaji")?.items ?? [];
    const listrikAir = expenses?.find((e) => e.category === "ListrikAir")?.items ?? [];
    const wifi = expenses?.find((e) => e.category === "Wifi")?.items ?? [];
    const sewa = expenses?.find((e) => e.category === "Sewa")?.items ?? [];
    return {
      gaji: gaji.reduce((s, i) => s + i.amount, 0),
      listrikAir: listrikAir.reduce((s, i) => s + i.amount, 0),
      wifi: wifi.reduce((s, i) => s + i.amount, 0),
      sewa: sewa.reduce((s, i) => s + i.amount, 0),
    };
  }, [expenses]);

  // Month label for display
  const monthLabel = useMemo(() => {
    const [y, m] = selectedMonth.split("-").map(Number);
    const date = new Date(y, m - 1);
    return date.toLocaleDateString("id-ID", { month: "long", year: "numeric" });
  }, [selectedMonth]);

  return (
    <RoleGuard allowedRoles={["super_admin"]}>
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 mb-6 p-4 rounded-lg border">
        {/* Month picker */}
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Bulan</label>
          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm block"
          />
        </div>

        {/* Branch */}
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Cabang</label>
          <select
            value={selectedBranchId}
            onChange={(e) => setSelectedBranchId(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm block"
          >
            <option value="">Semua Cabang</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Section 1: Harga HPP Makan Pegawai */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3">Harga HPP Makan Pegawai</h2>
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left py-2.5 px-3 font-medium">Menu</th>
                <th className="text-right py-2.5 px-3 font-medium w-32">HPP</th>
              </tr>
            </thead>
            <tbody>
              {recipes && recipes.length > 0 ? (
                recipes.map((r) => (
                  <tr key={r.id} className="border-b">
                    <td className="py-2 px-3">{r.name}</td>
                    <td className="py-2 px-3 text-right tabular-nums font-medium">
                      {formatRp(r.totalCogs)}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={2} className="py-8 text-center text-muted-foreground">
                    Tidak ada data HPP menu
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Section 2: Beban Makan Pegawai */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3">Beban Makan Pegawai</h2>
        <div className="rounded-lg border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left py-2.5 px-3 font-medium">Nama Pegawai</th>
                  {mealColumns.map((col) => (
                    <th key={col} className="text-right py-2.5 px-3 font-medium w-24">
                      {col}
                    </th>
                  ))}
                  <th className="text-right py-2.5 px-3 font-medium w-32">Beban Makan</th>
                </tr>
              </thead>
              <tbody>
                {mealsLoading ? (
                  <tr>
                    <td
                      colSpan={mealColumns.length + 2}
                      className="py-8 text-center text-muted-foreground"
                    >
                      Memuat data beban makan…
                    </td>
                  </tr>
                ) : mealsByStaff.length > 0 ? (
                  <>
                    {mealsByStaff.map((staff) => (
                      <tr key={staff.staffName} className="border-b">
                        <td className="py-2 px-3 font-medium">{staff.staffName}</td>
                        {mealColumns.map((col) => (
                          <td key={col} className="py-2 px-3 text-right tabular-nums">
                            {staff.items.get(col) ?? "-"}
                          </td>
                        ))}
                        <td className="py-2 px-3 text-right tabular-nums font-medium">
                          {formatRp(staff.total)}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t-2 font-semibold bg-muted/30">
                      <td className="py-2.5 px-3">Total</td>
                      {mealColumns.map((col) => {
                        const total = mealsByStaff.reduce(
                          (sum, s) => sum + (s.items.get(col) ?? 0),
                          0,
                        );
                        return (
                          <td key={col} className="py-2.5 px-3 text-right tabular-nums">
                            {total || "-"}
                          </td>
                        );
                      })}
                      <td className="py-2.5 px-3 text-right tabular-nums">
                        {formatRp(mealsByStaff.reduce((sum, s) => sum + s.total, 0))}
                      </td>
                    </tr>
                  </>
                ) : (
                  <tr>
                    <td
                      colSpan={mealColumns.length + 2}
                      className="py-8 text-center text-muted-foreground"
                    >
                      Tidak ada data beban makan
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Section 3: Rincian Biaya Operasional */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3">Rincian Biaya Operasional</h2>
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left py-2.5 px-3 font-medium w-12">No</th>
                <th className="text-left py-2.5 px-3 font-medium">Items</th>
                <th className="text-left py-2.5 px-3 font-medium w-28">Tanggal</th>
                <th className="text-right py-2.5 px-3 font-medium w-32">Total</th>
              </tr>
            </thead>
            <tbody>
              {operasionalExpenses.length > 0 ? (
                <>
                  {operasionalExpenses.map((item, i) => (
                    <tr key={item.id} className="border-b">
                      <td className="py-2 px-3 text-muted-foreground">{i + 1}</td>
                      <td className="py-2 px-3">{item.notes ?? "-"}</td>
                      <td className="py-2 px-3 text-muted-foreground">{item.date}</td>
                      <td className="py-2 px-3 text-right tabular-nums font-medium">
                        {formatRp(item.amount)}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t-2 font-semibold bg-muted/30">
                    <td colSpan={3} className="py-2.5 px-3 text-right">
                      Total
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums">
                      {formatRp(operasionalExpenses.reduce((sum, item) => sum + item.amount, 0))}
                    </td>
                  </tr>
                </>
              ) : (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-muted-foreground">
                    Tidak ada data biaya operasional
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Section 4: Rekap Keuangan */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3">Rekap Keuangan</h2>
        <div className="rounded-lg border overflow-hidden">
          <div className="p-4">
            {/* Header */}
            <div className="text-center mb-4 pb-3 border-b">
              <div className="font-semibold">OMOIYARI</div>
              <div className="text-sm text-muted-foreground">{monthLabel}</div>
            </div>

            {/* Cost breakdown */}
            <div className="max-w-md space-y-0">
              <SummaryRow label="Biaya Makan Staff" value={summary?.biayaMakanStaff ?? 0} />
              <SummaryRow label="Biaya Operasional" value={summary?.biayaOperasional ?? 0} />
              <SummaryRow label="Biaya Gaji" value={fixedCosts.gaji || (summary?.biayaGaji ?? 0)} />
              <SummaryRow
                label="Biaya Listrik dan Air"
                value={fixedCosts.listrikAir || (summary?.biayaListrikAir ?? 0)}
              />
              <SummaryRow label="Wifi" value={fixedCosts.wifi || (summary?.biayaWifi ?? 0)} />
              <SummaryRow label="Biaya Sewa" value={fixedCosts.sewa || (summary?.biayaSewa ?? 0)} />
              <div className="flex justify-between py-2 border-t mt-2">
                <span className="font-semibold">Total</span>
                <span className="font-semibold tabular-nums">{formatRp(summary?.total ?? 0)}</span>
              </div>

              <div className="border-t my-4" />

              {/* Revenue */}
              <SummaryRow label="HPP" value={summary?.hpp ?? 0} />
              <SummaryRow label="Piutang Penjualan" value={summary?.piutangPenjualan ?? 0} />
              <div className="flex justify-between py-2">
                <span className="text-muted-foreground">Profit Margin</span>
                <span
                  className={`tabular-nums font-medium ${(summary?.profitMargin ?? 0) >= 0 ? "text-emerald-600" : "text-destructive"}`}
                >
                  {formatRp(summary?.profitMargin ?? 0)}
                </span>
              </div>

              <div className="border-t my-4" />

              {/* Profit split */}
              <div className="flex justify-between py-2">
                <span className="font-semibold">Nett Profit</span>
                <span
                  className={`tabular-nums font-semibold ${(summary?.nettProfit ?? 0) >= 0 ? "text-emerald-600" : "text-destructive"}`}
                >
                  {formatRp(summary?.nettProfit ?? 0)}
                </span>
              </div>
              <SummaryRow label="Biaya Franchise (5%)" value={summary?.biayaFranchise ?? 0} />

              {/* Christopher input */}
              <div className="flex items-center justify-between py-2">
                <label className="text-muted-foreground">Christopher</label>
                <input
                  type="number"
                  value={christopher || ""}
                  onChange={(e) => setChristopher(Number(e.target.value) || 0)}
                  placeholder="0"
                  className="h-8 w-36 rounded-md border border-input bg-background px-2 text-sm text-right tabular-nums"
                />
              </div>

              <div className="flex justify-between py-2 border-t">
                <span className="font-semibold">Pusat</span>
                <span
                  className={`tabular-nums font-semibold ${(summary?.pusat ?? 0) >= 0 ? "text-emerald-600" : "text-destructive"}`}
                >
                  {formatRp(summary?.pusat ?? 0)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </RoleGuard>
  );
}

function SummaryRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between py-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums font-medium">{formatRp(value)}</span>
    </div>
  );
}
