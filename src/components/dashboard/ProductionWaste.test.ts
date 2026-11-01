import { describe, expect, it } from "vite-plus/test";
import {
  computeProductionSummary,
  type ProductionRecord,
} from "#/components/dashboard/ProductionTracking";
import { computeWasteSummary, type WasteEntry } from "#/components/dashboard/WasteBreakdown";

describe("computeProductionSummary", () => {
  it("aggregates Active production per branch and per produced item", () => {
    const records: ProductionRecord[] = [
      {
        id: "a",
        branchId: "b1",
        branchName: "Central Kitchen",
        status: "Active",
        out: [{ ingredientId: "i3", ingredientName: "Beras", stockUnit: "kg", quantity: 8 }],
        produced: [
          { ingredientId: "i1", ingredientName: "Sambal", stockUnit: "kg", quantity: 10 },
          { ingredientId: "i2", ingredientName: "Nasi", stockUnit: "porsi", quantity: 5 },
        ],
      },
      {
        id: "b",
        branchId: "b1",
        branchName: "Central Kitchen",
        status: "Active",
        out: [],
        produced: [{ ingredientId: "i1", ingredientName: "Sambal", stockUnit: "kg", quantity: 5 }],
      },
      {
        id: "c",
        branchId: "b2",
        branchName: "Outlet A",
        status: "Active",
        out: [],
        produced: [{ ingredientId: "i2", ingredientName: "Nasi", stockUnit: "porsi", quantity: 2 }],
      },
      {
        id: "d",
        branchId: "b2",
        branchName: "Outlet A",
        status: "Cancelled",
        out: [],
        produced: [
          { ingredientId: "i9", ingredientName: "Dibatalkan", stockUnit: "kg", quantity: 100 },
        ],
      },
    ];

    const summary = computeProductionSummary(records);

    expect(summary.totalBatches).toBe(3);
    expect(summary.totalProduced).toBe(22);
    expect(summary.totalOut).toBe(8);
    expect(summary.branches).toHaveLength(2);
    expect(summary.branches[0].branchName).toBe("Central Kitchen");
    expect(summary.branches[0].batches).toBe(2);
    expect(summary.branches[0].producedTotal).toBe(20);
    expect(summary.topProduced[0]).toMatchObject({ ingredientId: "i1", quantity: 15 });
    expect(summary.topProduced.find((item) => item.ingredientId === "i2")).toMatchObject({
      quantity: 7,
      branchCount: 2,
    });
    expect(summary.topProduced.some((item) => item.ingredientId === "i9")).toBe(false);
  });

  it("filters by inclusive Jakarta day and branch", () => {
    const records: ProductionRecord[] = [
      {
        id: "in-range",
        branchId: "b1",
        branchName: "Central Kitchen",
        status: "Active",
        productionDate: new Date("2026-10-14T10:00:00.000Z"),
        out: [],
        produced: [{ ingredientId: "i1", ingredientName: "Sambal", stockUnit: "kg", quantity: 5 }],
      },
      {
        id: "other-day",
        branchId: "b1",
        branchName: "Central Kitchen",
        status: "Active",
        productionDate: new Date("2026-10-13T10:00:00.000Z"),
        out: [],
        produced: [{ ingredientId: "i1", ingredientName: "Sambal", stockUnit: "kg", quantity: 9 }],
      },
      {
        id: "other-branch",
        branchId: "b2",
        branchName: "Outlet A",
        status: "Active",
        productionDate: new Date("2026-10-14T10:00:00.000Z"),
        out: [],
        produced: [{ ingredientId: "i2", ingredientName: "Nasi", stockUnit: "porsi", quantity: 7 }],
      },
    ];

    const summary = computeProductionSummary(records, {
      from: "2026-10-14",
      to: "2026-10-14",
      branchId: "b1",
    });

    expect(summary.totalBatches).toBe(1);
    expect(summary.totalProduced).toBe(5);
    expect(summary.branches).toHaveLength(1);
  });
});

describe("computeWasteSummary", () => {
  it("groups active waste by category with item subtotals", () => {
    const entries: WasteEntry[] = [
      {
        id: "w1",
        branchId: "b1",
        ingredientId: "i1",
        ingredientName: "Beras",
        ingredientUnit: "kg",
        recipeId: null,
        recipeName: null,
        quantity: 2,
        category: "Biaya Operasional",
        valuation: 50000,
        status: "Active",
      },
      {
        id: "w2",
        branchId: "b1",
        ingredientId: "i1",
        ingredientName: "Beras",
        ingredientUnit: "kg",
        recipeId: null,
        recipeName: null,
        quantity: 1,
        category: "Biaya Operasional",
        valuation: 25000,
        status: "Active",
      },
      {
        id: "w3",
        branchId: "b1",
        ingredientId: null,
        ingredientName: null,
        ingredientUnit: null,
        recipeId: "r1",
        recipeName: "Nasi Goreng",
        quantity: 3,
        category: "Spoiled",
        valuation: 60000,
        status: "Active",
      },
      {
        id: "w4",
        branchId: "b1",
        ingredientId: "i2",
        ingredientName: "Telur",
        ingredientUnit: "butir",
        recipeId: null,
        recipeName: null,
        quantity: 1,
        category: "Denda",
        valuation: 10000,
        status: "Cancelled",
      },
      {
        id: "w5",
        branchId: "b2",
        ingredientId: "i3",
        ingredientName: "Ayam",
        ingredientUnit: "kg",
        recipeId: null,
        recipeName: null,
        quantity: 1,
        category: "Beban Makan",
        valuation: 20000,
        status: "Active",
      },
    ];

    const summary = computeWasteSummary(entries);
    const operasional = summary.categories.find((category) => category.key === "Biaya Operasional");
    const spoiled = summary.categories.find((category) => category.key === "Spoiled");
    const denda = summary.categories.find((category) => category.key === "Denda");

    expect(summary.total).toBe(155000);
    expect(summary.entries).toBe(4);
    expect(summary.categories).toHaveLength(4);
    expect(operasional).toMatchObject({ label: "Biaya Operasional", total: 75000, entries: 2 });
    expect(operasional?.items).toHaveLength(1);
    expect(operasional?.items[0]).toMatchObject({
      name: "Beras",
      unit: "kg",
      quantity: 3,
      subtotal: 75000,
      entries: 2,
    });
    expect(spoiled?.items[0]).toMatchObject({
      name: "Nasi Goreng",
      unit: "porsi",
      subtotal: 60000,
    });
    expect(denda).toMatchObject({ total: 0, entries: 0 });
    expect(summary.categories.find((category) => category.key === "Beban Makan")).toMatchObject({
      label: "Biaya Makan Staff",
      total: 20000,
    });
  });

  it("filters waste by inclusive Jakarta day and branch", () => {
    const entries: WasteEntry[] = [
      {
        id: "w1",
        branchId: "b1",
        ingredientId: "i1",
        ingredientName: "Beras",
        ingredientUnit: "kg",
        recipeId: null,
        recipeName: null,
        quantity: 1,
        category: "Spoiled",
        valuation: 40000,
        createdAt: new Date("2026-10-14T10:00:00.000Z"),
        status: "Active",
      },
      {
        id: "w2",
        branchId: "b1",
        ingredientId: "i1",
        ingredientName: "Beras",
        ingredientUnit: "kg",
        recipeId: null,
        recipeName: null,
        quantity: 1,
        category: "Spoiled",
        valuation: 90000,
        createdAt: new Date("2026-10-13T10:00:00.000Z"),
        status: "Active",
      },
      {
        id: "w3",
        branchId: "b2",
        ingredientId: "i1",
        ingredientName: "Beras",
        ingredientUnit: "kg",
        recipeId: null,
        recipeName: null,
        quantity: 1,
        category: "Spoiled",
        valuation: 70000,
        createdAt: new Date("2026-10-14T10:00:00.000Z"),
        status: "Active",
      },
    ];

    const summary = computeWasteSummary(entries, {
      from: "2026-10-14",
      to: "2026-10-14",
      branchId: "b1",
    });

    expect(summary.total).toBe(40000);
    expect(summary.entries).toBe(1);
    expect(summary.categories.find((category) => category.key === "Spoiled")?.total).toBe(40000);
  });
});
