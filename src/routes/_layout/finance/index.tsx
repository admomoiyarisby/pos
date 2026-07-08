import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import { usePageTitle } from "#/hooks/usePageTitle";
import Modal from "#/components/ui/Modal";
import {
  getFinanceSummary,
  createManualRevenue,
  createChannelRevenue,
  createManualExpense,
  getManualExpenses,
  deleteManualExpense,
  printFinancePage,
} from "#/lib/server/finance";
import { getBranches } from "#/lib/server/branches";
import { TrendingDown, DollarSign, PiggyBank, Percent, Banknote, Receipt } from "lucide-react";
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

  const { data: summary } = useQuery({
    queryKey: ["finance-summary", dateRange.from, dateRange.to],
    queryFn: () =>
      getFinanceSummary({
        data: { dateFrom: dateRange.from || undefined, dateTo: dateRange.to || undefined },
      }),
    initialData: initial,
  });

  const { data: expenses } = useQuery({
    queryKey: ["manual-expenses", dateRange.from, dateRange.to],
    queryFn: () =>
      getManualExpenses({
        data: { dateFrom: dateRange.from || undefined, dateTo: dateRange.to || undefined },
      }),
  });

  const createManualMutation = useMutation({
    mutationFn: createManualRevenue,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["finance-summary"] });
      setModalOpen(false);
    },
  });

  const createChannelMutation = useMutation({
    mutationFn: createChannelRevenue,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["finance-summary"] });
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

  const cards = [
    {
      label: "Omzet Bruto",
      value: summary.totalSales,
      icon: Receipt,
      color: "text-blue-600",
    },
    {
      label: "Diskon Merchant",
      value: summary.totalMerchantDiscount,
      icon: Percent,
      color: "text-red-500",
    },
    {
      label: "MDR Ojol",
      value: summary.totalMdr,
      icon: Banknote,
      color: "text-orange-500",
    },
    {
      label: "Omzet Netto",
      value: summary.netSales,
      icon: DollarSign,
      color: "text-green-600",
    },
    {
      label: "Total HPP / COGS",
      value: summary.totalCogs,
      icon: TrendingDown,
      color: "text-red-500",
    },
    {
      label: "Pengeluaran Operasional",
      value: summary.manualExpenses,
      icon: Banknote,
      color: "text-orange-500",
    },
    {
      label: "Gross Profit",
      value: summary.grossProfit,
      icon: PiggyBank,
      color: summary.grossProfit >= 0 ? "text-emerald-600" : "text-red-500",
    },
  ];
  usePageTitle("Keuangan & Rekonsiliasi", "Input uang cair & kalkulasi profitabilitas");

  return (
    <RoleGuard allowedRoles={["super_admin"]}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-3">
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
        </div>

        {/* Date Range Filter */}
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="date"
            value={dateRange.from}
            onChange={(e) => setDateRange((p) => ({ ...p, from: e.target.value }))}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          />
          <span className="text-muted-foreground">sampai</span>
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

        {/* Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {cards.map((card) => (
            <div key={card.label} className="rounded-lg border p-4">
              <div className="flex items-center gap-2">
                <card.icon className={`h-4 w-4 ${card.color}`} />
                <span className="text-xs text-muted-foreground uppercase">{card.label}</span>
              </div>
              <p className="text-2xl font-bold mt-2">{formatRp(card.value)}</p>
            </div>
          ))}
        </div>

        {/* Metrics */}
        <div className="rounded-lg border p-4 space-y-4">
          <h2 className="font-semibold">Metrik Keuangan</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Jumlah Order</p>
              <p className="text-lg font-medium">{summary.orderCount.toLocaleString("id-ID")}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total MDR</p>
              <p className="text-lg font-medium">{formatRp(summary.totalMdr)}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Manual Revenue</p>
              <p className="text-lg font-medium">{formatRp(summary.manualRevenue)}</p>
            </div>
          </div>
          {summary.totalCogs > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span>Food Cost Ratio</span>
                <span
                  className={`font-medium ${summary.totalCogs / summary.totalSales > 0.4 ? "text-destructive" : ""}`}
                >
                  {((summary.totalCogs / summary.totalSales) * 100).toFixed(1)}%
                </span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full ${summary.totalCogs / summary.totalSales > 0.4 ? "bg-destructive" : "bg-primary"}`}
                  style={{
                    width: `${Math.min((summary.totalCogs / summary.totalSales) * 100, 100)}%`,
                  }}
                />
              </div>
              {summary.totalCogs / summary.totalSales > 0.4 && (
                <p className="text-xs text-destructive">⚠️ Food cost melebihi 40%!</p>
              )}
            </div>
          )}
        </div>

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

        {/* Manual Expenses Section */}
        <div className="rounded-lg border p-4 space-y-4">
          <h2 className="font-semibold">Pencatatan Manual</h2>
          <p className="text-sm text-muted-foreground">
            Pengeluaran operasional: Gaji, Listrik & Air, Sewa, Makan Staff
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
                <option value="Sewa">Sewa / Service Charge</option>
                <option value="MakanStaff">Makan Staff</option>
                <option value="Lainnya">Lainnya</option>
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
      </div>
    </RoleGuard>
  );
}
