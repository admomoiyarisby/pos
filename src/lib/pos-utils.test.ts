import { describe, expect, it } from "vite-plus/test";
import { calculateCartCount, calculateCartTotal, getStockQuantity } from "#/lib/pos-utils";
import type { CartItem, MenuItem } from "#/lib/pos-types";

const baseItem: MenuItem = {
  id: "recipe-1",
  code: "REC-1",
  name: "Nasi",
  imageUrl: null,
  categoryName: "Makanan",
  categoryId: "cat-1",
  basePrice: 10000,
  isBOGO: false,
  isStaffMeal: false,
  isBundle: false,
  brands: [],
  modifierGroups: [],
  ingredientIds: [{ ingredientId: "ing-rice", quantity: 2 }],
};

const cartItem = (quantity: number, price = 10000): CartItem => ({
  recipeId: "recipe-1",
  name: "Nasi",
  price,
  quantity,
  modifiers: [],
  notes: "",
});

describe("getStockQuantity", () => {
  it("returns the limiting ingredient quantity", () => {
    expect(
      getStockQuantity(baseItem, [
        { ingredientId: "ing-rice", quantity: 7 },
        { ingredientId: "ing-salt", quantity: 100 },
      ]),
    ).toBe(3);
  });

  it("returns zero when a required ingredient is missing", () => {
    expect(getStockQuantity(baseItem, [])).toBe(0);
  });

  it("floors fractional servings", () => {
    expect(getStockQuantity(baseItem, [{ ingredientId: "ing-rice", quantity: 5 }])).toBe(2);
  });

  it("returns the unlimited sentinel for recipes without ingredients", () => {
    expect(getStockQuantity({ ...baseItem, ingredientIds: [] }, [])).toBe(999);
    expect(getStockQuantity(baseItem, undefined)).toBe(999);
  });

  it("uses the smallest serving count for multi-ingredient recipes", () => {
    const item = {
      ...baseItem,
      ingredientIds: [
        { ingredientId: "ing-rice", quantity: 2 },
        { ingredientId: "ing-chicken", quantity: 3 },
      ],
    };
    expect(
      getStockQuantity(item, [
        { ingredientId: "ing-rice", quantity: 100 },
        { ingredientId: "ing-chicken", quantity: 7 },
      ]),
    ).toBe(2);
  });
});

describe("cart calculations", () => {
  it("calculates the cart total from line prices and quantities", () => {
    expect(calculateCartTotal([cartItem(2), cartItem(1, 5000)])).toBe(25000);
  });

  it("calculates the total item count", () => {
    expect(calculateCartCount([cartItem(2), cartItem(3)])).toBe(5);
  });

  it("returns zero for an empty cart", () => {
    expect(calculateCartTotal([])).toBe(0);
    expect(calculateCartCount([])).toBe(0);
  });
});
