import { createServerFn } from "@tanstack/react-start";
import { db } from "#/lib/server/db";
import { yieldConversions, yieldConversionItems, ingredients } from "#/db/schema";
import { eq, inArray } from "drizzle-orm";
import { requireRole } from "./auth";
import { logSystemAction, logAudit } from "./logging";

export const getYieldConversions = createServerFn({ method: "GET" })
  .validator((data: { branchId?: string }) => data)
  .handler(async ({ data: _data }) => {
    await requireRole("super_admin", "central_kitchen");

    const conversions = await db
      .select({
        id: yieldConversions.id,
        branchId: yieldConversions.branchId,
        notes: yieldConversions.notes,
        productionDate: yieldConversions.productionDate,
        createdAt: yieldConversions.createdAt,
        processedBy: yieldConversions.processedBy,
      })
      .from(yieldConversions)
      .orderBy(yieldConversions.createdAt);

    // Fetch all items for these conversions, with ingredient names.
    const conversionIds = conversions.map((c) => c.id);
    let items: {
      conversionId: string;
      ingredientId: string;
      quantity: number;
      direction: "OUT" | "PRODUCED";
      ingredientName: string | null;
    }[] = [];
    if (conversionIds.length > 0) {
      items = await db
        .select({
          conversionId: yieldConversionItems.conversionId,
          ingredientId: yieldConversionItems.ingredientId,
          quantity: yieldConversionItems.quantity,
          direction: yieldConversionItems.direction,
          ingredientName: ingredients.name,
        })
        .from(yieldConversionItems)
        .leftJoin(ingredients, eq(yieldConversionItems.ingredientId, ingredients.id))
        .where(inArray(yieldConversionItems.conversionId, conversionIds));
    }

    const byConversion: Record<string, typeof items> = {};
    for (const it of items) {
      (byConversion[it.conversionId] ??= []).push(it);
    }

    return conversions.map((c) => {
      const convItems = byConversion[c.id] ?? [];
      return {
        ...c,
        out: convItems
          .filter((i) => i.direction === "OUT")
          .map((i) => ({
            ingredientId: i.ingredientId,
            quantity: i.quantity,
            ingredientName: i.ingredientName,
          })),
        produced: convItems
          .filter((i) => i.direction === "PRODUCED")
          .map((i) => ({
            ingredientId: i.ingredientId,
            quantity: i.quantity,
            ingredientName: i.ingredientName,
          })),
      };
    });
  });

export const createYieldConversion = createServerFn({ method: "POST" })
  .validator(
    (data: {
      branchId: string;
      out: { ingredientId: string; quantity: number }[];
      produced: { ingredientId: string; quantity: number }[];
      notes?: string;
      productionDate?: string;
    }) => data,
  )
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "central_kitchen");

    const out = (data.out ?? []).filter((s) => s.ingredientId && s.quantity > 0);
    const produced = (data.produced ?? []).filter((s) => s.ingredientId && s.quantity > 0);

    if (out.length === 0) throw new Error("Setidaknya satu bahan keluar (out) diperlukan");
    if (produced.length === 0)
      throw new Error("Setidaknya satu bahan dihasilkan (produced) diperlukan");

    // An ingredient cannot be both consumed and produced in the same record.
    const outIds = new Set(out.map((s) => s.ingredientId));
    const producedIds = new Set(produced.map((s) => s.ingredientId));
    const conflict = [...producedIds].find((id) => outIds.has(id));
    if (conflict) {
      throw new Error("Bahan yang sama tidak boleh menjadi keluar sekaligus dihasilkan");
    }

    // Each ingredient may appear only once per side.
    if (outIds.size !== out.length || producedIds.size !== produced.length) {
      throw new Error("Bahan tidak boleh muncul lebih dari satu kali dalam satu sisi");
    }

    const allIds = [...outIds, ...producedIds];
    const ingMap = new Map(
      (
        await db
          .select()
          .from(ingredients)
          .where(inArray(ingredients.id, [...allIds]))
      ).map((i) => [i.id, i]),
    );
    const missing = [...allIds].filter((id) => !ingMap.has(id));
    if (missing.length > 0) throw new Error(`Bahan tidak ditemukan: ${missing.join(", ")}`);

    const [conversion] = await db
      .insert(yieldConversions)
      .values({
        branchId: data.branchId,
        notes: data.notes,
        processedBy: user.id,
        productionDate: data.productionDate ? new Date(data.productionDate) : new Date(),
      })
      .returning();

    const itemsToInsert: {
      conversionId: string;
      ingredientId: string;
      quantity: number;
      direction: "OUT" | "PRODUCED";
    }[] = [
      ...out.map((s) => ({
        conversionId: conversion.id,
        ingredientId: s.ingredientId,
        quantity: s.quantity,
        direction: "OUT" as const,
      })),
      ...produced.map((s) => ({
        conversionId: conversion.id,
        ingredientId: s.ingredientId,
        quantity: s.quantity,
        direction: "PRODUCED" as const,
      })),
    ];
    await db.insert(yieldConversionItems).values(itemsToInsert);

    // NOTE: Production records are a documentation/log only. They do NOT adjust
    // inventory or write stock-ledger entries — stock changes are handled
    // separately (e.g. stock opname / manual adjustments).

    const outNames = out
      .map((s) => `${ingMap.get(s.ingredientId)?.name ?? s.ingredientId} (${s.quantity})`)
      .join(" + ");
    const producedNames = produced
      .map((s) => `${ingMap.get(s.ingredientId)?.name ?? s.ingredientId} (${s.quantity})`)
      .join(" + ");

    await logSystemAction(
      user,
      "Create Production Record",
      `Produksi "${outNames} → ${producedNames}" dicatat (catatan produksi, tidak mengubah stok) oleh ${user.name}`,
    );
    await logAudit(user, "yieldConversions", conversion.id, "CREATE", undefined, conversion);

    return { success: true, conversion, out, produced };
  });
