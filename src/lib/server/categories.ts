import { createServerFn } from "@tanstack/react-start";
import { db } from "#/lib/server/db";
import { recipes, categories } from "#/db/schema";
import { eq, inArray, sql } from "drizzle-orm";
import { requireAuth, requireRole } from "./auth";
import { logSystemAction } from "./logging";
import { z } from "zod";

export type CategoryInfo = {
  id: string;
  code: string;
  name: string;
  recipeCount: number;
};

export const getCategories = createServerFn({ method: "GET" }).handler(async () => {
  await requireAuth();

  const counts = await db
    .select({
      categoryId: recipes.categoryId,
      count: sql<number>`count(*)`,
    })
    .from(recipes)
    .groupBy(recipes.categoryId);

  const countMap = Object.fromEntries(counts.map((r) => [r.categoryId, Number(r.count)]));

  const cats = await db.select().from(categories).orderBy(categories.name);

  return cats.map((c) => ({
    id: c.id,
    code: c.code,
    name: c.name,
    recipeCount: countMap[c.id] ?? 0,
  }));
});

export const getCategoryRecipes = createServerFn({ method: "GET" })
  .validator((data: { categoryId: string }) => data)
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
      .where(eq(recipes.categoryId, data.categoryId))
      .orderBy(recipes.name);

    return rows;
  });

export const assignRecipesToCategory = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z
      .object({
        categoryId: z.string().uuid(),
        recipeIds: z.array(z.string().uuid()),
        removedRecipeIds: z.array(z.string().uuid()).default([]),
        destinationCategoryId: z.string().uuid().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");

    await db.transaction(async (tx) => {
      if (data.recipeIds.length > 0) {
        await tx
          .update(recipes)
          .set({ categoryId: data.categoryId })
          .where(inArray(recipes.id, data.recipeIds));
      }

      if (data.removedRecipeIds.length > 0 && data.destinationCategoryId) {
        await tx
          .update(recipes)
          .set({ categoryId: data.destinationCategoryId })
          .where(inArray(recipes.id, data.removedRecipeIds));
      }
    });

    const cat = await db
      .select({ name: categories.name })
      .from(categories)
      .where(eq(categories.id, data.categoryId))
      .then((r) => r[0]);

    const destCat = data.destinationCategoryId
      ? await db
          .select({ name: categories.name })
          .from(categories)
          .where(eq(categories.id, data.destinationCategoryId))
          .then((r) => r[0])
      : null;

    await logSystemAction(
      user,
      "Assign Recipes to Category",
      `${data.recipeIds.length} menu ke "${cat?.name ?? data.categoryId}"${data.removedRecipeIds.length > 0 && destCat ? `, ${data.removedRecipeIds.length} menu pindah ke "${destCat.name}"` : ""} oleh ${user.name}`,
    );

    return { success: true };
  });

export const createCategory = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z
      .object({
        code: z.string().min(1).max(50),
        name: z.string().min(1).max(100),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");

    const [cat] = await db
      .insert(categories)
      .values({ code: data.code, name: data.name })
      .returning({ id: categories.id, code: categories.code, name: categories.name });

    await logSystemAction(
      user,
      "Create Category",
      `Kategori "${cat.name}" (${cat.code}) dibuat oleh ${user.name}`,
    );

    return { category: cat };
  });

export const deleteCategory = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z
      .object({
        categoryId: z.string().uuid(),
        destinationCategoryId: z.string().uuid(),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");

    const cat = await db
      .select({ name: categories.name, code: categories.code })
      .from(categories)
      .where(eq(categories.id, data.categoryId))
      .then((r) => r[0]);

    if (!cat) {
      return { success: false, error: "Kategori tidak ditemukan" };
    }

    await db.transaction(async (tx) => {
      // Reassign orphaned recipes to destination category
      await tx
        .update(recipes)
        .set({ categoryId: data.destinationCategoryId })
        .where(eq(recipes.categoryId, data.categoryId));

      // Delete the category
      await tx.delete(categories).where(eq(categories.id, data.categoryId));
    });

    await logSystemAction(
      user,
      "Delete Category",
      `Kategori "${cat.name}" (${cat.code}) dihapus oleh ${user.name}`,
    );

    return { success: true };
  });
