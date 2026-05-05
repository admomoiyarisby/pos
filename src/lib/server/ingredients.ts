import { createServerFn } from "@tanstack/react-start";
import { db } from "#/db/index";
import { ingredients } from "#/db/schema";
import { eq, ilike, and } from "drizzle-orm";
import { requireAuth, requireRole } from "./auth";
import { z } from "zod";

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
  .inputValidator(
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
  .inputValidator((data: { id: string }) => data)
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
  .inputValidator((data: unknown) => ingredientInput.parse(data))
  .handler(async ({ data }) => {
    await requireRole("super_admin", "admin_pusat", "central_kitchen");

    const [result] = await db.insert(ingredients).values(data).returning();
    return result;
  });

export const updateIngredient = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    ingredientInput.partial().extend({ id: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data }) => {
    await requireRole("super_admin", "admin_pusat", "central_kitchen");

    const { id, ...updates } = data;
    const [result] = await db
      .update(ingredients)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(ingredients.id, id))
      .returning();

    return result;
  });
