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
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");

    if (data.recipeIds.length > 0) {
      await db
        .update(recipes)
        .set({ category: data.category })
        .where(inArray(recipes.id, data.recipeIds));
    }

    await logSystemAction(
      user,
      "Assign Recipes to Category",
      `${data.recipeIds.length} menu dipindahkan ke kategori "${data.category}" oleh ${user.name}`,
    );

    return { success: true };
  });
