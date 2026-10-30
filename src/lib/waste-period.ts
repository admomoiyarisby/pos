import { toDateInputValue } from "#/lib/utils";

/**
 * The waste/loss reporting period: the 26th of a month through the 25th of
 * the next, expressed as `YYYY-MM-DD` days in Asia/Jakarta.
 *
 * Pinned to Jakarta rather than the runtime's local clock on purpose. The app
 * servers run with `TZ=UTC` (deploy/compose.yaml) while every outlet is on WIB,
 * so a local-clock period made server render and hydration disagree for the
 * first seven hours of the 26th: the server still computed the cycle that was
 * ending while the browser recomputed the new one, and yesterday's rows
 * vanished right after the first paint ("waste muncul sebentar lalu hilang").
 * The period boundary is a Jakarta calendar fact, so both sides must derive it
 * from the same clock.
 */
export function wasteCycleRange(now: Date = new Date()) {
  // `toDateInputValue` is Jakarta-pinned, so this is the outlet's calendar day
  // even when the process runs in UTC. `month` is 1-based; `monthIndex` is the
  // 0-based index the month arithmetic below works in.
  const [year, month, day] = toDateInputValue(now).split("-").map(Number);
  const monthIndex = month - 1;

  if (day < 26) {
    // Still inside the cycle that opened on the 26th of the previous month.
    return wasteCycleForMonth(monthKey(year, monthIndex));
  }

  // The cycle that opened today, closing on the 25th of next month.
  return wasteCycleForMonth(monthKey(year, monthIndex + 1));
}

/**
 * The 26→25 cycle that **closes** on the 25th of `monthValue` (`YYYY-MM`).
 * October's books, for example, run 26 September → 25 October.
 */
export function wasteCycleForMonth(monthValue: string) {
  const [year, month] = monthValue.split("-").map(Number);
  const monthIndex = month - 1;
  return {
    from: `${monthKey(year, monthIndex - 1)}-26`,
    to: `${monthKey(year, monthIndex)}-25`,
  };
}

/**
 * `YYYY-MM` for a 0-based month index that may under- or overflow the year.
 *
 * Uses UTC arithmetic only, so the rollover (Jan → Dec of the previous year and
 * Dec → Jan of the next) cannot be shifted by the runtime timezone.
 */
function monthKey(year: number, monthIndex: number): string {
  const date = new Date(Date.UTC(year, monthIndex, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
