import { createServerFn } from "@tanstack/react-start";
import { db } from "#/lib/server/db";
import {
  recipes,
  recipeBrands,
  recipeIngredients,
  recipeChildRecipes,
  recipeModifierGroups,
  recipeBranches,
  ingredients,
  brands,
  modifierGroups,
  modifiers,
  branches,
} from "#/db/schema";
import { eq, ilike, inArray, sql } from "drizzle-orm";
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
  category: z.enum(["makanan", "minuman", "snack", "add_ons", "paket_bundle"]),
  isSubRecipe: z.boolean().default(false),
  basePrice: z.number().int().min(0),
  isBOGO: z.boolean().default(false),
  brandIds: z.array(z.string().uuid()),
  ingredients: z.array(recipeIngredientInput),
  childRecipes: z.array(recipeChildInput).optional(),
  modifierGroupIds: z.array(z.string().uuid()).optional(),
  branchIds: z.array(z.string().uuid()).optional().nullable(),
});

export const getRecipes = createServerFn({ method: "GET" })
  .inputValidator((data: { search?: string; category?: string; brandId?: string }) => data)
  .handler(async ({ data }) => {
    await requireAuth();

    // Get current branch for filtering
    const user = await requireRole();
    const currentBranchId = user.branchId;

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
        branchId: recipeBranches.branchId,
      })
      .from(recipes)
      .leftJoin(recipeBranches, eq(recipeBranches.recipeId, recipes.id))
      .where(data.search ? ilike(recipes.name, `%${data.search}%`) : undefined)
      .orderBy(recipes.name);

    // Filter recipes based on branch visibility
    if (currentBranchId) {
      result = result
        .where(
          sql`
            EXISTS (
              SELECT 1 FROM recipe_branches WHERE recipe_branches.recipe_id = recipes.id AND recipe_branches.branch_id = ${currentBranchId}
            )
            OR recipe_branches.id IS NULL
          `,
        )
        .orderBy(recipes.name);
    }

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
            .where(inArray(recipeBrands.recipeId, recipeIds))
        : [];

    // Get child recipe counts
    const childCounts: Record<string, number> = {};
    if (recipeIds.length > 0) {
      const rows = await db
        .select({
          parentRecipeId: recipeChildRecipes.parentRecipeId,
          count: sql<number>`count(*)`,
        })
        .from(recipeChildRecipes)
        .where(inArray(recipeChildRecipes.parentRecipeId, recipeIds))
        .groupBy(recipeChildRecipes.parentRecipeId);
      for (const row of rows) {
        childCounts[row.parentRecipeId] = Number(row.count);
      }
    }

    return result.map((r) => ({
      ...r,
      brands: brandLinks
        .filter((b) => b.recipeId === r.id)
        .map((b) => ({
          id: b.brandId,
          name: b.brandName,
        })),
      hasChildren: (childCounts[r.id] ?? 0) > 0,
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
          childRecipeName: recipes.name,
          quantity: recipeChildRecipes.quantity,
        })
        .from(recipeChildRecipes)
        .leftJoin(recipes, eq(recipeChildRecipes.childRecipeId, recipes.id))
        .where(eq(recipeChildRecipes.parentRecipeId, data.id)),
      db
        .select({
          modifierGroupId: recipeModifierGroups.modifierGroupId,
          modifierGroupName: modifierGroups.name,
          minSelection: modifierGroups.minSelection,
          maxSelection: modifierGroups.maxSelection,
        })
        .from(recipeModifierGroups)
        .leftJoin(modifierGroups, eq(recipeModifierGroups.modifierGroupId, modifierGroups.id))
        .where(eq(recipeModifierGroups.recipeId, data.id)),
    ]);

    // Fetch full modifier data for each group
    const modifierGroupIds = modifierLinks.map((m) => m.modifierGroupId);
    const allModifiers =
      modifierGroupIds.length > 0
        ? await db
            .select()
            .from(modifiers)
            .where(inArray(modifiers.modifierGroupId, modifierGroupIds))
        : [];

    const modGroupsWithModifiers = modifierLinks.map((mg) => ({
      ...mg,
      modifiers: allModifiers.filter((m) => m.modifierGroupId === mg.modifierGroupId),
    }));

    return {
      ...recipe,
      brands: brandLinks,
      ingredients: ingredientLinks,
      childRecipes: childLinks,
      modifierGroups: modGroupsWithModifiers,
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

    // Insert branch visibility
    if (data.branchIds?.length && data.branchIds.length > 0) {
      await db
        .insert(recipeBranches)
        .values(
          data.branchIds.map((branchId) => ({
            recipeId: recipe.id,
            branchId,
          })),
        );
    } else {
      // Default: visible in all branches (no explicit records needed)
      // The query logic handles this via NULL branch_id
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
      branchIds,
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

    // Update branch visibility
    if (branchIds !== undefined) {
      if (branchIds.length === 0) {
        // Explicitly set to "all branches" by deleting all explicit records
        await db.delete(recipeBranches).where(eq(recipeBranches.recipeId, id));
      } else {
        // Delete existing and insert new branch assignments
        await db.delete(recipeBranches).where(eq(recipeBranches.recipeId, id));
        if (branchIds.length > 0) {
          await db
            .insert(recipeBranches)
            .values(branchIds.map((branchId) => ({ recipeId: id, branchId })));
        }
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

// =============================================================================
// DELETE RECIPE (SOFT DELETE)
// =============================================================================

export const deleteRecipe = createServerFn({ method: "POST" })
  .inputValidator(
    (data: unknown) =>
      z.object({ id: z.string().uuid(), hardDelete: z.boolean().default(false) }).parse(data),
  )
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");

    const { id, hardDelete } = data;

    // Check if recipe is referenced in any orders
    const [orderRefCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(orderItems)
      .where(eq(orderItems.recipeId, id))
      .limit(1);

    const referencedInOrders = orderRefCount?.count ?? 0;

    if (hardDelete && referencedInOrders > 0) {
      throw new Error(
        `Cannot hard delete recipe referenced in ${referencedInOrders} order(s). Use soft delete or remove from orders first.`,
      );
    }

    // Check if recipe is used as child recipe in other bundles
    const [childRefCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(recipeChildRecipes)
      .where(eq(recipeChildRecipes.childRecipeId, id))
      .limit(1);

    const usedInBundles = childRefCount?.count ?? 0;

    if (hardDelete && usedInBundles > 0) {
      throw new Error(
        `Cannot hard delete recipe used in ${usedInBundles} bundle recipe(s). Remove from bundles first or use soft delete.`,
      );
    }

    const [old] = await db.select().from(recipes).where(eq(recipes.id, id)).limit(1);

    if (!old) {
      throw new Error("Recipe not found");
    }

    // Soft delete by setting status to Inactive
    const [result] = await db
      .update(recipes)
      .set({ status: "Inactive", updatedAt: new Date() })
      .where(eq(recipes.id, id))
      .returning();

    await logSystemAction(
      user,
      "Delete Recipe",
      `Resep "${old.name}" dihapus oleh ${user.name}`,
    );
    await logAudit(
      user,
      "recipes",
      id,
      "DELETE",
      old as Record<string, unknown>,
      result as Record<string, unknown>,
    );

    return { success: true, wasSoftDelete: true };
  });
