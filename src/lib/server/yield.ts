import { createServerFn } from "@tanstack/react-start";
import { db } from "#/db/index";
import { yieldConversions, ingredients, stockLedger, inventory } from "#/db/schema";
import { recalculateRecipeCostsForIngredient } from "./cost-rollup";
import { eq, and } from "drizzle-orm";
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

    return result.map((r) => ({
      ...r,
      targetName: targetNames[r.targetIngredientId] ?? r.targetIngredientId,
    }));
  });

export const createYieldConversion = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      branchId: string;
      sourceIngredientId: string;
      sourceQuantity: number;
      targetIngredientId: string;
      targetQuantity: number;
      notes?: string;
    }) => data,
  )
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "central_kitchen");

    // Get source ingredient cost
    const [sourceIng] = await db
      .select()
      .from(ingredients)
      .where(eq(ingredients.id, data.sourceIngredientId))
      .limit(1);

    if (!sourceIng) throw new Error("Source ingredient not found");

    // Calculate total source cost
    const totalSourceCost = sourceIng.averageCost * data.sourceQuantity;

    // Calculate new HPP for target (cost per unit)
    const newTargetCost =
      data.targetQuantity > 0 ? Math.round(totalSourceCost / data.targetQuantity) : 0;

    // Calculate yield percentage and shrinkage
    const yieldPercentage =
      data.sourceQuantity > 0
        ? Number(((data.targetQuantity / data.sourceQuantity) * 100).toFixed(2))
        : 0;
    const shrinkageQuantity = data.sourceQuantity - data.targetQuantity;

    // Fetch target ingredient name
    const [targetIng] = await db
      .select({ name: ingredients.name })
      .from(ingredients)
      .where(eq(ingredients.id, data.targetIngredientId))
      .limit(1);
    const targetName = targetIng?.name ?? data.targetIngredientId;

    // Create yield conversion record
    const [conversion] = await db
      .insert(yieldConversions)
      .values({
        branchId: data.branchId,
        sourceIngredientId: data.sourceIngredientId,
        sourceQuantity: data.sourceQuantity,
        targetIngredientId: data.targetIngredientId,
        targetQuantity: data.targetQuantity,
        yieldPercentage: String(yieldPercentage),
        shrinkageQuantity,
        notes: data.notes,
        processedBy: user.id,
      })
      .returning();

    // Update target ingredient's averageCost
    await db
      .update(ingredients)
      .set({ averageCost: newTargetCost, updatedAt: new Date() })
      .where(eq(ingredients.id, data.targetIngredientId));

    // Deduct source inventory
    const [sourceInv] = await db
      .select()
      .from(inventory)
      .where(
        and(
          eq(inventory.branchId, data.branchId),
          eq(inventory.ingredientId, data.sourceIngredientId),
        ),
      )
      .limit(1);

    let sourceBalance = 0;
    if (sourceInv) {
      sourceBalance = Math.max(0, sourceInv.quantity - data.sourceQuantity);
      await db
        .update(inventory)
        .set({ quantity: sourceBalance, lastUpdated: new Date() })
        .where(eq(inventory.id, sourceInv.id));
    }

    // Create ledger OUT for source
    await db.insert(stockLedger).values({
      branchId: data.branchId,
      ingredientId: data.sourceIngredientId,
      type: "OUT",
      quantity: data.sourceQuantity,
      balance: sourceBalance,
      reference: conversion.id,
      notes: `Yield: ${sourceIng.name} → produksi${data.notes ? " (" + data.notes + ")" : ""}`,
    });

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

    // Create ledger IN for target with same reference
    await db.insert(stockLedger).values({
      branchId: data.branchId,
      ingredientId: data.targetIngredientId,
      type: "IN",
      quantity: data.targetQuantity,
      balance: targetBalance,
      reference: conversion.id,
      notes: `Yield: produksi → ${targetName}${data.notes ? " (" + data.notes + ")" : ""}`,
    });

    // BOM Cost Roll-Up: Recalculate all recipes using the target ingredient
    await recalculateRecipeCostsForIngredient(data.targetIngredientId);

    await logSystemAction(
      user,
      "Create Yield Conversion",
      `Yield conversion "${sourceIng.name}" (${data.sourceQuantity} → ${data.targetQuantity}) dibuat oleh ${user.name}`,
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
