import { describe, expect, it } from "vite-plus/test";
import {
  DUPLICATE_ORDER_WINDOW_MINUTES,
  findDuplicateOrderMatches,
  hasBlockingDuplicate,
  normalizeOrderCode,
  orderIdentityKey,
  type DuplicateOrderCandidate,
  type DuplicateOrderIdentity,
} from "#/lib/duplicate-order";

const NOW = new Date("2026-11-18T09:00:00.000Z");

const baseOrder: DuplicateOrderIdentity = {
  channel: "ShopeeFood",
  orderCode: "210",
  customerName: null,
  totalAmount: 60000,
  lines: [
    {
      recipeId: "recipe-nasi",
      recipeName: "Nasi Goreng",
      quantity: 2,
      price: 25000,
      modifierIds: ["mod-a", "mod-b"],
      notes: null,
    },
    {
      recipeId: "recipe-teh",
      recipeName: "Es Teh",
      quantity: 1,
      price: 10000,
      modifierIds: [],
      notes: null,
    },
  ],
};

function candidate(overrides: Partial<DuplicateOrderCandidate> = {}): DuplicateOrderCandidate {
  return {
    ...baseOrder,
    id: "order-1",
    status: "New",
    createdAt: new Date(NOW.getTime() - 60 * 1000),
    ...overrides,
  };
}

describe("duplicate order matching", () => {
  it("normalizes spacing and casing on Kode Order", () => {
    expect(normalizeOrderCode("  210 ")).toBe("210");
    expect(normalizeOrderCode("AbC123")).toBe("abc123");
    expect(normalizeOrderCode("   ")).toBeNull();
    expect(normalizeOrderCode(null)).toBeNull();
  });

  it("treats the same Kode Order as a blocking duplicate regardless of cart or age", () => {
    const matches = findDuplicateOrderMatches(
      baseOrder,
      [
        candidate({
          id: "older",
          orderCode: " 210 ",
          totalAmount: 15000,
          lines: [],
          createdAt: new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000),
        }),
      ],
      NOW,
    );

    expect(matches).toHaveLength(1);
    expect(matches[0].reason).toBe("same-code");
    expect(matches[0].order.id).toBe("older");
    expect(hasBlockingDuplicate(matches)).toBe(true);
  });

  it("warns on an identical recent order with no code", () => {
    const matches = findDuplicateOrderMatches(
      { ...baseOrder, orderCode: "" },
      [candidate({ id: "typo", orderCode: null })],
      NOW,
    );

    expect(matches).toHaveLength(1);
    expect(matches[0].reason).toBe("same-identity");
    expect(hasBlockingDuplicate(matches)).toBe(false);
  });

  it("identifies a re-typed delivery order that lost its code", () => {
    // Existing order has the platform code; the cashier retyped without it.
    const matches = findDuplicateOrderMatches(
      { ...baseOrder, orderCode: "" },
      [candidate({ id: "coded", orderCode: "210" })],
      NOW,
    );

    expect(matches.map((m) => m.order.id)).toEqual(["coded"]);
    expect(matches[0].reason).toBe("same-identity");
  });

  it("does not warn when the two platform codes differ", () => {
    const matches = findDuplicateOrderMatches(
      baseOrder,
      [candidate({ id: "other", orderCode: "211" })],
      NOW,
    );

    expect(matches).toEqual([]);
  });

  it("ignores orders outside the recent window", () => {
    const tooOld = new Date(NOW.getTime() - (DUPLICATE_ORDER_WINDOW_MINUTES + 1) * 60 * 1000);
    const matches = findDuplicateOrderMatches(
      { ...baseOrder, orderCode: "" },
      [candidate({ id: "old", orderCode: null, createdAt: tooOld })],
      NOW,
    );

    expect(matches).toEqual([]);
  });

  it("keeps genuine separate orders apart by total, name, and lines", () => {
    const noCode = { ...baseOrder, orderCode: "" };
    const candidates = [
      candidate({ id: "total", totalAmount: 60001 }),
      candidate({ id: "name", customerName: "Siti" }),
      candidate({
        id: "qty",
        lines: [{ ...baseOrder.lines[0], quantity: 3 }, baseOrder.lines[1]],
      }),
      candidate({
        id: "modifier",
        lines: [{ ...baseOrder.lines[0], modifierIds: ["mod-a"] }, baseOrder.lines[1]],
      }),
      candidate({ id: "channel", channel: "Grabfood" }),
    ];

    expect(findDuplicateOrderMatches(noCode, candidates, NOW)).toEqual([]);
  });

  it("treats identical orders with the same code as one match, not two", () => {
    const matches = findDuplicateOrderMatches(baseOrder, [candidate()], NOW);

    expect(matches).toHaveLength(1);
    expect(matches[0].reason).toBe("same-code");
  });

  it("never flags a voided order", () => {
    const matches = findDuplicateOrderMatches(
      { ...baseOrder, orderCode: "" },
      [candidate({ status: "Void" })],
      NOW,
    );

    expect(matches).toEqual([]);
  });

  it("makes the identity key independent of line order and modifier order", () => {
    const reordered: DuplicateOrderIdentity = {
      ...baseOrder,
      lines: [baseOrder.lines[1], { ...baseOrder.lines[0], modifierIds: ["mod-b", "mod-a"] }],
    };

    expect(orderIdentityKey(reordered)).toBe(orderIdentityKey(baseOrder));
  });
});
