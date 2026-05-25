import { db } from "#/lib/server/db";
import { recipes, recipeIngredients, ingredients } from "#/db/schema";
import { eq } from "drizzle-orm";

/**
 * Recalculate totalCogs for all recipes that use a given ingredient.
 * Call this after ingredient averageCost changes.
 */
export async function recalculateRecipeCostsForIngredient(ingredientId: string): Promise<void> {
  // Find all recipes that use this ingredient
  const recipeLinks = await db
    .select({ recipeId: recipeIngredients.recipeId })
    .from(recipeIngredients)
    .where(eq(recipeIngredients.ingredientId, ingredientId));

  const recipeIds = [...new Set(recipeLinks.map((r) => r.recipeId))];
  if (recipeIds.length === 0) return;

  await recalculateRecipeCosts(recipeIds);
}

/**
 * Recalculate totalCogs for specific recipe IDs.
 */
export async function recalculateRecipeCosts(recipeIds: string[]): Promise<void> {
  for (const rid of recipeIds) {
    const ings = await db
      .select({
        quantity: recipeIngredients.quantity,
        averageCost: ingredients.averageCost,
      })
      .from(recipeIngredients)
      .leftJoin(ingredients, eq(recipeIngredients.ingredientId, ingredients.id))
      .where(eq(recipeIngredients.recipeId, rid));

    const totalCogs = ings.reduce((sum, i) => sum + (i.averageCost ?? 0) * i.quantity, 0);

    await db.update(recipes).set({ totalCogs }).where(eq(recipes.id, rid));
  }
}

/**
 * Recalculate totalCogs for ALL recipes.
 * Use sparingly — prefer targeted recalculation.
 */
export async function recalculateAllRecipeCosts(): Promise<void> {
  const allRecipes = await db.select({ id: recipes.id }).from(recipes);
  const ids = allRecipes.map((r) => r.id);
  await recalculateRecipeCosts(ids);
}
