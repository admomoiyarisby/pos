import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import { usePageTitle } from "#/hooks/usePageTitle";
import Modal from "#/components/ui/Modal";
import {
  getFinanceSummary,
  getDailyFinanceSummary,
  createManualRevenue,
  createChannelRevenue,
  createManualExpense,
  getManualExpenses,
  deleteManualExpense,
  printFinancePage,
} from "#/lib/server/finance";
import { getBranches } from "#/lib/server/branches";
import { TrendingDown, PiggyBank, Percent, Receipt } from "lucide-react";
import { formatRp } from "#/lib/utils";
import { openPrintWindow } from "#/lib/print-window";
import { toast } from "sonner";

export const Route = createFileRoute("/_layout/finance/")({
  component: FinancePage,
  loader: async () => {
    const summary = await getFinanceSummary({ data: {} });
    const branches = await getBranches({ data: {} });
    return { summary, branches };
  },
});

function FinancePage() {
  const { summary: initial, branches } = Route.useLoaderData();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [expenseModalOpen, setExpenseModalOpen] = useState(false);
  const [revenueType, setRevenueType] = useState<"manual" | "channel">("manual");
  const [dateRange, setDateRange] = useState(() => {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    return {
      from: firstDay.toISOString().split("T")[0],
      to: now.toISOString().split("T")[0],
    };
  });

  // Branch state
  const [selectedBranchId, setSelectedBranchId] = useState<string>("");
  const [checkedBranches, setCheckedBranches] = useState<Set<string>>(new Set());

  // Selected day for analytics panel
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  // Christopher input
  const [christopher, setChristopher] = useState<number>(0);

  // Initialize checked branches
  useMemo(() => {
    if (branches.length > 0 && checkedBranches.size === 0) {
      setCheckedBranches(new Set(branches.map((b) => b.id)));
    }
  }, [branches]);

  const branchId = selectedBranchId || undefined;

  const { data: summary } = useQuery({
    queryKey: ["finance-summary", dateRange.from, dateRange.to, branchId],
    queryFn: () =>
      getFinanceSummary({
        data: {
          dateFrom: dateRange.from || undefined,
          dateTo: dateRange.to || undefined,
          branchId,
        },
      }),
    initialData: initial,
  });

  const { data: dailyRows } = useQuery({
    queryKey: ["daily-finance", dateRange.from, dateRange.to, branchId],
    queryFn: () =>
      getDailyFinanceSummary({
        data: {
          dateFrom: dateRange.from || undefined,
          dateTo: dateRange.to || undefined,
          branchId,
        },
      }),
  });

  const { data: expenses } = useQuery({
    queryKey: ["manual-expenses", dateRange.from, dateRange.to, branchId],
    queryFn: () =>
      getManualExpenses({
        data: {
          dateFrom: dateRange.from || undefined,
          dateTo: dateRange.to || undefined,
          branchId,
        },
      }),
  });

  const createManualMutation = useMutation({
    mutationFn: createManualRevenue,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["finance-summary"] });
      void queryClient.invalidateQueries({ queryKey: ["daily-finance"] });
      setModalOpen(false);
    },
  });

  const createChannelMutation = useMutation({
    mutationFn: createChannelRevenue,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["finance-summary"] });
      void queryClient.invalidateQueries({ queryKey: ["daily-finance"] });
      setModalOpen(false);
    },
  });

  const createExpenseMutation = useMutation({
    mutationFn: createManualExpense,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["finance-summary"] });
      void queryClient.invalidateQueries({ queryKey: ["manual-expenses"] });
      setExpenseModalOpen(false);
      toast.success("Pengeluaran berhasil dicatat");
    },
    onError: (err) => {
      toast.error("Gagal mencatat pengeluaran", { description: err.message });
    },
  });

  const deleteExpenseMutation = useMutation({
    mutationFn: deleteManualExpense,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["finance-summary"] });
      void queryClient.invalidateQueries({ queryKey: ["manual-expenses"] });
      toast.success("Pengeluaran berhasil dihapus");
    },
    onError: (err) => {
      toast.error("Gagal menghapus pengeluaran", { description: err.message });
    },
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (revenueType === "manual") {
      void createManualMutation.mutateAsync({
        data: {
          branchId: fd.get("branchId") as string,
          date: fd.get("date") as string,
          amount: Number(fd.get("amount")),
          notes: (fd.get("notes") as string) || undefined,
        },
      });
    } else {
      void createChannelMutation.mutateAsync({
        data: {
          branchId: fd.get("branchId") as string,
          date: fd.get("date") as string,
          channel: fd.get("channel") as "Gofood" | "Grabfood" | "ShopeeFood" | "Dine-in" | "TikTok",
          amount: Number(fd.get("amount")),
          notes: (fd.get("notes") as string) || undefined,
        },
      });
    }
  };

  // Toggle branch checkbox
  const toggleBranch = (branchId: string) => {
    setCheckedBranches((prev) => {
      const next = new Set(prev);
      if (next.has(branchId)) {
        next.delete(branchId);
      } else {
        next.add(branchId);
      }
      return next;
    });
  };

  // Selected day data (from dailyRows)
  const selectedDayData = useMemo(() => {
    if (!selectedDay || !dailyRows) return null;
    return dailyRows.find((r) => r.tanggal === selectedDay) ?? null;
  }, [selectedDay, dailyRows]);

  // Summary for checked branches (uses summary which is already branch-filtered)
  // For now, we show the selected branch summary. Multi-branch requires separate queries.
  const displaySummary = summary;

  const cards = [
    {
      label: "Omzet Bruto",
      value: displaySummary.totalSales,
      icon: Receipt,
      color: "text-blue-600",
    },
    {
      label: "HPP / COGS",
      value: displaySummary.totalCogs,
      icon: TrendingDown,
      color: "text-red-500",
    },
    {
      label: "Gross Profit",
      value: displaySummary.grossProfit,
      icon: PiggyBank,
      color: displaySummary.grossProfit >= 0 ? "text-emerald-600" : "text-red-500",
    },
    {
      label: "Food Cost %",
      value:
        displaySummary.totalSales > 0
          ? Math.round((displaySummary.totalCogs / displaySummary.totalSales) * 100)
          : 0,
      icon: Percent,
      color:
        displaySummary.totalSales > 0 && displaySummary.totalCogs / displaySummary.totalSales > 0.4
          ? "text-red-500"
          : "text-emerald-600",
      suffix: "%",
    },
  ];

  usePageTitle("Keuangan & Rekonsiliasi", "Input uang cair & kalkulasi profitabilitas");

  return (
    <RoleGuard allowedRoles={["super_admin"]}>
      {/* Top bar: actions + filters */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          Input Revenue
        </button>
        <button
          type="button"
          onClick={() => setExpenseModalOpen(true)}
          className="h-9 px-4 rounded-md border text-sm font-medium hover:bg-muted transition-colors"
        >
          Input Pengeluaran
        </button>
        <div className="flex items-center gap-2 ml-auto">
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
          <input
            type="date"
            value={dateRange.from}
            onChange={(e) => setDateRange((p) => ({ ...p, from: e.target.value }))}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          />
          <span className="text-muted-foreground text-sm">—</span>
          <input
            type="date"
            value={dateRange.to}
            onChange={(e) => setDateRange((p) => ({ ...p, to: e.target.value }))}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          />
          <button
            type="button"
            onClick={async () => {
              try {
                const result = await printFinancePage({
                  data: {
                    dateFrom: dateRange.from || undefined,
                    dateTo: dateRange.to || undefined,
                    branchId,
                  },
                });
                openPrintWindow(result.html);
              } catch (err) {
                toast.error("Gagal mencetak", { description: (err as Error).message });
              }
            }}
            className="h-9 px-4 rounded-md border text-sm font-medium hover:bg-muted transition-colors"
          >
            Cetak PDF
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {cards.map((card) => (
          <div key={card.label} className="rounded-lg border p-4">
            <div className="flex items-center gap-2">
              <card.icon className={`h-4 w-4 ${card.color}`} />
              <span className="text-xs text-muted-foreground uppercase">{card.label}</span>
            </div>
            <p className="text-2xl font-bold mt-2">
              {card.suffix ? `${card.value}${card.suffix}` : formatRp(card.value)}
            </p>
          </div>
        ))}
      </div>

      {/* Split layout: table left, analytics right */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6">
        {/* Left: Daily Table */}
        <div className="rounded-lg border">
          <div className="p-4 border-b">
            <h2 className="font-semibold">Laporan Harian</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Klik baris untuk melihat detail hari tersebut
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left py-2 px-3 font-medium">Tanggal</th>
                  <th className="text-right py-2 px-3 font-medium w-28">HPP</th>
                  <th className="text-right py-2 px-3 font-medium w-28">Omzet</th>
                  <th className="text-right py-2 px-3 font-medium w-28">Gross Profit</th>
                  <th className="text-right py-2 px-3 font-medium w-20">Margin</th>
                </tr>
              </thead>
              <tbody>
                {dailyRows && dailyRows.length > 0 ? (
                  <>
                    {dailyRows.map((row) => (
                      <tr
                        key={row.tanggal}
                        onClick={() => setSelectedDay(row.tanggal)}
                        className={`border-b cursor-pointer transition-colors ${
                          selectedDay === row.tanggal ? "bg-primary/10" : "hover:bg-muted/50"
                        }`}
                      >
                        <td className="py-2 px-3">
                          {new Date(row.tanggal).toLocaleDateString("id-ID", {
                            day: "2-digit",
                            month: "short",
                          })}
                        </td>
                        <td className="py-2 px-3 text-right">{formatRp(row.hpp)}</td>
                        <td className="py-2 px-3 text-right font-medium">{formatRp(row.omzet)}</td>
                        <td
                          className={`py-2 px-3 text-right font-medium ${
                            row.grossProfit >= 0 ? "text-emerald-600" : "text-destructive"
                          }`}
                        >
                          {formatRp(row.grossProfit)}
                        </td>
                        <td className="py-2 px-3 text-right text-muted-foreground">
                          {(row.margin * 100).toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                    {/* TOTAL row */}
                    <tr className="border-t-2 font-semibold bg-muted/30">
                      <td className="py-2 px-3">TOTAL</td>
                      <td className="py-2 px-3 text-right">
                        {formatRp(dailyRows.reduce((sum, r) => sum + r.hpp, 0))}
                      </td>
                      <td className="py-2 px-3 text-right">
                        {formatRp(dailyRows.reduce((sum, r) => sum + r.omzet, 0))}
                      </td>
                      <td className="py-2 px-3 text-right">
                        {formatRp(dailyRows.reduce((sum, r) => sum + r.grossProfit, 0))}
                      </td>
                      <td className="py-2 px-3 text-right">
                        {(() => {
                          const totalOmzet = dailyRows.reduce((sum, r) => sum + r.omzet, 0);
                          const totalGp = dailyRows.reduce((sum, r) => sum + r.grossProfit, 0);
                          return totalOmzet > 0
                            ? `${((totalGp / totalOmzet) * 100).toFixed(1)}%`
                            : "-";
                        })()}
                      </td>
                    </tr>
                  </>
                ) : (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-muted-foreground">
                      Tidak ada data untuk periode ini
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: Analytics Panel */}
        <div className="space-y-6">
          {/* Selected day detail or month summary */}
          <div className="rounded-lg border p-4">
            <h3 className="font-semibold mb-3">
              {selectedDay
                ? `Detail: ${new Date(selectedDay).toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long" })}`
                : "Ringkasan Bulan"}
            </h3>
            {selectedDayData ? (
              <div className="space-y-2">
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">HPP</span>
                  <span className="font-medium">{formatRp(selectedDayData.hpp)}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">Omzet</span>
                  <span className="font-medium">{formatRp(selectedDayData.omzet)}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">Gross Profit</span>
                  <span
                    className={`font-medium ${
                      selectedDayData.grossProfit >= 0 ? "text-emerald-600" : "text-destructive"
                    }`}
                  >
                    {formatRp(selectedDayData.grossProfit)}
                  </span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">Margin</span>
                  <span className="font-medium">{(selectedDayData.margin * 100).toFixed(1)}%</span>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">Jumlah Order</span>
                  <span className="font-medium">
                    {displaySummary.orderCount.toLocaleString("id-ID")}
                  </span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">Diskon Merchant</span>
                  <span className="font-medium">
                    {formatRp(displaySummary.totalMerchantDiscount)}
                  </span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">MDR Ojol</span>
                  <span className="font-medium">{formatRp(displaySummary.totalMdr)}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">Omzet Netto</span>
                  <span className="font-medium">{formatRp(displaySummary.netSales)}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">Manual Revenue</span>
                  <span className="font-medium">{formatRp(displaySummary.manualRevenue)}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">Pengeluaran Operasional</span>
                  <span className="font-medium">{formatRp(displaySummary.manualExpenses)}</span>
                </div>
                {displaySummary.totalCogs > 0 && (
                  <div className="pt-2 space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span>Food Cost Ratio</span>
                      <span
                        className={`font-medium ${
                          displaySummary.totalCogs / displaySummary.totalSales > 0.4
                            ? "text-destructive"
                            : ""
                        }`}
                      >
                        {((displaySummary.totalCogs / displaySummary.totalSales) * 100).toFixed(1)}%
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          displaySummary.totalCogs / displaySummary.totalSales > 0.4
                            ? "bg-destructive"
                            : "bg-primary"
                        }`}
                        style={{
                          width: `${Math.min(
                            (displaySummary.totalCogs / displaySummary.totalSales) * 100,
                            100,
                          )}%`,
                        }}
                      />
                    </div>
                    {displaySummary.totalCogs / displaySummary.totalSales > 0.4 && (
                      <p className="text-xs text-destructive">⚠️ Food cost melebihi 40%!</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Christopher input */}
          <div className="rounded-lg border p-4">
            <h3 className="font-semibold mb-3">Profit Split</h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between py-1">
                <label className="text-sm text-muted-foreground">Christopher</label>
                <input
                  type="number"
                  value={christopher || ""}
                  onChange={(e) => setChristopher(Number(e.target.value) || 0)}
                  placeholder="0"
                  className="h-8 w-36 rounded-md border border-input bg-background px-2 text-sm text-right"
                />
              </div>
              <div className="flex justify-between py-1 border-t pt-2">
                <span className="text-muted-foreground">Biaya Franchise (5%)</span>
                <span className="font-medium">{formatRp(displaySummary.totalSales * 0.05)}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-muted-foreground">Pusat</span>
                <span className="font-medium">
                  {formatRp(
                    displaySummary.grossProfit -
                      displaySummary.manualExpenses -
                      displaySummary.totalSales * 0.05 -
                      christopher,
                  )}
                </span>
              </div>
            </div>
          </div>

          {/* Branch checkboxes */}
          <div className="rounded-lg border p-4">
            <h3 className="font-semibold mb-3">Cabang (untuk total)</h3>
            <div className="space-y-2">
              {branches.map((b) => (
                <label key={b.id} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={checkedBranches.has(b.id)}
                    onChange={() => toggleBranch(b.id)}
                    className="rounded border-input"
                  />
                  <span className="text-sm">{b.name}</span>
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Centang cabang yang ingin dihitung dalam total
            </p>
          </div>
        </div>
      </div>

      {/* Manual Expenses Table */}
      <div className="mt-6 rounded-lg border p-4 space-y-4">
        <h2 className="font-semibold">Pencatatan Manual</h2>
        <p className="text-sm text-muted-foreground">
          Pengeluaran operasional: Gaji, Listrik & Air, Wifi, Sewa, Operasional
        </p>
        {expenses && expenses.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-3">Tanggal</th>
                  <th className="text-left py-2 px-3">Cabang</th>
                  <th className="text-left py-2 px-3">Kategori</th>
                  <th className="text-right py-2 px-3">Jumlah</th>
                  <th className="text-left py-2 px-3">Catatan</th>
                  <th className="text-center py-2 px-3">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((exp) => (
                  <tr key={exp.id} className="border-b">
                    <td className="py-2 px-3">{exp.date}</td>
                    <td className="py-2 px-3">{exp.branchName ?? "-"}</td>
                    <td className="py-2 px-3">
                      <span className="inline-flex items-center rounded-full px-2 py-1 text-xs font-medium bg-muted">
                        {exp.category}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right font-medium">{formatRp(exp.amount)}</td>
                    <td className="py-2 px-3 text-muted-foreground">{exp.notes ?? "-"}</td>
                    <td className="py-2 px-3 text-center">
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm("Hapus pengeluaran ini?")) {
                            void deleteExpenseMutation.mutateAsync({ data: { id: exp.id } });
                          }
                        }}
                        className="text-destructive hover:underline text-xs"
                      >
                        Hapus
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">
            Belum ada pengeluaran manual yang dicatat.
          </p>
        )}
      </div>

      {/* Revenue Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Input Revenue" size="lg">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setRevenueType("manual")}
              className={`h-9 px-4 rounded-md text-sm ${revenueType === "manual" ? "bg-primary text-primary-foreground" : "border"}`}
            >
              Manual Revenue
            </button>
            <button
              type="button"
              onClick={() => setRevenueType("channel")}
              className={`h-9 px-4 rounded-md text-sm ${revenueType === "channel" ? "bg-primary text-primary-foreground" : "border"}`}
            >
              Per Channel
            </button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Cabang</label>
              <select
                name="branchId"
                required
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Tanggal</label>
              <input
                name="date"
                type="date"
                required
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
          </div>

          {revenueType === "channel" && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Channel</label>
              <select
                name="channel"
                required
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="Gofood">Gofood</option>
                <option value="Grabfood">Grabfood</option>
                <option value="ShopeeFood">ShopeeFood</option>
                <option value="Dine-in">Dine-in</option>
              </select>
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium">Jumlah (Rp)</label>
            <input
              name="amount"
              type="number"
              min={0}
              required
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Catatan</label>
            <textarea
              name="notes"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[60px] resize-none"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="h-9 px-4 rounded-md border text-sm"
            >
              Batal
            </button>
            <button
              type="submit"
              className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm"
            >
              Simpan
            </button>
          </div>
        </form>
      </Modal>

      {/* Expense Modal */}
      <Modal
        open={expenseModalOpen}
        onClose={() => setExpenseModalOpen(false)}
        title="Input Pengeluaran Operasional"
        size="lg"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            void createExpenseMutation.mutateAsync({
              data: {
                branchId: fd.get("branchId") as string,
                date: fd.get("date") as string,
                category: fd.get("category") as string,
                amount: Number(fd.get("amount")),
                notes: (fd.get("notes") as string) || undefined,
              },
            });
          }}
          className="space-y-4"
        >
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Cabang</label>
              <select
                name="branchId"
                required
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Tanggal</label>
              <input
                name="date"
                type="date"
                required
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Kategori</label>
            <select
              name="category"
              required
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="Gaji">Gaji</option>
              <option value="ListrikAir">Listrik & Air</option>
              <option value="Wifi">Wifi</option>
              <option value="Sewa">Sewa / Service Charge</option>
              <option value="Operasional">Operasional</option>
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Jumlah (Rp)</label>
            <input
              name="amount"
              type="number"
              min={0}
              required
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Catatan</label>
            <textarea
              name="notes"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[60px] resize-none"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setExpenseModalOpen(false)}
              className="h-9 px-4 rounded-md border text-sm"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={createExpenseMutation.isPending}
              className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50"
            >
              {createExpenseMutation.isPending ? "Menyimpan..." : "Simpan"}
            </button>
          </div>
        </form>
      </Modal>
    </RoleGuard>
  );
}
