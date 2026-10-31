import { describe, expect, it } from "vite-plus/test";
import { buildDailyPnl, summarizePnl, type OrderAggregate } from "./finance-pnl";

const order = (over: Partial<OrderAggregate> = {}): OrderAggregate => ({
  date: "2026-09-26",
  channel: "ShopeeFood",
  orderCount: 10,
  grossSales: 1_000_000,
  netSales: 864_160,
  hpp: 400_000,
  ...over,
});

describe("buildDailyPnl — omzet basis", () => {
  it("falls back to POS net when no payout was input", () => {
    const [day] = buildDailyPnl([order()], []);
    const line = day.channels[0];
    expect(line.payout).toBeNull();
    expect(line.omzet).toBe(864_160);
    expect(line.source).toBe("pos");
    expect(line.gap).toBeNull();
    expect(line.grossProfit).toBe(464_160);
    expect(line.margin).toBeCloseTo(464_160 / 864_160, 10);
    expect(day.omzet).toBe(864_160);
    expect(day.grossProfit).toBe(464_160);
  });

  it("uses the typed payout as omzet and reports the gap vs POS net", () => {
    const [day] = buildDailyPnl(
      [order()],
      [{ date: "2026-09-26", channel: "ShopeeFood", amount: 512_509 }],
    );
    const line = day.channels[0];
    expect(line.payout).toBe(512_509);
    expect(line.omzet).toBe(512_509);
    expect(line.source).toBe("payout");
    expect(line.gap).toBe(512_509 - 864_160);
    expect(line.grossProfit).toBe(112_509);
    expect(line.margin).toBeCloseTo(112_509 / 512_509, 10);
    // POS net stays available for audit.
    expect(line.netSales).toBe(864_160);
    expect(day.posNet).toBe(864_160);
    expect(day.payout).toBe(512_509);
  });

  it("keeps POS-net fallback for channels without input while others use payouts", () => {
    const [day] = buildDailyPnl(
      [
        order({ channel: "ShopeeFood", netSales: 864_160, hpp: 400_000 }),
        order({ channel: "Gofood", netSales: 280_320, hpp: 200_000 }),
      ],
      [{ date: "2026-09-26", channel: "Gofood", amount: 229_036 }],
    );
    expect(day.channels.map((c) => [c.channel, c.omzet, c.source])).toEqual([
      ["Gofood", 229_036, "payout"],
      ["ShopeeFood", 864_160, "pos"],
    ]);
    expect(day.omzet).toBe(229_036 + 864_160);
    expect(day.payout).toBe(229_036);
    expect(day.posNet).toBe(864_160 + 280_320);
  });

  it("adds a signed day adjustment to the total without touching channels", () => {
    const [day] = buildDailyPnl(
      [order({ netSales: 1_000, hpp: 400 })],
      [],
      [{ date: "2026-09-26", amount: -100 }],
    );
    expect(day.channels).toHaveLength(1);
    expect(day.channels[0].omzet).toBe(1_000);
    expect(day.adjustment).toBe(-100);
    expect(day.omzet).toBe(900);
    expect(day.grossProfit).toBe(500);
    expect(day.margin).toBeCloseTo(500 / 900, 10);
  });
});

describe("buildDailyPnl — channel rows", () => {
  it("keeps a payout-only channel and leaves its margin unknown", () => {
    const [day] = buildDailyPnl(
      [],
      [{ date: "2026-09-26", channel: "Perlengkapan", amount: 200_000 }],
    );
    const line = day.channels[0];
    expect(line.orderCount).toBe(0);
    expect(line.hpp).toBe(0);
    expect(line.omzet).toBe(200_000);
    expect(line.source).toBe("payout");
    expect(line.gap).toBe(200_000);
    expect(line.margin).toBeNull();
    expect(day.omzet).toBe(200_000);
    // No POS orders means no HPP basis — not a 100% margin.
    expect(day.grossProfit).toBe(200_000);
    expect(day.margin).toBeNull();
  });

  it("leaves margin unknown when omzet is zero", () => {
    const [day] = buildDailyPnl([order({ channel: "Dine-in", netSales: 0, hpp: 50_000 })], []);
    expect(day.channels[0].grossProfit).toBe(-50_000);
    expect(day.channels[0].margin).toBeNull();
    expect(day.margin).toBeNull();
  });

  it("sums duplicate payout inputs for the same day and channel", () => {
    const [day] = buildDailyPnl(
      [order()],
      [
        { date: "2026-09-26", channel: "ShopeeFood", amount: 300_000 },
        { date: "2026-09-26", channel: "ShopeeFood", amount: 212_509 },
      ],
    );
    expect(day.channels[0].payout).toBe(512_509);
  });

  it("merges duplicate order aggregates instead of overwriting them", () => {
    const [day] = buildDailyPnl(
      [order({ orderCount: 2, netSales: 100 }), order({ orderCount: 3, netSales: 200 })],
      [],
    );
    expect(day.channels[0].orderCount).toBe(5);
    expect(day.channels[0].netSales).toBe(300);
  });

  it("orders days ascending and channels by the POS enum order", () => {
    const days = buildDailyPnl(
      [
        order({ date: "2026-09-27", channel: "Dine-in" }),
        order({ date: "2026-09-26", channel: "ShopeeFood" }),
        order({ date: "2026-09-26", channel: "Gofood" }),
        order({ date: "2026-09-26", channel: "Perlengkapan" }),
      ],
      [],
    );
    expect(days.map((d) => d.date)).toEqual(["2026-09-26", "2026-09-27"]);
    expect(days[0].channels.map((c) => c.channel)).toEqual([
      "Gofood",
      "ShopeeFood",
      "Perlengkapan",
    ]);
  });

  it("returns no rows for empty input", () => {
    expect(buildDailyPnl([], [])).toEqual([]);
  });
});

describe("summarizePnl", () => {
  it("rolls up days with a weighted margin, not an average of margins", () => {
    const days = buildDailyPnl(
      [
        order({ date: "2026-09-26", channel: "ShopeeFood", netSales: 1_000, hpp: 100 }),
        order({ date: "2026-09-27", channel: "Gofood", netSales: 3_000, hpp: 2_100 }),
      ],
      [{ date: "2026-09-27", channel: "Gofood", amount: 900 }],
      [{ date: "2026-09-27", amount: -50 }],
    );
    const totals = summarizePnl(days);
    expect(totals.omzet).toBe(1_000 + 850);
    expect(totals.hpp).toBe(2_200);
    expect(totals.grossProfit).toBe(1_850 - 2_200);
    expect(totals.margin).toBeCloseTo((1_850 - 2_200) / 1_850, 10);
    expect(totals.adjustment).toBe(-50);
    expect(totals.orderCount).toBe(20);
  });

  it("has no margin for a payout-only period", () => {
    const days = buildDailyPnl([], [{ date: "2026-06-01", channel: "ShopeeFood", amount: 5_000 }]);
    const totals = summarizePnl(days);
    expect(totals.omzet).toBe(5_000);
    expect(totals.orderCount).toBe(0);
    expect(totals.margin).toBeNull();
  });

  it("has no margin when there is no omzet", () => {
    expect(summarizePnl([])).toEqual({
      orderCount: 0,
      grossSales: 0,
      posNet: 0,
      payout: 0,
      adjustment: 0,
      hpp: 0,
      omzet: 0,
      grossProfit: 0,
      margin: null,
    });
  });
});
