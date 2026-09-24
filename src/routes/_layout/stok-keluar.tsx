import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import { IngredientUsageSection } from "#/components/finance/IngredientUsageSection";
import { usePageTitle } from "#/hooks/usePageTitle";
import { useAuth } from "#/lib/auth-context";
import { getDailyIngredientUsage } from "#/lib/server/finance";
import { getBranches } from "#/lib/server/branches";

export const Route = createFileRoute("/_layout/stok-keluar")({
  component: StokKeluarPage,
});

type PeriodType = "bulanan" | "mingguan" | "harian";

// Same week/month helpers as /finance so both pages produce identical ranges.
// `month` is 1-indexed (as it comes from the "YYYY-MM" selected month), so
// `new Date(year, month, 0)` is the last day of that same month.
function getWeeksInMonth(year: number, month: number) {
  const mm = String(month).padStart(2, "0");
  const lastDay = new Date(year, month, 0).getDate();
  return [
    { label: "Minggu 1 (1-7)", from: `${year}-${mm}-01`, to: `${year}-${mm}-07` },
    { label: "Minggu 2 (8-14)", from: `${year}-${mm}-08`, to: `${year}-${mm}-14` },
    { label: "Minggu 3 (15-21)", from: `${year}-${mm}-15`, to: `${year}-${mm}-21` },
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
    });
  }
  return months;
}

function StokKeluarPage() {
  const { user } = useAuth();
  // Single-branch roles (branch_admin, central_kitchen) are locked to their
  // branch — the server core enforces this too, the UI just mirrors it.
  const lockedBranchId = user?.branchId ?? "";
  const isBranchLocked = Boolean(lockedBranchId);

  const [periodType, setPeriodType] = useState<PeriodType>("bulanan");
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  // Correct the month on the client (server renders in a different TZ).
  useEffect(() => {
    const now = new Date();
    setSelectedMonth(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  }, []);
  const [selectedWeek, setSelectedWeek] = useState(0);
  const [selectedDate, setSelectedDate] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  });
  useEffect(() => {
    const now = new Date();
    setSelectedDate(
      `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`,
    );
  }, []);
  const [selectedBranchId, setSelectedBranchId] = useState<string>(lockedBranchId);

  // Multi-branch viewers (supervisors) get the branch picker; single-branch
  // users get a read-only field showing their branch's name (fetched here too,
  // not just for supervisors).
  const { data: branches } = useQuery({
    queryKey: ["branches"],
    queryFn: () => getBranches({ data: {} }),
  });

  const months = useMemo(() => getMonthsList(), []);
  const weeks = useMemo(() => {
    const [year, month] = selectedMonth.split("-").map(Number);
    return getWeeksInMonth(year, month);
  }, [selectedMonth]);

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

  const { data: usage, isLoading } = useQuery({
    queryKey: ["ingredient-usage", effectiveDateRange.from, effectiveDateRange.to, branchId],
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

        <IngredientUsageSection
          rows={usage}
          isLoading={isLoading}
          expanded={usageExpanded}
          onToggle={() => setUsageExpanded((v) => !v)}
        />
      </div>
    </RoleGuard>
  );
}
