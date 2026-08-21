import { createServerFn } from "@tanstack/react-start";
import { db } from "#/lib/server/db";
import { recipes, categories, recipeBranches } from "#/db/schema";
import { and, eq, inArray, ne, sql, type SQL } from "drizzle-orm";
import { requireAuth, requireRole, getCurrentUserRaw } from "./auth";
import { logSystemAction } from "./logging";
import { branchVisibleClause } from "#/lib/server/branch-visibility";
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
    // ADR-0009 mirror: tombstoned (Deleted) recipes never appear in the UI, so
    // they must not inflate the per-category menu count either.
    .where(ne(recipes.status, "Deleted"))
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
    const user = await getCurrentUserRaw();

    // Branch visibility: a branch-scoped caller sees only recipes allowed at
    // their branch; a recipe with no recipe_branches rows is visible everywhere.
    // ADR-0009 mirror: tombstoned (Deleted) recipes never appear in the UI.
    const whereConditions: SQL[] = [
      eq(recipes.categoryId, data.categoryId),
      ne(recipes.status, "Deleted"),
    ];
    const branchClause = branchVisibleClause({
      linkTable: recipeBranches,
      linkRowId: recipeBranches.recipeId,
      rowId: recipes.id,
      linkBranchId: recipeBranches.branchId,
      currentBranchId: user?.branchId,
    });
    if (branchClause) whereConditions.push(branchClause);

    const rows = await db
      .select({
        id: recipes.id,
        code: recipes.code,
        name: recipes.name,
        status: recipes.status,
      })
      .from(recipes)
      .where(and(...whereConditions))
      .orderBy(recipes.name);

    return rows;
  });

const assignRecipesToCategoryInput = z.object({
  categoryId: z.string().uuid(),
  recipeIds: z.array(z.string().uuid()),
  removedRecipeIds: z.array(z.string().uuid()).default([]),
  destinationCategoryId: z.string().uuid().optional(),
});

export const assignRecipesToCategory = createServerFn({ method: "POST" })
  .validator((data: z.input<typeof assignRecipesToCategoryInput>) =>
    assignRecipesToCategoryInput.parse(data),
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

const createCategoryInput = z.object({
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(100),
});

export const createCategory = createServerFn({ method: "POST" })
  .validator((data: z.input<typeof createCategoryInput>) => createCategoryInput.parse(data))
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

const deleteCategoryInput = z.object({
  categoryId: z.string().uuid(),
  destinationCategoryId: z.string().uuid(),
});

export const deleteCategory = createServerFn({ method: "POST" })
  .validator((data: z.input<typeof deleteCategoryInput>) => deleteCategoryInput.parse(data))
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
