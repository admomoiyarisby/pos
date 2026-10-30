import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import { IngredientUsageSection } from "#/components/finance/IngredientUsageSection";
import { usePageTitle } from "#/hooks/usePageTitle";
import { useAuth } from "#/lib/auth-context";
import { getDailyIngredientUsage } from "#/lib/server/finance";
import { getBranches } from "#/lib/server/branches";
import {
  currentDateValue,
  currentMonthValue,
  lastDayOfMonth,
  recentMonths,
  weeksInMonth,
} from "#/lib/report-period";
import { wasteCycleForMonth } from "#/lib/waste-period";

export const Route = createFileRoute("/_layout/stok-keluar")({
  component: StokKeluarPage,
});

type PeriodType = "bulanan" | "mingguan" | "harian" | "rentang";

const PERIOD_LABELS = {
  harian: "Harian",
  mingguan: "Mingguan",
  bulanan: "Bulanan",
  rentang: "Rentang",
} satisfies Record<PeriodType, string>;

/** A date-input value in `YYYY-MM-DD` form (empty string when cleared). */
const isDateValue = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

function StokKeluarPage() {
  const { user } = useAuth();
  // Single-branch roles (branch_admin, central_kitchen) are locked to their
  // branch — the server core enforces this too, the UI just mirrors it.
  const lockedBranchId = user?.branchId ?? "";
  const isBranchLocked = Boolean(lockedBranchId);
  // Rp nominals (cost estimates) are for supervisors only — branch admins see
  // physical quantities. central_kitchen still sees nominals.
  const isBranchAdmin = user?.role === "branch_admin";

  const [periodType, setPeriodType] = useState<PeriodType>("bulanan");
  // Both defaults come from the Jakarta calendar, so the server-rendered month
  // and the hydrated one agree (no client-side correction effect needed).
  const [selectedMonth, setSelectedMonth] = useState(() => currentMonthValue());
  const [selectedWeek, setSelectedWeek] = useState(0);
  const [selectedDate, setSelectedDate] = useState(() => currentDateValue());
  // Custom range. Defaults to the current month so switching to "Rentang"
  // starts from what the user was already looking at, then narrows it.
  const [rangeFrom, setRangeFrom] = useState(() => `${currentMonthValue()}-01`);
  const [rangeTo, setRangeTo] = useState(() => {
    const month = currentMonthValue();
    const [year, m] = month.split("-").map(Number);
    return `${month}-${String(lastDayOfMonth(year, m)).padStart(2, "0")}`;
  });
  const [selectedBranchId, setSelectedBranchId] = useState<string>(lockedBranchId);

  // Multi-branch viewers (supervisors) get the branch picker; single-branch
  // users get a read-only field showing their branch's name (fetched here too,
  // not just for supervisors).
  const { data: branches } = useQuery({
    queryKey: ["branches"],
    queryFn: () => getBranches({ data: {} }),
  });

  const months = useMemo(() => recentMonths(), []);
  const weeks = useMemo(() => {
    const [year, month] = selectedMonth.split("-").map(Number);
    return weeksInMonth(year, month);
  }, [selectedMonth]);

  const effectiveDateRange = useMemo(() => {
    if (periodType === "bulanan") {
      const [year, month] = selectedMonth.split("-").map(Number);
      const lastDay = lastDayOfMonth(year, month);
      return {
        from: `${selectedMonth}-01`,
        to: `${selectedMonth}-${String(lastDay).padStart(2, "0")}`,
      };
    }
    if (periodType === "mingguan") {
      return { from: weeks[selectedWeek].from, to: weeks[selectedWeek].to };
    }
    if (periodType === "rentang") {
      return { from: rangeFrom, to: rangeTo };
    }
    return { from: selectedDate, to: selectedDate };
  }, [periodType, selectedMonth, selectedWeek, selectedDate, rangeFrom, rangeTo, weeks]);

  const rangeValid =
    periodType !== "rentang" ||
    (isDateValue(rangeFrom) && isDateValue(rangeTo) && rangeFrom <= rangeTo);

  const branchId = selectedBranchId || undefined;

  const { data: usage, isLoading } = useQuery({
    queryKey: ["ingredient-usage", effectiveDateRange.from, effectiveDateRange.to, branchId],
    // An inverted or half-filled range would silently return nothing; wait
    // until it is valid instead of showing an empty report.
    enabled: rangeValid,
    queryFn: () =>
      getDailyIngredientUsage({
        data: {
          dateFrom: effectiveDateRange.from || undefined,
          dateTo: effectiveDateRange.to || undefined,
          branchId,
        },
      }),
  });

  const [usageExpanded, setUsageExpanded] = useState(true);

  usePageTitle("Stok Keluar", "Pemakaian bahan per periode untuk cabang Anda");

  return (
    <RoleGuard
      allowedRoles={[
        "super_admin",
        "admin_pusat",
        "area_manager",
        "branch_admin",
        "central_kitchen",
      ]}
    >
      <div className="space-y-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Stok Keluar</h1>
          <p className="text-sm text-muted-foreground">
            Jumlah fisik bahan keluar per periode — rekap dari Kartu Stok (POS, waste, produksi).
          </p>
        </div>

        {/* Same filter layout as /finance: period segmented control + contextual
            date picker + branch. No channel filter — the usage aggregation is
            channel-agnostic (same as the finance Stok Keluar sub-tab). */}
        <div className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:flex-wrap sm:items-end sm:p-4">
          <div className="flex w-full overflow-hidden rounded-md border sm:w-auto">
            {
              // SAFETY: the four literal periods are exactly the PeriodType
              // union values; the annotation only asserts that for .map().
              (["harian", "mingguan", "bulanan", "rentang"] as PeriodType[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => {
                    // Seeding "Rentang" from the period already on screen lets
                    // the user narrow a known-good range instead of retyping it.
                    if (p === "rentang" && periodType !== "rentang") {
                      setRangeFrom(effectiveDateRange.from);
                      setRangeTo(effectiveDateRange.to);
                    }
                    setPeriodType(p);
                  }}
                  className={`h-10 flex-1 text-sm font-medium transition-colors sm:h-9 sm:flex-none sm:px-4 ${
                    periodType === p
                      ? "bg-primary text-primary-foreground"
                      : "bg-background hover:bg-muted"
                  }`}
                >
                  {PERIOD_LABELS[p]}
                </button>
              ))
            }
          </div>

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
          {periodType === "rentang" && (
            <>
              <div className="grid w-full grid-cols-2 gap-3 sm:contents">
                <div className="w-full space-y-1 sm:w-auto">
                  <label className="text-xs text-muted-foreground">Dari</label>
                  <input
                    type="date"
                    value={rangeFrom}
                    onChange={(e) => setRangeFrom(e.target.value)}
                    aria-label="Dari tanggal"
                    className="block h-10 w-full rounded-md border border-input bg-background px-3 text-base sm:h-9 sm:w-auto sm:text-sm"
                  />
                </div>
                <div className="w-full space-y-1 sm:w-auto">
                  <label className="text-xs text-muted-foreground">Sampai</label>
                  <input
                    type="date"
                    value={rangeTo}
                    onChange={(e) => setRangeTo(e.target.value)}
                    aria-label="Sampai tanggal"
                    className="block h-10 w-full rounded-md border border-input bg-background px-3 text-base sm:h-9 sm:w-auto sm:text-sm"
                  />
                </div>
                {/* The outlets close the books on the 25th, so their month runs
                    26 → 25 rather than 1 → end of month. This selects the cycle
                    that closes on the 25th of the month picked above (October →
                    26 Sep – 25 Oct). */}
                <button
                  type="button"
                  onClick={() => {
                    const cycle = wasteCycleForMonth(selectedMonth);
                    setRangeFrom(cycle.from);
                    setRangeTo(cycle.to);
                  }}
                  title="Siklus buku bulan terpilih: 26 bulan lalu sampai 25 bulan ini"
                  className="col-span-2 h-10 self-end rounded-md border px-3 text-sm font-medium transition-colors hover:bg-muted sm:col-span-1 sm:h-9"
                >
                  Siklus 26–25
                </button>
              </div>
              {!rangeValid && (
                <p className="w-full text-xs text-destructive">
                  Tanggal "Sampai" harus sama atau setelah tanggal "Dari".
                </p>
              )}
            </>
          )}

          {/* Branch — locked for single-branch users (mirrors the server-side
              scope); supervisors get the same picker as /finance. */}
          <div className="w-full space-y-1 sm:w-auto">
            <label className="text-xs text-muted-foreground">Cabang</label>
            {isBranchLocked ? (
              <input
                type="text"
                value={branches?.find((b) => b.id === lockedBranchId)?.name ?? "Cabang Anda"}
                readOnly
                aria-label="Cabang"
                className="block h-10 w-full rounded-md border border-input bg-muted/30 px-3 text-base text-muted-foreground sm:h-9 sm:w-auto sm:text-sm"
              />
            ) : (
              <select
                value={selectedBranchId}
                onChange={(e) => setSelectedBranchId(e.target.value)}
                aria-label="Cabang"
                className="block h-10 w-full rounded-md border border-input bg-background px-3 text-base sm:h-9 sm:w-auto sm:text-sm"
              >
                <option value="">Semua Cabang</option>
                {(branches ?? []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* Rp nominals hidden for branch admins only: they see physical
            quantities, not costs. central_kitchen still sees nominals. */}
        <IngredientUsageSection
          rows={usage}
          isLoading={isLoading}
          expanded={usageExpanded}
          onToggle={() => setUsageExpanded((v) => !v)}
          hideCurrency={isBranchAdmin}
        />
      </div>
    </RoleGuard>
  );
}
