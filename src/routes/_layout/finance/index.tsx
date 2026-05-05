import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import PageHeader from "#/components/ui/PageHeader";
import { usePageTitle } from "#/hooks/usePageTitle";
import Modal from "#/components/ui/Modal";
import { getFinanceSummary, createManualRevenue, createChannelRevenue } from "#/lib/server/finance";
import { getBranches } from "#/lib/server/branches";
import { TrendingDown, DollarSign, ShoppingCart, PiggyBank } from "lucide-react";

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
  const [revenueType, setRevenueType] = useState<"manual" | "channel">("manual");
  const [dateRange, setDateRange] = useState({ from: "", to: "" });

  const { data: summary } = useQuery({
    queryKey: ["finance-summary", dateRange.from, dateRange.to],
    queryFn: () =>
      getFinanceSummary({
        data: { dateFrom: dateRange.from || undefined, dateTo: dateRange.to || undefined },
      }),
    initialData: initial,
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
          channel: fd.get("channel") as "Gofood" | "Grabfood" | "ShopeeFood" | "Dine-in",
          amount: Number(fd.get("amount")),
          notes: (fd.get("notes") as string) || undefined,
        },
      });
    }
  };

  const cards = [
    {
      label: "Total Penjualan",
      value: summary.totalSales,
      icon: ShoppingCart,
      color: "text-blue-600",
    },
    {
      label: "Total HPP / COGS",
      value: summary.totalCogs,
      icon: TrendingDown,
      color: "text-red-500",
    },
    { label: "Net Sales", value: summary.netSales, icon: DollarSign, color: "text-green-600" },
    {
      label: "Gross Profit",
      value: summary.grossProfit,
      icon: PiggyBank,
      color: summary.grossProfit >= 0 ? "text-emerald-600" : "text-red-500",
    },
  ];
  usePageTitle("Finance & Reconciliation", "Input uang cair & kalkulasi profitabilitas");

  return (
    <RoleGuard allowedRoles={["super_admin"]}>
      <div className="space-y-6">
        <PageHeader action={{ label: "Input Revenue", onClick: () => setModalOpen(true) }} />

        {/* Date Range Filter */}
        <div className="flex items-center gap-3">
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
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-4 gap-4">
          {cards.map((card) => (
            <div key={card.label} className="rounded-lg border p-4">
              <div className="flex items-center gap-2">
                <card.icon className={`h-4 w-4 ${card.color}`} />
                <span className="text-xs text-muted-foreground uppercase">{card.label}</span>
              </div>
              <p className="text-2xl font-bold mt-2">Rp {card.value.toLocaleString("id-ID")}</p>
            </div>
          ))}
        </div>

        {/* Metrics */}
        <div className="rounded-lg border p-4 space-y-4">
          <h2 className="font-semibold">Metrik Keuangan</h2>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Jumlah Order</p>
              <p className="text-lg font-medium">{summary.orderCount.toLocaleString("id-ID")}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total MDR</p>
              <p className="text-lg font-medium">Rp {summary.totalMdr.toLocaleString("id-ID")}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Manual Revenue</p>
              <p className="text-lg font-medium">
                Rp {summary.manualRevenue.toLocaleString("id-ID")}
              </p>
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
      </div>
    </RoleGuard>
  );
}
