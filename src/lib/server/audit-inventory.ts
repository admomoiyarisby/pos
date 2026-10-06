import { createServerFn } from "@tanstack/react-start";
import { db } from "#/lib/server/db";
import { z } from "zod";
import {
  orders,
  orderItems,
  recipes,
  ingredients,
  recipeIngredients,
  ORDER_CHANNEL_VALUES,
} from "#/db/schema";
import { eq, and, ne, isNull, sql, inArray } from "drizzle-orm";
import { requireRole } from "./auth";

export interface AuditInventoryIngredient {
  ingredientId: string;
  ingredientName: string;
  quantityPerServing: number;
  unit: string;
  totalConsumed: number;
}

export interface AuditInventoryRecipe {
  recipeId: string;
  recipeName: string;
  servingsSold: number;
  ingredients: AuditInventoryIngredient[];
}

/**
 * Compute theoretical ingredient consumption per recipe for a date range.
 * Based on: orders → orderItems (count per recipe) → recipeIngredients → ingredients.
 *
 * "Consumed" means every non-voided order, not `status = 'Completed'` — see the
 * status comment on `conditions` below for why.
 */
export const getAuditInventory = createServerFn({ method: "GET" })
  .validator(
    (data: { dateFrom?: string; dateTo?: string; branchId?: string; channel?: string }) => ({
      ...data,
      channel: z.enum(ORDER_CHANNEL_VALUES).optional().catch(undefined).parse(data.channel),
    }),
  )
  .handler(async ({ data }): Promise<AuditInventoryRecipe[]> => {
    await requireRole("super_admin", "admin_pusat");

    // Soft-deleted orders are excluded for the same reason finance.ts excludes
    // them (finance.ts:132 and friends): a soft-deleted order disappears from
    // history lists but keeps its stock effect, so counting it here would
    // report consumption the operator can no longer see or reconcile.
    //
    // Count every order that actually consumed stock, and exclude only `Void`.
    //
    // This used to filter `status = 'Completed'`, which made the page
    // permanently empty: `createOrderCore` (pos.ts) inserts orders with no
    // `status`, so they take the column default `New`, and the only writer of
    // `Completed` — `completeOrderCore` — is called from integration tests but
    // from no UI. Of 3,770 orders only 67 are `Completed`, none since
    // 2026-09-03, so every month rendered "Tidak ada data penjualan".
    //
    // `Void` is the one status that genuinely means "not consumed":
    // `voidOrderCore` calls `restoreInventoryForVoid`, and across the live
    // database voided orders net to -1 unit (111,821 OUT vs 111,822 restored),
    // i.e. fully reversed. `New` is the status the POS actually sells with —
    // 2,163,520 units net consumed — so excluding it would discard every real
    // sale. `Cancel Requested` orders are still pending, not reversed.
    const conditions = [ne(orders.status, "Void"), isNull(orders.deletedAt)];
    if (data.branchId) conditions.push(eq(orders.branchId, data.branchId));
    if (data.channel) conditions.push(eq(orders.channel, data.channel));
    // Date range (Jakarta local dates, matching finance.ts): the UI sends
    // YYYY-MM-DD strings and orders.createdAt is a NAIVE timestamp storing UTC
    // wall-clock time (see schema.ts), so convert UTC -> WIB before comparing
    // to the local date — JS Date boundaries align to UTC days and shift the
    // window by 7 hours (orders from 00:00–07:00 WIB land on the wrong day).
    if (data.dateFrom)
      conditions.push(
        sql`DATE((${orders.createdAt} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta') >= ${data.dateFrom}`,
      );
    if (data.dateTo)
      conditions.push(
        sql`DATE((${orders.createdAt} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta') <= ${data.dateTo}`,
      );

    // Step 1: Count servings per recipe from order items
    const recipeServingCounts = await db
      .select({
        recipeId: orderItems.recipeId,
        totalServings: sql<number>`COALESCE(SUM(${orderItems.quantity}), 0)`,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .where(and(...conditions))
      .groupBy(orderItems.recipeId);

    if (recipeServingCounts.length === 0) return [];

    const recipeIds = recipeServingCounts.map((r) => r.recipeId);

    // Step 2: Get recipe names and their ingredient BOM
    const recipeIngredientsData = await db
      .select({
        recipeId: recipes.id,
        recipeName: recipes.name,
        ingredientId: ingredients.id,
        ingredientName: ingredients.name,
        quantityPerServing: recipeIngredients.quantity,
        unit: ingredients.stockUnit,
      })
      .from(recipes)
      .innerJoin(recipeIngredients, eq(recipes.id, recipeIngredients.recipeId))
      .innerJoin(ingredients, eq(recipeIngredients.ingredientId, ingredients.id))
      .where(inArray(recipes.id, recipeIds));

    // Step 3: Combine into grouped structure
    const recipeMap = new Map<string, AuditInventoryRecipe>();

    for (const serving of recipeServingCounts) {
      recipeMap.set(serving.recipeId, {
        recipeId: serving.recipeId,
        recipeName: "", // filled below
        servingsSold: Number(serving.totalServings),
        ingredients: [],
      });
    }

    for (const ri of recipeIngredientsData) {
      const recipe = recipeMap.get(ri.recipeId);
      if (recipe) {
        recipe.recipeName = ri.recipeName;
        recipe.ingredients.push({
          ingredientId: ri.ingredientId,
          ingredientName: ri.ingredientName,
          quantityPerServing: ri.quantityPerServing,
          unit: ri.unit,
          totalConsumed: ri.quantityPerServing * recipe.servingsSold,
        });
      }
    }

    return Array.from(recipeMap.values()).sort((a, b) => a.recipeName.localeCompare(b.recipeName));
  });
