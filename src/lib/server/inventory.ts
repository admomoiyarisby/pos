import { createServerFn } from "@tanstack/react-start";
import { db } from "#/db/index";
import {
  inventory,
  stockLedger,
  ingredients,
  branches,
  stockOpnames,
  stockOpnameItems,
} from "#/db/schema";
import { eq, and, ilike, desc } from "drizzle-orm";
import { requireAuth, requireRole } from "./auth";

export const getInventory = createServerFn({ method: "GET" })
  .inputValidator(
    (data: {
      branchId?: string;
      search?: string;
      category?: "Fresh" | "Dry" | "Packaging" | null;
      skuType?: "RM" | "SFG" | "FG" | null;
    }) => data,
  )
  .handler(async ({ data }) => {
    const user = await requireAuth();

    let branchFilter = data.branchId;
    if (user.role === "branch_admin" && user.branchId) {
      branchFilter = user.branchId;
    } else if (user.role === "admin_pusat") {
      // Admin pusat sees central warehouse or all depending on preference
      // Default to no filter (all) for now
    }

    const result = await db
      .select({
        id: inventory.id,
        branchId: inventory.branchId,
        ingredientId: inventory.ingredientId,
        quantity: inventory.quantity,
        lastUpdated: inventory.lastUpdated,
        ingredientName: ingredients.name,
        ingredientCode: ingredients.code,
        ingredientCategory: ingredients.category,
        ingredientSkuType: ingredients.skuType,
        purchaseUnit: ingredients.purchaseUnit,
        stockUnit: ingredients.stockUnit,
        branchName: branches.name,
      })
      .from(inventory)
      .leftJoin(ingredients, eq(inventory.ingredientId, ingredients.id))
      .leftJoin(branches, eq(inventory.branchId, branches.id))
      .where(
        and(
          branchFilter ? eq(inventory.branchId, branchFilter) : undefined,
          data.search ? ilike(ingredients.name, `%${data.search}%`) : undefined,
          data.category ? eq(ingredients.category, data.category) : undefined,
          data.skuType ? eq(ingredients.skuType, data.skuType) : undefined,
        ),
      )
      .orderBy(ingredients.name);

    return result;
  });

export const getStockLedger = createServerFn({ method: "GET" })
  .inputValidator(
    (data: {
      branchId?: string;
      ingredientId?: string;
      dateFrom?: string;
      dateTo?: string;
      page?: number;
      limit?: number;
    }) => data,
  )
  .handler(async ({ data }) => {
    await requireAuth();

    const result = await db
      .select({
        id: stockLedger.id,
        branchId: stockLedger.branchId,
        ingredientId: stockLedger.ingredientId,
        type: stockLedger.type,
        quantity: stockLedger.quantity,
        balance: stockLedger.balance,
        reference: stockLedger.reference,
        notes: stockLedger.notes,
        createdAt: stockLedger.createdAt,
        ingredientName: ingredients.name,
        branchName: branches.name,
      })
      .from(stockLedger)
      .leftJoin(ingredients, eq(stockLedger.ingredientId, ingredients.id))
      .leftJoin(branches, eq(stockLedger.branchId, branches.id))
      .where(
        and(
          data.branchId ? eq(stockLedger.branchId, data.branchId) : undefined,
          data.ingredientId ? eq(stockLedger.ingredientId, data.ingredientId) : undefined,
        ),
      )
      .orderBy(desc(stockLedger.createdAt))
      .limit(data.limit ?? 50)
      .offset((data.page ?? 0) * (data.limit ?? 50));

    return result;
  });

export const triggerStockOpname = createServerFn({ method: "POST" })
  .inputValidator((data: { branchId: string; date: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuth();
    await requireRole("super_admin", "admin_pusat", "area_manager");

    // Get current inventory for the branch
    const invItems = await db
      .select({
        ingredientId: inventory.ingredientId,
        quantity: inventory.quantity,
      })
      .from(inventory)
      .where(eq(inventory.branchId, data.branchId));

    // Create stock opname
    const [so] = await db
      .insert(stockOpnames)
      .values({
        branchId: data.branchId,
        date: data.date,
        triggeredBy: user.id,
        submittedBy: user.id,
      })
      .returning();

    // Create SO items with system stock
    for (const item of invItems) {
      await db.insert(stockOpnameItems).values({
        stockOpnameId: so.id,
        ingredientId: item.ingredientId,
        systemStock: item.quantity,
        physicalStock: 0,
        variance: 0,
      });
    }

    return so;
  });

export const getStockOpnames = createServerFn({ method: "GET" })
  .inputValidator((data: { branchId?: string }) => data)
  .handler(async ({ data }) => {
    await requireAuth();

    const result = await db
      .select({
        id: stockOpnames.id,
        branchId: stockOpnames.branchId,
        date: stockOpnames.date,
        status: stockOpnames.status,
        triggeredBy: stockOpnames.triggeredBy,
        submittedBy: stockOpnames.submittedBy,
        approvedBy: stockOpnames.approvedBy,
        createdAt: stockOpnames.createdAt,
        branchName: branches.name,
      })
      .from(stockOpnames)
      .leftJoin(branches, eq(stockOpnames.branchId, branches.id))
      .where(data.branchId ? eq(stockOpnames.branchId, data.branchId) : undefined)
      .orderBy(desc(stockOpnames.createdAt));

    return result;
  });

export const getStockOpnameDetail = createServerFn({ method: "GET" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuth();

    const [so] = await db.select().from(stockOpnames).where(eq(stockOpnames.id, data.id)).limit(1);

    if (!so) return null;

    const items = await db
      .select({
        id: stockOpnameItems.id,
        ingredientId: stockOpnameItems.ingredientId,
        systemStock: stockOpnameItems.systemStock,
        physicalStock: stockOpnameItems.physicalStock,
        variance: stockOpnameItems.variance,
        variancePercentage: stockOpnameItems.variancePercentage,
        investigationNote: stockOpnameItems.investigationNote,
        ingredientName: ingredients.name,
        ingredientCode: ingredients.code,
        ingredientCategory: ingredients.category,
      })
      .from(stockOpnameItems)
      .leftJoin(ingredients, eq(stockOpnameItems.ingredientId, ingredients.id))
      .where(eq(stockOpnameItems.stockOpnameId, data.id));

    // For blind roles, strip system stock
    const isBlind =
      user.role === "branch_admin" ||
      (user.role === "admin_pusat" && so.branchId !== user.branchId);

    return {
      ...so,
      items: isBlind
        ? items.map((i) => ({
            ...i,
            systemStock: 0 as number,
            variance: 0 as number,
          }))
        : items,
      isBlind,
    };
  });

export const submitStockOpname = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { soId: string; items: { itemId: string; physicalStock: number }[] }) => data,
  )
  .handler(async ({ data }) => {
    const user = await requireAuth();

    for (const item of data.items) {
      // Get current system stock
      const [soItem] = await db
        .select()
        .from(stockOpnameItems)
        .where(eq(stockOpnameItems.id, item.itemId))
        .limit(1);

      if (!soItem) continue;

      const variance = item.physicalStock - soItem.systemStock;
      const variancePercentage =
        soItem.systemStock > 0
          ? Number(((Math.abs(variance) / soItem.systemStock) * 100).toFixed(2))
          : 0;

      await db
        .update(stockOpnameItems)
        .set({
          physicalStock: item.physicalStock,
          variance,
          variancePercentage: String(variancePercentage),
        })
        .where(eq(stockOpnameItems.id, item.itemId));
    }

    // Check if any variance > threshold -> mark Under Investigation
    const allItems = await db
      .select()
      .from(stockOpnameItems)
      .where(eq(stockOpnameItems.stockOpnameId, data.soId));

    const hasVariance = allItems.some((i) => Math.abs(i.variance) > 0);

    await db
      .update(stockOpnames)
      .set({
        status: hasVariance ? "Under Investigation" : "Submitted",
        submittedBy: user.id,
      })
      .where(eq(stockOpnames.id, data.soId));

    return { success: true, status: hasVariance ? "Under Investigation" : "Submitted" };
  });

export const approveStockOpname = createServerFn({ method: "POST" })
  .inputValidator((data: { soId: string; investigationNote?: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuth();
    await requireRole("super_admin", "area_manager");

    // Get the SO
    const [so] = await db
      .select()
      .from(stockOpnames)
      .where(eq(stockOpnames.id, data.soId))
      .limit(1);

    if (!so) throw new Error("Stock opname not found");

    // Adjust inventory to physical stock
    const items = await db
      .select()
      .from(stockOpnameItems)
      .where(eq(stockOpnameItems.stockOpnameId, data.soId));

    for (const item of items) {
      // Find inventory record
      const [inv] = await db
        .select()
        .from(inventory)
        .where(
          and(eq(inventory.branchId, so.branchId), eq(inventory.ingredientId, item.ingredientId)),
        )
        .limit(1);

      if (inv) {
        await db
          .update(inventory)
          .set({
            quantity: item.physicalStock,
            lastUpdated: new Date(),
          })
          .where(eq(inventory.id, inv.id));

        // Create ledger adjustment entry
        if (item.variance !== 0) {
          await db.insert(stockLedger).values({
            branchId: so.branchId,
            ingredientId: item.ingredientId,
            type: item.variance > 0 ? "IN" : "OUT",
            quantity: Math.abs(item.variance),
            balance: item.physicalStock,
            reference: data.soId,
            notes: `SO Adjustment${data.investigationNote ? ": " + data.investigationNote : ""}`,
          });
        }
      }
    }

    await db
      .update(stockOpnames)
      .set({
        status: "Approved",
        approvedBy: user.id,
      })
      .where(eq(stockOpnames.id, data.soId));

    return { success: true };
  });
