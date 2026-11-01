import { toDateInputValue } from "#/lib/utils";

export interface DashboardFilter {
  /** Inclusive Jakarta calendar day, `YYYY-MM-DD`. */
  from?: string;
  /** Inclusive Jakarta calendar day, `YYYY-MM-DD`. */
  to?: string;
  branchId?: string;
}

/**
 * A row matches when it belongs to the selected branch and its Jakarta
 * calendar day sits inside the inclusive range. A missing date never hides a
 * row: rows without a date can only be excluded by the branch filter.
 */
export function matchesDashboardFilter(
  date: Date | string | undefined,
  branchId: string,
  filter: DashboardFilter,
): boolean {
  if (filter.branchId && branchId !== filter.branchId) return false;
  if (!date) return true;

  const day = toDateInputValue(date);
  if (filter.from && day < filter.from) return false;
  if (filter.to && day > filter.to) return false;
  return true;
}
