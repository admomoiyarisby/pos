import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo, useCallback, Fragment, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import { usePageTitle } from "#/hooks/usePageTitle";
import Modal from "#/components/ui/Modal";
import MoneyInput from "#/components/MoneyInput";
import {
  getDailyFinanceSummary,
  getDailyHppBreakdown,
  upsertDailyOverride,
  createManualRevenue,
  createChannelRevenue,
  createManualExpense,
  printFinancePage,
} from "#/lib/server/finance";
import { getBrokenStock } from "#/lib/server/waste";
import { getBranches } from "#/lib/server/branches";
import { ChevronRight, Lock, Pencil, Printer, Package } from "lucide-react";
import { z } from "zod";
import { formatRp, formText } from "#/lib/utils";
import { openPrintWindow } from "#/lib/print-window";
import { toast } from "sonner";

export const Route = createFileRoute("/_layout/finance/")({
  component: FinancePage,
  loader: async () => {
    const branches = await getBranches({ data: {} });
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const daily = await getDailyFinanceSummary({
      data: { dateFrom: `${ym}-01`, dateTo: `${ym}-${String(lastDay).padStart(2, "0")}` },
    });
    return { branches, daily };
  },
});

type PeriodType = "bulanan" | "mingguan" | "harian";

const CHANNELS = [
  { label: "Semua", value: "" },
  { label: "Offline", value: "Dine-in" },
  { label: "Gojek", value: "Gofood" },
  { label: "Grab", value: "Grabfood" },
  { label: "Shopee", value: "ShopeeFood" },
  { label: "TikTok", value: "TikTok" },
  { label: "Perlengkapan", value: "Perlengkapan" },
];

function getWeeksInMonth(year: number, month: number) {
  const lastDay = new Date(year, month + 1, 0).getDate();
  return [
    {
      label: "Minggu 1 (1-7)",
      from: `${year}-${String(month + 1).padStart(2, "0")}-01`,
      to: `${year}-${String(month + 1).padStart(2, "0")}-07`,
    },
    {
      label: "Minggu 2 (8-14)",
      from: `${year}-${String(month + 1).padStart(2, "0")}-08`,
      to: `${year}-${String(month + 1).padStart(2, "0")}-14`,
    },
    {
      label: "Minggu 3 (15-21)",
      from: `${year}-${String(month + 1).padStart(2, "0")}-15`,
      to: `${year}-${String(month + 1).padStart(2, "0")}-21`,
    },
    {
      label: `Minggu 4 (22-${lastDay})`,
      from: `${year}-${String(month + 1).padStart(2, "0")}-22`,
      to: `${year}-${String(month + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
    },
  ];
}

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

// Inline editable Omzet cell — only active when no channel filter (day-level override)
function EditableOmzetCell({
  value,
  hasOverride,
  disabled,
  onSave,
}: {
  value: number;
  hasOverride: boolean;
  disabled: boolean;
  onSave: (newValue: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);

  const handleSave = useCallback(() => {
    if (editValue !== value) onSave(editValue);
    setEditing(false);
  }, [editValue, value, onSave]);

  if (editing) {
    return (
      <MoneyInput
        value={editValue}
        onChange={(raw) => setEditValue(raw ?? 0)}
        onBlur={handleSave}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSave();
          if (e.key === "Escape") setEditing(false);
        }}
        className="w-36 h-8 rounded border border-primary bg-background px-2 text-sm text-right font-medium tabular-nums"
        autoFocus
      />
    );
  }

  if (disabled) {
    return (
      <span
        className="inline-flex items-center gap-1.5 w-36 h-8 px-2 rounded border border-dashed border-muted-foreground/30 bg-muted/30 text-sm text-right text-muted-foreground tabular-nums cursor-not-allowed"
        title="Filter channel aktif — omzet hanya diedit per hari"
      >
        {formatRp(value)}
        <Lock className="h-3 w-3 shrink-0" />
      </span>
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
      className={`inline-flex items-center gap-1.5 w-36 h-8 px-2 rounded border text-sm text-right font-medium tabular-nums transition-colors ${
        hasOverride
          ? "border-blue-300 bg-blue-50 hover:bg-blue-100"
          : "border-input bg-background hover:bg-muted/60"
      }`}
      title={hasOverride ? "Override manual — klik untuk edit" : "Klik untuk edit omzet harian"}
    >
      {formatRp(value)}
      <Pencil className="h-3 w-3 shrink-0 text-muted-foreground" />
    </button>
  );
}

// Expandable HPP-per-bahan breakdown for a single day
function HppBreakdownRow({
  branchId,
  date,
  channel,
}: {
  branchId: string;
  date: string;
  channel: string;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["daily-hpp-breakdown", date, branchId, channel],
    queryFn: () =>
      getDailyHppBreakdown({
        data: { branchId: branchId || undefined, date, channel: channel || undefined },
      }),
  });

  if (isLoading) {
    return (
      <tr className="bg-muted/30">
        <td colSpan={6} className="px-4 py-3 text-sm text-muted-foreground">
          Memuat rincian HPP per bahan…
        </td>
      </tr>
    );
  }

  if (!data || data.length === 0) {
    return (
      <tr className="bg-muted/30">
        <td colSpan={6} className="px-4 py-3 text-sm text-muted-foreground">
          Tidak ada rincian bahan untuk hari ini.
        </td>
      </tr>
    );
  }

  const total = data.reduce((s, d) => s + d.cost, 0);
  const dateStr = new Date(date + "T00:00:00").toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
  });

  return (
    <tr className="bg-muted/30">
      <td colSpan={6} className="px-4 py-3">
        <div className="text-xs font-medium text-muted-foreground mb-2">
          Rincian HPP per Bahan — {dateStr}
        </div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-0">
          {data.map((d) => (
            <div
              key={d.ingredientId}
              className="flex items-center justify-between text-sm py-1 border-b border-border/40"
            >
              <span className="truncate pr-2">{d.name}</span>
              <span className="tabular-nums font-medium shrink-0">{formatRp(d.cost)}</span>
            </div>
          ))}
        </div>
        <div className="flex justify-end mt-2 pt-2 border-t text-sm font-semibold">
          Total HPP: <span className="tabular-nums ml-2">{formatRp(total)}</span>
        </div>
      </td>
    </tr>
  );
}

function FinancePage() {
  const { branches, daily: initialDaily } = Route.useLoaderData();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [expenseModalOpen, setExpenseModalOpen] = useState(false);
  const [revenueType, setRevenueType] = useState<"manual" | "channel">("manual");
  const [activeTab, setActiveTab] = useState<"keuangan" | "barang-rusak">("keuangan");

  // Period + filter state
  const [periodType, setPeriodType] = useState<PeriodType>("bulanan");
  const [selectedMonth, setSelectedMonth] = useState(() => {
    // Default to current month - will be corrected on client side
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });

  // Update month on client side to handle timezone correctly
  useEffect(() => {
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    setSelectedMonth(currentMonth);
  }, []);
  const [selectedWeek, setSelectedWeek] = useState(0);
  const [selectedDate, setSelectedDate] = useState(() => {
    // Default to today's date - will be corrected on client side
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  });

  // Update date on client side to handle timezone correctly
  useEffect(() => {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    setSelectedDate(today);
  }, []);
  const [selectedBranchId, setSelectedBranchId] = useState<string>("");
  const [selectedChannel, setSelectedChannel] = useState<string>("");

  // Expandable HPP row
  const [expandedDay, setExpandedDay] = useState<string | null>(null);

  const months = useMemo(() => getMonthsList(), []);
  const weeks = useMemo(() => {
    const [year, month] = selectedMonth.split("-").map(Number);
    return getWeeksInMonth(year, month);
  }, [selectedMonth]);

  // Effective date range from period
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
      return { from: weeks[selectedWeek].from, to: weeks[selectedWeek].to };
    }
    return { from: selectedDate, to: selectedDate };
  }, [periodType, selectedMonth, selectedWeek, selectedDate, weeks]);

  const branchId = selectedBranchId || undefined;
  const channel = selectedChannel || undefined;

  const { data: dailyRows } = useQuery({
    queryKey: ["daily-finance", effectiveDateRange.from, effectiveDateRange.to, branchId, channel],
    queryFn: () =>
      getDailyFinanceSummary({
        data: {
          dateFrom: effectiveDateRange.from || undefined,
          dateTo: effectiveDateRange.to || undefined,
          branchId,
          channel,
        },
      }),
    initialData: initialDaily,
  });

  // Broken stock query (for Barang Rusak tab)
  const { data: brokenStockEntries } = useQuery({
    queryKey: ["broken-stock", effectiveDateRange.from, effectiveDateRange.to, branchId],
    queryFn: () => getBrokenStock({ data: {} }),
  });

  // Filter broken stock by date range and branch
  const filteredBrokenStock = useMemo(() => {
    if (!brokenStockEntries) return [];
    return brokenStockEntries.filter((entry) => {
      const entryDate = new Date(entry.createdAt);
      const from = new Date(effectiveDateRange.from + "T00:00:00");
      const to = new Date(effectiveDateRange.to + "T23:59:59");
      const inDateRange = entryDate >= from && entryDate <= to;
      const inBranch = !branchId || entry.branchId === branchId;
      return inDateRange && inBranch;
    });
  }, [brokenStockEntries, effectiveDateRange, branchId]);

  const brokenStockTotal = useMemo(() => {
    return filteredBrokenStock.reduce((sum, e) => sum + (e.valuation ?? 0), 0);
  }, [filteredBrokenStock]);

  const upsertOverrideMutation = useMutation({
    mutationFn: upsertDailyOverride,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["daily-finance"] });
      toast.success("Omzet diperbarui");
    },
    onError: (err) => toast.error("Gagal memperbarui omzet", { description: err.message }),
  });

  const createManualMutation = useMutation({
    mutationFn: createManualRevenue,
    onSuccess: () => {
      setModalOpen(false);
      toast.success("Revenue berhasil dicatat");
    },
  });

  const createChannelMutation = useMutation({
    mutationFn: createChannelRevenue,
    onSuccess: () => {
      setModalOpen(false);
      toast.success("Revenue berhasil dicatat");
    },
  });

  const createExpenseMutation = useMutation({
    mutationFn: createManualExpense,
    onSuccess: () => {
      setExpenseModalOpen(false);
      toast.success("Pengeluaran berhasil dicatat");
    },
    onError: (err) => toast.error("Gagal mencatat pengeluaran", { description: err.message }),
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (revenueType === "manual") {
      void createManualMutation.mutateAsync({
        data: {
          branchId: formText(fd, "branchId"),
          date: formText(fd, "date"),
          amount: Number(formText(fd, "amount")),
          notes: formText(fd, "notes") || undefined,
        },
      });
    } else {
      void createChannelMutation.mutateAsync({
        data: {
          branchId: formText(fd, "branchId"),
          date: formText(fd, "date"),
          channel: z
            .enum(["Gofood", "Grabfood", "ShopeeFood", "Dine-in", "TikTok", "Perlengkapan"])
            .parse(formText(fd, "channel")),
          amount: Number(formText(fd, "amount")),
          notes: formText(fd, "notes") || undefined,
        },
      });
    }
  };

  const totals = useMemo(() => {
    const rows = dailyRows ?? [];
    const hpp = rows.reduce((s, r) => s + r.hpp, 0);
    const omzet = rows.reduce((s, r) => s + r.omzet, 0);
    const gross = rows.reduce((s, r) => s + r.grossProfit, 0);
    return { hpp, omzet, gross, margin: omzet > 0 ? gross / omzet : 0 };
  }, [dailyRows]);

  usePageTitle("Keuangan", "Laporan P&L harian, mingguan, bulanan");

  return (
    <RoleGuard allowedRoles={["super_admin", "admin_pusat"]}>
      {/* Top bar */}
      <div className="flex flex-wrap items-center justify-end gap-3 mb-6">
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
        <button
          type="button"
          onClick={async () => {
            try {
              const result = await printFinancePage({
                data: {
                  dateFrom: effectiveDateRange.from || undefined,
                  dateTo: effectiveDateRange.to || undefined,
                  branchId,
                  channel,
                },
              });
              openPrintWindow(result.html);
            } catch (err) {
              toast.error("Gagal mencetak", {
                description: err instanceof Error ? err.message : String(err),
              });
            }
          }}
          className="h-9 px-4 rounded-md border text-sm font-medium hover:bg-muted transition-colors inline-flex items-center gap-2"
        >
          <Printer className="h-4 w-4" /> Cetak PDF
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 p-1 rounded-lg border bg-muted/30 w-fit">
        <button
          type="button"
          onClick={() => setActiveTab("keuangan")}
          className={`h-9 px-4 rounded-md text-sm font-medium transition-colors ${
            activeTab === "keuangan"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Keuangan
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("barang-rusak")}
          className={`h-9 px-4 rounded-md text-sm font-medium transition-colors inline-flex items-center gap-2 ${
            activeTab === "barang-rusak"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Package className="h-4 w-4" />
          Barang Rusak
        </button>
      </div>

      {/* Single filter row */}
      <div className="flex flex-wrap items-end gap-3 mb-4 p-4 rounded-lg border">
        {/* Period segmented control */}
        <div className="flex rounded-md border overflow-hidden">
          {
            // SAFETY: the three literal periods are exactly the PeriodType
            // union values; the annotation only asserts that for .map().
            (["harian", "mingguan", "bulanan"] as PeriodType[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriodType(p)}
                className={`h-9 px-4 text-sm font-medium transition-colors ${
                  periodType === p
                    ? "bg-primary text-primary-foreground"
                    : "bg-background hover:bg-muted"
                }`}
              >
                {p === "harian" ? "Harian" : p === "mingguan" ? "Mingguan" : "Bulanan"}
              </button>
            ))
          }
        </div>

        {/* Contextual date picker */}
        {periodType === "bulanan" && (
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Bulan</label>
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm block"
            >
              {months.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        )}
        {periodType === "mingguan" && (
          <>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Bulan</label>
              <select
                value={selectedMonth}
                onChange={(e) => {
                  setSelectedMonth(e.target.value);
                  setSelectedWeek(0);
                }}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm block"
              >
                {months.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Minggu</label>
              <select
                value={selectedWeek}
                onChange={(e) => setSelectedWeek(Number(e.target.value))}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm block"
              >
                {weeks.map((w, i) => (
                  <option key={i} value={i}>
                    {w.label}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
        {periodType === "harian" && (
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Tanggal</label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm block"
            />
          </div>
        )}

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

        {/* Channel */}
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Channel</label>
          <select
            value={selectedChannel}
            onChange={(e) => setSelectedChannel(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm block"
          >
            {CHANNELS.map((c) => (
              <option key={c.label} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Ledger table - Keuangan tab */}
      {activeTab === "keuangan" && (
        <div className="rounded-lg border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left py-2.5 px-3 font-medium w-10"></th>
                  <th className="text-left py-2.5 px-3 font-medium">Tanggal</th>
                  <th className="text-right py-2.5 px-3 font-medium w-36">HPP</th>
                  <th className="text-right py-2.5 px-3 font-medium w-44">Omzet</th>
                  <th className="text-right py-2.5 px-3 font-medium w-36">Gross Profit</th>
                  <th className="text-right py-2.5 px-3 font-medium w-20">Margin</th>
                </tr>
              </thead>
              <tbody>
                {dailyRows && dailyRows.length > 0 ? (
                  dailyRows.map((row) => {
                    const isOpen = expandedDay === row.tanggal;
                    return (
                      <Fragment key={row.tanggal}>
                        <tr
                          className={`border-b ${isOpen ? "bg-muted/20" : "hover:bg-muted/40"} transition-colors`}
                        >
                          <td className="py-2 px-3">
                            <button
                              type="button"
                              onClick={() => setExpandedDay(isOpen ? null : row.tanggal)}
                              className="h-7 w-7 rounded flex items-center justify-center hover:bg-muted transition-colors"
                              title="Lihat rincian HPP per bahan"
                            >
                              <ChevronRight
                                className={`h-4 w-4 transition-transform ${isOpen ? "rotate-90" : ""}`}
                              />
                            </button>
                          </td>
                          <td className="py-2 px-3">
                            {new Date(row.tanggal + "T00:00:00").toLocaleDateString("id-ID", {
                              weekday: "short",
                              day: "numeric",
                              month: "short",
                            })}
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums">{formatRp(row.hpp)}</td>
                          <td className="py-2 px-3 text-right">
                            <EditableOmzetCell
                              value={row.omzet}
                              hasOverride={row.hasOmzetOverride}
                              disabled={!!channel}
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
                            className={`py-2 px-3 text-right tabular-nums font-medium ${row.grossProfit >= 0 ? "text-emerald-600" : "text-destructive"}`}
                          >
                            {formatRp(row.grossProfit)}
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">
                            {(row.margin * 100).toFixed(1)}%
                          </td>
                        </tr>
                        {isOpen && (
                          <HppBreakdownRow
                            branchId={selectedBranchId}
                            date={row.tanggal}
                            channel={selectedChannel}
                          />
                        )}
                      </Fragment>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-muted-foreground">
                      Tidak ada data untuk periode ini
                    </td>
                  </tr>
                )}
              </tbody>
              {dailyRows && dailyRows.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 font-semibold bg-muted/40">
                    <td className="py-2.5 px-3"></td>
                    <td className="py-2.5 px-3">TOTAL</td>
                    <td className="py-2.5 px-3 text-right tabular-nums">{formatRp(totals.hpp)}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums">
                      {formatRp(totals.omzet)}
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums">
                      {formatRp(totals.gross)}
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums">
                      {totals.omzet > 0
                        ? `${((totals.gross / totals.omzet) * 100).toFixed(1)}%`
                        : "-"}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {/* Barang Rusak tab */}
      {activeTab === "barang-rusak" && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="rounded-lg border bg-card p-4">
            <div className="text-sm text-muted-foreground">Total Kerugian</div>
            <div className="text-2xl font-semibold tabular-nums">{formatRp(brokenStockTotal)}</div>
          </div>

          {/* Table */}
          <div className="rounded-lg border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left py-2.5 px-3 font-medium">Tanggal</th>
                    <th className="text-left py-2.5 px-3 font-medium">Bahan</th>
                    <th className="text-right py-2.5 px-3 font-medium w-24">Qty</th>
                    <th className="text-right py-2.5 px-3 font-medium w-32">Nilai</th>
                    <th className="text-left py-2.5 px-3 font-medium">Keterangan</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredBrokenStock.length > 0 ? (
                    filteredBrokenStock.map((entry) => (
                      <tr key={entry.id} className="border-b hover:bg-muted/40 transition-colors">
                        <td className="py-2.5 px-3">
                          {new Date(entry.createdAt).toLocaleDateString("id-ID", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}
                        </td>
                        <td className="py-2.5 px-3">{entry.ingredientName}</td>
                        <td className="py-2.5 px-3 text-right font-medium tabular-nums">
                          {entry.quantity}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums">
                          {formatRp(entry.valuation ?? 0)}
                        </td>
                        <td className="py-2.5 px-3 text-muted-foreground">{entry.notes ?? "-"}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="py-10 text-center text-muted-foreground">
                        Tidak ada data barang rusak untuk periode ini
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
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
                <option value="TikTok">TikTok</option>
                <option value="Perlengkapan">Perlengkapan</option>
              </select>
            </div>
          )}
          <div className="space-y-2">
            <label className="text-sm font-medium">Jumlah (Rp)</label>
            <MoneyInput
              name="amount"
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
                branchId: formText(fd, "branchId"),
                date: formText(fd, "date"),
                category: formText(fd, "category"),
                amount: Number(formText(fd, "amount")),
                notes: formText(fd, "notes") || undefined,
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
            <MoneyInput
              name="amount"
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
