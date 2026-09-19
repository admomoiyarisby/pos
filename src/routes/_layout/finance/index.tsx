import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo, useCallback, Fragment, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import { ShiftCashDetail } from "#/components/pos/ShiftCashDetail";
import { usePageTitle } from "#/hooks/usePageTitle";
import Modal from "#/components/ui/Modal";
import MoneyInput from "#/components/MoneyInput";
import {
  getDailyFinanceSummary,
  getDailyHppBreakdown,
  getManualFinanceEntries,
  type ManualFinanceEntry,
  getOmzetBreakdown,
  getShiftCashVariance,
  upsertDailyOverride,
  createManualRevenue,
  createChannelRevenue,
  createManualExpense,
  printFinancePage,
} from "#/lib/server/finance";
import { getBrokenStock } from "#/lib/server/waste";
import { getBranches } from "#/lib/server/branches";
import {
  ChevronRight,
  Lock,
  Pencil,
  Printer,
  Package,
  CalendarDays,
  Wallet,
  PackageX,
} from "lucide-react";
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
  { label: "Dine In", value: "Dine-in" },
  { label: "Gojek", value: "Gofood" },
  { label: "Grab", value: "Grabfood" },
  { label: "Shopee", value: "ShopeeFood" },
  { label: "TikTok", value: "TikTok" },
  { label: "Perlengkapan", value: "Perlengkapan" },
];

// `month` is 1-indexed (as it comes from the "YYYY-MM" selected month), so
// `new Date(year, month, 0)` is the last day of that same month.
function getWeeksInMonth(year: number, month: number) {
  const mm = String(month).padStart(2, "0");
  const lastDay = new Date(year, month, 0).getDate();
  return [
    {
      label: "Minggu 1 (1-7)",
      from: `${year}-${mm}-01`,
      to: `${year}-${mm}-07`,
    },
    {
      label: "Minggu 2 (8-14)",
      from: `${year}-${mm}-08`,
      to: `${year}-${mm}-14`,
    },
    {
      label: "Minggu 3 (15-21)",
      from: `${year}-${mm}-15`,
      to: `${year}-${mm}-21`,
    },
    {
      label: `Minggu 4 (22-${lastDay})`,
      from: `${year}-${mm}-22`,
      to: `${year}-${mm}-${String(lastDay).padStart(2, "0")}`,
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

// Inline editable Omzet cell — only active when no channel filter (day-level override).
// `fullWidth` is used by the mobile day cards (comfortable tap target, no fixed
// 144px column); the desktop table keeps the fixed-width cell.
function EditableOmzetCell({
  value,
  hasOverride,
  disabled,
  fullWidth = false,
  onSave,
}: {
  value: number;
  hasOverride: boolean;
  disabled: boolean;
  fullWidth?: boolean;
  onSave: (newValue: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const cellSize = fullWidth ? "w-full h-10" : "w-36 h-8";

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
        className={`${cellSize} rounded border border-primary bg-background px-2 text-sm text-right font-medium tabular-nums`}
        autoFocus
      />
    );
  }

  if (disabled) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 ${cellSize} px-2 rounded border border-dashed border-muted-foreground/30 bg-muted/30 text-sm text-right text-muted-foreground tabular-nums cursor-not-allowed`}
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
      className={`inline-flex items-center gap-1.5 ${cellSize} px-2 rounded border text-sm text-right font-medium tabular-nums transition-colors ${
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

// HPP-per-bahan breakdown for a single day. The content is shared by the
// desktop table row and the mobile day card, so both stay in sync.
function HppBreakdownContent({
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
    return <p className="text-sm text-muted-foreground">Memuat rincian HPP per bahan…</p>;
  }

  if (!data || data.length === 0) {
    return <p className="text-sm text-muted-foreground">Tidak ada rincian bahan untuk hari ini.</p>;
  }

  const total = data.reduce((s, d) => s + d.cost, 0);
  const dateStr = new Date(date + "T00:00:00").toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
  });

  return (
    <>
      <div className="text-xs font-medium text-muted-foreground mb-2">
        Rincian HPP per Bahan — {dateStr}
      </div>
      <div className="grid grid-cols-1 gap-x-8 gap-y-0 sm:grid-cols-2">
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
    </>
  );
}

function HppBreakdownRow({
  branchId,
  date,
  channel,
}: {
  branchId: string;
  date: string;
  channel: string;
}) {
  return (
    <tr className="bg-muted/30">
      <td colSpan={7} className="px-4 py-3">
        <HppBreakdownContent branchId={branchId} date={date} channel={channel} />
      </td>
    </tr>
  );
}

// Omzet detail for one day: order-derived total vs any manual override, plus
// the per-channel order totals behind the sum — lets the user verify Gross
// Profit = Omzet − HPP against the actual orders. Shared by the desktop table
// row and the mobile day card.
function OmzetBreakdownContent({
  branchId,
  date,
  channel,
}: {
  branchId: string;
  date: string;
  channel: string;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["omzet-breakdown", date, branchId, channel],
    queryFn: () =>
      getOmzetBreakdown({
        data: { branchId: branchId || undefined, date, channel: channel || undefined },
      }),
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Memuat rincian omzet…</p>;
  }

  if (!data) {
    return <p className="text-sm text-muted-foreground">Tidak ada rincian omzet.</p>;
  }

  const channelLabel = (ch: string) => CHANNELS.find((c) => c.value === ch)?.label ?? ch;
  const dateStr = new Date(date + "T00:00:00").toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
  });

  return (
    <>
      <div className="text-xs font-medium text-muted-foreground mb-2">
        Rincian Omzet — {dateStr} ({data.orderCount} pesanan)
      </div>
      <div className="grid grid-cols-1 gap-x-8 gap-y-0 sm:grid-cols-2">
        {data.perChannel.map((ch) => (
          <div
            key={ch.channel}
            className="flex items-center justify-between text-sm py-1 border-b border-border/40"
          >
            <span className="truncate pr-2">
              {channelLabel(ch.channel)}
              <span className="ml-1.5 text-xs text-muted-foreground">({ch.orderCount})</span>
            </span>
            <span className="tabular-nums font-medium shrink-0">{formatRp(ch.totalAmount)}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap justify-end gap-x-4 gap-y-1 mt-2 pt-2 border-t text-sm">
        <span className="text-muted-foreground">
          Dari pesanan:{" "}
          <span className="tabular-nums font-medium">{formatRp(data.computedOmzet)}</span>
        </span>
        {data.override !== null && (
          <span className="text-blue-600">
            Override manual:{" "}
            <span className="tabular-nums font-medium">{formatRp(data.override)}</span>
          </span>
        )}
        <span className="font-semibold">
          Total Omzet: <span className="tabular-nums">{formatRp(data.effectiveOmzet)}</span>
        </span>
      </div>
    </>
  );
}

function OmzetBreakdownRow({
  branchId,
  date,
  channel,
}: {
  branchId: string;
  date: string;
  channel: string;
}) {
  return (
    <tr className="bg-muted/30">
      <td colSpan={7} className="px-4 py-3">
        <OmzetBreakdownContent branchId={branchId} date={date} channel={channel} />
      </td>
    </tr>
  );
}

// Itemized manual entries for one day — each revenue/expense input through
// the finance buttons, with its channel (or "no-channel" for manual revenue).
// Shared by the desktop table row and the mobile day card.
function ManualBreakdownContent({ entries }: { entries: ManualFinanceEntry[] }) {
  const channelLabel = (channel: string) =>
    CHANNELS.find((c) => c.value === channel)?.label ?? channel;

  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">Tidak ada entri manual untuk hari ini.</p>;
  }

  const revenue = entries.filter((e) => e.kind === "revenue").reduce((s, e) => s + e.amount, 0);
  const expense = entries.filter((e) => e.kind === "expense").reduce((s, e) => s + e.amount, 0);

  return (
    <>
      <div className="text-xs font-medium text-muted-foreground mb-2">
        Rincian Entri Manual — {entries.length} entri
      </div>
      <div className="grid grid-cols-1 gap-y-0">
        {entries.map((e) => (
          <div
            key={e.id}
            className="flex items-center justify-between gap-2 text-sm py-1 border-b border-border/40"
          >
            <span className="min-w-0 truncate pr-2">
              <span
                className={`mr-1.5 inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${
                  e.kind === "revenue"
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-amber-100 text-amber-700"
                }`}
              >
                {e.kind === "revenue" ? "Revenue" : "Expense"}
              </span>
              {e.kind === "revenue"
                ? e.channel
                  ? channelLabel(e.channel)
                  : "No Channel"
                : (e.category ?? "-")}
              {e.notes ? (
                <span className="ml-1.5 text-xs text-muted-foreground">— {e.notes}</span>
              ) : null}
            </span>
            <span
              className={`shrink-0 tabular-nums font-medium ${e.kind === "revenue" ? "text-emerald-600" : "text-amber-600"}`}
            >
              {e.kind === "revenue" ? "+" : "−"}
              {formatRp(e.amount)}
            </span>
          </div>
        ))}
      </div>
      <div className="flex justify-end gap-4 mt-2 pt-2 border-t text-sm font-semibold">
        <span className="text-emerald-600">Revenue: {formatRp(revenue)}</span>
        <span className="text-amber-600">Expense: {formatRp(expense)}</span>
      </div>
    </>
  );
}

function ManualBreakdownRow({ entries }: { entries: ManualFinanceEntry[] }) {
  return (
    <tr className="bg-muted/30">
      <td colSpan={7} className="px-4 py-3">
        <ManualBreakdownContent entries={entries} />
      </td>
    </tr>
  );
}

// Desktop detail row for the Selisih Kas table: wraps the shared per-shift
// cash reconciliation detail in a full-width table cell.
function CashDetailRow({
  shiftId,
  cashFloat,
  expectedCash,
  actualCash,
}: {
  shiftId: string;
  cashFloat: number;
  expectedCash: number;
  actualCash: number;
}) {
  return (
    <tr className="bg-muted/30">
      <td colSpan={8} className="px-4 py-3">
        <ShiftCashDetail
          shiftId={shiftId}
          cashFloat={cashFloat}
          expectedCash={expectedCash}
          actualCash={actualCash}
        />
      </td>
    </tr>
  );
}

// Variance badge shared by the desktop table and the mobile shift card, so a
// mismatch reads identically in both.
function VarianceBadge({ variance }: { variance: number }) {
  if (variance === 0) return <span className="font-medium text-emerald-600">Cocok</span>;
  return (
    <span
      className={`font-medium tabular-nums ${variance > 0 ? "text-amber-600" : "text-destructive"}`}
    >
      {variance > 0 ? "+" : ""}
      {formatRp(variance)}
    </span>
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
  // Expandable Selisih Kas detail row (per shift)
  const [expandedCashShift, setExpandedCashShift] = useState<string | null>(null);

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
  const { data: brokenStockEntries, isLoading: brokenStockLoading } = useQuery({
    queryKey: ["broken-stock", effectiveDateRange.from, effectiveDateRange.to, branchId],
    queryFn: () => getBrokenStock({ data: {} }),
  });

  // Manual ledger entries ("Manual" column): revenues input via "Input Revenue"
  // (manual + per-channel) and expenses via "Input Pengeluaran", grouped by day.
  const { data: manualEntries } = useQuery({
    queryKey: ["manual-finance-entries", effectiveDateRange.from, effectiveDateRange.to, branchId],
    queryFn: () =>
      getManualFinanceEntries({
        data: {
          dateFrom: effectiveDateRange.from!,
          dateTo: effectiveDateRange.to!,
          branchId,
        },
      }),
  });

  const manualByDate = useMemo(() => {
    const map = new Map<string, ManualFinanceEntry[]>();
    for (const e of manualEntries ?? []) {
      const list = map.get(e.date) ?? [];
      list.push(e);
      map.set(e.date, list);
    }
    return map;
  }, [manualEntries]);

  // Net manual total = manual revenue − expenses, per day. Same math on both
  // the desktop column and the mobile card so they read identically.
  const manualNetFor = useCallback(
    (date: string) => {
      const entries = manualByDate.get(date) ?? [];
      return entries.reduce((s, e) => s + (e.kind === "revenue" ? e.amount : -e.amount), 0);
    },
    [manualByDate],
  );

  // Per-shift cash reconciliation (Selisih Kas). Channel-agnostic — shifts
  // hold mixed-channel cash sales — so it's only shown without a channel
  // filter, where the ledger numbers are also channel-aggregated.
  const showCashRecon = !channel;
  const { data: cashVariances, isLoading: cashReconLoading } = useQuery({
    queryKey: ["shift-cash-variance", effectiveDateRange.from, effectiveDateRange.to, branchId],
    queryFn: () =>
      getShiftCashVariance({
        data: {
          dateFrom: effectiveDateRange.from || undefined,
          dateTo: effectiveDateRange.to || undefined,
          branchId,
        },
      }),
    enabled: showCashRecon,
  });

  const cashRecon = useMemo(() => {
    const rows = cashVariances ?? [];
    const expected = rows.reduce((s, r) => s + r.expectedCash, 0);
    const actual = rows.reduce((s, r) => s + r.actualCash, 0);
    const mismatches = rows.filter((r) => r.variance !== 0);
    return {
      rows,
      shiftCount: rows.length,
      expected,
      actual,
      variance: actual - expected,
      mismatches,
      mismatchTotal: mismatches.reduce((s, r) => s + r.variance, 0),
    };
  }, [cashVariances]);

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

  // Omzet edits need a branch to attach the day-level override to; shared by
  // the desktop cell and the mobile day card so both behave identically.
  const saveOmzet = useCallback(
    (date: string, newValue: number) => {
      if (!branchId) {
        toast.error("Pilih cabang terlebih dahulu untuk mengedit Omzet");
        return;
      }
      void upsertOverrideMutation.mutateAsync({
        data: { branchId, date, field: "omzet", value: newValue },
      });
    },
    [branchId, upsertOverrideMutation],
  );

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
    const manualNet = rows.reduce((s, r) => s + manualNetFor(r.tanggal), 0);
    return { hpp, omzet, gross, manualNet, margin: omzet > 0 ? gross / omzet : 0 };
  }, [dailyRows, manualNetFor]);

  usePageTitle("Keuangan", "Laporan P&L harian, mingguan, bulanan");

  return (
    <RoleGuard allowedRoles={["super_admin", "admin_pusat"]}>
      {/* Top bar — one full-width primary action on phones; right-aligned row
          from sm. The wrapper collapses into the flex row at sm (sm:contents). */}
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end sm:gap-3">
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="h-11 rounded-md bg-primary text-primary-foreground text-sm font-medium transition-colors hover:bg-primary/90 active:scale-[0.99] sm:h-9 sm:px-4"
        >
          Input Revenue
        </button>
        <div className="grid grid-cols-2 gap-2 sm:contents">
          <button
            type="button"
            onClick={() => setExpenseModalOpen(true)}
            className="h-11 rounded-md border text-sm font-medium transition-colors hover:bg-muted active:scale-[0.99] sm:h-9 sm:px-4"
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
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md border text-sm font-medium transition-colors hover:bg-muted active:scale-[0.99] sm:h-9 sm:px-4"
          >
            <Printer className="h-4 w-4" /> Cetak PDF
          </button>
        </div>
      </div>

      {/* Tabs — full-width split on phones (bigger touch targets), pill-sized
          from sm where there is room to sit left. */}
      <div className="mb-4 flex w-full gap-1 rounded-lg border bg-muted/30 p-1 sm:w-fit">
        <button
          type="button"
          onClick={() => setActiveTab("keuangan")}
          className={`h-10 flex-1 rounded-md text-sm font-medium transition-colors sm:h-9 sm:flex-none sm:px-4 ${
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
          className={`inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors sm:h-9 sm:flex-none sm:px-4 ${
            activeTab === "barang-rusak"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Package className="h-4 w-4" />
          Barang Rusak
        </button>
      </div>

      {/* Single filter row — stacked full-width controls on phones, inline from sm */}
      <div className="mb-4 flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:flex-wrap sm:items-end sm:p-4">
        {/* Period segmented control */}
        <div className="flex w-full overflow-hidden rounded-md border sm:w-auto">
          {
            // SAFETY: the three literal periods are exactly the PeriodType
            // union values; the annotation only asserts that for .map().
            (["harian", "mingguan", "bulanan"] as PeriodType[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriodType(p)}
                className={`h-10 flex-1 text-sm font-medium transition-colors sm:h-9 sm:flex-none sm:px-4 ${
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
          <div className="w-full space-y-1 sm:w-auto">
            <label className="text-xs text-muted-foreground">Bulan</label>
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              aria-label="Bulan"
              className="block h-10 w-full rounded-md border border-input bg-background px-3 text-base sm:h-9 sm:w-auto sm:text-sm"
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
          <div className="grid grid-cols-2 gap-3 sm:contents">
            <div className="w-full space-y-1 sm:w-auto">
              <label className="text-xs text-muted-foreground">Bulan</label>
              <select
                value={selectedMonth}
                onChange={(e) => {
                  setSelectedMonth(e.target.value);
                  setSelectedWeek(0);
                }}
                aria-label="Bulan"
                className="block h-10 w-full rounded-md border border-input bg-background px-3 text-base sm:h-9 sm:w-auto sm:text-sm"
              >
                {months.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="w-full space-y-1 sm:w-auto">
              <label className="text-xs text-muted-foreground">Minggu</label>
              <select
                value={selectedWeek}
                onChange={(e) => setSelectedWeek(Number(e.target.value))}
                aria-label="Minggu"
                className="block h-10 w-full rounded-md border border-input bg-background px-3 text-base sm:h-9 sm:w-auto sm:text-sm"
              >
                {weeks.map((w, i) => (
                  <option key={i} value={i}>
                    {w.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
        {periodType === "harian" && (
          <div className="w-full space-y-1 sm:w-auto">
            <label className="text-xs text-muted-foreground">Tanggal</label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              aria-label="Tanggal"
              className="block h-10 w-full rounded-md border border-input bg-background px-3 text-base sm:h-9 sm:w-auto sm:text-sm"
            />
          </div>
        )}

        {/* Branch */}
        <div className="w-full space-y-1 sm:w-auto">
          <label className="text-xs text-muted-foreground">Cabang</label>
          <select
            value={selectedBranchId}
            onChange={(e) => setSelectedBranchId(e.target.value)}
            aria-label="Cabang"
            className="block h-10 w-full rounded-md border border-input bg-background px-3 text-base sm:h-9 sm:w-auto sm:text-sm"
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
        <div className="w-full space-y-1 sm:w-auto">
          <label className="text-xs text-muted-foreground">Channel</label>
          <select
            value={selectedChannel}
            onChange={(e) => setSelectedChannel(e.target.value)}
            aria-label="Channel"
            className="block h-10 w-full rounded-md border border-input bg-background px-3 text-base sm:h-9 sm:w-auto sm:text-sm"
          >
            {CHANNELS.map((c) => (
              <option key={c.label} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Ledger - Keuangan tab. Cards own everything below lg: from md (768px)
          the fixed 16rem sidebar leaves only ~460px of content width, less than
          the table's natural width, so the table would scroll horizontally. */}
      {activeTab === "keuangan" && (
        <>
          <div className="space-y-2.5 lg:hidden">
            {dailyRows && dailyRows.length > 0 ? (
              <>
                {dailyRows.map((row) => {
                  const isOpen = expandedDay === row.tanggal;
                  return (
                    <div
                      key={row.tanggal}
                      className={`overflow-hidden rounded-xl border bg-card shadow-xs ${
                        isOpen ? "border-foreground/20" : ""
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setExpandedDay(isOpen ? null : row.tanggal)}
                        aria-expanded={isOpen}
                        className="flex w-full items-center justify-between gap-3 p-3.5 text-left transition-colors active:bg-muted/40"
                      >
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold">
                            {new Date(row.tanggal + "T00:00:00").toLocaleDateString("id-ID", {
                              weekday: "long",
                              day: "numeric",
                              month: "short",
                            })}
                          </span>
                          <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                            Rincian HPP per bahan
                            <ChevronRight
                              className={`h-3.5 w-3.5 transition-transform ${isOpen ? "rotate-90" : ""}`}
                            />
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="block text-xs text-muted-foreground">Gross Profit</span>
                          <span
                            className={`block text-sm font-semibold tabular-nums ${
                              row.grossProfit >= 0 ? "text-emerald-600" : "text-destructive"
                            }`}
                          >
                            {formatRp(row.grossProfit)}
                          </span>
                        </span>
                      </button>
                      <div className="grid grid-cols-2 gap-3 border-t px-3.5 py-3">
                        <div>
                          <div className="text-xs text-muted-foreground">HPP</div>
                          <div className="text-sm font-medium tabular-nums">
                            {formatRp(row.hpp)}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-muted-foreground">Margin</div>
                          <div className="text-sm font-medium tabular-nums">
                            {(row.margin * 100).toFixed(1)}%
                          </div>
                        </div>
                        <div className="col-span-2">
                          <div className="mb-1 text-xs text-muted-foreground">Omzet</div>
                          <EditableOmzetCell
                            fullWidth
                            value={row.omzet}
                            hasOverride={row.hasOmzetOverride}
                            disabled={!!channel}
                            onSave={(newValue) => saveOmzet(row.tanggal, newValue)}
                          />
                        </div>
                        <div className="col-span-2">
                          <div className="mb-1 text-xs text-muted-foreground">Manual</div>
                          <div
                            className={`text-sm font-semibold tabular-nums ${
                              manualNetFor(row.tanggal) >= 0
                                ? "text-emerald-600"
                                : "text-destructive"
                            }`}
                          >
                            {manualNetFor(row.tanggal) > 0 ? "+" : ""}
                            {formatRp(manualNetFor(row.tanggal))}
                          </div>
                        </div>
                      </div>
                      {isOpen && (
                        <div className="border-t bg-muted/30 px-3.5 py-3 space-y-3">
                          <OmzetBreakdownContent
                            branchId={selectedBranchId}
                            date={row.tanggal}
                            channel={selectedChannel}
                          />
                          <ManualBreakdownContent entries={manualByDate.get(row.tanggal) ?? []} />
                          <div>
                            <div className="text-xs font-medium text-muted-foreground mb-2">
                              Rincian HPP per Bahan
                            </div>
                            <HppBreakdownContent
                              branchId={selectedBranchId}
                              date={row.tanggal}
                              channel={selectedChannel}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                {/* Totals — mirrors the desktop table footer */}
                <div className="rounded-xl border bg-muted/40 p-3.5">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Total
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-xs text-muted-foreground">HPP</div>
                      <div className="text-sm font-semibold tabular-nums">
                        {formatRp(totals.hpp)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground">Gross Profit</div>
                      <div className="text-sm font-semibold tabular-nums">
                        {formatRp(totals.gross)}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Omzet</div>
                      <div className="text-sm font-semibold tabular-nums">
                        {formatRp(totals.omzet)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground">Margin</div>
                      <div className="text-sm font-semibold tabular-nums">
                        {totals.omzet > 0
                          ? `${((totals.gross / totals.omzet) * 100).toFixed(1)}%`
                          : "-"}
                      </div>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="rounded-xl border border-dashed bg-muted/20 p-8 text-center">
                <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                  <CalendarDays className="h-5 w-5 text-muted-foreground" />
                </div>
                <p className="mt-3 text-sm font-medium">Tidak ada data untuk periode ini</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Ubah periode atau cabang untuk melihat ledger harian.
                </p>
              </div>
            )}
          </div>

          {/* Desktop table */}
          <div className="hidden lg:block rounded-lg border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left py-2.5 px-3 font-medium w-10"></th>
                    <th className="text-left py-2.5 px-3 font-medium">Tanggal</th>
                    <th className="text-right py-2.5 px-3 font-medium w-36">HPP</th>
                    <th className="text-right py-2.5 px-3 font-medium w-36">Manual</th>
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
                            <td className="py-2 px-3 text-right tabular-nums">
                              {formatRp(row.hpp)}
                            </td>
                            <td
                              className={`py-2 px-3 text-right tabular-nums font-medium ${
                                manualNetFor(row.tanggal) >= 0
                                  ? "text-emerald-600"
                                  : "text-destructive"
                              }`}
                            >
                              {manualNetFor(row.tanggal) > 0 ? "+" : ""}
                              {formatRp(manualNetFor(row.tanggal))}
                            </td>
                            <td className="py-2 px-3 text-right">
                              <EditableOmzetCell
                                value={row.omzet}
                                hasOverride={row.hasOmzetOverride}
                                disabled={!!channel}
                                onSave={(newValue) => saveOmzet(row.tanggal, newValue)}
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
                            <>
                              <OmzetBreakdownRow
                                branchId={selectedBranchId}
                                date={row.tanggal}
                                channel={selectedChannel}
                              />
                              <ManualBreakdownRow entries={manualByDate.get(row.tanggal) ?? []} />
                              <HppBreakdownRow
                                branchId={selectedBranchId}
                                date={row.tanggal}
                                channel={selectedChannel}
                              />
                            </>
                          )}
                        </Fragment>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={7} className="py-10 text-center text-muted-foreground">
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
                      <td className="py-2.5 px-3 text-right tabular-nums">
                        {formatRp(totals.hpp)}
                      </td>
                      <td
                        className={`py-2.5 px-3 text-right tabular-nums ${
                          totals.manualNet >= 0 ? "text-emerald-600" : "text-destructive"
                        }`}
                      >
                        {totals.manualNet > 0 ? "+" : ""}
                        {formatRp(totals.manualNet)}
                      </td>
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
        </>
      )}

      {/* Selisih Kas — per-shift cash reconciliation (Keuangan tab only) */}
      {activeTab === "keuangan" && showCashRecon && (
        <div className="mt-6 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold tracking-tight">Selisih Kas</h2>
            <span className="text-xs text-muted-foreground">
              {cashRecon.shiftCount} shift ditutup dalam periode ini
            </span>
          </div>

          {cashReconLoading ? (
            /* Without this the empty state flashes while the query is in flight,
               which reads as "no shifts closed" rather than "still loading". */
            <div className="space-y-2.5">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="animate-pulse rounded-xl border bg-card p-3.5"
                  style={{ animationDelay: `${i * 120}ms` }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="h-3.5 w-28 rounded bg-muted" />
                      <div className="mt-2 h-3 w-20 rounded bg-muted" />
                    </div>
                    <div className="h-5 w-20 rounded bg-muted" />
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 border-t pt-3">
                    <div className="h-3 w-16 rounded bg-muted" />
                    <div className="h-3 w-16 rounded bg-muted" />
                  </div>
                </div>
              ))}
            </div>
          ) : cashRecon.shiftCount === 0 ? (
            <div className="rounded-xl border border-dashed bg-muted/20 p-8 text-center">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                <Wallet className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="mt-3 text-sm font-medium">Belum ada data rekonsiliasi kas</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Shift yang ditutup dengan hitungan kas akan muncul di sini.
              </p>
            </div>
          ) : (
            <>
              {/* Summary strip */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="rounded-lg border bg-card p-3">
                  <div className="text-xs text-muted-foreground">Perkiraan Kas</div>
                  <div className="text-base font-semibold tabular-nums sm:text-lg">
                    {formatRp(cashRecon.expected)}
                  </div>
                </div>
                <div className="rounded-lg border bg-card p-3">
                  <div className="text-xs text-muted-foreground">Kas Fisik Dihitung</div>
                  <div className="text-base font-semibold tabular-nums sm:text-lg">
                    {formatRp(cashRecon.actual)}
                  </div>
                </div>
                <div className="rounded-lg border bg-card p-3">
                  <div className="text-xs text-muted-foreground">Total Selisih</div>
                  <div
                    className={`text-base font-semibold tabular-nums sm:text-lg ${
                      cashRecon.variance === 0
                        ? "text-emerald-600"
                        : cashRecon.variance > 0
                          ? "text-amber-600"
                          : "text-destructive"
                    }`}
                  >
                    {cashRecon.variance > 0 ? "+" : ""}
                    {formatRp(cashRecon.variance)}
                  </div>
                </div>
                <div className="rounded-lg border bg-card p-3">
                  <div className="text-xs text-muted-foreground">Shift Tidak Cocok</div>
                  <div
                    className={`text-base font-semibold tabular-nums sm:text-lg ${
                      cashRecon.mismatches.length === 0 ? "text-emerald-600" : "text-destructive"
                    }`}
                  >
                    {cashRecon.mismatches.length}
                    {cashRecon.mismatches.length > 0 && (
                      <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                        ({cashRecon.mismatchTotal > 0 ? "+" : ""}
                        {formatRp(cashRecon.mismatchTotal)})
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Per-shift rows — expandable to show each cash movement.
                  Cards below xl (not lg, unlike the other tables): eight columns
                  of Rupiah need ~950px, which the 720px content column at
                  1024px cannot hold, so a table there would scroll sideways. */}
              <div className="space-y-2.5 xl:hidden">
                {cashRecon.rows.map((r) => {
                  const isOpen = expandedCashShift === r.shiftId;
                  const mutation = r.cashSales + r.cashAdjustments;
                  return (
                    <div
                      key={r.shiftId}
                      className={`overflow-hidden rounded-xl border bg-card shadow-xs ${
                        r.variance !== 0 ? "border-destructive/30" : ""
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setExpandedCashShift(isOpen ? null : r.shiftId)}
                        aria-expanded={isOpen}
                        className="flex w-full items-center justify-between gap-3 p-3.5 text-left transition-colors active:bg-muted/40"
                      >
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold tabular-nums">
                            {r.closedAt
                              ? new Date(r.closedAt).toLocaleString("id-ID", {
                                  day: "2-digit",
                                  month: "short",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })
                              : "-"}
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                            {r.branchName ?? "-"}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2.5">
                          <span className="text-right">
                            <span className="block text-xs text-muted-foreground">Selisih</span>
                            <VarianceBadge variance={r.variance} />
                          </span>
                          <ChevronRight
                            className={`h-4 w-4 text-muted-foreground transition-transform ${
                              isOpen ? "rotate-90" : ""
                            }`}
                          />
                        </span>
                      </button>
                      <div className="grid grid-cols-2 gap-3 border-t px-3.5 py-3">
                        <div>
                          <div className="text-xs text-muted-foreground">Kas Awal</div>
                          <div className="text-sm font-medium tabular-nums">
                            {formatRp(r.cashFloat)}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-muted-foreground">Mutasi Kas</div>
                          <div className="text-sm font-medium tabular-nums">
                            {mutation > 0 ? "+" : ""}
                            {formatRp(mutation)}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">Perkiraan</div>
                          <div className="text-sm font-medium tabular-nums">
                            {formatRp(r.expectedCash)}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs leading-tight text-muted-foreground">
                            Kas Akhir
                          </div>
                          <div className="text-sm font-medium tabular-nums">
                            {formatRp(r.actualCash)}
                          </div>
                        </div>
                      </div>
                      {isOpen && (
                        <div className="border-t bg-muted/30 px-3.5 py-3">
                          <ShiftCashDetail
                            shiftId={r.shiftId}
                            cashFloat={r.cashFloat}
                            expectedCash={r.expectedCash}
                            actualCash={r.actualCash}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Desktop table */}
              <div className="hidden xl:block rounded-lg border overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left py-2.5 px-3 font-medium w-10"></th>
                        <th className="text-left py-2.5 px-3 font-medium">Ditutup</th>
                        <th className="text-left py-2.5 px-3 font-medium">Cabang</th>
                        <th className="text-right py-2.5 px-3 font-medium w-32">Kas Awal</th>
                        <th className="text-right py-2.5 px-3 font-medium w-36">Mutasi Kas</th>
                        <th className="text-right py-2.5 px-3 font-medium w-36">Perkiraan</th>
                        <th className="text-right py-2.5 px-3 font-medium w-36">Kas Akhir</th>
                        <th className="text-right py-2.5 px-3 font-medium w-32">Selisih</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cashRecon.rows.map((r) => {
                        const isOpen = expandedCashShift === r.shiftId;
                        return (
                          <Fragment key={r.shiftId}>
                            <tr
                              className={`border-b ${r.variance !== 0 ? "bg-destructive/[0.04]" : ""} hover:bg-muted/40 transition-colors`}
                            >
                              <td className="py-2.5 px-3">
                                <button
                                  type="button"
                                  onClick={() => setExpandedCashShift(isOpen ? null : r.shiftId)}
                                  className="h-7 w-7 rounded flex items-center justify-center hover:bg-muted transition-colors"
                                  title="Lihat rincian transaksi kas"
                                >
                                  <ChevronRight
                                    className={`h-4 w-4 transition-transform ${isOpen ? "rotate-90" : ""}`}
                                  />
                                </button>
                              </td>
                              <td className="py-2.5 px-3 tabular-nums whitespace-nowrap">
                                {r.closedAt
                                  ? new Date(r.closedAt).toLocaleString("id-ID", {
                                      day: "2-digit",
                                      month: "short",
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    })
                                  : "-"}
                              </td>
                              <td className="py-2.5 px-3">{r.branchName ?? "-"}</td>
                              <td className="py-2.5 px-3 text-right tabular-nums">
                                {formatRp(r.cashFloat)}
                              </td>
                              <td className="py-2.5 px-3 text-right tabular-nums">
                                {/* Mutasi Kas = sales (always in) + adjustments
                                    (±). Expansion shows each movement. */}
                                {r.cashSales + r.cashAdjustments > 0 ? "+" : ""}
                                {formatRp(r.cashSales + r.cashAdjustments)}
                              </td>
                              <td className="py-2.5 px-3 text-right tabular-nums">
                                {formatRp(r.expectedCash)}
                              </td>
                              <td className="py-2.5 px-3 text-right tabular-nums">
                                {formatRp(r.actualCash)}
                              </td>
                              <td className="py-2.5 px-3 text-right tabular-nums">
                                <VarianceBadge variance={r.variance} />
                              </td>
                            </tr>
                            {isOpen && (
                              <CashDetailRow
                                shiftId={r.shiftId}
                                cashFloat={r.cashFloat}
                                expectedCash={r.expectedCash}
                                actualCash={r.actualCash}
                              />
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
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

          {/* Mobile cards — own everything below lg, same as the other tabs */}
          <div className="space-y-2.5 lg:hidden">
            {brokenStockLoading ? (
              [0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="animate-pulse rounded-xl border bg-card p-3.5"
                  style={{ animationDelay: `${i * 120}ms` }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="h-3.5 w-32 rounded bg-muted" />
                      <div className="mt-2 h-3 w-24 rounded bg-muted" />
                    </div>
                    <div className="h-3.5 w-20 rounded bg-muted" />
                  </div>
                  <div className="mt-3 h-3 w-2/3 rounded bg-muted" />
                </div>
              ))
            ) : filteredBrokenStock.length > 0 ? (
              filteredBrokenStock.map((entry) => (
                <div key={entry.id} className="rounded-xl border bg-card p-3.5 shadow-xs">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{entry.ingredientName}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                        {new Date(entry.createdAt).toLocaleDateString("id-ID", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-xs text-muted-foreground">Nilai</div>
                      <div className="text-sm font-semibold tabular-nums">
                        {formatRp(entry.valuation ?? 0)}
                      </div>
                    </div>
                  </div>
                  <div className="mt-2.5 flex items-center gap-2 border-t pt-2.5 text-xs">
                    <span className="inline-flex items-center rounded-md border px-2 py-0.5 font-medium tabular-nums">
                      Qty {entry.quantity}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">
                      {entry.notes ?? "-"}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-dashed bg-muted/20 p-8 text-center">
                <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                  <PackageX className="h-5 w-5 text-muted-foreground" />
                </div>
                <p className="mt-3 text-sm font-medium">Tidak ada data barang rusak</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Catatan bahan rusak dari gudang akan muncul di sini.
                </p>
              </div>
            )}
          </div>

          {/* Desktop table */}
          <div className="hidden lg:block rounded-lg border overflow-hidden">
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
              className={`h-11 flex-1 rounded-md text-sm sm:h-9 sm:flex-none sm:px-4 ${revenueType === "manual" ? "bg-primary text-primary-foreground" : "border"}`}
            >
              Manual Revenue
            </button>
            <button
              type="button"
              onClick={() => setRevenueType("channel")}
              className={`h-11 flex-1 rounded-md text-sm sm:h-9 sm:flex-none sm:px-4 ${revenueType === "channel" ? "bg-primary text-primary-foreground" : "border"}`}
            >
              Per Channel
            </button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
            <div className="space-y-2">
              <label className="text-sm font-medium">Cabang</label>
              <select
                name="branchId"
                required
                className="h-11 w-full rounded-md border border-input bg-background px-3 text-base sm:h-9 sm:text-sm"
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
                className="h-11 w-full rounded-md border border-input bg-background px-3 text-base sm:h-9 sm:text-sm"
              />
            </div>
          </div>
          {revenueType === "channel" && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Channel</label>
              <select
                name="channel"
                required
                className="h-11 w-full rounded-md border border-input bg-background px-3 text-base sm:h-9 sm:text-sm"
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
              className="h-11 w-full rounded-md border border-input bg-background px-3 text-base sm:h-9 sm:text-sm"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Catatan</label>
            <textarea
              name="notes"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-base min-h-[60px] resize-none sm:text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-2 pt-2 sm:flex sm:justify-end">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="h-11 rounded-md border text-sm sm:h-9 sm:px-4"
            >
              Batal
            </button>
            <button
              type="submit"
              className="h-11 rounded-md bg-primary text-primary-foreground text-sm active:scale-[0.99] sm:h-9 sm:px-4"
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
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Cabang</label>
              <select
                name="branchId"
                required
                className="h-11 w-full rounded-md border border-input bg-background px-3 text-base sm:h-9 sm:text-sm"
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
                className="h-11 w-full rounded-md border border-input bg-background px-3 text-base sm:h-9 sm:text-sm"
              />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Kategori</label>
            <select
              name="category"
              required
              className="h-11 w-full rounded-md border border-input bg-background px-3 text-base sm:h-9 sm:text-sm"
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
              className="h-11 w-full rounded-md border border-input bg-background px-3 text-base sm:h-9 sm:text-sm"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Catatan</label>
            <textarea
              name="notes"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-base min-h-[60px] resize-none sm:text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-2 pt-2 sm:flex sm:justify-end">
            <button
              type="button"
              onClick={() => setExpenseModalOpen(false)}
              className="h-11 rounded-md border text-sm sm:h-9 sm:px-4"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={createExpenseMutation.isPending}
              className="h-11 rounded-md bg-primary text-primary-foreground text-sm active:scale-[0.99] disabled:opacity-50 sm:h-9 sm:px-4"
            >
              {createExpenseMutation.isPending ? "Menyimpan..." : "Simpan"}
            </button>
          </div>
        </form>
      </Modal>
    </RoleGuard>
  );
}
