import { createServerFn } from "@tanstack/react-start";
import { db } from "#/lib/server/db";
import { ingredients, recipeIngredients } from "#/db/schema";
import { eq, ilike, and } from "drizzle-orm";
import { requireAuth, requireRole } from "./auth";
import { logSystemAction, logAudit } from "./logging";
import { recalculateRecipeCostsForIngredient } from "./cost-rollup";
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
});

export const getIngredients = createServerFn({ method: "GET" })
  .validator(
    (data: {
      search?: string;
      category?: "Fresh" | "Dry" | "Packaging" | null;
      skuType?: "RM" | "SFG" | "FG" | null;
    }) => data,
  )
  .handler(async ({ data }) => {
    await requireAuth();

    const conditions = [];
    if (data.search) {
      conditions.push(
        ilike(ingredients.name, `%${data.search}%`),
        ilike(ingredients.code, `%${data.search}%`),
      );
    }
    if (data.category) {
      conditions.push(eq(ingredients.category, data.category));
    }
    if (data.skuType) {
      conditions.push(eq(ingredients.skuType, data.skuType));
    }

    const result = await db
      .select()
      .from(ingredients)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(ingredients.name);

    return result;
  });

export const getIngredient = createServerFn({ method: "GET" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    await requireAuth();
    const [result] = await db
      .select()
      .from(ingredients)
      .where(eq(ingredients.id, data.id))
      .limit(1);
    return result ?? null;
  });

export const createIngredient = createServerFn({ method: "POST" })
  .validator((data: unknown) => ingredientInput.parse(data))
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat", "central_kitchen");

    const [result] = await db.insert(ingredients).values(data).returning();

    await logSystemAction(
      user,
      "Create Ingredient",
      `Bahan baku "${result.name}" (${result.code}) dibuat oleh ${user.name}`,
    );
    await logAudit(
      user,
      "ingredients",
      result.id,
      "CREATE",
      undefined,
      result as Record<string, unknown>,
    );

    return result;
  });

export const updateIngredient = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    ingredientInput.partial().extend({ id: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat", "central_kitchen");

    const { id, ...updates } = data;

    const [old] = await db.select().from(ingredients).where(eq(ingredients.id, id)).limit(1);

    const [result] = await db
      .update(ingredients)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(ingredients.id, id))
      .returning();

    // Trigger BOM cost roll-up if averageCost changed
    if ("averageCost" in updates) {
      await recalculateRecipeCostsForIngredient(id);
    }

    await logSystemAction(
      user,
      "Update Ingredient",
      `Bahan baku "${result.name}" diperbarui oleh ${user.name}`,
    );
    await logAudit(
      user,
      "ingredients",
      id,
      "UPDATE",
      old as Record<string, unknown>,
      result as Record<string, unknown>,
    );

    return result;
  });

// =============================================================================
// DELETE INGREDIENT (SOFT DELETE)
// =============================================================================

export const deleteIngredient = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z.object({ id: z.string().uuid(), hardDelete: z.boolean().default(false) }).parse(data),
  )
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

    // Soft delete by setting status to Inactive
    const [result] = await db
      .update(ingredients)
      .set({ status: "Inactive", updatedAt: new Date() })
      .where(eq(ingredients.id, id))
      .returning();

    await logSystemAction(
      user,
      "Delete Ingredient",
      `Bahan baku "${old.name}" (${old.code}) dihapus oleh ${user.name}`,
    );
    await logAudit(
      user,
      "ingredients",
      id,
      "DELETE",
      old as Record<string, unknown>,
      result as Record<string, unknown>,
    );

    return { success: true, wasSoftDelete: true };
  });
