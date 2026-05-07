import { createServerFn } from "@tanstack/react-start";
import { db } from "#/db/index";
import {
  recipes,
  recipeBrands,
  recipeIngredients,
  recipeChildRecipes,
  recipeModifierGroups,
  ingredients,
  brands,
  modifierGroups,
} from "#/db/schema";
import { eq, ilike } from "drizzle-orm";
import { requireAuth, requireRole } from "./auth";
import { logSystemAction, logAudit } from "./logging";
import { recalculateAllRecipeCosts as recalcAllCosts } from "./cost-rollup";
import { z } from "zod";

const recipeIngredientInput = z.object({
  ingredientId: z.string().uuid(),
  quantity: z.number().int().min(1),
});

const recipeChildInput = z.object({
  recipeId: z.string().uuid(),
  quantity: z.number().int().min(1),
});

const recipeInput = z.object({
  code: z.string().min(1).max(30),
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  imageUrl: z.string().optional(),
  category: z.enum(["makanan", "minuman", "snack", "add_ons"]),
  isSubRecipe: z.boolean().default(false),
  basePrice: z.number().int().min(0),
  isBOGO: z.boolean().default(false),
  brandIds: z.array(z.string().uuid()),
  ingredients: z.array(recipeIngredientInput),
  childRecipes: z.array(recipeChildInput).optional(),
  modifierGroupIds: z.array(z.string().uuid()).optional(),
});

export const getRecipes = createServerFn({ method: "GET" })
  .inputValidator((data: { search?: string; category?: string; brandId?: string }) => data)
  .handler(async ({ data }) => {
    await requireAuth();

    let result = await db
      .select({
        id: recipes.id,
        code: recipes.code,
        name: recipes.name,
        description: recipes.description,
        imageUrl: recipes.imageUrl,
        category: recipes.category,
        isSubRecipe: recipes.isSubRecipe,
        basePrice: recipes.basePrice,
        totalCogs: recipes.totalCogs,
        isBOGO: recipes.isBOGO,
        status: recipes.status,
      })
      .from(recipes)
      .where(data.search ? ilike(recipes.name, `%${data.search}%`) : undefined)
      .orderBy(recipes.name);

    // Get brands for each recipe
    const recipeIds = result.map((r) => r.id);
    const brandLinks =
      recipeIds.length > 0
        ? await db
            .select({
              recipeId: recipeBrands.recipeId,
              brandId: recipeBrands.brandId,
              brandName: brands.name,
            })
            .from(recipeBrands)
            .leftJoin(brands, eq(recipeBrands.brandId, brands.id))
            .where(eq(recipeBrands.recipeId, recipeIds[0]))
        : [];

    return result.map((r) => ({
      ...r,
      brands: brandLinks
        .filter((b) => b.recipeId === r.id)
        .map((b) => ({
          id: b.brandId,
          name: b.brandName,
        })),
    }));
  });

export const getRecipeDetail = createServerFn({ method: "GET" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    await requireAuth();

    const [recipe] = await db.select().from(recipes).where(eq(recipes.id, data.id)).limit(1);

    if (!recipe) return null;

    const [brandLinks, ingredientLinks, childLinks, modifierLinks] = await Promise.all([
      db
        .select({
          brandId: recipeBrands.brandId,
          brandName: brands.name,
        })
        .from(recipeBrands)
        .leftJoin(brands, eq(recipeBrands.brandId, brands.id))
        .where(eq(recipeBrands.recipeId, data.id)),
      db
        .select({
          ingredientId: recipeIngredients.ingredientId,
          ingredientName: ingredients.name,
          quantity: recipeIngredients.quantity,
        })
        .from(recipeIngredients)
        .leftJoin(ingredients, eq(recipeIngredients.ingredientId, ingredients.id))
        .where(eq(recipeIngredients.recipeId, data.id)),
      db
        .select({
          childRecipeId: recipeChildRecipes.childRecipeId,
          quantity: recipeChildRecipes.quantity,
        })
        .from(recipeChildRecipes)
        .where(eq(recipeChildRecipes.parentRecipeId, data.id)),
      db
        .select({
          modifierGroupId: recipeModifierGroups.modifierGroupId,
          modifierGroupName: modifierGroups.name,
        })
        .from(recipeModifierGroups)
        .leftJoin(modifierGroups, eq(recipeModifierGroups.modifierGroupId, modifierGroups.id))
        .where(eq(recipeModifierGroups.recipeId, data.id)),
    ]);

    return {
      ...recipe,
      brands: brandLinks,
      ingredients: ingredientLinks,
      childRecipes: childLinks,
      modifierGroups: modifierLinks,
    };
  });

export const createRecipe = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => recipeInput.parse(data))
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");

    // Insert recipe
    const [recipe] = await db
      .insert(recipes)
      .values({
        code: data.code,
        name: data.name,
        description: data.description,
        imageUrl: data.imageUrl,
        category: data.category,
        isSubRecipe: data.isSubRecipe,
        basePrice: data.basePrice,
        isBOGO: data.isBOGO,
      })
      .returning();

    // Insert brand links
    if (data.brandIds.length > 0) {
      await db
        .insert(recipeBrands)
        .values(data.brandIds.map((brandId) => ({ recipeId: recipe.id, brandId })));
    }

    // Insert ingredients
    if (data.ingredients.length > 0) {
      await db
        .insert(recipeIngredients)
        .values(data.ingredients.map((ing) => ({ recipeId: recipe.id, ...ing })));
    }

    // Insert child recipes
    if (data.childRecipes?.length) {
      await db.insert(recipeChildRecipes).values(
        data.childRecipes.map((cr) => ({
          parentRecipeId: recipe.id,
          childRecipeId: cr.recipeId,
          quantity: cr.quantity,
        })),
      );
    }

    // Insert modifier groups
    if (data.modifierGroupIds?.length) {
      await db
        .insert(recipeModifierGroups)
        .values(
          data.modifierGroupIds.map((mgId) => ({ recipeId: recipe.id, modifierGroupId: mgId })),
        );
    }

    await logSystemAction(user, "Create Recipe", `Resep "${recipe.name}" dibuat oleh ${user.name}`);
    await logAudit(
      user,
      "recipes",
      recipe.id,
      "CREATE",
      undefined,
      recipe as Record<string, unknown>,
    );

    return recipe;
  });

export const updateRecipe = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    recipeInput.partial().extend({ id: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");

    const {
      id,
      brandIds,
      ingredients: recipeIngs,
      childRecipes,
      modifierGroupIds,
      ...recipeUpdates
    } = data;

    // Fetch old recipe for audit
    const [old] = await db.select().from(recipes).where(eq(recipes.id, id)).limit(1);

    // Update recipe base fields
    await db.update(recipes).set(recipeUpdates).where(eq(recipes.id, id));

    // Update brand links
    if (brandIds !== undefined) {
      await db.delete(recipeBrands).where(eq(recipeBrands.recipeId, id));
      if (brandIds.length > 0) {
        await db
          .insert(recipeBrands)
          .values(brandIds.map((brandId) => ({ recipeId: id, brandId })));
      }
    }

    // Update ingredients
    if (recipeIngs !== undefined) {
      await db.delete(recipeIngredients).where(eq(recipeIngredients.recipeId, id));
      if (recipeIngs.length > 0) {
        await db
          .insert(recipeIngredients)
          .values(recipeIngs.map((ing) => ({ recipeId: id, ...ing })));
      }
    }

    // Update child recipes
    if (childRecipes !== undefined) {
      await db.delete(recipeChildRecipes).where(eq(recipeChildRecipes.parentRecipeId, id));
      if (childRecipes.length > 0) {
        await db.insert(recipeChildRecipes).values(
          childRecipes.map((cr) => ({
            parentRecipeId: id,
            childRecipeId: cr.recipeId,
            quantity: cr.quantity,
          })),
        );
      }
    }

    // Update modifier groups
    if (modifierGroupIds !== undefined) {
      await db.delete(recipeModifierGroups).where(eq(recipeModifierGroups.recipeId, id));
      if (modifierGroupIds.length > 0) {
        await db
          .insert(recipeModifierGroups)
          .values(modifierGroupIds.map((mgId) => ({ recipeId: id, modifierGroupId: mgId })));
      }
    }

    const [updated] = await db.select().from(recipes).where(eq(recipes.id, id)).limit(1);

    await logSystemAction(
      user,
      "Update Recipe",
      `Resep "${updated?.name}" diperbarui oleh ${user.name}`,
    );
    await logAudit(
      user,
      "recipes",
      id,
      "UPDATE",
      old as Record<string, unknown>,
      updated as Record<string, unknown>,
    );

    return { success: true };
  });

export const recalculateAllRecipeCosts = createServerFn({ method: "POST" }).handler(async () => {
  const user = await requireRole("super_admin");

  await recalcAllCosts();

  await logSystemAction(
    user,
    "Recalculate HPP",
    `Semua HPP resep dihitung ulang oleh ${user.name}`,
  );

  return { success: true };
});
