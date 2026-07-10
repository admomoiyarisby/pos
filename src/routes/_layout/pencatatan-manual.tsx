import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import PageHeader from "#/components/ui/PageHeader";
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
  const [dateFrom, setDateFrom] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  });
  const [dateTo, setDateTo] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  });
  const [selectedBranchId, setSelectedBranchId] = useState<string>("");
  const [christopher, setChristopher] = useState<number>(0);

  const branchId = selectedBranchId || undefined;

  // Fetch all data
  const { data: recipes } = useQuery({
    queryKey: ["recipes-hpp"],
    queryFn: () => getRecipesWithHpp({ data: {} }),
  });

  const { data: meals } = useQuery({
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

  // Get operational expenses
  const operasionalExpenses = useMemo(() => {
    return expenses?.find((e) => e.category === "Operasional")?.items ?? [];
  }, [expenses]);

  usePageTitle("Pencatatan Manual", "Rekap biaya operasional, beban makan, dan laporan keuangan");

  return (
    <RoleGuard allowedRoles={["super_admin"]}>
      <PageHeader />

      {/* Date & Branch Filters */}
      <div className="mb-6 flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Dari</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Sampai</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Cabang</label>
          <select
            value={selectedBranchId}
            onChange={(e) => setSelectedBranchId(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
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

      {/* Section 1: HPP Menu Items */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3">Harga HPP Makan Pegawai</h2>
        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left py-2 px-3 font-medium">Menu</th>
                <th className="text-right py-2 px-3 font-medium w-32">HPP</th>
              </tr>
            </thead>
            <tbody>
              {recipes && recipes.length > 0 ? (
                recipes.map((r) => (
                  <tr key={r.id} className="border-b">
                    <td className="py-2 px-3">{r.name}</td>
                    <td className="py-2 px-3 text-right font-medium">{formatRp(r.totalCogs)}</td>
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

      {/* Section 2: Employee Meal Consumption */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3">Beban Makan Pegawai</h2>
        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left py-2 px-3 font-medium">Nama Pegawai</th>
                {mealColumns.map((col) => (
                  <th key={col} className="text-right py-2 px-3 font-medium w-24">
                    {col}
                  </th>
                ))}
                <th className="text-right py-2 px-3 font-medium w-32">Total</th>
              </tr>
            </thead>
            <tbody>
              {mealsByStaff.length > 0 ? (
                <>
                  {mealsByStaff.map((staff) => (
                    <tr key={staff.staffName} className="border-b">
                      <td className="py-2 px-3 font-medium">{staff.staffName}</td>
                      {mealColumns.map((col) => (
                        <td key={col} className="py-2 px-3 text-right">
                          {staff.items.get(col) ?? "-"}
                        </td>
                      ))}
                      <td className="py-2 px-3 text-right font-medium">{formatRp(staff.total)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 font-semibold">
                    <td className="py-2 px-3">Total</td>
                    {mealColumns.map((col) => {
                      const total = mealsByStaff.reduce(
                        (sum, s) => sum + (s.items.get(col) ?? 0),
                        0,
                      );
                      return (
                        <td key={col} className="py-2 px-3 text-right">
                          {total || "-"}
                        </td>
                      );
                    })}
                    <td className="py-2 px-3 text-right">
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
      </section>

      {/* Section 3: Operational Expenses */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3">Rincian Biaya Operasional</h2>
        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left py-2 px-3 font-medium w-12">No</th>
                <th className="text-left py-2 px-3 font-medium">Item</th>
                <th className="text-left py-2 px-3 font-medium w-24">Tanggal</th>
                <th className="text-right py-2 px-3 font-medium w-32">Total</th>
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
                      <td className="py-2 px-3 text-right font-medium">{formatRp(item.amount)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 font-semibold">
                    <td colSpan={3} className="py-2 px-3 text-right">
                      Total
                    </td>
                    <td className="py-2 px-3 text-right">
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

      {/* Section 4: Financial Summary */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3">Rekap Keuangan</h2>
        <div className="rounded-md border p-4">
          <div className="max-w-md space-y-1">
            {/* Christopher input */}
            <div className="flex items-center justify-between py-1 mb-4">
              <label className="text-sm text-muted-foreground">Christopher (manual)</label>
              <input
                type="number"
                value={christopher || ""}
                onChange={(e) => setChristopher(Number(e.target.value) || 0)}
                placeholder="0"
                className="h-8 w-32 rounded-md border border-input bg-background px-2 text-sm text-right"
              />
            </div>

            {/* Expenses */}
            <div className="flex justify-between py-1">
              <span className="text-muted-foreground">Biaya Makan Staff</span>
              <span className="font-medium">{formatRp(summary?.biayaMakanStaff ?? 0)}</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-muted-foreground">Biaya Operasional</span>
              <span className="font-medium">{formatRp(summary?.biayaOperasional ?? 0)}</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-muted-foreground">Biaya Gaji</span>
              <span className="font-medium">{formatRp(summary?.biayaGaji ?? 0)}</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-muted-foreground">Biaya Listrik & Air</span>
              <span className="font-medium">{formatRp(summary?.biayaListrikAir ?? 0)}</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-muted-foreground">Wifi</span>
              <span className="font-medium">{formatRp(summary?.biayaWifi ?? 0)}</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-muted-foreground">Biaya Sewa</span>
              <span className="font-medium">{formatRp(summary?.biayaSewa ?? 0)}</span>
            </div>
            <div className="flex justify-between py-1 border-t pt-2">
              <span className="font-semibold">Total</span>
              <span className="font-semibold">{formatRp(summary?.total ?? 0)}</span>
            </div>

            <div className="border-t my-4" />

            {/* Revenue */}
            <div className="flex justify-between py-1">
              <span className="text-muted-foreground">HPP</span>
              <span className="font-medium">{formatRp(summary?.hpp ?? 0)}</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-muted-foreground">Piutang Penjualan</span>
              <span className="font-medium">{formatRp(summary?.piutangPenjualan ?? 0)}</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-muted-foreground">Profit Margin</span>
              <span
                className={`font-medium ${(summary?.profitMargin ?? 0) >= 0 ? "text-emerald-600" : "text-destructive"}`}
              >
                {formatRp(summary?.profitMargin ?? 0)}
              </span>
            </div>

            <div className="border-t my-4" />

            {/* Profit split */}
            <div className="flex justify-between py-1">
              <span className="font-semibold">Nett Profit</span>
              <span
                className={`font-semibold ${(summary?.nettProfit ?? 0) >= 0 ? "text-emerald-600" : "text-destructive"}`}
              >
                {formatRp(summary?.nettProfit ?? 0)}
              </span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-muted-foreground">Biaya Franchise (5%)</span>
              <span className="font-medium">{formatRp(summary?.biayaFranchise ?? 0)}</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-muted-foreground">Christopher</span>
              <span className="font-medium">{formatRp(summary?.christopher ?? 0)}</span>
            </div>
            <div className="flex justify-between py-1 border-t pt-2">
              <span className="font-semibold">Pusat</span>
              <span
                className={`font-semibold ${(summary?.pusat ?? 0) >= 0 ? "text-emerald-600" : "text-destructive"}`}
              >
                {formatRp(summary?.pusat ?? 0)}
              </span>
            </div>
          </div>
        </div>
      </section>
    </RoleGuard>
  );
}
