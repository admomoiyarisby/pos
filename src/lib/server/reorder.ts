import { createServerFn } from "@tanstack/react-start";
import { db } from "#/db/index";
import { ingredients, stockLedger } from "#/db/schema";
import { eq, and, gte } from "drizzle-orm";
import { requireRole } from "./auth";

/**
 * Server function: Generate reorder recommendations for all ingredients in a branch.
 * Calculates ROP (3-day safety stock) and ROQ (5-day supply rounded to MOQ) from 30-day usage.
 * Returns list of ingredients with suggested order quantities.
 */
export const generateReorderRecommendations = createServerFn({ method: "POST" })
  .inputValidator((data: { branchId: string }) => data)
  .handler(async ({ data }) => {
    await requireRole("super_admin", "admin_pusat", "branch_admin");

    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
    const allIngredients = await db
      .select()
      .from(ingredients)
      .where(eq(ingredients.status, "Active"));

    const results: {
      ingredientId: string;
      ingredientName: string;
      ingredientCode: string;
      rop: number;
      roq: number;
      moq: number;
    }[] = [];

    for (const ing of allIngredients) {
      // Calculate 30-day average daily out
      const outEntries = await db
        .select({ quantity: stockLedger.quantity })
        .from(stockLedger)
        .where(
          and(
            eq(stockLedger.ingredientId, ing.id),
            eq(stockLedger.branchId, data.branchId),
            eq(stockLedger.type, "OUT"),
            gte(stockLedger.createdAt, thirtyDaysAgo),
          ),
        );

      const totalOut = outEntries.reduce((sum, e) => sum + e.quantity, 0);
      const avgDaily = totalOut / 30;
      const recommendedQty = Math.ceil(avgDaily * 5);
      const roq = Math.ceil(recommendedQty / ing.moq) * ing.moq;
      const rop = Math.ceil(avgDaily * 3);

      // Update ingredient with new values
      await db.update(ingredients).set({ rop, roq }).where(eq(ingredients.id, ing.id));

      results.push({
        ingredientId: ing.id,
        ingredientName: ing.name,
        ingredientCode: ing.code,
        rop,
        roq,
        moq: ing.moq,
      });
    }

    return results;
  });
