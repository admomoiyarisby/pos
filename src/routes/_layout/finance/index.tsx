import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import { usePageTitle } from "#/hooks/usePageTitle";
import Modal from "#/components/ui/Modal";
import {
  getFinanceSummary,
  getDailyFinanceSummary,
  getRecipesWithHpp,
  getEmployeeMealSummary,
  getPencatatanManualSummary,
  upsertDailyOverride,
  createManualRevenue,
  createChannelRevenue,
  createManualExpense,
  getManualExpenses,
  printFinancePage,
} from "#/lib/server/finance";
import { getBranches } from "#/lib/server/branches";
import {
  TrendingDown,
  PiggyBank,
  Percent,
  Receipt,
  ChevronDown,
  ChevronRight,
  Pencil,
} from "lucide-react";
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

// Period types
type PeriodType = "bulanan" | "mingguan" | "harian";

// Helper: get weeks in a month
function getWeeksInMonth(year: number, month: number) {
  const lastDay = new Date(year, month + 1, 0).getDate();
  return [
    {
      label: "Minggu 1: 1-7",
      from: `${year}-${String(month + 1).padStart(2, "0")}-01`,
      to: `${year}-${String(month + 1).padStart(2, "0")}-07`,
    },
    {
      label: "Minggu 2: 8-14",
      from: `${year}-${String(month + 1).padStart(2, "0")}-08`,
      to: `${year}-${String(month + 1).padStart(2, "0")}-14`,
    },
    {
      label: "Minggu 3: 15-21",
      from: `${year}-${String(month + 1).padStart(2, "0")}-15`,
      to: `${year}-${String(month + 1).padStart(2, "0")}-21`,
    },
    {
      label: `Minggu 4: 22-${lastDay}`,
      from: `${year}-${String(month + 1).padStart(2, "0")}-22`,
      to: `${year}-${String(month + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
    },
  ];
}

// Helper: get months list (last 12 months)
function getMonthsList() {
  const months = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      label: d.toLocaleDateString("id-ID", { month: "long", year: "numeric" }),
      value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      year: d.getFullYear(),
      month: d.getMonth(),
    });
  }
  return months;
}

// Inline edit cell component
function EditableOmzetCell({
  value,
  hasOverride,
  onSave,
}: {
  value: number;
  hasOverride: boolean;
  onSave: (newValue: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);

  const handleSave = useCallback(() => {
    if (editValue !== value) {
      onSave(editValue);
    }
    setEditing(false);
  }, [editValue, value, onSave]);

  if (editing) {
    return (
      <input
        type="number"
        value={editValue}
        onChange={(e) => setEditValue(Number(e.target.value) || 0)}
        onBlur={handleSave}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSave();
          if (e.key === "Escape") setEditing(false);
        }}
        className="w-28 h-8 rounded border border-primary bg-blue-50 px-2 text-sm text-right font-medium"
        autoFocus
      />
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        setEditValue(value);
        setEditing(true);
      }}
      className={`group flex items-center gap-1 text-right font-medium ${
        hasOverride ? "bg-blue-50 px-2 py-1 rounded" : ""
      } hover:bg-blue-100 transition-colors cursor-pointer`}
      title={hasOverride ? "Override (klik untuk edit)" : "Klik untuk edit"}
    >
      {formatRp(value)}
      <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground" />
    </button>
  );
}

function FinancePage() {
  const { summary: initial, branches } = Route.useLoaderData();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [expenseModalOpen, setExpenseModalOpen] = useState(false);
  const [revenueType, setRevenueType] = useState<"manual" | "channel">("manual");

  // Period state
  const [periodType, setPeriodType] = useState<PeriodType>("bulanan");
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [selectedWeek, setSelectedWeek] = useState(0);
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

  // Selected day for analytics panel
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  // Christopher input
  const [christopher, setChristopher] = useState<number>(0);

  // Collapsible filter sections
  const [filterExpanded, setFilterExpanded] = useState<Record<PeriodType, boolean>>({
    bulanan: true,
    mingguan: false,
    harian: false,
  });

  // Calculate date range based on period
  const effectiveDateRange = useMemo(() => {
    if (periodType === "bulanan") {
      const [year, month] = selectedMonth.split("-").map(Number);
      const lastDay = new Date(year, month, 0).getDate();
      return {
        from: `${selectedMonth}-01`,
        to: `${selectedMonth}-${String(lastDay).padStart(2, "0")}`,
      };
    }
    if (periodType === "mingguan") {
      const [year, month] = selectedMonth.split("-").map(Number);
      const weeks = getWeeksInMonth(year, month);
      const week = weeks[selectedWeek];
      return { from: week.from, to: week.to };
    }
    return dateRange;
  }, [periodType, selectedMonth, selectedWeek, dateRange]);

  const branchId = selectedBranchId || undefined;

  const { data: summary } = useQuery({
    queryKey: ["finance-summary", effectiveDateRange.from, effectiveDateRange.to, branchId],
    queryFn: () =>
      getFinanceSummary({
        data: {
          dateFrom: effectiveDateRange.from || undefined,
          dateTo: effectiveDateRange.to || undefined,
          branchId,
        },
      }),
    initialData: initial,
  });

  const { data: dailyRows } = useQuery({
    queryKey: ["daily-finance", effectiveDateRange.from, effectiveDateRange.to, branchId],
    queryFn: () =>
      getDailyFinanceSummary({
        data: {
          dateFrom: effectiveDateRange.from || undefined,
          dateTo: effectiveDateRange.to || undefined,
          branchId,
        },
      }),
  });

  const { data: expenses } = useQuery({
    queryKey: ["manual-expenses", effectiveDateRange.from, effectiveDateRange.to, branchId],
    queryFn: () =>
      getManualExpenses({
        data: {
          dateFrom: effectiveDateRange.from || undefined,
          dateTo: effectiveDateRange.to || undefined,
          branchId,
        },
      }),
  });

  // Pencatatan Manual data (monthly only)
  const { data: recipesData } = useQuery({
    queryKey: ["recipes-hpp"],
    queryFn: () => getRecipesWithHpp({ data: {} }),
    enabled: periodType === "bulanan",
  });

  const { data: employeeMeals } = useQuery({
    queryKey: ["employee-meals", effectiveDateRange.from, effectiveDateRange.to, branchId],
    queryFn: () =>
      getEmployeeMealSummary({
        data: {
          dateFrom: effectiveDateRange.from!,
          dateTo: effectiveDateRange.to!,
          branchId,
        },
      }),
    enabled: periodType === "bulanan",
  });

  const { data: pmSummary } = useQuery({
    queryKey: ["pm-summary", effectiveDateRange.from, effectiveDateRange.to, branchId],
    queryFn: () =>
      getPencatatanManualSummary({
        data: {
          dateFrom: effectiveDateRange.from!,
          dateTo: effectiveDateRange.to!,
          branchId,
        },
      }),
    enabled: periodType === "bulanan",
  });

  // Omzet override mutation
  const upsertOverrideMutation = useMutation({
    mutationFn: upsertDailyOverride,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["daily-finance"] });
      void queryClient.invalidateQueries({ queryKey: ["finance-summary"] });
    },
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
      void queryClient.invalidateQueries({ queryKey: ["expenses-by-category"] });
      void queryClient.invalidateQueries({ queryKey: ["pm-summary"] });
      setExpenseModalOpen(false);
      toast.success("Pengeluaran berhasil dicatat");
    },
    onError: (err) => {
      toast.error("Gagal mencatat pengeluaran", { description: err.message });
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

  // Selected day data
  const selectedDayData = useMemo(() => {
    if (!selectedDay || !dailyRows) return null;
    return dailyRows.find((r) => r.tanggal === selectedDay) ?? null;
  }, [selectedDay, dailyRows]);

  // Month/week options
  const months = useMemo(() => getMonthsList(), []);
  const weeks = useMemo(() => {
    const [year, month] = selectedMonth.split("-").map(Number);
    return getWeeksInMonth(year, month);
  }, [selectedMonth]);

  const cards = [
    { label: "Omzet Bruto", value: summary.totalSales, icon: Receipt, color: "text-blue-600" },
    { label: "HPP / COGS", value: summary.totalCogs, icon: TrendingDown, color: "text-red-500" },
    {
      label: "Gross Profit",
      value: summary.grossProfit,
      icon: PiggyBank,
      color: summary.grossProfit >= 0 ? "text-emerald-600" : "text-red-500",
    },
    {
      label: "Food Cost %",
      value:
        summary.totalSales > 0 ? Math.round((summary.totalCogs / summary.totalSales) * 100) : 0,
      icon: Percent,
      color:
        summary.totalSales > 0 && summary.totalCogs / summary.totalSales > 0.4
          ? "text-red-500"
          : "text-emerald-600",
      suffix: "%",
    },
  ];

  usePageTitle("Keuangan & Rekonsiliasi", "Input uang cair & kalkulasi profitabilitas");

  return (
    <RoleGuard allowedRoles={["super_admin"]}>
      {/* Top bar: actions + branch */}
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
          <button
            type="button"
            onClick={async () => {
              try {
                const result = await printFinancePage({
                  data: {
                    dateFrom: effectiveDateRange.from || undefined,
                    dateTo: effectiveDateRange.to || undefined,
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

      {/* Period filter */}
      <div className="mb-6 space-y-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium">Periode:</span>
          <div className="flex gap-1">
            {(["bulanan", "mingguan", "harian"] as PeriodType[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => {
                  setPeriodType(p);
                  setFilterExpanded({
                    bulanan: p === "bulanan",
                    mingguan: p === "mingguan",
                    harian: p === "harian",
                  });
                }}
                className={`h-9 px-4 rounded-md text-sm font-medium transition-colors ${
                  periodType === p ? "bg-primary text-primary-foreground" : "border hover:bg-muted"
                }`}
              >
                {p === "bulanan" ? "Bulanan" : p === "mingguan" ? "Mingguan" : "Harian"}
              </button>
            ))}
          </div>
        </div>

        {/* Collapsible filter sections */}
        {(["bulanan", "mingguan", "harian"] as PeriodType[]).map((p) => (
          <div key={p} className="rounded-lg border">
            <button
              type="button"
              onClick={() => setFilterExpanded((prev) => ({ ...prev, [p]: !prev[p] }))}
              className="flex w-full items-center gap-2 px-4 py-2 text-sm font-medium hover:bg-muted/50 transition-colors"
            >
              {filterExpanded[p] ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              {p === "bulanan"
                ? "Filter Bulanan"
                : p === "mingguan"
                  ? "Filter Mingguan"
                  : "Filter Harian"}
            </button>
            {filterExpanded[p] && (
              <div className="px-4 pb-3">
                {p === "bulanan" && (
                  <select
                    value={selectedMonth}
                    onChange={(e) => setSelectedMonth(e.target.value)}
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    {months.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                )}
                {p === "mingguan" && (
                  <div className="flex items-center gap-3">
                    <select
                      value={selectedMonth}
                      onChange={(e) => {
                        setSelectedMonth(e.target.value);
                        setSelectedWeek(0);
                      }}
                      className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                    >
                      {months.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                    <select
                      value={selectedWeek}
                      onChange={(e) => setSelectedWeek(Number(e.target.value))}
                      className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                    >
                      {weeks.map((w, i) => (
                        <option key={i} value={i}>
                          {w.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {p === "harian" && (
                  <div className="flex items-center gap-3">
                    <input
                      type="date"
                      value={dateRange.from}
                      onChange={(e) => setDateRange((prev) => ({ ...prev, from: e.target.value }))}
                      className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                    />
                    <span className="text-muted-foreground text-sm">—</span>
                    <input
                      type="date"
                      value={dateRange.to}
                      onChange={(e) => setDateRange((prev) => ({ ...prev, to: e.target.value }))}
                      className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
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
              Klik baris untuk melihat detail hari tersebut. Klik nilai Omzet untuk mengedit.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left py-2 px-3 font-medium">Tanggal</th>
                  <th className="text-right py-2 px-3 font-medium w-28">HPP</th>
                  <th className="text-right py-2 px-3 font-medium w-36">Omzet</th>
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
                          {new Date(row.tanggal + "T00:00:00").toLocaleDateString("id-ID", {
                            day: "2-digit",
                            month: "short",
                          })}
                        </td>
                        <td className="py-2 px-3 text-right">{formatRp(row.hpp)}</td>
                        <td className="py-2 px-3 text-right">
                          <EditableOmzetCell
                            value={row.omzet}
                            hasOverride={row.hasOmzetOverride}
                            onSave={(newValue) => {
                              if (!branchId) {
                                toast.error("Pilih cabang terlebih dahulu untuk mengedit Omzet");
                                return;
                              }
                              void upsertOverrideMutation.mutateAsync({
                                data: {
                                  branchId,
                                  date: row.tanggal,
                                  field: "omzet",
                                  value: newValue,
                                },
                              });
                            }}
                          />
                        </td>
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
                ? `Detail: ${new Date(selectedDay + "T00:00:00").toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long" })}`
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
                    className={`font-medium ${selectedDayData.grossProfit >= 0 ? "text-emerald-600" : "text-destructive"}`}
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
                  <span className="font-medium">{summary.orderCount.toLocaleString("id-ID")}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">Diskon Merchant</span>
                  <span className="font-medium">{formatRp(summary.totalMerchantDiscount)}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">MDR Ojol</span>
                  <span className="font-medium">{formatRp(summary.totalMdr)}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">Omzet Netto</span>
                  <span className="font-medium">{formatRp(summary.netSales)}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">Manual Revenue</span>
                  <span className="font-medium">{formatRp(summary.manualRevenue)}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">Pengeluaran Operasional</span>
                  <span className="font-medium">{formatRp(summary.manualExpenses)}</span>
                </div>
                {summary.totalCogs > 0 && (
                  <div className="pt-2 space-y-1">
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
                <span className="font-medium">{formatRp(summary.totalSales * 0.05)}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-muted-foreground">Pusat</span>
                <span className="font-medium">
                  {formatRp(
                    summary.grossProfit -
                      summary.manualExpenses -
                      summary.totalSales * 0.05 -
                      christopher,
                  )}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Pencatatan Manual (monthly only) */}
      {periodType === "bulanan" && (
        <div className="mt-6 space-y-6">
          <h2 className="text-lg font-semibold">Pencatatan Manual</h2>

          {/* Section 1: HPP Menu Items */}
          <div className="rounded-lg border p-4">
            <h3 className="font-semibold mb-3">Harga HPP Makan Pegawai</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left py-2 px-3 font-medium">Menu Item</th>
                    <th className="text-right py-2 px-3 font-medium w-32">HPP</th>
                  </tr>
                </thead>
                <tbody>
                  {recipesData && recipesData.length > 0 ? (
                    recipesData.map((recipe) => (
                      <tr key={recipe.id} className="border-b">
                        <td className="py-2 px-3">{recipe.name}</td>
                        <td className="py-2 px-3 text-right font-medium">
                          {formatRp(recipe.totalCogs)}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={2} className="py-4 text-center text-muted-foreground">
                        Tidak ada data resep
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Section 2: Employee Meal Matrix */}
          <div className="rounded-lg border p-4">
            <h3 className="font-semibold mb-3">Beban Makan Pegawai</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left py-2 px-3 font-medium">Nama Pegawai</th>
                    <th className="text-left py-2 px-3 font-medium">Menu Item</th>
                    <th className="text-right py-2 px-3 font-medium w-20">Qty</th>
                    <th className="text-right py-2 px-3 font-medium w-32">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {employeeMeals && employeeMeals.length > 0 ? (
                    employeeMeals.map((meal, i) => (
                      <tr key={i} className="border-b">
                        <td className="py-2 px-3">{meal.staffName}</td>
                        <td className="py-2 px-3">{meal.ingredientName}</td>
                        <td className="py-2 px-3 text-right">{meal.quantity}</td>
                        <td className="py-2 px-3 text-right font-medium">
                          {formatRp(meal.valuation)}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} className="py-4 text-center text-muted-foreground">
                        Tidak ada data beban makan
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {employeeMeals && employeeMeals.length > 0 && (
              <div className="mt-2 flex justify-end">
                <span className="font-semibold text-sm">
                  Total: {formatRp(employeeMeals.reduce((sum, m) => sum + m.valuation, 0))}
                </span>
              </div>
            )}
          </div>

          {/* Section 3: Detailed Operational Expenses */}
          <div className="rounded-lg border p-4">
            <h3 className="font-semibold mb-3">Rincian Biaya Operasional</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left py-2 px-3 font-medium w-10">No</th>
                    <th className="text-left py-2 px-3 font-medium">Items</th>
                    <th className="text-right py-2 px-3 font-medium w-32">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {expenses && expenses.length > 0 ? (
                    expenses.map((exp, i) => (
                      <tr key={exp.id} className="border-b">
                        <td className="py-2 px-3">{i + 1}</td>
                        <td className="py-2 px-3">{exp.notes ?? exp.category}</td>
                        <td className="py-2 px-3 text-right font-medium">{formatRp(exp.amount)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={3} className="py-4 text-center text-muted-foreground">
                        Tidak ada data pengeluaran operasional
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {expenses && expenses.length > 0 && (
              <div className="mt-2 flex justify-end">
                <span className="font-semibold text-sm">
                  Total: {formatRp(expenses.reduce((sum, e) => sum + e.amount, 0))}
                </span>
              </div>
            )}
          </div>

          {/* Section 4: Financial Summary */}
          {pmSummary && (
            <div className="rounded-lg border p-4">
              <h3 className="font-semibold mb-3">Ringkasan Keuangan</h3>
              <div className="space-y-2">
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">Biaya Makan Staff</span>
                  <span className="font-medium">{formatRp(pmSummary.biayaMakanStaff)}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">Biaya Operasional</span>
                  <span className="font-medium">{formatRp(pmSummary.biayaOperasional)}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">Biaya Gaji</span>
                  <span className="font-medium">{formatRp(pmSummary.biayaGaji)}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">Biaya Listrik dan Air</span>
                  <span className="font-medium">{formatRp(pmSummary.biayaListrikAir)}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">Wifi</span>
                  <span className="font-medium">{formatRp(pmSummary.biayaWifi)}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">Biaya Sewa (Inc Service Charge)</span>
                  <span className="font-medium">{formatRp(pmSummary.biayaSewa)}</span>
                </div>
                <div className="flex justify-between py-1 border-t pt-2 font-semibold">
                  <span>Total Biaya</span>
                  <span>{formatRp(pmSummary.total)}</span>
                </div>
                <div className="flex justify-between py-1 border-t pt-2">
                  <span className="text-muted-foreground">HPP</span>
                  <span className="font-medium">{formatRp(pmSummary.hpp)}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">Piutang Penjualan</span>
                  <span className="font-medium">{formatRp(pmSummary.piutangPenjualan)}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">Profit Margin</span>
                  <span className="font-medium">{formatRp(pmSummary.profitMargin)}</span>
                </div>
                <div className="flex justify-between py-1 border-t pt-2">
                  <span className="text-muted-foreground">Nett Profit</span>
                  <span className="font-medium">{formatRp(pmSummary.nettProfit)}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">Biaya Franchise (5%)</span>
                  <span className="font-medium">{formatRp(pmSummary.biayaFranchise)}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">Pusat</span>
                  <span className="font-medium">{formatRp(pmSummary.pusat)}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">Christopher</span>
                  <span className="font-medium">{formatRp(christopher)}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

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
