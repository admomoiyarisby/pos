import { createServerFn } from "@tanstack/react-start";
import { db } from "#/lib/server/db";
import {
  wasteEntries,
  ingredients,
  branches,
  stockLedger,
  inventory,
  operationalExpenses,
} from "#/db/schema";
import { eq, and, desc, ilike, inArray } from "drizzle-orm";
import { requireAuth } from "./auth";
import { logSystemAction, logAudit } from "./logging";
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
    } else if (user.role === "area_manager" && user.assignedBranches?.length) {
      if (branchFilter && !user.assignedBranches.includes(branchFilter)) {
        branchFilter = user.assignedBranches[0];
      }
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
        valuation: wasteEntries.valuation,
        submittedBy: wasteEntries.submittedBy,
        createdAt: wasteEntries.createdAt,
        ingredientName: ingredients.name,
        ingredientCode: ingredients.code,
        stockUnit: ingredients.stockUnit,
        branchName: branches.name,
        currentInventoryQty: inventory.quantity,
      })
      .from(wasteEntries)
      .leftJoin(ingredients, eq(wasteEntries.ingredientId, ingredients.id))
      .leftJoin(branches, eq(wasteEntries.branchId, branches.id))
      .leftJoin(
        inventory,
        and(
          eq(inventory.branchId, wasteEntries.branchId),
          eq(inventory.ingredientId, wasteEntries.ingredientId),
        ),
      )
      .where(
        and(
          branchFilter
            ? user.role === "area_manager"
              ? inArray(wasteEntries.branchId, user.assignedBranches ?? [])
              : eq(wasteEntries.branchId, branchFilter)
            : user.role === "area_manager" && user.assignedBranches?.length
              ? inArray(wasteEntries.branchId, user.assignedBranches)
              : undefined,
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

    const branchId = data.branchId || (user.role === "branch_admin" ? user.branchId : undefined);
    if (!branchId) throw new Error("Branch is required");

    if (user.role === "branch_admin" && branchId !== user.branchId) {
      throw new Error("Unauthorized branch");
    }

    const [ing] = await db
      .select()
      .from(ingredients)
      .where(eq(ingredients.id, data.ingredientId))
      .limit(1);

    const valuation = data.quantity * (ing?.averageCost ?? 0);

    const [entry] = await db
      .insert(wasteEntries)
      .values({
        branchId,
        ingredientId: data.ingredientId,
        quantity: data.quantity,
        category: data.category,
        notes: data.notes,
        valuation,
        submittedBy: user.id,
      })
      .returning();

    if (data.category === "Biaya Operasional") {
      await db.insert(operationalExpenses).values({
        branchId,
        wasteEntryId: entry.id,
        category: "Biaya Operasional",
        amount: valuation,
        date: new Date().toISOString().split("T")[0],
        notes: data.notes ?? `Auto-generated from Waste Entry ${entry.id}`,
        submittedBy: user.id,
      });
    }

    const [inv] = await db
      .select()
      .from(inventory)
      .where(and(eq(inventory.branchId, branchId), eq(inventory.ingredientId, data.ingredientId)))
      .limit(1);

    if (inv) {
      const newQty = Math.max(0, inv.quantity - data.quantity);
      await db
        .update(inventory)
        .set({ quantity: newQty, lastUpdated: new Date() })
        .where(eq(inventory.id, inv.id));

      await db.insert(stockLedger).values({
        branchId: branchId,
        ingredientId: data.ingredientId,
        type: "OUT",
        quantity: data.quantity,
        balance: newQty,
        reference: entry.id,
        notes: `Waste: ${data.category}${data.notes ? " - " + data.notes : ""}`,
      });
    }

    await logSystemAction(
      user,
      "Create Waste Entry",
      `Waste entry untuk "${ing?.name ?? data.ingredientId}" (${data.quantity} ${ing?.stockUnit ?? ""}, nilai: Rp${valuation.toLocaleString()}) dicatat oleh ${user.name}`,
    );
    await logAudit(
      user,
      "wasteEntries",
      entry.id,
      "CREATE",
      undefined,
      entry as Record<string, unknown>,
    );

    return entry;
  });

export const addInvestigationNote = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z
      .object({
        wasteEntryId: z.string().uuid(),
        investigationNote: z.string().min(1),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const user = await requireAuth();

    if (user.role !== "super_admin" && user.role !== "area_manager") {
      throw new Error(
        "Unauthorized: hanya super_admin dan area_manager yang dapat menambahkan catatan investigasi",
      );
    }

    const [existing] = await db
      .select()
      .from(wasteEntries)
      .where(eq(wasteEntries.id, data.wasteEntryId))
      .limit(1);

    if (!existing) throw new Error("Waste entry tidak ditemukan");

    const [updated] = await db
      .update(wasteEntries)
      .set({ investigationNote: data.investigationNote })
      .where(eq(wasteEntries.id, data.wasteEntryId))
      .returning();

    await logSystemAction(
      user,
      "Add Investigation Note",
      `Catatan investigasi ditambahkan pada waste entry ${data.wasteEntryId} oleh ${user.name}`,
    );
    await logAudit(
      user,
      "wasteEntries",
      data.wasteEntryId,
      "UPDATE",
      { investigationNote: existing.investigationNote },
      { investigationNote: data.investigationNote },
    );

    return updated;
  });

export const updateWasteEntry = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z
      .object({
        wasteEntryId: z.string().uuid(),
        notes: z.string().optional(),
        investigationNote: z.string().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const user = await requireAuth();

    const [existing] = await db
      .select()
      .from(wasteEntries)
      .where(eq(wasteEntries.id, data.wasteEntryId))
      .limit(1);

    if (!existing) throw new Error("Waste entry tidak ditemukan");

    if (user.role === "branch_admin" && existing.submittedBy !== user.id) {
      throw new Error("Unauthorized: hanya dapat mengedit waste entry sendiri");
    }

    const updates: Record<string, unknown> = {};
    if (data.notes !== undefined) updates.notes = data.notes;
    if (data.investigationNote !== undefined) updates.investigationNote = data.investigationNote;

    if (user.role !== "super_admin" && user.role !== "area_manager") {
      delete updates.investigationNote;
    }

    if (Object.keys(updates).length === 0) {
      throw new Error("Tidak ada perubahan");
    }

    const [updated] = await db
      .update(wasteEntries)
      .set(updates)
      .where(eq(wasteEntries.id, data.wasteEntryId))
      .returning();

    await logSystemAction(
      user,
      "Update Waste Entry",
      `Waste entry ${data.wasteEntryId} diperbarui oleh ${user.name}`,
    );
    await logAudit(
      user,
      "wasteEntries",
      data.wasteEntryId,
      "UPDATE",
      existing as Record<string, unknown>,
      updated as Record<string, unknown>,
    );

    return updated;
  });

export const getBrokenStock = createServerFn({ method: "GET" })
  .inputValidator((data: { branchId?: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuth();

    let branchFilter = data.branchId;
    if (user.role === "branch_admin" && user.branchId) {
      branchFilter = user.branchId;
    } else if (user.role === "area_manager" && user.assignedBranches?.length) {
      if (branchFilter && !user.assignedBranches.includes(branchFilter)) {
        branchFilter = user.assignedBranches[0];
      }
    }

    const result = await db
      .select({
        id: wasteEntries.id,
        branchId: wasteEntries.branchId,
        ingredientId: wasteEntries.ingredientId,
        quantity: wasteEntries.quantity,
        category: wasteEntries.category,
        notes: wasteEntries.notes,
        valuation: wasteEntries.valuation,
        createdAt: wasteEntries.createdAt,
        ingredientName: ingredients.name,
        ingredientCode: ingredients.code,
        stockUnit: ingredients.stockUnit,
        branchName: branches.name,
        currentInventoryQty: inventory.quantity,
        operationalExpenseId: operationalExpenses.id,
        operationalExpenseAmount: operationalExpenses.amount,
        operationalExpenseDate: operationalExpenses.date,
      })
      .from(wasteEntries)
      .leftJoin(ingredients, eq(wasteEntries.ingredientId, ingredients.id))
      .leftJoin(branches, eq(wasteEntries.branchId, branches.id))
      .leftJoin(
        inventory,
        and(
          eq(inventory.branchId, wasteEntries.branchId),
          eq(inventory.ingredientId, wasteEntries.ingredientId),
        ),
      )
      .leftJoin(operationalExpenses, eq(operationalExpenses.wasteEntryId, wasteEntries.id))
      .where(
        and(
          eq(wasteEntries.category, "Biaya Operasional"),
          branchFilter
            ? user.role === "area_manager"
              ? inArray(wasteEntries.branchId, user.assignedBranches ?? [])
              : eq(wasteEntries.branchId, branchFilter)
            : user.role === "area_manager" && user.assignedBranches?.length
              ? inArray(wasteEntries.branchId, user.assignedBranches)
              : undefined,
        ),
      )
      .orderBy(desc(wasteEntries.createdAt));

    return result;
  });
