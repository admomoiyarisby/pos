import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import RoleGuard from "#/components/RoleGuard";
import { usePageTitle } from "#/hooks/usePageTitle";
import { getBranches } from "#/lib/server/branches";
import {
  getRecipesWithHpp,
  getEmployeeMealSummary,
  getExpensesByCategory,
  getPencatatanManualSummary,
  saveFixedCosts,
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

  const queryClient = useQueryClient();
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(() => {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [selectedBranchId, setSelectedBranchId] = useState<string>("");
  const [christopher, setChristopher] = useState<number>(0);

  // Editable fixed costs (local state)
  const [editGaji, setEditGaji] = useState<string>("");
  const [editListrikAir, setEditListrikAir] = useState<string>("");
  const [editWifi, setEditWifi] = useState<string>("");
  const [editSewa, setEditSewa] = useState<string>("");
  const [hasEdits, setHasEdits] = useState(false);

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

  // Initialize editable fields when summary loads
  useMemo(() => {
    if (summary && !hasEdits) {
      setEditGaji(String(summary.biayaGaji));
      setEditListrikAir(String(summary.biayaListrikAir));
      setEditWifi(String(summary.biayaWifi));
      setEditSewa(String(summary.biayaSewa));
    }
  }, [summary, hasEdits]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: () =>
      saveFixedCosts({
        data: {
          branchId: branchId!,
          dateFrom,
          dateTo,
          gaji: Number(editGaji) || 0,
          listrikAir: Number(editListrikAir) || 0,
          wifi: Number(editWifi) || 0,
          sewa: Number(editSewa) || 0,
        },
      }),
    onSuccess: () => {
      toast.success("Biaya tetap berhasil disimpan");
      setHasEdits(false);
      void queryClient.invalidateQueries({ queryKey: ["pencatatan-summary"] });
      void queryClient.invalidateQueries({ queryKey: ["expenses-by-category"] });
    },
    onError: (err: Error) => {
      toast.error("Gagal menyimpan", { description: err.message });
    },
  });

  const handleSave = useCallback(() => {
    if (!branchId) {
      toast.error("Pilih cabang terlebih dahulu");
      return;
    }
    saveMutation.mutate();
  }, [branchId, saveMutation]);

  const markEdited = useCallback(() => setHasEdits(true), []);

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
    for (const m of meals) names.add(m.ingredientName);
    return Array.from(names).sort();
  }, [meals]);

  // Get operational expenses (non-fixed-cost categories)
  const operasionalExpenses = useMemo(() => {
    return expenses?.find((e) => e.category === "Operasional")?.items ?? [];
  }, [expenses]);

  // Month label
  const monthLabel = useMemo(() => {
    const [y, m] = selectedMonth.split("-").map(Number);
    return new Date(y, m - 1).toLocaleDateString("id-ID", { month: "long", year: "numeric" });
  }, [selectedMonth]);

  // Computed totals
  const totalGaji = Number(editGaji) || 0;
  const totalListrikAir = Number(editListrikAir) || 0;
  const totalWifi = Number(editWifi) || 0;
  const totalSewa = Number(editSewa) || 0;
  const biayaMakanStaff = summary?.biayaMakanStaff ?? 0;
  const biayaOperasional = summary?.biayaOperasional ?? 0;
  const totalBiaya =
    biayaMakanStaff + biayaOperasional + totalGaji + totalListrikAir + totalWifi + totalSewa;

  return (
    <RoleGuard allowedRoles={["super_admin"]}>
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 mb-6 p-4 rounded-lg border">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Bulan</label>
          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm block"
          />
        </div>
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

      {/* HPP + Employee Meals side by side on large screens */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mb-8">
        {/* HPP Table */}
        <section className="xl:col-span-1">
          <h2 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wide">
            Harga HPP Makan Pegawai
          </h2>
          <div className="rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left py-2 px-3 font-medium">Menu</th>
                  <th className="text-right py-2 px-3 font-medium w-28">HPP</th>
                </tr>
              </thead>
              <tbody>
                {recipes?.map((r) => (
                  <tr key={r.id} className="border-b last:border-b-0">
                    <td className="py-1.5 px-3">{r.name}</td>
                    <td className="py-1.5 px-3 text-right tabular-nums">{formatRp(r.totalCogs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Employee Meals Table */}
        <section className="xl:col-span-2">
          <h2 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wide">
            Beban Makan Pegawai
          </h2>
          <div className="rounded-lg border">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left py-2 px-3 font-medium">Nama</th>
                    {mealColumns.map((col) => (
                      <th key={col} className="text-right py-2 px-2 font-medium min-w-[60px]">
                        {col}
                      </th>
                    ))}
                    <th className="text-right py-2 px-3 font-medium w-28">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {mealsLoading ? (
                    <tr>
                      <td
                        colSpan={mealColumns.length + 2}
                        className="py-6 text-center text-muted-foreground"
                      >
                        Memuat…
                      </td>
                    </tr>
                  ) : mealsByStaff.length > 0 ? (
                    <>
                      {mealsByStaff.map((staff) => (
                        <tr key={staff.staffName} className="border-b last:border-b-0">
                          <td className="py-1.5 px-3 font-medium whitespace-nowrap">
                            {staff.staffName}
                          </td>
                          {mealColumns.map((col) => (
                            <td key={col} className="py-1.5 px-2 text-right tabular-nums">
                              {staff.items.get(col) ?? "-"}
                            </td>
                          ))}
                          <td className="py-1.5 px-3 text-right tabular-nums font-medium">
                            {formatRp(staff.total)}
                          </td>
                        </tr>
                      ))}
                      <tr className="border-t-2 font-semibold bg-muted/30">
                        <td className="py-2 px-3">Total</td>
                        {mealColumns.map((col) => {
                          const t = mealsByStaff.reduce((s, st) => s + (st.items.get(col) ?? 0), 0);
                          return (
                            <td key={col} className="py-2 px-2 text-right tabular-nums">
                              {t || "-"}
                            </td>
                          );
                        })}
                        <td className="py-2 px-3 text-right tabular-nums">
                          {formatRp(mealsByStaff.reduce((s, st) => s + st.total, 0))}
                        </td>
                      </tr>
                    </>
                  ) : (
                    <tr>
                      <td
                        colSpan={mealColumns.length + 2}
                        className="py-6 text-center text-muted-foreground"
                      >
                        Tidak ada data
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>

      {/* Operational Expenses */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wide">
          Rincian Biaya Operasional
        </h2>
        <div className="rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left py-2 px-3 font-medium w-10">No</th>
                <th className="text-left py-2 px-3 font-medium">Items</th>
                <th className="text-left py-2 px-3 font-medium w-28">Tanggal</th>
                <th className="text-right py-2 px-3 font-medium w-28">Total</th>
              </tr>
            </thead>
            <tbody>
              {operasionalExpenses.length > 0 ? (
                <>
                  {operasionalExpenses.map((item, i) => (
                    <tr key={item.id} className="border-b last:border-b-0">
                      <td className="py-1.5 px-3 text-muted-foreground">{i + 1}</td>
                      <td className="py-1.5 px-3">{item.notes ?? "-"}</td>
                      <td className="py-1.5 px-3 text-muted-foreground text-xs">{item.date}</td>
                      <td className="py-1.5 px-3 text-right tabular-nums">
                        {formatRp(item.amount)}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t-2 font-semibold bg-muted/30">
                    <td colSpan={3} className="py-2 px-3 text-right">
                      Total
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums">
                      {formatRp(biayaOperasional)}
                    </td>
                  </tr>
                </>
              ) : (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-muted-foreground">
                    Tidak ada data
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Rekap Keuangan — two-column: costs (left) + P&L (right) */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wide">
          Rekap Keuangan
        </h2>
        <div className="rounded-lg border overflow-hidden">
          <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x">
            {/* Left: Cost breakdown */}
            <div className="p-4 space-y-3">
              <div className="text-center mb-2">
                <div className="font-semibold text-sm">OMOIYARI</div>
                <div className="text-xs text-muted-foreground">{monthLabel}</div>
              </div>

              <CostRow label="Biaya Makan Staff" value={biayaMakanStaff} />
              <CostRow label="Biaya Operasional" value={biayaOperasional} />

              {/* Editable fixed costs */}
              <EditableCostRow
                label="Biaya Gaji"
                value={editGaji}
                onChange={(v) => {
                  setEditGaji(v);
                  markEdited();
                }}
              />
              <EditableCostRow
                label="Listrik & Air"
                value={editListrikAir}
                onChange={(v) => {
                  setEditListrikAir(v);
                  markEdited();
                }}
              />
              <EditableCostRow
                label="Wifi"
                value={editWifi}
                onChange={(v) => {
                  setEditWifi(v);
                  markEdited();
                }}
              />
              <EditableCostRow
                label="Biaya Sewa"
                value={editSewa}
                onChange={(v) => {
                  setEditSewa(v);
                  markEdited();
                }}
              />

              <div className="flex justify-between py-2 border-t">
                <span className="font-semibold text-sm">Total Biaya</span>
                <span className="font-semibold tabular-nums text-sm">{formatRp(totalBiaya)}</span>
              </div>

              {/* Save button */}
              {hasEdits && (
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saveMutation.isPending || !branchId}
                  className="w-full h-9 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {saveMutation.isPending ? "Menyimpan…" : "Simpan Biaya Tetap"}
                </button>
              )}
              {!branchId && hasEdits && (
                <p className="text-xs text-destructive text-center">Pilih cabang terlebih dahulu</p>
              )}
            </div>

            {/* Right: P&L */}
            <div className="p-4 space-y-3">
              <div className="text-center mb-2">
                <div className="font-semibold text-sm">Profit & Loss</div>
              </div>

              <CostRow label="HPP" value={summary?.hpp ?? 0} />
              <CostRow label="Piutang Penjualan" value={summary?.piutangPenjualan ?? 0} />
              <div className="flex justify-between py-1.5">
                <span className="text-muted-foreground text-sm">Profit Margin</span>
                <span
                  className={`tabular-nums text-sm font-medium ${(summary?.profitMargin ?? 0) >= 0 ? "text-emerald-600" : "text-destructive"}`}
                >
                  {formatRp(summary?.profitMargin ?? 0)}
                </span>
              </div>

              <div className="border-t my-2" />

              <div className="flex justify-between py-1.5">
                <span className="font-semibold text-sm">Nett Profit</span>
                <span
                  className={`tabular-nums text-sm font-semibold ${(summary?.nettProfit ?? 0) >= 0 ? "text-emerald-600" : "text-destructive"}`}
                >
                  {formatRp(summary?.nettProfit ?? 0)}
                </span>
              </div>
              <CostRow label="Franchise (5%)" value={summary?.biayaFranchise ?? 0} />

              {/* Christopher input */}
              <div className="flex items-center justify-between py-1.5">
                <label className="text-muted-foreground text-sm">Christopher</label>
                <input
                  type="number"
                  value={christopher || ""}
                  onChange={(e) => setChristopher(Number(e.target.value) || 0)}
                  placeholder="0"
                  className="h-8 w-32 rounded border border-input bg-background px-2 text-sm text-right tabular-nums"
                />
              </div>

              <div className="flex justify-between py-2 border-t">
                <span className="font-semibold text-sm">Pusat</span>
                <span
                  className={`tabular-nums text-sm font-semibold ${(summary?.pusat ?? 0) >= 0 ? "text-emerald-600" : "text-destructive"}`}
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

function CostRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between py-1.5">
      <span className="text-muted-foreground text-sm">{label}</span>
      <span className="tabular-nums text-sm font-medium">{formatRp(value)}</span>
    </div>
  );
}

function EditableCostRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <label className="text-muted-foreground text-sm">{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-32 rounded border border-input bg-background px-2 text-sm text-right tabular-nums focus:border-primary focus:outline-none"
      />
    </div>
  );
}
