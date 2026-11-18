import { describe, expect, it } from "vite-plus/test";
import {
  dashboardDateLabel,
  dashboardRangeDays,
  dashboardSearchSchema,
  resolveDashboardRange,
  resolveDashboardSearch,
  shiftIsoDay,
  trendBucketLabel,
  trendBucketStarts,
  trendGranularityFor,
} from "#/lib/dashboard-range";

const NOW = new Date("2026-11-18T05:00:00.000Z"); // 18 Nov 2026, 12:00 WIB

describe("dashboard date ranges", () => {
  it("resolves the rolling presets in Jakarta days", () => {
    expect(resolveDashboardRange("today", undefined, undefined, NOW)).toMatchObject({
      from: "2026-11-18",
      to: "2026-11-18",
    });
    expect(resolveDashboardRange("7d", undefined, undefined, NOW)).toMatchObject({
      from: "2026-11-12",
      to: "2026-11-18",
    });
    expect(resolveDashboardRange("30d", undefined, undefined, NOW)).toMatchObject({
      from: "2026-10-20",
      to: "2026-11-18",
    });
    expect(resolveDashboardRange("this-month", undefined, undefined, NOW)).toMatchObject({
      from: "2026-11-01",
      to: "2026-11-30",
    });
    expect(resolveDashboardRange("last-month", undefined, undefined, NOW)).toMatchObject({
      from: "2026-10-01",
      to: "2026-10-31",
    });
    expect(resolveDashboardRange("all", undefined, undefined, NOW)).toMatchObject({
      from: undefined,
      to: undefined,
    });
  });

  it("repairs a reversed custom range instead of querying backwards", () => {
    const range = resolveDashboardRange("custom", "2026-11-18", "2026-11-01", NOW);
    expect(range.from).toBe("2026-11-01");
    expect(range.to).toBe("2026-11-18");
    expect(dashboardRangeDays(range)).toBe(18);
  });

  it("defaults a clean URL to the last 7 days", () => {
    const range = resolveDashboardSearch({}, NOW);
    expect(range.period).toBe("7d");
    expect(range.from).toBe("2026-11-12");
    expect(range.to).toBe("2026-11-18");
  });

  it("drops invalid URL values instead of failing the route", () => {
    const search = dashboardSearchSchema.parse({
      period: "nonsense",
      from: "18-11-2026",
      to: "2026-11-18",
      branch: "not-a-uuid",
    });
    expect(search.period).toBeUndefined();
    expect(search.from).toBeUndefined();
    expect(search.to).toBe("2026-11-18");
    expect(search.branch).toBeUndefined();
  });

  it("labels the range in id-ID", () => {
    expect(dashboardDateLabel(undefined, undefined)).toBe("Semua waktu");
    expect(dashboardDateLabel("2026-11-18", "2026-11-18")).toBe("18 Nov 2026");
    expect(dashboardDateLabel("2026-11-12", "2026-11-18")).toBe("12 Nov – 18 Nov 2026");
  });
});

describe("trend bucketing", () => {
  it("uses daily, weekly, and monthly buckets as the span grows", () => {
    expect(
      trendGranularityFor(resolveDashboardRange("custom", "2026-11-12", "2026-11-18", NOW)),
    ).toBe("day");
    expect(
      trendGranularityFor(resolveDashboardRange("custom", "2026-08-01", "2026-11-18", NOW)),
    ).toBe("week");
    expect(
      trendGranularityFor(resolveDashboardRange("custom", "2025-01-01", "2026-11-18", NOW)),
    ).toBe("month");
    expect(trendGranularityFor(resolveDashboardRange("all", undefined, undefined, NOW))).toBe(
      "month",
    );
  });

  it("fills zero days instead of skipping them", () => {
    const range = resolveDashboardRange("custom", "2026-11-17", "2026-11-19", NOW);
    expect(trendBucketStarts(range, "day")).toEqual(["2026-11-17", "2026-11-18", "2026-11-19"]);
  });

  it("starts weekly buckets on Monday and monthly buckets on the 1st", () => {
    const weekly = resolveDashboardRange("custom", "2026-11-18", "2026-12-01", NOW);
    expect(trendBucketStarts(weekly, "week")[0]).toBe("2026-11-16");

    const monthly = resolveDashboardRange("custom", "2026-11-18", "2027-01-02", NOW);
    expect(trendBucketStarts(monthly, "month")).toEqual(["2026-11-01", "2026-12-01", "2027-01-01"]);
  });

  it("formats bucket labels for the chosen granularity", () => {
    expect(trendBucketLabel("2026-11-18", "day")).toBe("18 Nov");
    expect(trendBucketLabel("2026-11-01", "month")).toBe("Nov 26");
  });

  it("shifts ISO days across month boundaries", () => {
    expect(shiftIsoDay("2026-11-30", 1)).toBe("2026-12-01");
    expect(shiftIsoDay("2026-01-01", -1)).toBe("2025-12-31");
  });
});
