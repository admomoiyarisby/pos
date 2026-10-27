import { toDateInputValue } from "#/lib/utils";

/**
 * Period helpers for the finance / Stok Keluar report pickers.
 *
 * Every "current" default is derived from **Asia/Jakarta**, not the runtime
 * clock. The app servers run with `TZ=UTC` (deploy/compose.yaml) while the
 * outlets are on WIB, so a local-clock default made the server-rendered month
 * disagree with the browser's for the first seven hours of every month — the
 * page briefly painted the wrong period and then refetched. These helpers keep
 * server render and hydration on the same calendar.
 */

/** The outlet's current month as `YYYY-MM`. */
export function currentMonthValue(now: Date = new Date()): string {
  return toDateInputValue(now).slice(0, 7);
}

/** The outlet's current day as `YYYY-MM-DD`. */
export function currentDateValue(now: Date = new Date()): string {
  return toDateInputValue(now);
}

/**
 * Number of days in a 1-based month.
 *
 * `Date.UTC(year, month, 0)` is day zero of the *next* month, i.e. the last day
 * of `month`; UTC arithmetic keeps the answer independent of the runtime
 * timezone.
 */
export function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * The four fixed weeks the report pickers offer: 1–7, 8–14, 15–21, and 22–end.
 * Purely a function of the selected month, so it needs no timezone.
 */
export function weeksInMonth(year: number, month: number) {
  const mm = String(month).padStart(2, "0");
  const lastDay = lastDayOfMonth(year, month);
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

/**
 * The most recent `count` months, newest first, each labelled in Indonesian.
 *
 * Labels are formatted in UTC because the dates are built at UTC midnight; the
 * runtime timezone would otherwise shift a January date back to December.
 */
export function recentMonths(count = 12, now: Date = new Date()) {
  const [year, month] = currentMonthValue(now).split("-").map(Number);
  const labelFormat = new Intl.DateTimeFormat("id-ID", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  });

  const months = [];
  for (let i = 0; i < count; i++) {
    // `month - 1` is the 0-based index of the current month; subtracting `i`
    // walks backwards and rolls across the year boundary.
    const date = new Date(Date.UTC(year, month - 1 - i, 1));
    months.push({
      label: labelFormat.format(date),
      value: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`,
    });
  }
  return months;
}
