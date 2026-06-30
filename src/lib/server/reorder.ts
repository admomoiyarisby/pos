import { createServerFn } from "@tanstack/react-start";
import { db } from "#/lib/server/db";
import { ingredients, stockLedger, appSettings } from "#/db/schema";
import { eq, and, gte } from "drizzle-orm";
import { requireRole } from "./auth";

async function getReorderDays(): Promise<{ ropDays: number; roqDays: number }> {
  const [ropSetting] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, "reorder_rop_days"))
    .limit(1);
  const [roqSetting] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, "reorder_roq_days"))
    .limit(1);
  return {
    ropDays: Number(ropSetting?.value ?? 3),
    roqDays: Number(roqSetting?.value ?? 5),
  };
}

export const getReorderSettings = createServerFn({ method: "GET" }).handler(async () => {
  await requireRole("super_admin", "admin_pusat");
  return getReorderDays();
});

export const updateReorderSettings = createServerFn({ method: "POST" })
  .validator((data: { ropDays: number; roqDays: number }) => data)
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");

    for (const [key, value] of [
      ["reorder_rop_days", String(data.ropDays)],
      ["reorder_roq_days", String(data.roqDays)],
    ] as const) {
      const [existing] = await db
        .select({ id: appSettings.id })
        .from(appSettings)
        .where(eq(appSettings.key, key))
        .limit(1);

      if (existing) {
        await db
          .update(appSettings)
          .set({ value: value, updatedBy: user.id, updatedAt: new Date() })
          .where(eq(appSettings.id, existing.id));
      } else {
        await db.insert(appSettings).values({
          key,
          value,
          description:
            key === "reorder_rop_days"
              ? "Reorder Point safety stock days"
              : "Reorder Order Quantity supply days",
          updatedBy: user.id,
        });
      }
    }

    return { success: true };
  });

/**
 * Server function: Generate reorder recommendations for all ingredients in a branch.
 * Calculates ROP and ROQ from 30-day usage based on configurable days settings.
 * Returns list of ingredients with suggested order quantities.
 */
export const generateReorderRecommendations = createServerFn({ method: "POST" })
  .validator((data: { branchId: string }) => data)
  .handler(async ({ data }) => {
    await requireRole("super_admin", "admin_pusat", "branch_admin");

    const { ropDays, roqDays } = await getReorderDays();
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
      const recommendedQty = Math.ceil(avgDaily * roqDays);
      const roq = Math.ceil(recommendedQty / ing.moq) * ing.moq;
      const rop = Math.ceil(avgDaily * ropDays);

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
