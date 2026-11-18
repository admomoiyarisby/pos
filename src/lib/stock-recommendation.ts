import { RECOMMENDATION_MAX_FRACTION_DIGITS, formatQuantity, roundQuantity } from "#/lib/utils";

/**
 * Safety-stock rule requested by the client: the reference stock for an
 * ingredient is its average daily stock-out over the last 3 complete days
 * multiplied by a lead time (5 days by default, configurable via
 * `stock_lead_time_days`). Current stock is compared against that reference,
 * and the shortfall is the amount staff should order.
 *
 * Kept free of database access so the arithmetic and the colour thresholds can
 * be tested without a fixture (the server core feeds it aggregated numbers).
 */
export const USAGE_WINDOW_DAYS = 3;
export const LEAD_TIME_DAYS = 5;

/** Sane bounds for the configured lead time; anything else falls back to 5. */
export const MIN_LEAD_TIME_DAYS = 1;
export const MAX_LEAD_TIME_DAYS = 90;

/** Up to one lead time plus a short buffer still needs attention. */
export const WATCH_BUFFER_DAYS = 2;

export type StockStatus = "low" | "watch" | "ok" | "no-data";

export const STOCK_STATUS_LABEL = {
  low: "Kurang",
  watch: "Perhatian",
  ok: "Aman",
  "no-data": "Belum ada data",
} satisfies Record<StockStatus, string>;

export const STOCK_STATUS_VARIANT = {
  low: "destructive",
  watch: "warning",
  ok: "success",
  "no-data": "outline",
} satisfies Record<StockStatus, "destructive" | "warning" | "success" | "outline">;

/**
 * Resolve a stored setting to a usable day count. Missing, fractional,
 * non-numeric and out-of-range values all fall back to the business default
 * instead of producing a nonsensical target.
 */
export function normalizeLeadTimeDays(raw: string | number | null | undefined): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < MIN_LEAD_TIME_DAYS || parsed > MAX_LEAD_TIME_DAYS) {
    return LEAD_TIME_DAYS;
  }
  return parsed;
}

/** Accessible description for a marker at the configured lead time. */
export function stockStatusHint(
  status: StockStatus,
  leadTimeDays: number = LEAD_TIME_DAYS,
): string {
  switch (status) {
    case "low":
      return `Stok di bawah acuan ${leadTimeDays} hari`;
    case "watch":
      return `Stok cukup untuk ${leadTimeDays}–${leadTimeDays + WATCH_BUFFER_DAYS} hari`;
    case "ok":
      return `Stok lebih dari ${leadTimeDays + WATCH_BUFFER_DAYS} hari`;
    case "no-data":
      return `Belum ada pemakaian ${USAGE_WINDOW_DAYS} hari terakhir`;
  }
}

export interface StockRecommendationNumbers {
  usage3d: number;
  avgDailyUsage: number;
  targetStock: number;
  /** `null` when there was no usage to divide by. */
  daysCover: number | null;
  status: StockStatus;
  recommendedOrder: number;
}

export function stockStatusFor(
  avgDailyUsage: number,
  daysCover: number | null,
  leadTimeDays: number = LEAD_TIME_DAYS,
): StockStatus {
  if (!(avgDailyUsage > 0) || daysCover === null) return "no-data";
  if (daysCover < leadTimeDays) return "low";
  if (daysCover <= leadTimeDays + WATCH_BUFFER_DAYS) return "watch";
  return "ok";
}

export function stockRecommendationFor(
  currentStock: number,
  usage3d: number,
  windowDays: number = USAGE_WINDOW_DAYS,
  leadTimeDays: number = LEAD_TIME_DAYS,
): StockRecommendationNumbers {
  const avgDailyUsage = windowDays > 0 ? usage3d / windowDays : 0;
  const targetStock = avgDailyUsage * leadTimeDays;
  const daysCover = avgDailyUsage > 0 ? currentStock / avgDailyUsage : null;
  const status = stockStatusFor(avgDailyUsage, daysCover, leadTimeDays);
  return {
    usage3d,
    avgDailyUsage,
    targetStock,
    daysCover,
    status,
    // `ok` already implies current stock covers the target, so the shortfall is
    // only positive when the marker is low/watch.
    recommendedOrder:
      status === "no-data" ? 0 : roundQuantity(Math.max(0, targetStock - currentStock)),
  };
}

/** Shared lookup key: a recommendation is per (branch, ingredient). */
export function stockRecommendationKey(branchId: string, ingredientId: string): string {
  return `${branchId}:${ingredientId}`;
}

/** "3,5 hari" — a cover of 0 is honest ("0 hari"), a missing one is "—". */
export function formatDaysCover(daysCover: number | null): string {
  if (daysCover === null) return "—";
  return `${formatQuantity(daysCover)} hari`;
}

/**
 * The recommendation as the screen shows it: one decimal, not three.
 *
 * `10,667` next to a stock unit measured in whole pcs reads as false precision,
 * and the number is multiplied by a 3-day usage window, so the third decimal is
 * noise anyway. `recommendedOrder` itself stays exact; round it with
 * `roundRecommendation` before showing or applying it so the field a buyer sees
 * is the price they pay.
 */
export function formatRecommendationQuantity(value: number | null | undefined): string {
  return formatQuantity(value, RECOMMENDATION_MAX_FRACTION_DIGITS);
}

/** `recommendedOrder` at display precision — what "Isi rekomendasi" fills in. */
export function roundRecommendation(value: number): number {
  return roundQuantity(value, RECOMMENDATION_MAX_FRACTION_DIGITS);
}
