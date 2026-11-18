import { z } from "zod";
import { currentDateValue, currentMonthValue, lastDayOfMonth } from "#/lib/report-period";

/**
 * Dashboard date range — one vocabulary for the page filter, every tab, and
 * every chart (ADR 0034).
 *
 * Presets resolve to inclusive Jakarta calendar days (`YYYY-MM-DD`), the same
 * day boundaries the POS, finance, and stock reports use. The resolved range
 * is what enters the React Query key and the server WHERE clause, so shortcuts
 * and custom inputs cannot disagree.
 */
export const DASHBOARD_PERIOD_VALUES = [
  "today",
  "7d",
  "30d",
  "90d",
  "this-month",
  "last-month",
  "all",
  "custom",
] as const;

export type DashboardPeriod = (typeof DASHBOARD_PERIOD_VALUES)[number];

export const DASHBOARD_PERIOD_OPTIONS: { value: DashboardPeriod; label: string }[] = [
  { value: "today", label: "Hari ini" },
  { value: "7d", label: "7 hari" },
  { value: "30d", label: "30 hari" },
  { value: "90d", label: "90 hari" },
  { value: "this-month", label: "Bulan ini" },
  { value: "last-month", label: "Bulan lalu" },
  { value: "all", label: "Semua waktu" },
  { value: "custom", label: "Rentang khusus" },
];

export const DEFAULT_DASHBOARD_PERIOD: DashboardPeriod = "7d";

const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal harus YYYY-MM-DD")
  .optional()
  .catch(undefined);

/**
 * URL schema for the dashboard filters. Every field is optional so a clean URL
 * means the default period; invalid values are dropped instead of breaking the
 * route.
 */
export const dashboardSearchSchema = z.object({
  period: z.enum(DASHBOARD_PERIOD_VALUES).optional().catch(undefined),
  from: isoDay,
  to: isoDay,
  branch: z.string().uuid().optional().catch(undefined),
});

export type DashboardSearch = z.infer<typeof dashboardSearchSchema>;

export interface ResolvedDashboardRange {
  period: DashboardPeriod;
  /** Inclusive Jakarta day, or undefined for "all time". */
  from?: string;
  /** Inclusive Jakarta day, or undefined for "all time". */
  to?: string;
  /** Preset name, e.g. "30 hari". */
  label: string;
  /** Human date span, e.g. "20 Okt – 18 Nov 2026". */
  dateLabel: string;
}

export function shiftIsoDay(day: string, days: number): string {
  const shifted = new Date(`${day}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

export function daysBetweenIso(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function monthRange(monthOffset: number, now: Date) {
  const [year, month] = currentMonthValue(now).split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + monthOffset, 1));
  const targetYear = target.getUTCFullYear();
  const targetMonth = target.getUTCMonth() + 1;
  const ym = `${targetYear}-${String(targetMonth).padStart(2, "0")}`;
  return {
    from: `${ym}-01`,
    to: `${ym}-${String(lastDayOfMonth(targetYear, targetMonth)).padStart(2, "0")}`,
  };
}

function formatDay(day: string, withYear: boolean): string {
  const options: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  };
  if (withYear) options.year = "numeric";
  return new Intl.DateTimeFormat("id-ID", options).format(new Date(`${day}T00:00:00Z`));
}

/** "20 Okt – 18 Nov 2026", "18 Nov 2026", or "Semua waktu". */
export function dashboardDateLabel(from?: string, to?: string): string {
  if (!from) return to ? `Sampai ${formatDay(to, true)}` : "Semua waktu";
  if (!to) return `Sejak ${formatDay(from, true)}`;
  if (from === to) return formatDay(from, true);
  if (from.slice(0, 4) === to.slice(0, 4)) {
    return `${formatDay(from, false)} – ${formatDay(to, true)}`;
  }
  return `${formatDay(from, true)} – ${formatDay(to, true)}`;
}

function periodLabel(period: DashboardPeriod): string {
  return (
    DASHBOARD_PERIOD_OPTIONS.find(function (option) {
      return option.value === period;
    })?.label ?? "Rentang khusus"
  );
}

/**
 * Resolve a URL `period` (+ custom dates) into an inclusive day range.
 *
 * `today` is the Jakarta day, not the device's local day. `custom` stays
 * custom; if its inputs are absent or reversed the range is repaired instead
 * of producing an empty or inverted query.
 */
export function resolveDashboardRange(
  period: DashboardPeriod,
  from?: string,
  to?: string,
  now: Date = new Date(),
): ResolvedDashboardRange {
  const today = currentDateValue(now);
  let resolvedFrom: string | undefined;
  let resolvedTo: string | undefined;

  switch (period) {
    case "today":
      resolvedFrom = today;
      resolvedTo = today;
      break;
    case "7d":
      resolvedFrom = shiftIsoDay(today, -6);
      resolvedTo = today;
      break;
    case "30d":
      resolvedFrom = shiftIsoDay(today, -29);
      resolvedTo = today;
      break;
    case "90d":
      resolvedFrom = shiftIsoDay(today, -89);
      resolvedTo = today;
      break;
    case "this-month":
      resolvedFrom = monthRange(0, now).from;
      resolvedTo = monthRange(0, now).to;
      break;
    case "last-month":
      resolvedFrom = monthRange(-1, now).from;
      resolvedTo = monthRange(-1, now).to;
      break;
    case "all":
      resolvedFrom = undefined;
      resolvedTo = undefined;
      break;
    case "custom": {
      resolvedFrom = from ?? shiftIsoDay(today, -29);
      resolvedTo = to ?? today;
      if (resolvedFrom > resolvedTo) {
        const swap = resolvedFrom;
        resolvedFrom = resolvedTo;
        resolvedTo = swap;
      }
      break;
    }
  }

  return {
    period,
    from: resolvedFrom,
    to: resolvedTo,
    label: periodLabel(period),
    dateLabel: dashboardDateLabel(resolvedFrom, resolvedTo),
  };
}

/** Read the current URL search into a concrete range. */
export function resolveDashboardSearch(
  search: DashboardSearch,
  now: Date = new Date(),
): ResolvedDashboardRange {
  const period = search.period ?? DEFAULT_DASHBOARD_PERIOD;
  return resolveDashboardRange(period, search.from, search.to, now);
}

/** The inclusive day span, or null for all-time. */
export function dashboardRangeDays(range: ResolvedDashboardRange): number | null {
  if (!range.from || !range.to) return null;
  return daysBetweenIso(range.from, range.to) + 1;
}

/**
 * Chart trend bucket size: daily for short ranges, weekly for a quarter, and
 * monthly once the span would make a daily line unreadable. All-time is always
 * monthly because its span is unbounded.
 */
export type TrendGranularity = "day" | "week" | "month";

export function trendGranularityFor(range: ResolvedDashboardRange): TrendGranularity {
  const days = dashboardRangeDays(range);
  if (days === null) return "month";
  if (days <= 45) return "day";
  if (days <= 180) return "week";
  return "month";
}

/**
 * Bucket starts covering the range, so the chart shows zero days instead of
 * silently connecting two non-adjacent points. All-time starts at the first
 * returned bucket (the caller passes it in).
 */
export function trendBucketStarts(
  range: ResolvedDashboardRange,
  granularity: TrendGranularity,
  firstDataBucket?: string,
): string[] {
  const from = range.from ?? firstDataBucket;
  if (!from) return [];
  const to = range.to ?? firstDataBucket;
  if (!to) return [];

  if (granularity === "day") {
    const buckets: string[] = [];
    for (let day = from; day <= to; day = shiftIsoDay(day, 1)) buckets.push(day);
    return buckets;
  }

  if (granularity === "week") {
    const weekday = new Date(`${from}T00:00:00Z`).getUTCDay(); // 0=Sunday
    const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
    const buckets: string[] = [];
    for (let day = shiftIsoDay(from, mondayOffset); day <= to; day = shiftIsoDay(day, 7)) {
      buckets.push(day);
    }
    return buckets;
  }

  const buckets: string[] = [];
  let [year, month] = from.slice(0, 7).split("-").map(Number);
  for (;;) {
    const bucket = `${year}-${String(month).padStart(2, "0")}-01`;
    if (bucket > to) break;
    buckets.push(bucket);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return buckets;
}

/** Short axis label for a trend bucket. */
export function trendBucketLabel(bucket: string, granularity: TrendGranularity): string {
  const date = new Date(`${bucket}T00:00:00Z`);
  return new Intl.DateTimeFormat("id-ID", {
    ...(granularity === "month"
      ? { month: "short", year: "2-digit" }
      : { day: "numeric", month: "short" }),
    timeZone: "UTC",
  }).format(date);
}
