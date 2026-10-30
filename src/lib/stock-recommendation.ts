import { formatQuantity, roundQuantity } from "#/lib/utils";

/**
 * Safety-stock rule requested by the client: the reference stock for an
 * ingredient is its average daily stock-out over the last 3 complete days
 * multiplied by a 5-day lead time. Current stock is compared against that
 * reference, and the shortfall is the amount staff should order.
 *
 * Kept free of database access so the arithmetic and the colour thresholds can
 * be tested without a fixture (the server core feeds it aggregated numbers).
 */
export const USAGE_WINDOW_DAYS = 3;
export const LEAD_TIME_DAYS = 5;

/** Below the lead time means the next delivery may not arrive in time. */
const LOW_COVER_DAYS = 5;
/** Up to one lead time plus a short buffer still needs attention. */
const WATCH_COVER_DAYS = 7;

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

export const STOCK_STATUS_HINT = {
  low: "Stok di bawah acuan 5 hari",
  watch: "Stok cukup untuk 5–7 hari",
  ok: "Stok lebih dari 7 hari",
  "no-data": "Belum ada pemakaian 3 hari terakhir",
} satisfies Record<StockStatus, string>;

export interface StockRecommendationNumbers {
  usage3d: number;
  avgDailyUsage: number;
  targetStock: number;
  /** `null` when there was no usage to divide by. */
  daysCover: number | null;
  status: StockStatus;
  recommendedOrder: number;
}

export function stockStatusFor(avgDailyUsage: number, daysCover: number | null): StockStatus {
  if (!(avgDailyUsage > 0) || daysCover === null) return "no-data";
  if (daysCover < LOW_COVER_DAYS) return "low";
  if (daysCover <= WATCH_COVER_DAYS) return "watch";
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
  const status = stockStatusFor(avgDailyUsage, daysCover);
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
