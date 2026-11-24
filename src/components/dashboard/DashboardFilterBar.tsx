import { CalendarDays, RefreshCw } from "lucide-react";
import { DASHBOARD_PERIOD_OPTIONS, type DashboardPeriod } from "#/lib/dashboard-range";

const QUICK_PERIODS: DashboardPeriod[] = [
  "today",
  "7d",
  "30d",
  "90d",
  "this-month",
  "last-month",
  "all",
];

interface DashboardFilterBarProps {
  period: DashboardPeriod;
  from?: string;
  to?: string;
  branchId?: string;
  branches: { id: string; name: string }[];
  showBranchFilter: boolean;
  dateLabel: string;
  isFetching: boolean;
  onPeriodChange: (period: DashboardPeriod) => void;
  onFromChange: (from: string) => void;
  onToChange: (to: string) => void;
  onBranchChange: (branchId: string) => void;
  onRefresh: () => void;
  /** Page-specific fields (e.g. analytics' order-status scope). Rendered with
   *  the shared ones so a page never grows a second filter surface. */
  children?: React.ReactNode;
}

/**
 * Page-level date range for the dashboard. Every tab and chart resolves its
 * query from this range; presets are shortcuts over the same custom inputs, so
 * there is one source of truth rather than a preset range plus a separate
 * manual range that can disagree.
 */
export default function DashboardFilterBar({
  period,
  from,
  to,
  branchId,
  branches,
  showBranchFilter,
  dateLabel,
  isFetching,
  onPeriodChange,
  onFromChange,
  onToChange,
  onBranchChange,
  onRefresh,
  children,
}: DashboardFilterBarProps) {
  return (
    <div className="rounded-lg border bg-card p-3 shadow-sm md:p-4">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <CalendarDays className="h-3.5 w-3.5" />
            Periode
          </span>
          <div className="flex flex-wrap gap-1">
            {QUICK_PERIODS.map(function (option) {
              const label = DASHBOARD_PERIOD_OPTIONS.find(function (entry) {
                return entry.value === option;
              })?.label;
              const active = period === option;
              return (
                <button
                  key={option}
                  type="button"
                  aria-pressed={active}
                  onClick={function () {
                    onPeriodChange(option);
                  }}
                  className={
                    "h-8 rounded-full border px-3 text-xs font-medium transition-colors " +
                    (active
                      ? "border-primary bg-primary text-primary-foreground"
                      : "bg-background text-foreground hover:bg-muted")
                  }
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <label
              htmlFor="dashboard-from"
              className="text-[11px] font-medium text-muted-foreground"
            >
              Dari
            </label>
            <input
              id="dashboard-from"
              type="date"
              value={from ?? ""}
              onChange={function (event) {
                onFromChange(event.target.value);
              }}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm sm:w-36"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="dashboard-to" className="text-[11px] font-medium text-muted-foreground">
              Sampai
            </label>
            <input
              id="dashboard-to"
              type="date"
              value={to ?? ""}
              onChange={function (event) {
                onToChange(event.target.value);
              }}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm sm:w-36"
            />
          </div>

          {showBranchFilter && (
            <div className="space-y-1">
              <label
                htmlFor="dashboard-branch"
                className="text-[11px] font-medium text-muted-foreground"
              >
                Cabang
              </label>
              <select
                id="dashboard-branch"
                value={branchId ?? ""}
                onChange={function (event) {
                  onBranchChange(event.target.value);
                }}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm sm:w-52"
              >
                <option value="">Semua Cabang</option>
                {branches.map(function (branch) {
                  return (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  );
                })}
              </select>
            </div>
          )}

          {children}

          <div className="ml-auto flex items-center gap-2 pb-0.5">
            <span className="text-xs text-muted-foreground">{dateLabel}</span>
            <button
              type="button"
              onClick={onRefresh}
              disabled={isFetching}
              aria-label="Muat ulang data dashboard"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border text-muted-foreground hover:bg-muted disabled:opacity-50"
            >
              <RefreshCw className={"h-4 w-4 " + (isFetching ? "animate-spin" : "")} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
