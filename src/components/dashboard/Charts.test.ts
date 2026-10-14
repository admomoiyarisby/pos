import { describe, expect, it, vi } from "vite-plus/test";
import { computeSalesTrend } from "#/components/dashboard/Charts";

describe("computeSalesTrend", () => {
  it("attributes 02:00 WIB sales to the Jakarta day", () => {
    vi.setSystemTime(new Date("2026-10-14T12:00:00.000Z"));
    try {
      const orders: Parameters<typeof computeSalesTrend>[0] = [
        {
          id: "a",
          channel: "Dine-in",
          totalAmount: 50000,
          branchId: "b",
          createdAt: new Date("2026-10-13T19:30:00.000Z"),
          status: "Done",
        },
        {
          id: "b",
          channel: "Dine-in",
          totalAmount: 25000,
          branchId: "b",
          createdAt: new Date("2026-10-14T10:00:00.000Z"),
          status: "Done",
        },
      ];
      const days = computeSalesTrend(orders);
      expect(days).toHaveLength(7);
      const today = days[days.length - 1];
      expect(today.sales).toBe(75);
    } finally {
      vi.useRealTimers();
    }
  });
});
