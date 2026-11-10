import { describe, expect, it } from "vite-plus/test";
import {
  formatDaysCover,
  formatRecommendationQuantity,
  roundRecommendation,
  stockRecommendationFor,
  stockStatusFor,
} from "#/lib/stock-recommendation";

describe("stockRecommendationFor", () => {
  it("uses 3 days of usage × 5 days of lead time as the reference", () => {
    const rec = stockRecommendationFor(10, 9);
    expect(rec.usage3d).toBe(9);
    expect(rec.avgDailyUsage).toBe(3);
    expect(rec.targetStock).toBe(15);
    expect(rec.status).toBe("low");
    expect(rec.recommendedOrder).toBe(5);
  });

  it("recommends nothing once stock is at or above the reference", () => {
    const atTarget = stockRecommendationFor(15, 9);
    expect(atTarget.daysCover).toBe(5);
    expect(atTarget.status).toBe("watch");
    expect(atTarget.recommendedOrder).toBe(0);

    const above = stockRecommendationFor(30, 9);
    expect(above.recommendedOrder).toBe(0);
    expect(above.status).toBe("ok");
  });

  it("counts a negative balance as a shortfall on top of the reference", () => {
    const rec = stockRecommendationFor(-2, 9);
    expect(rec.status).toBe("low");
    expect(rec.recommendedOrder).toBe(17);
  });

  it("has no recommendation when the window had no usage", () => {
    const rec = stockRecommendationFor(10, 0);
    expect(rec.daysCover).toBeNull();
    expect(rec.status).toBe("no-data");
    expect(rec.recommendedOrder).toBe(0);
    expect(rec.targetStock).toBe(0);
  });

  it("rounds the recommendation to the quantity display precision", () => {
    // avg 1/3 → target 5/3; stock 1 → shortfall 2/3 → 0,667 at 3 decimals.
    const rec = stockRecommendationFor(1, 1);
    expect(rec.recommendedOrder).toBe(0.667);
  });
});

describe("recommendation display precision", () => {
  it("shows one decimal, not three", () => {
    // The client's complaint: "isi rekomendasi: +10,667 pcs" — the third
    // decimal is noise for a stock unit counted in whole pcs.
    expect(formatRecommendationQuantity(10.667)).toBe("10,7");
    expect(formatRecommendationQuantity(11.667)).toBe("11,7");
    expect(formatRecommendationQuantity(4)).toBe("4");
  });

  it("fills the quantity with the number the button promised", () => {
    // Whatever label the buyer clicked, the input must hold that value — a
    // +10,7 button that fills 10,667 is the same bug in another place.
    expect(roundRecommendation(10.667)).toBe(10.7);
    expect(roundRecommendation(10)).toBe(10);
  });

  it("leaves the raw recommendation untouched", () => {
    const rec = stockRecommendationFor(1, 1);
    expect(rec.recommendedOrder).toBe(0.667);
    expect(roundRecommendation(rec.recommendedOrder)).toBe(0.7);
  });
});

describe("stockStatusFor", () => {
  it("treats the 5–7 day band as watch, below as low, above as ok", () => {
    expect(stockStatusFor(2, 4.99)).toBe("low");
    expect(stockStatusFor(2, 5)).toBe("watch");
    expect(stockStatusFor(2, 7)).toBe("watch");
    expect(stockStatusFor(2, 7.01)).toBe("ok");
  });

  it("is no-data whenever usage is unknown", () => {
    expect(stockStatusFor(0, null)).toBe("no-data");
    expect(stockStatusFor(0, 3)).toBe("no-data");
  });
});

describe("formatDaysCover", () => {
  it("renders id-ID days and a dash for unknown cover", () => {
    expect(formatDaysCover(3.333)).toBe("3,333 hari");
    expect(formatDaysCover(0)).toBe("0 hari");
    expect(formatDaysCover(null)).toBe("—");
  });
});
