import { createServerFn } from "@tanstack/react-start";
import { db } from "#/lib/server/db";
import { recipes } from "#/db/schema";
import { eq, inArray, sql } from "drizzle-orm";
import { requireAuth, requireRole } from "./auth";
import { logSystemAction } from "./logging";
import { z } from "zod";

// The canonical list of recipe categories
const CATEGORIES = [
  { code: "makanan", name: "Makanan" },
  { code: "minuman", name: "Minuman" },
  { code: "snack", name: "Snack" },
  { code: "add_ons", name: "Add-Ons" },
  { code: "paket_bundle", name: "Paket / Bundle" },
] as const;

export type CategoryInfo = (typeof CATEGORIES)[number] & { recipeCount: number };

export const getCategories = createServerFn({ method: "GET" }).handler(async () => {
  await requireAuth();

  const counts = await db
    .select({
      category: recipes.category,
      count: sql<number>`count(*)`,
    })
    .from(recipes)
    .groupBy(recipes.category);

  const countMap = Object.fromEntries(counts.map((r) => [r.category, Number(r.count)]));

  return CATEGORIES.map((c) => ({
    ...c,
    recipeCount: countMap[c.code] ?? 0,
  }));
});

export const getCategoryRecipes = createServerFn({ method: "GET" })
  .validator((data: { category: string }) => data)
  .handler(async ({ data }) => {
    await requireAuth();

    const rows = await db
      .select({
        id: recipes.id,
        code: recipes.code,
        name: recipes.name,
        status: recipes.status,
      })
      .from(recipes)
      .where(eq(recipes.category, data.category as any))
      .orderBy(recipes.name);

    return rows;
  });

export const assignRecipesToCategory = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z
      .object({
        category: z.enum(["makanan", "minuman", "snack", "add_ons", "paket_bundle"]),
        recipeIds: z.array(z.string().uuid()),
        // Recipes removed from this category must be moved somewhere
        removedRecipeIds: z.array(z.string().uuid()).default([]),
        destinationCategory: z
          .enum(["makanan", "minuman", "snack", "add_ons", "paket_bundle"])
          .optional(),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");

    await db.transaction(async (tx) => {
      // Assign selected recipes to this category
      if (data.recipeIds.length > 0) {
        await tx
          .update(recipes)
          .set({ category: data.category })
          .where(inArray(recipes.id, data.recipeIds));
      }

      // Move unlinked recipes to destination category
      if (data.removedRecipeIds.length > 0 && data.destinationCategory) {
        await tx
          .update(recipes)
          .set({ category: data.destinationCategory })
          .where(inArray(recipes.id, data.removedRecipeIds));
      }
    });

    await logSystemAction(
      user,
      "Assign Recipes to Category",
      `${data.recipeIds.length} menu ke "${data.category}"${data.removedRecipeIds.length > 0 && data.destinationCategory ? `, ${data.removedRecipeIds.length} menu pindah ke "${data.destinationCategory}"` : ""} oleh ${user.name}`,
    );

    return { success: true };
  });
