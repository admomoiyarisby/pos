import { createServerFn } from "@tanstack/react-start";
import { db } from "#/lib/server/db";
import {
  recipes,
  recipeBrands,
  recipeIngredients,
  recipeChildRecipes,
  recipeModifierGroups,
  recipeBranches,
  recipeInventory,
  stockLedger,
  inventory,
  branches,
  ingredients,
  brands,
  modifierGroups,
  modifiers,
  orderItems,
  categories,
} from "#/db/schema";
import { eq, inArray, sql, and, ne, isNull } from "drizzle-orm";
import { fuzzySearch, fuzzyRank } from "./fuzzy";
import { requireAuth, requireRole, getCurrentUserRaw } from "./auth";
import type { AppUser } from "./auth";
import { logSystemAction, logAudit } from "./logging";
import { recalculateAllRecipeCosts as recalcAllCosts, recalculateRecipeCosts } from "./cost-rollup";
import { branchVisibleClause } from "#/lib/server/branch-visibility";
import { z } from "zod";

const recipeIngredientInput = z.object({
  ingredientId: z.string().uuid(),
  // recipe_ingredients.quantity is real (float4) — recipe takaran can be fractional
  // (e.g. 1.5 tsp), so decimals are allowed here. Must still be a positive number.
  quantity: z.number().positive(),
});

const recipeChildInput = z.object({
  recipeId: z.string().uuid(),
  quantity: z.number().int().min(1),
});

const recipeInput = z.object({
  code: z.string().min(1).max(30),
  name: z.string().min(1).max(100),
  alias: z.string().max(100).optional().nullable(),
  description: z.string().optional(),
  imageUrl: z.string().optional(),
  // The categories table is the master; the wizard submits the category row's
  // id (FK), not a legacy enum code. Replaces the dropped recipe_category enum.
  categoryId: z.string().uuid(),
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
  .validator(
    (data: { search?: string; category?: string; brandId?: string; status?: string }) => data,
  )
  .handler(async ({ data }) => {
    await requireAuth();

    // Get current branch for filtering
    const user = await getCurrentUserRaw();
    const currentBranchId = user?.branchId;

    // Build conditions list, then apply all at once
    const whereConditions: import("drizzle-orm").SQL[] = [];

    if (data.search) {
      whereConditions.push(fuzzySearch([recipes.name, recipes.alias], data.search));
    }

    // ADR-0009: tombstoned (Deleted) recipes never appear in the UI. An optional
    // `status` filter narrows to Active/Inactive; otherwise both are returned.
    whereConditions.push(ne(recipes.status, "Deleted"));
    if (data.status === "Active" || data.status === "Inactive") {
      whereConditions.push(eq(recipes.status, data.status));
    }

    // Branch visibility gate: a branch-scoped caller sees only recipes allowed
    // at their branch; a recipe with no recipe_branches rows is visible
    // everywhere. Centralized in branchVisibleClause.
    const branchClause = branchVisibleClause({
      linkTable: recipeBranches,
      linkRowId: recipeBranches.recipeId,
      rowId: recipes.id,
      linkBranchId: recipeBranches.branchId,
      currentBranchId,
    });
    if (branchClause) whereConditions.push(branchClause);

    const result = await db
      .select({
        id: recipes.id,
        code: recipes.code,
        name: recipes.name,
        alias: recipes.alias,
        description: recipes.description,
        imageUrl: recipes.imageUrl,
        categoryId: recipes.categoryId,
        categoryName: categories.name,
        isSubRecipe: recipes.isSubRecipe,
        basePrice: recipes.basePrice,
        totalCogs: recipes.totalCogs,
        isBOGO: recipes.isBOGO,
        status: recipes.status,
      })
      .from(recipes)
      .leftJoin(categories, eq(recipes.categoryId, categories.id))
      .where(and(...whereConditions))
      .orderBy(data.search ? fuzzyRank([recipes.name, recipes.alias], data.search) : recipes.name);

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

    // Deduplicate by recipe id — the LEFT JOIN with recipe_branches can produce
    // multiple rows per recipe when a recipe is linked to multiple branches.
    const seenIds = new Set<string>();
    const dedupedResult = result.filter((r) => {
      if (seenIds.has(r.id)) return false;
      seenIds.add(r.id);
      return true;
    });

    return dedupedResult.map((r) => ({
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
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    await requireAuth();
    const user = await getCurrentUserRaw();

    // Branch visibility: a branch-scoped caller must not deep-link to a recipe
    // restricted from their branch. Reusing the shared clause makes a restricted
    // row return no result → null.
    const branchClause = branchVisibleClause({
      linkTable: recipeBranches,
      linkRowId: recipeBranches.recipeId,
      rowId: recipes.id,
      linkBranchId: recipeBranches.branchId,
      currentBranchId: user?.branchId,
    });

    const [recipe] = await db
      .select({
        recipe: recipes,
        categoryName: categories.name,
      })
      .from(recipes)
      .leftJoin(categories, eq(recipes.categoryId, categories.id))
      // ADR-0009 mirror: a tombstoned (Deleted) recipe must not be viewable
      // even via a direct URL (restore is DB-only).
      .where(and(eq(recipes.id, data.id), ne(recipes.status, "Deleted"), branchClause))
      .limit(1);

    if (!recipe) return null;

    // Flatten the joined shape so callers see `categoryName` alongside the
    // recipe columns (mirrors getRecipes).
    const recipeRow = { ...recipe.recipe, categoryName: recipe.categoryName };

    const [brandLinks, ingredientLinks, childLinks, modifierLinks, branchLinks] = await Promise.all(
      [
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
            stockUnit: ingredients.stockUnit,
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
          // ADR-0009 mirror: tombstoned (soft-deleted) modifier groups never
          // appear on the recipe detail/edit page.
          .where(and(eq(recipeModifierGroups.recipeId, data.id), isNull(modifierGroups.deletedAt)))
          // Honor the manual group order set on /modifier-groups so the recipe
          // detail page lists modifier groups in the operator's chosen order.
          .orderBy(modifierGroups.sortOrder),
        db
          .select({ branchId: recipeBranches.branchId })
          .from(recipeBranches)
          .where(eq(recipeBranches.recipeId, data.id)),
      ],
    );

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
      ...recipeRow,
      brands: brandLinks,
      ingredients: ingredientLinks,
      childRecipes: childLinks,
      modifierGroups: modGroupsWithModifiers,
      branchIds: branchLinks.map((b) => b.branchId),
    };
  });

export interface RecipeStockRow {
  recipeId: string;
  branchId: string;
  branchName: string | null;
  branchType: "Central" | "Outlet" | null;
  quantity: number;
  lastUpdated: Date;
}

export const getRecipeInventory = createServerFn({ method: "GET" })
  .validator((data: { recipeId: string }) => data)
  .handler(async ({ data }): Promise<RecipeStockRow[]> => {
    await requireAuth();
    const user = await getCurrentUserRaw();

    // Branch visibility: a branch-scoped caller must not see stock for a recipe
    // restricted from their branch. Reuse the shared clause against recipes.id;
    // if the recipe isn't visible, return no rows.
    if (user?.branchId) {
      const [visible] = await db
        .select({ id: recipes.id })
        .from(recipes)
        .where(
          and(
            eq(recipes.id, data.recipeId),
            branchVisibleClause({
              linkTable: recipeBranches,
              linkRowId: recipeBranches.recipeId,
              rowId: recipes.id,
              linkBranchId: recipeBranches.branchId,
              currentBranchId: user.branchId,
            }),
          ),
        )
        .limit(1);
      if (!visible) return [];
    }

    const rows = await db
      .select({
        recipeId: recipeInventory.recipeId,
        branchId: recipeInventory.branchId,
        branchName: branches.name,
        branchType: branches.type,
        quantity: recipeInventory.quantity,
        lastUpdated: recipeInventory.lastUpdated,
      })
      .from(recipeInventory)
      .leftJoin(branches, eq(recipeInventory.branchId, branches.id))
      .where(eq(recipeInventory.recipeId, data.recipeId))
      .orderBy(branches.name);

    return rows.map((r) => ({
      recipeId: r.recipeId,
      branchId: r.branchId,
      branchName: r.branchName,
      branchType: r.branchType,
      quantity: Number(r.quantity),
      lastUpdated: r.lastUpdated,
    }));
  });

// User-parameterized core (ADR-0015). Mirrors the wrapper's requireRole guard.
export async function createRecipeCore(user: AppUser, data: z.input<typeof recipeInput>) {
  if (user.role !== "super_admin" && user.role !== "admin_pusat") {
    throw new Error(
      `Forbidden: insufficient role (user ${user.id} has role "${user.role}", required: super_admin | admin_pusat)`,
    );
  }

  // Insert recipe
  const [recipe] = await db
    .insert(recipes)
    .values({
      code: data.code,
      name: data.name,
      description: data.description,
      imageUrl: data.imageUrl,
      categoryId: data.categoryId,
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
    await db.insert(recipeBranches).values(
      data.branchIds.map((branchId) => ({
        recipeId: recipe.id,
        branchId,
      })),
    );
  } else {
    // Default: visible in all branches (no explicit records needed)
    // The query logic handles this via NULL branch_id
  }

  // Compute HPP (totalCogs) immediately so the new recipe doesn't show Rp 0
  // until a manual "Recalculate HPP" is triggered. The column defaults to 0.
  await recalculateRecipeCosts([recipe.id]);

  await logSystemAction(user, "Create Recipe", `Resep "${recipe.name}" dibuat oleh ${user.name}`);
  await logAudit(user, "recipes", recipe.id, "CREATE", undefined, recipe);

  return recipe;
}

export const createRecipe = createServerFn({ method: "POST" })
  .validator((data: z.input<typeof recipeInput>) => recipeInput.parse(data))
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");
    return createRecipeCore(user, data);
  });

// Partial-update schema for the edit-mode wizard. `recipeInput` declares
// `isSubRecipe`/`isBOGO` with `.default(false)`; zod re-applies those defaults
// when the key is absent from a `.partial()` payload. That silently reset the
// flags on every BOM/availability-only save (a BOGO recipe lost its BOGO badge
// the moment its takaran was edited). Strip the defaults here so absent keys
// stay absent, and re-add them as plain optionals — the wizard sends them
// explicitly on the Opsi Lanjutan step.
const updateRecipeInput = recipeInput.partial().omit({ isSubRecipe: true, isBOGO: true }).extend({
  id: z.string().uuid(),
  isSubRecipe: z.boolean().optional(),
  isBOGO: z.boolean().optional(),
});

// User-parameterized core (ADR-0015). Mirrors the wrapper's requireRole guard.
export async function updateRecipeCore(user: AppUser, data: z.input<typeof updateRecipeInput>) {
  if (user.role !== "super_admin" && user.role !== "admin_pusat") {
    throw new Error(
      `Forbidden: insufficient role (user ${user.id} has role "${user.role}", required: super_admin | admin_pusat)`,
    );
  }

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
  if (!old) throw new Error("Recipe not found");

  // All link-table writes are atomic — a failure in any block (e.g. dup
  // recipe_child_unique) rolls back the whole recipe update, avoiding a
  // half-deleted BOM that the non-transactional version left behind
  // (see db-risky-calls.integration.test.ts).
  await db.transaction(async (tx) => {
    // Update recipe base fields. `recipeUpdates` can legitimately be empty for
    // link-only partial saves (BOM-only or branch-only), so skip the UPDATE
    // instead of sending drizzle an empty `set({})` (which throws
    // "No values to set").
    if (Object.keys(recipeUpdates).length > 0) {
      await tx.update(recipes).set(recipeUpdates).where(eq(recipes.id, id));
    }

    // Update brand links
    if (brandIds !== undefined) {
      await tx.delete(recipeBrands).where(eq(recipeBrands.recipeId, id));
      if (brandIds.length > 0) {
        await tx
          .insert(recipeBrands)
          .values(brandIds.map((brandId) => ({ recipeId: id, brandId })));
      }
    }

    // Update ingredients
    if (recipeIngs !== undefined) {
      await tx.delete(recipeIngredients).where(eq(recipeIngredients.recipeId, id));
      if (recipeIngs.length > 0) {
        await tx
          .insert(recipeIngredients)
          .values(recipeIngs.map((ing) => ({ recipeId: id, ...ing })));
      }
    }

    // Update child recipes
    if (childRecipes !== undefined) {
      await tx.delete(recipeChildRecipes).where(eq(recipeChildRecipes.parentRecipeId, id));
      if (childRecipes.length > 0) {
        await tx.insert(recipeChildRecipes).values(
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
      await tx.delete(recipeModifierGroups).where(eq(recipeModifierGroups.recipeId, id));
      if (modifierGroupIds.length > 0) {
        await tx
          .insert(recipeModifierGroups)
          .values(modifierGroupIds.map((mgId) => ({ recipeId: id, modifierGroupId: mgId })));
      }
    }

    // Update branch visibility
    if (branchIds !== undefined && branchIds !== null) {
      if (branchIds.length === 0) {
        // Explicitly set to "all branches" by deleting all explicit records
        await tx.delete(recipeBranches).where(eq(recipeBranches.recipeId, id));
      } else {
        // Delete existing and insert new branch assignments
        await tx.delete(recipeBranches).where(eq(recipeBranches.recipeId, id));
        if (branchIds.length > 0) {
          await tx
            .insert(recipeBranches)
            .values(branchIds.map((branchId) => ({ recipeId: id, branchId })));
        }
      }
    }
  });

  const [updated] = await db.select().from(recipes).where(eq(recipes.id, id)).limit(1);

  // Recompute HPP (totalCogs) after any BOM edit — it would otherwise stay
  // stale at its previous value (or 0) until a manual recalculation.
  await recalculateRecipeCosts([id]);

  await logSystemAction(
    user,
    "Update Recipe",
    `Resep "${updated?.name}" diperbarui oleh ${user.name}`,
  );
  await logAudit(user, "recipes", id, "UPDATE", old, updated);

  return { success: true };
}

export const updateRecipe = createServerFn({ method: "POST" })
  .validator((data: z.input<typeof updateRecipeInput>) => updateRecipeInput.parse(data))
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");
    return updateRecipeCore(user, data);
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
// RECIPE LIFECYCLE (ADR-0009): Active ⇄ Inactive → Deleted
// =============================================================================

// Deactivate: Active → Inactive. Reversible; both admin roles.
// User-parameterized core (ADR-0015). Mirrors the wrapper's requireRole guard.
export async function deactivateRecipeCore(user: AppUser, data: { id: string }) {
  if (user.role !== "super_admin" && user.role !== "admin_pusat") {
    throw new Error(
      `Forbidden: insufficient role (user ${user.id} has role "${user.role}", required: super_admin | admin_pusat)`,
    );
  }

  const [old] = await db.select().from(recipes).where(eq(recipes.id, data.id)).limit(1);
  if (!old) throw new Error("Recipe not found");

  const [updated] = await db
    .update(recipes)
    .set({ status: "Inactive", updatedAt: new Date() })
    .where(eq(recipes.id, data.id))
    .returning();

  await logSystemAction(
    user,
    "Deactivate Recipe",
    `Resep "${old.name}" dinonaktifkan oleh ${user.name}`,
  );
  await logAudit(user, "recipes", data.id, "STATUS_CHANGE", old, updated);

  return { success: true };
}

export const deactivateRecipe = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");
    return deactivateRecipeCore(user, data);
  });

// Reactivate: Inactive → Active. Reversible; both admin roles.
// User-parameterized core (ADR-0015). Mirrors the wrapper's requireRole guard.
export async function reactivateRecipeCore(user: AppUser, data: { id: string }) {
  if (user.role !== "super_admin" && user.role !== "admin_pusat") {
    throw new Error(
      `Forbidden: insufficient role (user ${user.id} has role "${user.role}", required: super_admin | admin_pusat)`,
    );
  }

  const [old] = await db.select().from(recipes).where(eq(recipes.id, data.id)).limit(1);
  if (!old) throw new Error("Recipe not found");

  const [updated] = await db
    .update(recipes)
    .set({ status: "Active", updatedAt: new Date() })
    .where(eq(recipes.id, data.id))
    .returning();

  await logSystemAction(
    user,
    "Activate Recipe",
    `Resep "${old.name}" diaktifkan oleh ${user.name}`,
  );
  await logAudit(user, "recipes", data.id, "STATUS_CHANGE", old, updated);

  return { success: true };
}

export const reactivateRecipe = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");
    return reactivateRecipeCore(user, data);
  });

export interface RecipeDeleteImpact {
  orderCount: number;
  bundleCount: number;
  /** Child of an Active parent bundle — blocks deletion (would break a live BOM). */
  activeBundleCount: number;
  modifierGroupCount: number;
  branchStockCount: number;
}

// Reference counts powering the delete-confirmation warnings (ADR-0009).
export const getRecipeDeleteImpact = createServerFn({ method: "GET" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }): Promise<RecipeDeleteImpact> => {
    await requireRole("super_admin");

    const [[orderRow], [bundleRow], [activeBundleRow], [modRow], [stockRow]] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)` })
        .from(orderItems)
        .where(eq(orderItems.recipeId, data.id))
        .limit(1),
      db
        .select({ count: sql<number>`count(*)` })
        .from(recipeChildRecipes)
        .where(eq(recipeChildRecipes.childRecipeId, data.id))
        .limit(1),
      db
        .select({ count: sql<number>`count(*)` })
        .from(recipeChildRecipes)
        .innerJoin(recipes, eq(recipeChildRecipes.parentRecipeId, recipes.id))
        .where(and(eq(recipeChildRecipes.childRecipeId, data.id), eq(recipes.status, "Active")))
        .limit(1),
      db
        .select({ count: sql<number>`count(*)` })
        .from(recipeModifierGroups)
        .where(eq(recipeModifierGroups.recipeId, data.id))
        .limit(1),
      db
        .select({ count: sql<number>`count(*)` })
        .from(recipeInventory)
        .where(eq(recipeInventory.recipeId, data.id))
        .limit(1),
    ]);

    return {
      orderCount: Number(orderRow?.count ?? 0),
      bundleCount: Number(bundleRow?.count ?? 0),
      activeBundleCount: Number(activeBundleRow?.count ?? 0),
      modifierGroupCount: Number(modRow?.count ?? 0),
      branchStockCount: Number(stockRow?.count ?? 0),
    };
  });

export interface RecipeReactivateImpact {
  deletedChildCount: number;
  inactiveChildCount: number;
}

// For reactivate warnings: does this (bundle) recipe contain Deleted/Inactive children?
export const getRecipeReactivateImpact = createServerFn({ method: "GET" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }): Promise<RecipeReactivateImpact> => {
    await requireRole("super_admin", "admin_pusat");

    const [[delRow], [inactRow]] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)` })
        .from(recipeChildRecipes)
        .innerJoin(recipes, eq(recipeChildRecipes.childRecipeId, recipes.id))
        .where(and(eq(recipeChildRecipes.parentRecipeId, data.id), eq(recipes.status, "Deleted")))
        .limit(1),
      db
        .select({ count: sql<number>`count(*)` })
        .from(recipeChildRecipes)
        .innerJoin(recipes, eq(recipeChildRecipes.childRecipeId, recipes.id))
        .where(and(eq(recipeChildRecipes.parentRecipeId, data.id), eq(recipes.status, "Inactive")))
        .limit(1),
    ]);

    return {
      deletedChildCount: Number(delRow?.count ?? 0),
      inactiveChildCount: Number(inactRow?.count ?? 0),
    };
  });

// Delete (soft tombstone): → Deleted. super_admin only; UI-irreversible (restore is
// DB-only). Blocked only when the recipe is a child of an Active bundle — that would
// silently break a live, sellable product's BOM. All other references are warnings,
// surfaced by getRecipeDeleteImpact in the confirm modal.
// User-parameterized core (ADR-0015). Mirrors the wrapper's requireRole guard
// (super_admin only).
export async function deleteRecipeCore(user: AppUser, data: { id: string }) {
  if (user.role !== "super_admin") {
    throw new Error(
      `Forbidden: insufficient role (user ${user.id} has role "${user.role}", required: super_admin)`,
    );
  }

  const [old] = await db.select().from(recipes).where(eq(recipes.id, data.id)).limit(1);
  if (!old) throw new Error("Recipe not found");

  const [activeBundleRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(recipeChildRecipes)
    .innerJoin(recipes, eq(recipeChildRecipes.parentRecipeId, recipes.id))
    .where(and(eq(recipeChildRecipes.childRecipeId, data.id), eq(recipes.status, "Active")))
    .limit(1);

  const activeBundleCount = Number(activeBundleRow?.count ?? 0);
  if (activeBundleCount > 0) {
    throw new Error(
      `Tidak dapat menghapus resep yang digunakan dalam ${activeBundleCount} paket aktif. Nonaktifkan paket terlebih dahulu.`,
    );
  }

  // Soft delete → tombstone. Row + history (orders, COGS, audit) preserved.
  // Restore is DB-only (ADR-0009); the Storage image is kept so a DB restore
  // retains the picture.
  const [result] = await db
    .update(recipes)
    .set({ status: "Deleted", updatedAt: new Date() })
    .where(eq(recipes.id, data.id))
    .returning();

  await logSystemAction(
    user,
    "Delete Recipe",
    `Resep "${old.name}" dihapus secara permanen oleh ${user.name}`,
  );
  await logAudit(user, "recipes", data.id, "DELETE", old, result);

  return { success: true };
}

export const deleteRecipe = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin");
    return deleteRecipeCore(user, data);
  });

// =============================================================================
// ASSIGN RECIPE (FINISHED-GOOD) STOCK — production into a branch
// =============================================================================
//
// Super Admin / Admin Pusat produce a new recipe's finished units and stock
// them at a branch (typically Central Warehouse). This writes the movement to
// Kartu Stok (stock_ledger) linked to the recipe so it is auditable alongside
// the ingredient-level movements. See FRD §4.2 (produksi → Kartu Stok).

// User-parameterized core (ADR-0015). Mirrors the wrapper's requireRole guard.
export async function assignRecipeStockCore(
  user: AppUser,
  data: { recipeId: string; quantity: number; branchId?: string; notes?: string },
) {
  if (user.role !== "super_admin" && user.role !== "admin_pusat") {
    throw new Error(
      `Forbidden: insufficient role (user ${user.id} has role "${user.role}", required: super_admin | admin_pusat)`,
    );
  }

  if (!Number.isFinite(data.quantity) || data.quantity <= 0) {
    throw new Error("Jumlah stok harus lebih dari 0");
  }

  const [recipe] = await db
    .select({ id: recipes.id, name: recipes.name, code: recipes.code })
    .from(recipes)
    .where(eq(recipes.id, data.recipeId))
    .limit(1);
  if (!recipe) throw new Error("Resep tidak ditemukan");

  // Resolve target branch: must be Central Warehouse.
  // This feature is restricted to Central Warehouse only.
  const [central] = await db
    .select({ id: branches.id, name: branches.name })
    .from(branches)
    .where(eq(branches.type, "Central"))
    .limit(1);
  if (!central) throw new Error("Cabang Pusat (Central Warehouse) tidak ditemukan");

  // If branchId is provided, validate it's the Central Warehouse
  if (data.branchId && data.branchId !== central.id) {
    throw new Error(
      "Produksi resep hanya bisa dilakukan di Central Warehouse. " +
        "Gunakan Central Warehouse atau hapus branchId untuk menggunakan default.",
    );
  }

  const targetBranchId = central.id;

  // Fetch recipe BOM (ingredients list) to deduct from inventory
  const bomItems = await db
    .select({
      ingredientId: recipeIngredients.ingredientId,
      quantity: recipeIngredients.quantity,
      ingredientName: ingredients.name,
      stockUnit: ingredients.stockUnit,
    })
    .from(recipeIngredients)
    .leftJoin(ingredients, eq(recipeIngredients.ingredientId, ingredients.id))
    .where(eq(recipeIngredients.recipeId, data.recipeId));

  // Validate all ingredients have sufficient stock
  const insufficientStock: string[] = [];
  for (const bom of bomItems) {
    const requiredQty = bom.quantity * data.quantity;
    const [inv] = await db
      .select({ quantity: inventory.quantity })
      .from(inventory)
      .where(
        and(eq(inventory.branchId, targetBranchId), eq(inventory.ingredientId, bom.ingredientId)),
      )
      .limit(1);

    const currentQty = inv?.quantity ?? 0;
    if (currentQty < requiredQty) {
      insufficientStock.push(
        `${bom.ingredientName}: perlu ${requiredQty}${bom.stockUnit ?? ""}, tersedia ${currentQty}${bom.stockUnit ?? ""}`,
      );
    }
  }

  if (insufficientStock.length > 0) {
    throw new Error(
      `Stok bahan tidak cukup di Central Warehouse:\n${insufficientStock.join("\n")}`,
    );
  }

  // Production note reference for Kartu Stok traceability.
  const ref = `PROD-${recipe.code || recipe.id.slice(0, 4)}-${Date.now().toString(36).toUpperCase()}`;
  const ledgerNotes = `Produksi ${recipe.name}${data.notes ? ` (${data.notes})` : ""}`;

  // Deduct ingredients from Central Warehouse inventory (OUT)
  for (const bom of bomItems) {
    const requiredQty = bom.quantity * data.quantity;

    const [inv] = await db
      .select()
      .from(inventory)
      .where(
        and(eq(inventory.branchId, targetBranchId), eq(inventory.ingredientId, bom.ingredientId)),
      )
      .limit(1);

    if (!inv) {
      throw new Error(`Inventory tidak ditemukan untuk ${bom.ingredientName} di Central Warehouse`);
    }

    const newIngredientBalance = inv.quantity - requiredQty;

    // Update ingredient inventory
    await db
      .update(inventory)
      .set({ quantity: newIngredientBalance, lastUpdated: new Date() })
      .where(eq(inventory.id, inv.id));

    // Write ingredient OUT entry to Kartu Stok
    await db.insert(stockLedger).values({
      branchId: targetBranchId,
      ingredientId: bom.ingredientId,
      type: "OUT",
      quantity: Math.round(requiredQty),
      balance: Math.round(newIngredientBalance),
      reference: ref,
      notes: `${ledgerNotes} - ${bom.ingredientName}`,
    });
  }

  // Upsert recipeInventory for (recipeId, branchId).
  const [existing] = await db
    .select()
    .from(recipeInventory)
    .where(
      and(
        eq(recipeInventory.recipeId, data.recipeId),
        eq(recipeInventory.branchId, targetBranchId),
      ),
    )
    .limit(1);

  const newRecipeBalance = (existing?.quantity ?? 0) + data.quantity;
  if (existing) {
    await db
      .update(recipeInventory)
      .set({ quantity: newRecipeBalance, lastUpdated: new Date() })
      .where(eq(recipeInventory.id, existing.id));
  } else {
    await db.insert(recipeInventory).values({
      recipeId: data.recipeId,
      branchId: targetBranchId,
      quantity: data.quantity,
    });
  }

  // Write recipe IN entry to Kartu Stok
  await db.insert(stockLedger).values({
    branchId: targetBranchId,
    recipeId: data.recipeId,
    type: "IN",
    quantity: Math.round(data.quantity),
    balance: Math.round(newRecipeBalance),
    reference: ref,
    notes: ledgerNotes,
  });

  await logSystemAction(
    user,
    "Assign Recipe Stock",
    `Stok resep "${recipe.name}" +${data.quantity} di Central Warehouse oleh ${user.name}. Bahan: ${bomItems.map((b) => b.ingredientName).join(", ")}`,
  );
  await logAudit(
    user,
    "recipeInventory",
    `${data.recipeId}:${targetBranchId}`,
    "CREATE",
    undefined,
    {
      recipeId: data.recipeId,
      branchId: targetBranchId,
      quantity: data.quantity,
      reference: ref,
      ingredientsDeducted: bomItems.map((b) => ({
        ingredientId: b.ingredientId,
        name: b.ingredientName,
        quantityUsed: b.quantity * data.quantity,
      })),
    },
  );

  return {
    success: true,
    recipeId: data.recipeId,
    branchId: targetBranchId,
    quantity: data.quantity,
    reference: ref,
    ingredientsDeducted: bomItems.map((b) => ({
      ingredientId: b.ingredientId,
      name: b.ingredientName,
      quantityUsed: b.quantity * data.quantity,
    })),
  };
}

export const assignRecipeStock = createServerFn({ method: "POST" })
  .validator(
    (data: { recipeId: string; quantity: number; branchId?: string; notes?: string }) => data,
  )
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");
    return assignRecipeStockCore(user, data);
  });
