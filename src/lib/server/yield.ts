import { createServerFn } from "@tanstack/react-start";
import { db } from "#/lib/server/db";
import { yieldConversions, yieldConversionSources, ingredients, stockLedger, inventory } from "#/db/schema";
import { recalculateRecipeCostsForIngredient } from "./cost-rollup";
import { eq, and, inArray } from "drizzle-orm";
import { requireRole } from "./auth";
import { logSystemAction, logAudit } from "./logging";

export const getYieldConversions = createServerFn({ method: "GET" })
  .inputValidator((data: { branchId?: string }) => data)
  .handler(async ({ data: _data }) => {
    await requireRole("super_admin", "central_kitchen");

    const result = await db
      .select({
        id: yieldConversions.id,
        branchId: yieldConversions.branchId,
        sourceIngredientId: yieldConversions.sourceIngredientId,
        sourceQuantity: yieldConversions.sourceQuantity,
        targetIngredientId: yieldConversions.targetIngredientId,
        targetQuantity: yieldConversions.targetQuantity,
        yieldPercentage: yieldConversions.yieldPercentage,
        shrinkageQuantity: yieldConversions.shrinkageQuantity,
        notes: yieldConversions.notes,
        createdAt: yieldConversions.createdAt,
        sourceName: ingredients.name,
        targetName: ingredients.name,
      })
      .from(yieldConversions)
      .leftJoin(ingredients, eq(yieldConversions.sourceIngredientId, ingredients.id))
      .orderBy(yieldConversions.createdAt);

    // Get target names separately since we can only join once
    const targetIds = [...new Set(result.map((r) => r.targetIngredientId))];
    const targetNames: Record<string, string> = {};
    for (const id of targetIds) {
      const [ing] = await db
        .select({ name: ingredients.name })
        .from(ingredients)
        .where(eq(ingredients.id, id))
        .limit(1);
      if (ing) targetNames[id] = ing.name;
    }

    // Fetch multi-source entries for all conversions
    const conversionIds = result.map((r) => r.id);
    let sources: {
      yieldConversionId: string;
      ingredientId: string;
      quantity: number;
      ingredientName: string | null;
    }[] = [];
    if (conversionIds.length > 0) {
      const rawSources = await db
        .select({
          yieldConversionId: yieldConversionSources.yieldConversionId,
          ingredientId: yieldConversionSources.ingredientId,
          quantity: yieldConversionSources.quantity,
          ingredientName: ingredients.name,
        })
        .from(yieldConversionSources)
        .leftJoin(ingredients, eq(yieldConversionSources.ingredientId, ingredients.id))
        .where(inArray(yieldConversionSources.yieldConversionId, conversionIds));
      sources = rawSources;
    }

    // Group sources by conversion id
    const sourcesByConversion: Record<string, typeof sources> = {};
    for (const s of sources) {
      if (!sourcesByConversion[s.yieldConversionId]) sourcesByConversion[s.yieldConversionId] = [];
      sourcesByConversion[s.yieldConversionId].push(s);
    }

    return result.map((r) => ({
      ...r,
      targetName: targetNames[r.targetIngredientId] ?? r.targetIngredientId,
      sources: sourcesByConversion[r.id] ?? [],
    }));
  });

export const createYieldConversion = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      branchId: string;
      // Single source (legacy) — optional
      sourceIngredientId?: string;
      sourceQuantity?: number;
      // Multi-source — use this for new conversions
      sources?: { ingredientId: string; quantity: number }[];
      targetIngredientId: string;
      targetQuantity: number;
      notes?: string;
    }) => data,
  )
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "central_kitchen");

    // Determine source items: prefer multi-source, fall back to single source
    const sourceItems = data.sources && data.sources.length > 0
      ? data.sources
      : data.sourceIngredientId && data.sourceQuantity
        ? [{ ingredientId: data.sourceIngredientId, quantity: data.sourceQuantity }]
        : [];

    if (sourceItems.length === 0) {
      throw new Error("Setidaknya satu bahan mentah diperlukan");
    }

    // Fetch all source ingredients
    const sourceIngIds = sourceItems.map((s) => s.ingredientId);
    const sourceIngs = await db
      .select()
      .from(ingredients)
      .where(inArray(ingredients.id, sourceIngIds));

    const sourceMap = new Map(sourceIngs.map((i) => [i.id, i]));
    const missingIds = sourceIngIds.filter((id) => !sourceMap.has(id));
    if (missingIds.length > 0) {
      throw new Error(`Bahan tidak ditemukan: ${missingIds.join(", ")}`);
    }

    // Calculate total source cost across all sources
    let totalSourceCost = 0;
    let totalSourceQuantity = 0;
    for (const item of sourceItems) {
      const ing = sourceMap.get(item.ingredientId)!;
      totalSourceCost += ing.averageCost * item.quantity;
      totalSourceQuantity += item.quantity;
    }

    // Calculate new HPP for target (cost per unit)
    const newTargetCost =
      data.targetQuantity > 0 ? Math.round(totalSourceCost / data.targetQuantity) : 0;

    // Calculate yield percentage and shrinkage
    const yieldPercentage =
      totalSourceQuantity > 0
        ? Number(((data.targetQuantity / totalSourceQuantity) * 100).toFixed(2))
        : 0;
    const shrinkageQuantity = totalSourceQuantity - data.targetQuantity;

    // Fetch target ingredient name
    const [targetIng] = await db
      .select({ name: ingredients.name, id: ingredients.id })
      .from(ingredients)
      .where(eq(ingredients.id, data.targetIngredientId))
      .limit(1);
    if (!targetIng) throw new Error("Target ingredient not found");

    // Build source names for the note
    const sourceNamesStr = sourceItems
      .map((item) => {
        const ing = sourceMap.get(item.ingredientId);
        return `${ing?.name ?? item.ingredientId} (${item.quantity})`;
      })
      .join(" + ");

    // Use the first source as the legacy display source (for backward compat in DB)
    const firstSource = sourceItems[0];

    // Create yield conversion record
    const [conversion] = await db
      .insert(yieldConversions)
      .values({
        branchId: data.branchId,
        sourceIngredientId: firstSource.ingredientId,
        sourceQuantity: firstSource.quantity,
        targetIngredientId: data.targetIngredientId,
        targetQuantity: data.targetQuantity,
        yieldPercentage: String(yieldPercentage),
        shrinkageQuantity,
        notes: data.notes,
        processedBy: user.id,
      })
      .returning();

    // Insert multi-source junction rows if more than one source
    if (sourceItems.length > 1) {
      await db.insert(yieldConversionSources).values(
        sourceItems.map((item) => ({
          yieldConversionId: conversion.id,
          ingredientId: item.ingredientId,
          quantity: item.quantity,
        })),
      );
    }

    // Update target ingredient's averageCost
    await db
      .update(ingredients)
      .set({ averageCost: newTargetCost, updatedAt: new Date() })
      .where(eq(ingredients.id, data.targetIngredientId));

    // Deduct each source from inventory
    for (const item of sourceItems) {
      const ing = sourceMap.get(item.ingredientId)!;
      const [sourceInv] = await db
        .select()
        .from(inventory)
        .where(
          and(
            eq(inventory.branchId, data.branchId),
            eq(inventory.ingredientId, item.ingredientId),
          ),
        )
        .limit(1);

      let sourceBalance = 0;
      if (sourceInv) {
        sourceBalance = Math.max(0, sourceInv.quantity - item.quantity);
        await db
          .update(inventory)
          .set({ quantity: sourceBalance, lastUpdated: new Date() })
          .where(eq(inventory.id, sourceInv.id));
      }

      // Create ledger OUT for each source
      await db.insert(stockLedger).values({
        branchId: data.branchId,
        ingredientId: item.ingredientId,
        type: "OUT",
        quantity: item.quantity,
        balance: sourceBalance,
        reference: conversion.id,
        notes: `Yield: ${ing.name} → produksi${data.notes ? " (" + data.notes + ")" : ""}`,
      });
    }

    // Add target inventory
    const [targetInv] = await db
      .select()
      .from(inventory)
      .where(
        and(
          eq(inventory.branchId, data.branchId),
          eq(inventory.ingredientId, data.targetIngredientId),
        ),
      )
      .limit(1);

    let targetBalance = data.targetQuantity;
    if (targetInv) {
      targetBalance = targetInv.quantity + data.targetQuantity;
      await db
        .update(inventory)
        .set({ quantity: targetBalance, lastUpdated: new Date() })
        .where(eq(inventory.id, targetInv.id));
    } else {
      await db.insert(inventory).values({
        branchId: data.branchId,
        ingredientId: data.targetIngredientId,
        quantity: data.targetQuantity,
      });
    }

    // Create ledger IN for target
    await db.insert(stockLedger).values({
      branchId: data.branchId,
      ingredientId: data.targetIngredientId,
      type: "IN",
      quantity: data.targetQuantity,
      balance: targetBalance,
      reference: conversion.id,
      notes: `Yield: produksi → ${targetIng.name}${data.notes ? " (" + data.notes + ")" : ""}`,
    });

    // BOM Cost Roll-Up: Recalculate all recipes using the target ingredient
    await recalculateRecipeCostsForIngredient(data.targetIngredientId);

    await logSystemAction(
      user,
      "Create Yield Conversion",
      `Yield conversion "${sourceNamesStr} → ${targetIng.name}" (${data.targetQuantity}) dibuat oleh ${user.name}`,
    );
    await logAudit(
      user,
      "yieldConversions",
      conversion.id,
      "CREATE",
      undefined,
      conversion as Record<string, unknown>,
    );

    return {
      success: true,
      conversion,
      newTargetCost,
      yieldPercentage,
      shrinkageQuantity,
    };
  });
