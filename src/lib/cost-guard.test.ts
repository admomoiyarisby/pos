import { describe, expect, it } from "vitest";
import {
  assessCostChange,
  COST_EXTREME_RATIO,
  COST_SILENT_RATIO,
  costPerPurchaseUnit,
  needsCostConfirmation,
  resolveQuotedCost,
} from "./cost-guard";

describe("assessCostChange — bands", () => {
  it("treats a small move in either direction as a normal price change", () => {
    expect(assessCostChange(1_000, 1_200).verdict).toBe("silent");
    expect(assessCostChange(1_000, 800).verdict).toBe("silent");
  });

  it("includes the silent boundary itself", () => {
    expect(assessCostChange(1_000, 1_000 * COST_SILENT_RATIO).verdict).toBe("silent");
    expect(assessCostChange(1_000, 1_000 / COST_SILENT_RATIO).verdict).toBe("silent");
  });

  it("asks between the two bands, in either direction", () => {
    expect(assessCostChange(1_000, 6_000).verdict).toBe("confirm");
    expect(assessCostChange(1_000, 1_000 * COST_EXTREME_RATIO).verdict).toBe("confirm");
    expect(assessCostChange(6_000, 1_000).verdict).toBe("confirm");
  });

  it("calls anything past the extreme band extreme", () => {
    expect(assessCostChange(1_000, 1_000 * COST_EXTREME_RATIO + 1).verdict).toBe("extreme");
    expect(assessCostChange(60_000, 1_000).verdict).toBe("extreme");
  });

  it("reports the ratio both ways, always positive", () => {
    expect(assessCostChange(1_000, 6_000).ratio).toBe(6);
    expect(assessCostChange(6_000, 1_000).ratio).toBeCloseTo(1 / 6);
  });
});

describe("assessCostChange — the two cases a ratio cannot describe", () => {
  it("does not flag first costing: every ingredient starts at 0", () => {
    // 0 -> price is how an ingredient gets its first cost. A guard that fires
    // here would fire on every new row, and be clicked through.
    expect(assessCostChange(0, 50_000)).toEqual({ verdict: "silent", ratio: null, delta: 50_000 });
  });

  it("calls a drop to free extreme, because it frees every menu it is in", () => {
    expect(assessCostChange(369, 0)).toMatchObject({ verdict: "extreme", ratio: 0, delta: -369 });
  });

  it("leaves an unchanged cost alone", () => {
    expect(assessCostChange(1_000, 1_000)).toEqual({ verdict: "unchanged", ratio: 1, delta: 0 });
    expect(assessCostChange(0, 0)).toEqual({ verdict: "unchanged", ratio: null, delta: 0 });
  });

  it("reports the rupiah delta per stock unit", () => {
    expect(assessCostChange(1, 369).delta).toBe(368);
  });
});

describe("needsCostConfirmation", () => {
  it("only for the two upper bands", () => {
    expect(needsCostConfirmation("unchanged")).toBe(false);
    expect(needsCostConfirmation("silent")).toBe(false);
    expect(needsCostConfirmation("confirm")).toBe(true);
    expect(needsCostConfirmation("extreme")).toBe(true);
  });
});

describe("costPerPurchaseUnit", () => {
  it("multiplies back up so the typed number can be read as a pack price", () => {
    // Rp 369/ml for water in a 600 ml bottle is Rp 221.400 a bottle.
    expect(costPerPurchaseUnit(369, 600)).toBe(221_400);
  });

  it("is the same number when the units match", () => {
    expect(costPerPurchaseUnit(1_000, 1)).toBe(1_000);
  });

  it("treats a non-positive factor as 1 rather than zeroing the price", () => {
    expect(costPerPurchaseUnit(1_000, 0)).toBe(1_000);
  });
});

describe("resolveQuotedCost — a price quoted in the wrong unit", () => {
  const water = { stockUnit: "ml", purchaseUnit: "botol", conversionFactor: 600 };

  it("takes a price already quoted per stock unit as-is", () => {
    expect(resolveQuotedCost(1, "ml", water)).toEqual({
      ok: true,
      costPerStockUnit: 1,
      convertedFrom: null,
    });
  });

  it("divides a price quoted per purchase unit by the conversion factor", () => {
    // Rp 600 per bottle is Rp 1/ml, not Rp 600/ml.
    expect(resolveQuotedCost(600, "botol", water)).toEqual({
      ok: true,
      costPerStockUnit: 1,
      convertedFrom: "botol",
    });
  });

  it("refuses a unit that matches neither side instead of guessing", () => {
    expect(resolveQuotedCost(9_000, "pack", water)).toEqual({ ok: false });
  });

  it("ignores case and surrounding spaces", () => {
    expect(resolveQuotedCost(1, " ML ", water)).toEqual({
      ok: true,
      costPerStockUnit: 1,
      convertedFrom: null,
    });
  });

  it("keeps the quoted number when the source carries no unit", () => {
    expect(resolveQuotedCost(49, "", water)).toEqual({
      ok: true,
      costPerStockUnit: 49,
      convertedFrom: null,
    });
  });

  it("does not divide by a nonsense conversion factor", () => {
    expect(resolveQuotedCost(600, "botol", { ...water, conversionFactor: 0 })).toEqual({
      ok: true,
      costPerStockUnit: 600,
      convertedFrom: "botol",
    });
  });
});
