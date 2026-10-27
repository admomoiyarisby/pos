import { describe, expect, it } from "vite-plus/test";
import {
  currentDateValue,
  currentMonthValue,
  lastDayOfMonth,
  recentMonths,
  weeksInMonth,
} from "./report-period";

describe("currentMonthValue / currentDateValue", () => {
  it("uses the Jakarta day even when UTC is still on the previous month", () => {
    // 31 Oct 2026 17:30 UTC is 1 Nov 2026 00:30 WIB.
    const instant = new Date("2026-10-31T17:30:00.000Z");
    expect(currentMonthValue(instant)).toBe("2026-11");
    expect(currentDateValue(instant)).toBe("2026-11-01");
  });

  it("keeps the previous month during the last Jakarta hours", () => {
    expect(currentMonthValue(new Date("2026-10-31T16:59:00.000Z"))).toBe("2026-10");
    expect(currentDateValue(new Date("2026-10-31T16:59:00.000Z"))).toBe("2026-10-31");
  });
});

describe("lastDayOfMonth", () => {
  it("handles 28/29/30/31-day months and leap years", () => {
    expect(lastDayOfMonth(2026, 2)).toBe(28);
    expect(lastDayOfMonth(2028, 2)).toBe(29);
    expect(lastDayOfMonth(2026, 4)).toBe(30);
    expect(lastDayOfMonth(2026, 12)).toBe(31);
  });
});

describe("weeksInMonth", () => {
  it("ends the last week on the real last day, zero-padded", () => {
    const weeks = weeksInMonth(2026, 2);
    expect(weeks).toHaveLength(4);
    expect(weeks[0]).toEqual({ label: "Minggu 1 (1-7)", from: "2026-02-01", to: "2026-02-07" });
    expect(weeks[3]).toEqual({ label: "Minggu 4 (22-28)", from: "2026-02-22", to: "2026-02-28" });
  });

  it("pads single-digit months", () => {
    expect(weeksInMonth(2026, 9)[0]).toEqual({
      label: "Minggu 1 (1-7)",
      from: "2026-09-01",
      to: "2026-09-07",
    });
  });
});

describe("recentMonths", () => {
  it("walks back across the year boundary in Jakarta", () => {
    const months = recentMonths(3, new Date("2026-01-15T05:00:00.000Z"));
    expect(months.map((m) => m.value)).toEqual(["2026-01", "2025-12", "2025-11"]);
    expect(months[0].label).toBe("Januari 2026");
  });
});
