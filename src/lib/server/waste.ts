import { createServerFn } from "@tanstack/react-start";
import { db } from "#/db/index";
import { wasteEntries, ingredients, branches, stockLedger, inventory } from "#/db/schema";
import { eq, and, desc, ilike } from "drizzle-orm";
import { requireAuth } from "./auth";
import { z } from "zod";

export const getWasteEntries = createServerFn({ method: "GET" })
  .inputValidator(
    (data: {
      branchId?: string;
      category?: "Beban Makan" | "Biaya Operasional" | "Spoiled" | null;
      search?: string;
    }) => data,
  )
  .handler(async ({ data }) => {
    const user = await requireAuth();

    let branchFilter = data.branchId;
    if (user.role === "branch_admin" && user.branchId) {
      branchFilter = user.branchId;
    }

    const result = await db
      .select({
        id: wasteEntries.id,
        branchId: wasteEntries.branchId,
        ingredientId: wasteEntries.ingredientId,
        quantity: wasteEntries.quantity,
        category: wasteEntries.category,
        notes: wasteEntries.notes,
        investigationNote: wasteEntries.investigationNote,
        submittedBy: wasteEntries.submittedBy,
        createdAt: wasteEntries.createdAt,
        ingredientName: ingredients.name,
        ingredientCode: ingredients.code,
        branchName: branches.name,
      })
      .from(wasteEntries)
      .leftJoin(ingredients, eq(wasteEntries.ingredientId, ingredients.id))
      .leftJoin(branches, eq(wasteEntries.branchId, branches.id))
      .where(
        and(
          branchFilter ? eq(wasteEntries.branchId, branchFilter) : undefined,
          data.category ? eq(wasteEntries.category, data.category) : undefined,
          data.search ? ilike(ingredients.name, `%${data.search}%`) : undefined,
        ),
      )
      .orderBy(desc(wasteEntries.createdAt));

    return result;
  });

export const createWasteEntry = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z
      .object({
        branchId: z.string().uuid(),
        ingredientId: z.string().uuid(),
        quantity: z.number().int().min(1),
        category: z.enum(["Beban Makan", "Biaya Operasional", "Spoiled"]),
        notes: z.string().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const user = await requireAuth();

    // Validate branch access
    if (user.role === "branch_admin" && user.branchId !== data.branchId) {
      throw new Error("Unauthorized branch");
    }

    // Get ingredient cost for valuation
    await db.select().from(ingredients).where(eq(ingredients.id, data.ingredientId)).limit(1);

    const [entry] = await db
      .insert(wasteEntries)
      .values({
        branchId: data.branchId,
        ingredientId: data.ingredientId,
        quantity: data.quantity,
        category: data.category,
        notes: data.notes,
        submittedBy: user.id,
      })
      .returning();

    // Deduct inventory
    const [inv] = await db
      .select()
      .from(inventory)
      .where(
        and(eq(inventory.branchId, data.branchId), eq(inventory.ingredientId, data.ingredientId)),
      )
      .limit(1);

    if (inv) {
      const newQty = Math.max(0, inv.quantity - data.quantity);
      await db
        .update(inventory)
        .set({ quantity: newQty, lastUpdated: new Date() })
        .where(eq(inventory.id, inv.id));

      // Create ledger entry
      await db.insert(stockLedger).values({
        branchId: data.branchId,
        ingredientId: data.ingredientId,
        type: "OUT",
        quantity: data.quantity,
        balance: newQty,
        reference: entry.id,
        notes: `Waste: ${data.category}${data.notes ? " - " + data.notes : ""}`,
      });
    }

    return entry;
  });

export const getBrokenStock = createServerFn({ method: "GET" })
  .inputValidator((data: { branchId?: string }) => data)
  .handler(async ({ data }) => {
    await requireAuth();

    // Get operational waste entries linked to broken stock
    const result = await db
      .select({
        id: wasteEntries.id,
        branchId: wasteEntries.branchId,
        ingredientId: wasteEntries.ingredientId,
        quantity: wasteEntries.quantity,
        notes: wasteEntries.notes,
        createdAt: wasteEntries.createdAt,
        ingredientName: ingredients.name,
        ingredientCode: ingredients.code,
        branchName: branches.name,
      })
      .from(wasteEntries)
      .leftJoin(ingredients, eq(wasteEntries.ingredientId, ingredients.id))
      .leftJoin(branches, eq(wasteEntries.branchId, branches.id))
      .where(
        and(
          eq(wasteEntries.category, "Biaya Operasional"),
          data.branchId ? eq(wasteEntries.branchId, data.branchId) : undefined,
        ),
      )
      .orderBy(desc(wasteEntries.createdAt));

    return result;
  });
