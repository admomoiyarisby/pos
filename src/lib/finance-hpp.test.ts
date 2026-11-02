import { describe, expect, it } from "vitest";
import { allocateHpp, type HppItemInput, type HppOrderInput } from "./finance-hpp";

const ing = (ingredientId: string, cost: number) => ({
  ingredientId,
  ingredientName: ingredientId,
  cost,
});

/** Legacy line: costs re-priced at today's average cost. */
const current = (
  ingredients: HppItemInput["ingredients"],
  cogsAtTransaction: number,
  quantity = 1,
): HppItemInput => ({ ingredients, cogsAtTransaction, quantity, costSource: "current" });

/** ADR 0031 line: costs are already the sale-time values. */
const frozen = (
  ingredients: HppItemInput["ingredients"],
  cogsAtTransaction: number,
  quantity = 1,
): HppItemInput => ({ ingredients, cogsAtTransaction, quantity, costSource: "frozen" });

const order = (totalCogs: number, items: HppItemInput[]): HppOrderInput => ({ totalCogs, items });

const sum = (rows: { cost: number }[]) => rows.reduce((s, r) => s + r.cost, 0);

describe("allocateHpp", () => {
  it("uses frozen sale-time costs verbatim", () => {
    // Average cost has since doubled, but the snapshot says what was paid.
    const { rows, allocated, unallocated } = allocateHpp(
      [order(500, [frozen([ing("rice", 300), ing("egg", 200)], 500)])],
      500,
    );

    expect(allocated).toBe(500);
    expect(unallocated).toBe(0);
    expect(rows.find((r) => r.ingredientId === "rice")?.cost).toBe(300);
    expect(rows.find((r) => r.ingredientId === "egg")?.cost).toBe(200);
  });

  it("rescales legacy lines to their own frozen COGS", () => {
    // Current prices doubled since the sale, so the legacy line halves.
    const { rows, allocated } = allocateHpp(
      [order(500, [current([ing("rice", 600), ing("egg", 400)], 500)])],
      500,
    );

    expect(allocated).toBe(500);
    expect(rows.find((r) => r.ingredientId === "rice")?.cost).toBe(300);
    expect(rows.find((r) => r.ingredientId === "egg")?.cost).toBe(200);
  });

  it("keeps lines of the same recipe with different modifiers independent", () => {
    // A single day-wide scale would apply one drift factor to both lines.
    const plain = current([ing("rice", 1000), ing("egg", 1000)], 1500);
    const withCheese = current([ing("rice", 1000), ing("egg", 1000), ing("cheese", 2000)], 2000);

    const { rows, allocated } = allocateHpp([order(3500, [plain, withCheese])], 3500);

    expect(allocated).toBe(3500);
    // rice: 1000/2000 × 1500 + 1000/4000 × 2000 = 750 + 500
    expect(rows.find((r) => r.ingredientId === "rice")?.cost).toBe(1250);
    expect(rows.find((r) => r.ingredientId === "egg")?.cost).toBe(1250);
    // cheese: 2000/4000 × 2000 = 1000
    expect(rows.find((r) => r.ingredientId === "cheese")?.cost).toBe(1000);
  });

  it("absorbs per-order rounding into that order instead of unallocated", () => {
    // POS stores cogsAtTransaction per unit, rounded: 1001 / 3 -> 334.
    // target = 334 × 3 = 1002, order total = 1001. The 1-rupiah gap belongs
    // to this order, not to "unallocated".
    const { allocated, unallocated } = allocateHpp(
      [order(1001, [frozen([ing("a", 400), ing("b", 300), ing("c", 301)], 334, 3)])],
      1001,
    );

    expect(allocated).toBe(1001);
    expect(unallocated).toBe(0);
  });

  it("leaves orders with no items unallocated", () => {
    const { rows, allocated, unallocated } = allocateHpp(
      [
        order(500, [frozen([ing("rice", 500)], 500)]),
        order(300, []), // manual "Data Penjualan" entry
      ],
      800,
    );

    expect(allocated).toBe(500);
    expect(unallocated).toBe(300);
    expect(rows).toHaveLength(1);
    expect(sum(rows)).toBe(500);
  });

  it("nets signed exclusion costs instead of clamping them", () => {
    // Rice is largely excluded: +1000 from the BOM, -800 restored. Net 200.
    // Clamping the negative would leave 1000 and inflate rice's share.
    const { rows, allocated } = allocateHpp(
      [order(1200, [frozen([ing("rice", 1000), ing("rice", -800), ing("egg", 1000)], 1200)])],
      1200,
    );

    expect(allocated).toBe(1200);
    expect(rows.find((r) => r.ingredientId === "rice")?.cost).toBe(200);
    expect(rows.find((r) => r.ingredientId === "egg")?.cost).toBe(1000);
  });

  it("rounds with largest remainder", () => {
    const { rows, allocated } = allocateHpp(
      [order(100, [frozen([ing("a", 34), ing("b", 33), ing("c", 33)], 100)])],
      100,
    );

    expect(allocated).toBe(100);
    expect(sum(rows)).toBe(100);
    expect(rows.every((r) => r.cost >= 0)).toBe(true);
  });

  it("never produces negative rows when a scale deflates many tiny shares", () => {
    const ingredients = Array.from({ length: 100 }, (_, i) => ing(`i${i}`, 1));
    const { rows, allocated } = allocateHpp([order(1, [current(ingredients, 1)])], 1);

    expect(allocated).toBe(1);
    expect(rows.every((r) => r.cost >= 0)).toBe(true);
    expect(sum(rows)).toBe(1);
  });

  it("keeps rows + unallocated equal to the day total", () => {
    const { rows, unallocated } = allocateHpp(
      [order(1001, [frozen([ing("a", 400), ing("b", 601)], 334, 3)]), order(2500, [])],
      3501,
    );

    expect(sum(rows) + unallocated).toBe(3501);
  });

  it("treats orders with no usable cost as unallocated", () => {
    const { rows, allocated, unallocated } = allocateHpp(
      [order(500, [frozen([ing("rice", 0)], 500)]), order(300, [current([], 300)])],
      800,
    );

    expect(rows).toEqual([]);
    expect(allocated).toBe(0);
    expect(unallocated).toBe(800);
  });

  it("is empty when there is nothing to allocate", () => {
    expect(allocateHpp([], 0)).toEqual({ rows: [], allocated: 0, unallocated: 0 });
  });
});
