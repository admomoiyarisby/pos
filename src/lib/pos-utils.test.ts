import { describe, expect, it } from "vite-plus/test";
import {
  appliedModifierLines,
  appliedModifiersSummary,
  calculateCartCount,
  calculateCartTotal,
  getStockQuantity,
  resolveAppliedVoucher,
} from "#/lib/pos-utils";
import type { AppliedModifier } from "#/lib/pos-utils";
import type { CartItem, MenuItem, Voucher } from "#/lib/pos-types";

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

describe("resolveAppliedVoucher", () => {
  const voucher = (over: Partial<Voucher> = {}): Voucher => ({
    id: "v1",
    code: "PROMO10",
    description: "Diskon 10%",
    discountType: "percentage",
    discountValue: 10,
    minOrder: 50000,
    validUntil: new Date("2030-01-01"),
    status: "Active",
    ...over,
  });

  it("returns null when no voucher is selected", () => {
    expect(resolveAppliedVoucher(null, 100000)).toBeNull();
  });

  it("discounts a percentage voucher against the cart total", () => {
    const applied = resolveAppliedVoucher(voucher(), 100000);
    expect(applied?.voucher.code).toBe("PROMO10");
    expect(applied?.discount).toBe(10000);
  });

  it("discounts a fixed voucher by its value", () => {
    const applied = resolveAppliedVoucher(
      voucher({ discountType: "fixed", discountValue: 15000 }),
      100000,
    );
    expect(applied?.discount).toBe(15000);
  });

  it("treats minOrder as inclusive", () => {
    expect(resolveAppliedVoucher(voucher({ minOrder: 50000 }), 50000)?.discount).toBe(5000);
  });

  // The reported bug: a voucher picked while the cart was large enough kept its
  // highlighted pill and still submitted its code after the cart shrank below
  // minOrder, while the discount silently dropped to zero — "I applied the
  // promo and the price stayed the same".
  it("drops the voucher once the cart falls below minOrder", () => {
    expect(resolveAppliedVoucher(voucher({ minOrder: 50000 }), 100000)).not.toBeNull();
    expect(resolveAppliedVoucher(voucher({ minOrder: 50000 }), 49999)).toBeNull();
  });

  it("caps a fixed discount at the cart total so the order total cannot go negative", () => {
    // Server computes totalAmount = subtotal - voucherDiscount + tax with no clamp.
    const applied = resolveAppliedVoucher(
      voucher({ discountType: "fixed", discountValue: 50000, minOrder: 0 }),
      20000,
    );
    expect(applied?.discount).toBe(20000);
  });

  it("never discounts below zero", () => {
    const applied = resolveAppliedVoucher(
      voucher({ discountType: "fixed", discountValue: 0, minOrder: 0 }),
      0,
    );
    expect(applied?.discount).toBe(0);
  });
});

describe("applied modifier formatting", () => {
  const pedas: AppliedModifier = {
    modifierGroupId: "g1",
    modifierGroupName: "Level Pedas",
    modifierId: "m1",
    modifierName: "Pedas",
    isExclusion: false,
  };
  const normal: AppliedModifier = {
    modifierGroupId: "g1",
    modifierGroupName: "Level Pedas",
    modifierId: "m2",
    modifierName: "Normal",
    isExclusion: false,
  };
  const keju: AppliedModifier = {
    modifierGroupId: "g2",
    modifierGroupName: "Topping",
    modifierId: "m3",
    modifierName: "Keju",
    isExclusion: false,
  };

  it("groups options under their modifier group name", () => {
    expect(appliedModifierLines([pedas, keju, normal])).toEqual([
      "Level Pedas: Pedas, Normal",
      "Topping: Keju",
    ]);
  });

  it("preserves the applied order within a group", () => {
    expect(appliedModifierLines([normal, pedas])).toEqual(["Level Pedas: Normal, Pedas"]);
  });

  it("falls back for missing group/option names", () => {
    expect(
      appliedModifierLines([
        { modifierGroupId: "g", modifierGroupName: null, modifierId: "m", modifierName: null },
      ]),
    ).toEqual(["Modifier: Opsi"]);
  });

  it("returns an empty array when no modifiers were applied", () => {
    expect(appliedModifierLines([])).toEqual([]);
  });

  it("joins group lines into a single summary string", () => {
    expect(appliedModifiersSummary([pedas, keju])).toBe("Level Pedas: Pedas · Topping: Keju");
  });
});
