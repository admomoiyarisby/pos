import { createServerFn } from "@tanstack/react-start";
import { db } from "#/lib/server/db";
import { ingredients, recipeIngredients, ingredientBranches } from "#/db/schema";
import { eq, and, ne } from "drizzle-orm";
import { fuzzySearch, fuzzyRank } from "./fuzzy";
import { requireAuth, requireRole, getCurrentUserRaw } from "./auth";
import { logSystemAction, logAudit } from "./logging";
import { recalculateRecipeCostsForIngredient } from "./cost-rollup";
import { branchVisibleClause } from "#/lib/server/branch-visibility";
import { z } from "zod";
import { sql } from "drizzle-orm";

const ingredientInput = z.object({
  code: z.string().min(1).max(30),
  name: z.string().min(1).max(100),
  category: z.enum(["Fresh", "Dry", "Packaging"]),
  skuType: z.enum(["RM", "SFG", "FG"]),
  purchaseUnit: z.string().min(1),
  stockUnit: z.string().min(1),
  conversionFactor: z.number().int().min(1),
  averageCost: z.number().int().min(0),
  plannedCost: z.number().int().min(0).optional(),
  rop: z.number().int().min(0).default(0),
  roq: z.number().int().min(0).default(0),
  moq: z.number().int().min(1).default(1),
  countable: z.boolean().default(true),
  branchIds: z.array(z.string().uuid()).optional().nullable(),
});

export const getIngredients = createServerFn({ method: "GET" })
  .validator(
    (data: {
      search?: string;
      category?: "Fresh" | "Dry" | "Packaging" | null;
      skuType?: "RM" | "SFG" | "FG" | null;
      excludeNasi?: boolean; // Hide Nasi from non-stock-opname contexts
    }) => data,
  )
  .handler(async ({ data }) => {
    await requireAuth();

    const user = await getCurrentUserRaw();
    const currentBranchId = user?.branchId;

    // Build conditions list, then apply all at once (mirrors getRecipes).
    const conditions: import("drizzle-orm").SQL[] = [];

    // ADR-0009 mirror: tombstoned (Deleted) ingredients never appear in lists.
    // Inactive stays visible (search/sort/filter); only Deleted is hidden.
    conditions.push(ne(ingredients.status, "Deleted"));
    if (data.search) {
      conditions.push(fuzzySearch([ingredients.name, ingredients.code], data.search));
    }
    if (data.category) {
      conditions.push(eq(ingredients.category, data.category));
    }
    if (data.skuType) {
      conditions.push(eq(ingredients.skuType, data.skuType));
    }
    if (data.excludeNasi) {
      conditions.push(eq(ingredients.isNasi, false));
    }

    // Branch visibility gate (mirrors getRecipes / getPosMenu): a branch-scoped
    // caller sees only ingredients allowed at their branch; an ingredient with
    // no ingredient_branches rows is visible everywhere (NULL = all branches).
    const branchClause = branchVisibleClause({
      linkTable: ingredientBranches,
      linkRowId: ingredientBranches.ingredientId,
      rowId: ingredients.id,
      linkBranchId: ingredientBranches.branchId,
      currentBranchId,
    });
    if (branchClause) conditions.push(branchClause);

    const result = await db
      .select()
      .from(ingredients)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(
        data.search
          ? fuzzyRank([ingredients.name, ingredients.code], data.search)
          : ingredients.name,
      );

    // Branch admins must never see the stock HPP (averageCost / plannedCost).
    // The ingredient master pages are role-gated, but the same serializer is
    // used by branch-facing flows (procurement request form, waste combobox,
    // Mutasi detail), so strip the cost fields at the view/serializer layer.
    if (user?.role === "branch_admin") {
      return result.map((ing) => ({
        ...ing,
        averageCost: 0,
        plannedCost: ing.plannedCost === null ? null : 0,
      }));
    }

    return result;
  });

export const getIngredient = createServerFn({ method: "GET" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    await requireAuth();
    const user = await getCurrentUserRaw();

    // Branch visibility: a branch-scoped caller must not deep-link to an
    // ingredient restricted from their branch. Reusing the shared clause makes a
    // restricted row return no result → null.
    const branchClause = branchVisibleClause({
      linkTable: ingredientBranches,
      linkRowId: ingredientBranches.ingredientId,
      rowId: ingredients.id,
      linkBranchId: ingredientBranches.branchId,
      currentBranchId: user?.branchId,
    });

    const [result] = await db
      .select()
      .from(ingredients)
      .where(and(eq(ingredients.id, data.id), ne(ingredients.status, "Deleted"), branchClause))
      .limit(1);
    if (!result) return null;

    const branchLinks = await db
      .select({ branchId: ingredientBranches.branchId })
      .from(ingredientBranches)
      .where(eq(ingredientBranches.ingredientId, data.id));

    return { ...result, branchIds: branchLinks.map((b) => b.branchId) };
  });

export const createIngredient = createServerFn({ method: "POST" })
  .validator((data: z.input<typeof ingredientInput>) => ingredientInput.parse(data))
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat", "central_kitchen");

    const { branchIds, ...ingredientValues } = data;
    const [result] = await db.insert(ingredients).values(ingredientValues).returning();

    if (branchIds?.length) {
      await db
        .insert(ingredientBranches)
        .values(branchIds.map((branchId) => ({ ingredientId: result.id, branchId })));
    }

    await logSystemAction(
      user,
      "Create Ingredient",
      `Bahan baku "${result.name}" (${result.code}) dibuat oleh ${user.name}`,
    );
    await logAudit(user, "ingredients", result.id, "CREATE", undefined, result);

    return result;
  });

// Same partial-update trap as updateRecipe: `ingredientInput` defaults
// rop/roq/moq/countable, and zod re-applies those defaults for keys absent from
// a `.partial()` payload. The list page's status toggle only sends
// `{ id, status }`, which used to silently reset ROP/ROQ/MOQ/countable to their
// defaults. Strip the defaulted keys and re-add them as plain optionals.
const updateIngredientInput = ingredientInput
  .omit({ rop: true, roq: true, moq: true, countable: true })
  .partial()
  .extend({
    id: z.string().uuid(),
    status: z.enum(["Active", "Inactive"]).optional(),
    rop: z.number().int().min(0).optional(),
    roq: z.number().int().min(0).optional(),
    moq: z.number().int().min(1).optional(),
    countable: z.boolean().optional(),
  });

export const updateIngredient = createServerFn({ method: "POST" })
  .validator((data: z.input<typeof updateIngredientInput>) => updateIngredientInput.parse(data))
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat", "central_kitchen");

    const { id, branchIds, ...updates } = data;

    const [old] = await db.select().from(ingredients).where(eq(ingredients.id, id)).limit(1);

    const [result] = await db
      .update(ingredients)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(ingredients.id, id))
      .returning();

    // Update branch visibility (mirrors updateRecipe): empty array = all branches.
    if (branchIds !== undefined && branchIds !== null) {
      await db.delete(ingredientBranches).where(eq(ingredientBranches.ingredientId, id));
      if (branchIds.length > 0) {
        await db
          .insert(ingredientBranches)
          .values(branchIds.map((branchId) => ({ ingredientId: id, branchId })));
      }
    }

    // Trigger BOM cost roll-up if averageCost changed
    if ("averageCost" in updates) {
      await recalculateRecipeCostsForIngredient(id);
    }

    await logSystemAction(
      user,
      "Update Ingredient",
      `Bahan baku "${result.name}" diperbarui oleh ${user.name}`,
    );
    await logAudit(user, "ingredients", id, "UPDATE", old, result);

    return result;
  });

// =============================================================================
// DELETE INGREDIENT (SOFT DELETE)
// =============================================================================

const deleteIngredientInput = z.object({
  id: z.string().uuid(),
  hardDelete: z.boolean().default(false),
});

export const deleteIngredient = createServerFn({ method: "POST" })
  .validator((data: z.input<typeof deleteIngredientInput>) => deleteIngredientInput.parse(data))
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat", "central_kitchen");

    const { id, hardDelete } = data;

    // Check if ingredient is referenced in any recipe
    const [recipeRefCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(recipeIngredients)
      .where(eq(recipeIngredients.ingredientId, id))
      .limit(1);

    const referencedInRecipes = recipeRefCount?.count ?? 0;

    if (hardDelete && referencedInRecipes > 0) {
      throw new Error(
        `Cannot hard delete ingredient referenced in ${referencedInRecipes} recipe(s). Use soft delete or remove from recipes first.`,
      );
    }

    const [old] = await db.select().from(ingredients).where(eq(ingredients.id, id)).limit(1);

    if (!old) {
      throw new Error("Ingredient not found");
    }

    // Soft delete tombstone (ADR-0009 mirror): status → Deleted. The row is
    // preserved for historical references, hidden from every list, and restore
    // is DB-only (the UI never re-activates a Deleted ingredient).
    const [result] = await db
      .update(ingredients)
      .set({ status: "Deleted", updatedAt: new Date() })
      .where(eq(ingredients.id, id))
      .returning();

    await logSystemAction(
      user,
      "Delete Ingredient",
      `Bahan baku "${old.name}" (${old.code}) dihapus oleh ${user.name}`,
    );
    await logAudit(user, "ingredients", id, "DELETE", old, result);

    return { success: true, wasSoftDelete: true };
  });
