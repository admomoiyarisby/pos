import { createServerFn } from "@tanstack/react-start";
import { db } from "#/lib/server/db";
import { orders, orderItems, recipes, ingredients, recipeIngredients } from "#/db/schema";
import { eq, and, gte, lte, sql, inArray } from "drizzle-orm";
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
 */
export const getAuditInventory = createServerFn({ method: "GET" })
  .validator(
    (data: { dateFrom?: string; dateTo?: string; branchId?: string; channel?: string }) => data,
  )
  .handler(async ({ data }): Promise<AuditInventoryRecipe[]> => {
    await requireRole("super_admin", "admin_pusat");

    // Only count completed orders (exclude voided/cancelled)
    const conditions = [eq(orders.status, "Completed")];
    if (data.branchId) conditions.push(eq(orders.branchId, data.branchId));
    if (data.channel) conditions.push(eq(orders.channel, data.channel as any));
    if (data.dateFrom) conditions.push(gte(orders.createdAt, new Date(data.dateFrom)));
    if (data.dateTo) conditions.push(lte(orders.createdAt, new Date(data.dateTo + "T23:59:59")));

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
