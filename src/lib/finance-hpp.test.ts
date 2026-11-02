import { describe, expect, it } from "vitest";
import { allocateHppShares, type HppItemInput } from "./finance-hpp";

const item = (
  ingredients: HppItemInput["ingredients"],
  cogsAtTransaction: number,
  quantity = 1,
): HppItemInput => ({ ingredients, cogsAtTransaction, quantity });

const ing = (ingredientId: string, cost: number) => ({
  ingredientId,
  ingredientName: ingredientId,
  cost,
});

const total = (rows: { cost: number }[]) => rows.reduce((s, r) => s + r.cost, 0);

describe("allocateHppShares", () => {
  it("scales each line to its own frozen COGS", () => {
    // Current prices doubled since the sale, so both lines halve.
    const { rows, allocated } = allocateHppShares([item([ing("rice", 600), ing("egg", 400)], 500)]);
    expect(allocated).toBe(500);
    expect(rows.find((r) => r.ingredientId === "rice")?.cost).toBe(300);
    expect(rows.find((r) => r.ingredientId === "egg")?.cost).toBe(200);
    expect(total(rows)).toBe(500);
  });

  it("keeps lines with different modifiers independent", () => {
    // Same base recipe, different add-on. A single day-wide scale would apply
    // the same drift factor to both lines; per-line scaling must not.
    const plain = item([ing("rice", 1000), ing("egg", 1000)], 1500); // drifted 2x? no: target < pool
    const withCheese = item([ing("rice", 1000), ing("egg", 1000), ing("cheese", 2000)], 2000);

    const { rows, allocated } = allocateHppShares([plain, withCheese]);

    expect(allocated).toBe(3500);
    expect(total(rows)).toBe(3500);
    // plain: 1000/2000 of 1500 = 750; withCheese: 1000/4000 of 2000 = 500
    expect(rows.find((r) => r.ingredientId === "rice")?.cost).toBe(1250);
    // plain: 1000/2000 of 1500 = 750; withCheese: 1000/4000 of 2000 = 500
    expect(rows.find((r) => r.ingredientId === "egg")?.cost).toBe(1250);
    // withCheese: 2000/4000 of 2000 = 1000
    expect(rows.find((r) => r.ingredientId === "cheese")?.cost).toBe(1000);
  });

  it("sums to the rounded target total after largest-remainder rounding", () => {
    const { rows, allocated } = allocateHppShares([
      item([ing("a", 1), ing("b", 1), ing("c", 1)], 100),
    ]);
    expect(allocated).toBe(100);
    expect(total(rows)).toBe(100);
    // 100/3 each -> 33.33; leftover 1 goes to one row, never negative.
    expect(rows.every((r) => r.cost >= 0)).toBe(true);
    expect(rows.map((r) => r.cost).sort((x, y) => y - x)).toEqual([34, 33, 33]);
  });

  it("never produces negative rows when a scale deflates many tiny shares", () => {
    const ingredients = Array.from({ length: 100 }, (_, i) => ing(`i${i}`, 1));
    // Target far below the pool (e.g. totalCogs edited down): 0.01 per share.
    const { rows, allocated } = allocateHppShares([item(ingredients, 1)]);
    expect(allocated).toBe(1);
    expect(rows.every((r) => r.cost >= 0)).toBe(true);
    expect(total(rows)).toBe(1);
  });

  it("leaves lines without a usable pool unallocated", () => {
    const { rows, allocated } = allocateHppShares([
      item([ing("rice", 0)], 500), // zero cost -> no share
      item([], 300), // no composition at all
      item([ing("egg", 100)], 0), // zero target
    ]);
    expect(rows).toEqual([]);
    expect(allocated).toBe(0);
  });

  it("ignores zero-cost ingredients inside an otherwise usable line", () => {
    const { rows, allocated } = allocateHppShares([item([ing("rice", 500), ing("free", 0)], 500)]);
    expect(allocated).toBe(500);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ingredientId: "rice", cost: 500 });
  });

  it("multiplies the per-unit COGS by the ordered quantity", () => {
    const { allocated } = allocateHppShares([item([ing("rice", 1200)], 600, 2)]);
    expect(allocated).toBe(1200);
  });

  it("is empty when there is nothing to allocate", () => {
    expect(allocateHppShares([])).toEqual({ rows: [], allocated: 0 });
  });
});
