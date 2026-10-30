import { createServerFn } from "@tanstack/react-start";
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { areaManagerBranches, ingredients, inventory, stockLedger } from "#/db/schema";
import { db } from "#/lib/server/db";
import { requireAuth } from "./auth";
import type { AppUser } from "./auth";
import { notCancelledProductionSql, notCancelledWasteSql, notVoidedOrderSql } from "./finance";
import { stockRecommendationFor } from "#/lib/stock-recommendation";
import type { StockStatus } from "#/lib/stock-recommendation";
import { toDateInputValue } from "#/lib/utils";

export interface StockRecommendation {
  branchId: string;
  ingredientId: string;
  ingredientName: string;
  stockUnit: string;
  currentStock: number;
  usage3d: number;
  avgDailyUsage: number;
  targetStock: number;
  /** `null` when the item had no stock-out in the window. */
  daysCover: number | null;
  status: StockStatus;
  recommendedOrder: number;
  /** The three complete days the usage came from (Jakarta calendar). */
  dateFrom: string;
  dateTo: string;
}

export interface GetStockRecommendationsData {
  branchId?: string;
}

export const getStockRecommendations = createServerFn({ method: "GET" })
  .validator((data: GetStockRecommendationsData) => data)
  .handler(async ({ data }): Promise<StockRecommendation[]> => {
    const user = await requireAuth();
    return getStockRecommendationCore(user, data);
  });

/** Shift a Jakarta calendar date (`YYYY-MM-DD`) by whole days. */
function shiftDate(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

/**
 * Which branches this reader may see. `undefined` means all (supervisors
 * without a branch filter); `[]` means none, so the caller can return early.
 */
async function scopedBranchIds(
  user: AppUser,
  requestedBranchId?: string,
): Promise<string[] | undefined> {
  if (user.role === "super_admin" || user.role === "admin_pusat") {
    return requestedBranchId ? [requestedBranchId] : undefined;
  }
  if (user.role === "area_manager") {
    const assigned = await db
      .select({ branchId: areaManagerBranches.branchId })
      .from(areaManagerBranches)
      .where(eq(areaManagerBranches.userId, user.id));
    const assignedIds = assigned.map((row) => row.branchId);
    if (assignedIds.length === 0) return [];
    // A branch outside the assignment is ignored rather than honored, same as
    // the Stok Keluar report.
    return requestedBranchId && assignedIds.includes(requestedBranchId)
      ? [requestedBranchId]
      : assignedIds;
  }
  return user.branchId ? [user.branchId] : [];
}

/**
 * `getStockRecommendations` minus the session lookup — the ADR 0015 read-path
 * core seam. `now` is injectable so a test can pin the 3-day window.
 *
 * The usage window is the last 3 COMPLETE Jakarta days (today is partial, so
 * including it would understate usage and recommend too little). Cancel/void
 * filters match Stok Keluar: a cancelled document's original OUT rows stay in
 * the ledger for audit but must not count as consumption.
 */
export async function getStockRecommendationCore(
  user: AppUser,
  data: GetStockRecommendationsData,
  now: Date = new Date(),
): Promise<StockRecommendation[]> {
  const branchIds = await scopedBranchIds(user, data.branchId);
  if (branchIds && branchIds.length === 0) return [];

  const today = toDateInputValue(now);
  const dateTo = shiftDate(today, -1);
  const dateFrom = shiftDate(today, -3);
  const branchCondition = branchIds ? inArray(stockLedger.branchId, branchIds) : undefined;
  const inventoryBranchCondition = branchIds ? inArray(inventory.branchId, branchIds) : undefined;

  const usageRows = await db
    .select({
      branchId: stockLedger.branchId,
      ingredientId: stockLedger.ingredientId,
      name: ingredients.name,
      unit: ingredients.stockUnit,
      quantity: sql<number>`COALESCE(SUM(${stockLedger.quantity}), 0)`,
    })
    .from(stockLedger)
    .innerJoin(ingredients, eq(stockLedger.ingredientId, ingredients.id))
    .where(
      and(
        eq(stockLedger.type, "OUT"),
        isNull(stockLedger.recipeId),
        isNotNull(stockLedger.ingredientId),
        eq(ingredients.isNasi, false),
        notVoidedOrderSql,
        notCancelledWasteSql,
        notCancelledProductionSql,
        sql`DATE((${stockLedger.createdAt} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta') >= ${dateFrom}`,
        sql`DATE((${stockLedger.createdAt} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta') <= ${dateTo}`,
        branchCondition,
      ),
    )
    .groupBy(
      stockLedger.branchId,
      stockLedger.ingredientId,
      ingredients.name,
      ingredients.stockUnit,
    );

  const stockRows = await db
    .select({
      branchId: inventory.branchId,
      ingredientId: inventory.ingredientId,
      quantity: inventory.quantity,
      name: ingredients.name,
      unit: ingredients.stockUnit,
    })
    .from(inventory)
    .innerJoin(ingredients, eq(inventory.ingredientId, ingredients.id))
    .where(and(eq(ingredients.isNasi, false), inventoryBranchCondition));

  type Accumulator = {
    branchId: string;
    ingredientId: string;
    name: string;
    unit: string;
    currentStock: number;
    usage3d: number;
  };
  const byKey = new Map<string, Accumulator>();

  // Usage without an inventory row still matters (the item is stocked out),
  // so the union is seeded from both sides; a missing side counts as zero.
  for (const row of stockRows) {
    byKey.set(`${row.branchId}:${row.ingredientId}`, {
      branchId: row.branchId,
      ingredientId: row.ingredientId,
      name: row.name,
      unit: row.unit,
      currentStock: Number(row.quantity),
      usage3d: 0,
    });
  }
  for (const row of usageRows) {
    if (row.ingredientId === null) continue;
    const key = `${row.branchId}:${row.ingredientId}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.usage3d = Number(row.quantity);
    } else {
      byKey.set(key, {
        branchId: row.branchId,
        ingredientId: row.ingredientId,
        name: row.name,
        unit: row.unit,
        currentStock: 0,
        usage3d: Number(row.quantity),
      });
    }
  }

  return [...byKey.values()]
    .map((row) => {
      const numbers = stockRecommendationFor(row.currentStock, row.usage3d);
      return {
        branchId: row.branchId,
        ingredientId: row.ingredientId,
        ingredientName: row.name,
        stockUnit: row.unit,
        currentStock: row.currentStock,
        ...numbers,
        dateFrom,
        dateTo,
      };
    })
    .sort(
      (a, b) =>
        a.branchId.localeCompare(b.branchId) || a.ingredientName.localeCompare(b.ingredientName),
    );
}
