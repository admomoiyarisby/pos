import { createServerFn } from "@tanstack/react-start";
import { db } from "#/lib/server/db";
import {
  wasteEntries,
  ingredients,
  ingredientBranches,
  branches,
  stockLedger,
  inventory,
  recipeInventory,
  recipes,
  recipeBranches,
  operationalExpenses,
  users,
} from "#/db/schema";
import { eq, and, desc, inArray, or, sql } from "drizzle-orm";
import { fuzzySearch } from "./fuzzy";
import type { UnknownRecord } from "#/lib/unknown-record";
import { requireAuth } from "./auth";
import { logSystemAction, logAudit } from "./logging";
import { branchVisibleClause } from "#/lib/server/branch-visibility";
import { z } from "zod";

export const getWasteEntries = createServerFn({ method: "GET" })
  .validator(
    (data: {
      branchId?: string;
      category?: "Beban Makan" | "Biaya Operasional" | "Spoiled" | "Denda" | null;
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
        recipeId: wasteEntries.recipeId,
        quantity: wasteEntries.quantity,
        category: wasteEntries.category,
        staffName: wasteEntries.staffName,
        notes: wasteEntries.notes,
        investigationNote: wasteEntries.investigationNote,
        valuation: wasteEntries.valuation,
        submittedBy: wasteEntries.submittedBy,
        createdAt: wasteEntries.createdAt,
        status: wasteEntries.status,
        cancelledAt: wasteEntries.cancelledAt,
        cancelledBy: wasteEntries.cancelledBy,
        cancelReason: wasteEntries.cancelReason,
        cancelledByName: users.name,
        ingredientName: ingredients.name,
        ingredientCode: ingredients.code,
        stockUnit: ingredients.stockUnit,
        recipeName: recipes.name,
        recipeCode: recipes.code,
        branchName: branches.name,
        currentInventoryQty: inventory.quantity,
        currentRecipeQty: recipeInventory.quantity,
      })
      .from(wasteEntries)
      .leftJoin(ingredients, eq(wasteEntries.ingredientId, ingredients.id))
      .leftJoin(recipes, eq(wasteEntries.recipeId, recipes.id))
      .leftJoin(branches, eq(wasteEntries.branchId, branches.id))
      .leftJoin(users, eq(wasteEntries.cancelledBy, users.id))
      .leftJoin(
        inventory,
        and(
          eq(inventory.branchId, wasteEntries.branchId),
          eq(inventory.ingredientId, wasteEntries.ingredientId),
        ),
      )
      .leftJoin(
        recipeInventory,
        and(
          eq(recipeInventory.branchId, wasteEntries.branchId),
          eq(recipeInventory.recipeId, wasteEntries.recipeId),
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
          data.search
            ? or(fuzzySearch(ingredients.name, data.search), fuzzySearch(recipes.name, data.search))
            : undefined,
        ),
      )
      .orderBy(desc(wasteEntries.createdAt));

    // Branch admins must not see the HPP-derived valuation (qty × averageCost / totalCogs).
    if (user.role === "branch_admin") {
      return result.map((r) => ({ ...r, valuation: 0 }));
    }

    return result;
  });

const createWasteEntryInput = z
  .object({
    branchId: z.string().uuid(),
    ingredientId: z.string().uuid().optional(),
    recipeId: z.string().uuid().optional(),
    quantity: z.number().int().min(1),
    category: z.enum(["Beban Makan", "Biaya Operasional", "Spoiled", "Denda"]),
    staffName: z.string().optional(),
    notes: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    const hasIng = !!data.ingredientId;
    const hasRecipe = !!data.recipeId;
    if (hasIng === hasRecipe) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Exactly one of ingredientId or recipeId must be set",
        path: ["ingredientId"],
      });
    }
  });

export const createWasteEntry = createServerFn({ method: "POST" })
  .validator((data: z.input<typeof createWasteEntryInput>) => createWasteEntryInput.parse(data))
  .handler(async ({ data }) => {
    const user = await requireAuth();

    const branchId = data.branchId || (user.role === "branch_admin" ? user.branchId : undefined);
    if (!branchId) throw new Error("Branch is required");

    if (user.role === "branch_admin" && branchId !== user.branchId) {
      throw new Error("Unauthorized branch");
    }

    const isRecipe = !!data.recipeId;
    let valuation = 0;
    let displayName = "";
    let stockUnit = "";

    // Fetch target and validate branch visibility
    if (isRecipe) {
      const [recipe] = await db
        .select()
        .from(recipes)
        .where(
          and(
            eq(recipes.id, data.recipeId!),
            branchVisibleClause({
              linkTable: recipeBranches,
              linkRowId: recipeBranches.recipeId,
              rowId: recipes.id,
              linkBranchId: recipeBranches.branchId,
              currentBranchId: user.branchId,
            }),
          ),
        )
        .limit(1);
      if (!recipe) throw new Error("Forbidden: recipe is not available to your branch");
      valuation = data.quantity * (recipe.totalCogs ?? 0);
      displayName = recipe.name;
      stockUnit = "porsi";
    } else {
      const [ing] = await db
        .select()
        .from(ingredients)
        .where(
          and(
            eq(ingredients.id, data.ingredientId!),
            branchVisibleClause({
              linkTable: ingredientBranches,
              linkRowId: ingredientBranches.ingredientId,
              rowId: ingredients.id,
              linkBranchId: ingredientBranches.branchId,
              currentBranchId: user.branchId,
            }),
          ),
        )
        .limit(1);
      if (!ing) throw new Error("Forbidden: ingredient is not available to your branch");
      valuation = data.quantity * (ing.averageCost ?? 0);
      displayName = ing.name;
      stockUnit = ing.stockUnit ?? "";
    }

    // Transactional insert + OE + inventory + ledger (ADR 0012 pattern)
    const entry = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(wasteEntries)
        .values({
          branchId,
          ingredientId: data.ingredientId ?? null,
          recipeId: data.recipeId ?? null,
          quantity: data.quantity,
          category: data.category,
          staffName: data.staffName,
          notes: data.notes,
          valuation,
          submittedBy: user.id,
        })
        .returning();

      if (data.category === "Biaya Operasional") {
        await tx.insert(operationalExpenses).values({
          branchId,
          wasteEntryId: inserted.id,
          category: "Biaya Operasional",
          amount: valuation,
          date: new Date().toISOString().split("T")[0],
          notes: data.notes ?? `Auto-generated from Waste Entry ${inserted.id}`,
          submittedBy: user.id,
        });
      }

      if (isRecipe) {
        const [ri] = await tx
          .select()
          .from(recipeInventory)
          .where(
            and(
              eq(recipeInventory.branchId, branchId),
              eq(recipeInventory.recipeId, data.recipeId!),
            ),
          )
          .for("update")
          .limit(1);

        const newQty = (ri?.quantity ?? 0) - data.quantity;
        if (ri) {
          await tx
            .update(recipeInventory)
            .set({ quantity: newQty, lastUpdated: new Date() })
            .where(eq(recipeInventory.id, ri.id));
        } else {
          await tx.insert(recipeInventory).values({
            branchId,
            recipeId: data.recipeId!,
            quantity: newQty,
          });
        }

        await tx.insert(stockLedger).values({
          branchId,
          recipeId: data.recipeId!,
          type: "OUT",
          quantity: data.quantity,
          balance: Math.round(newQty),
          reference: inserted.id,
          notes: `Waste: ${data.category}${data.notes ? " - " + data.notes : ""}`,
        });
      } else {
        const [inv] = await tx
          .select()
          .from(inventory)
          .where(
            and(eq(inventory.branchId, branchId), eq(inventory.ingredientId, data.ingredientId!)),
          )
          .for("update")
          .limit(1);

        const hadRow = !!inv;
        const newQty = (inv?.quantity ?? 0) - data.quantity;

        if (hadRow) {
          await tx
            .update(inventory)
            .set({ quantity: newQty, lastUpdated: new Date() })
            .where(eq(inventory.id, inv!.id));
        } else {
          // Upsert-from-0 for ingredient waste at branch with no prior row (allow-negative)
          await tx.insert(inventory).values({
            branchId,
            ingredientId: data.ingredientId!,
            quantity: newQty,
          });
        }

        // Only write ledger if there was an inventory row or we just created one — always write now (allow-negative)
        await tx.insert(stockLedger).values({
          branchId,
          ingredientId: data.ingredientId!,
          type: "OUT",
          quantity: data.quantity,
          balance: Math.round(newQty),
          reference: inserted.id,
          notes: `Waste: ${data.category}${data.notes ? " - " + data.notes : ""}`,
        });
      }

      return inserted;
    });

    await logSystemAction(
      user,
      "Create Waste Entry",
      `Waste entry untuk "${displayName}" (${data.quantity} ${stockUnit}, nilai: Rp${valuation.toLocaleString()}) dicatat oleh ${user.name}`,
    );
    await logAudit(user, "wasteEntries", entry.id, "CREATE", undefined, entry);

    return entry;
  });

const addInvestigationNoteInput = z.object({
  wasteEntryId: z.string().uuid(),
  investigationNote: z.string().min(1),
});

export const addInvestigationNote = createServerFn({ method: "POST" })
  .validator((data: z.input<typeof addInvestigationNoteInput>) =>
    addInvestigationNoteInput.parse(data),
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
    if (existing.status === "Cancelled") {
      throw new Error("Waste entry sudah dibatalkan — tidak dapat diubah");
    }

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

const updateWasteEntryInput = z.object({
  wasteEntryId: z.string().uuid(),
  notes: z.string().optional(),
  investigationNote: z.string().optional(),
});

export const updateWasteEntry = createServerFn({ method: "POST" })
  .validator((data: z.input<typeof updateWasteEntryInput>) => updateWasteEntryInput.parse(data))
  .handler(async ({ data }) => {
    const user = await requireAuth();

    const [existing] = await db
      .select()
      .from(wasteEntries)
      .where(eq(wasteEntries.id, data.wasteEntryId))
      .limit(1);

    if (!existing) throw new Error("Waste entry tidak ditemukan");
    if (existing.status === "Cancelled") {
      throw new Error("Waste entry sudah dibatalkan — tidak dapat diubah");
    }

    if (user.role === "branch_admin" && existing.submittedBy !== user.id) {
      throw new Error("Unauthorized: hanya dapat mengedit waste entry sendiri");
    }

    const updates: UnknownRecord = {};
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
    await logAudit(user, "wasteEntries", data.wasteEntryId, "UPDATE", existing, updated);

    return updated;
  });

// ─── Waste Cancellation (super_admin / area_manager, ADR 0012 pattern) ──────
// Cancelling a waste entry flips its status to `Cancelled` (row + history
// preserved) and reverses the recorded stock effect: the quantity is restored
// to the same inventory surface it was deducted from.

type WasteTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function reverseWasteStockEffect(
  tx: WasteTx,
  entry: {
    id: string;
    branchId: string;
    ingredientId: string | null;
    recipeId: string | null;
    quantity: number;
  },
): Promise<void> {
  const [wroteStock] = await tx
    .select()
    .from(stockLedger)
    .where(eq(stockLedger.reference, entry.id))
    .limit(1);
  if (!wroteStock) return;

  if (entry.recipeId) {
    const [ri] = await tx
      .select()
      .from(recipeInventory)
      .where(
        and(
          eq(recipeInventory.branchId, entry.branchId),
          eq(recipeInventory.recipeId, entry.recipeId),
        ),
      )
      .for("update")
      .limit(1);

    const newQty = (ri?.quantity ?? 0) + entry.quantity;
    if (ri) {
      await tx
        .update(recipeInventory)
        .set({ quantity: newQty, lastUpdated: new Date() })
        .where(eq(recipeInventory.id, ri.id));
    } else {
      await tx.insert(recipeInventory).values({
        branchId: entry.branchId,
        recipeId: entry.recipeId,
        quantity: newQty,
      });
    }

    await tx.insert(stockLedger).values({
      branchId: entry.branchId,
      recipeId: entry.recipeId,
      type: "IN",
      quantity: entry.quantity,
      balance: Math.round(newQty),
      reference: entry.id,
      notes: `Waste dibatalkan ${entry.id.slice(0, 8)}`,
    });
  } else if (entry.ingredientId) {
    const [inv] = await tx
      .select()
      .from(inventory)
      .where(
        and(eq(inventory.branchId, entry.branchId), eq(inventory.ingredientId, entry.ingredientId)),
      )
      .for("update")
      .limit(1);

    const newQty = (inv?.quantity ?? 0) + entry.quantity;
    if (inv) {
      await tx
        .update(inventory)
        .set({ quantity: newQty, lastUpdated: new Date() })
        .where(eq(inventory.id, inv.id));
    } else {
      await tx.insert(inventory).values({
        branchId: entry.branchId,
        ingredientId: entry.ingredientId,
        quantity: newQty,
      });
    }

    await tx.insert(stockLedger).values({
      branchId: entry.branchId,
      ingredientId: entry.ingredientId,
      type: "IN",
      quantity: entry.quantity,
      balance: Math.round(newQty),
      reference: entry.id,
      notes: `Waste dibatalkan ${entry.id.slice(0, 8)}`,
    });
  }
}

/** The cancel mutation itself — status flip + expense cleanup + stock reversal
 *  in one transaction (ADR 0012 pattern). Extracted from `cancelWasteEntry` so
 *  the integration test can exercise the real production path. */
export async function applyWasteCancellation(
  tx: WasteTx,
  entry: {
    id: string;
    branchId: string;
    ingredientId: string | null;
    recipeId: string | null;
    quantity: number;
  },
  actor: { id: string },
  reason: string,
): Promise<typeof wasteEntries.$inferSelect> {
  const [updated] = await tx
    .update(wasteEntries)
    .set({
      status: "Cancelled",
      cancelledAt: new Date(),
      cancelledBy: actor.id,
      cancelReason: reason,
    })
    .where(eq(wasteEntries.id, entry.id))
    .returning();

  await tx.delete(operationalExpenses).where(eq(operationalExpenses.wasteEntryId, entry.id));

  await reverseWasteStockEffect(tx, entry);
  return updated;
}

const cancelWasteEntryInput = z.object({
  wasteEntryId: z.string().uuid(),
  reason: z.string().min(1),
});

export const cancelWasteEntry = createServerFn({ method: "POST" })
  .validator((data: z.input<typeof cancelWasteEntryInput>) => cancelWasteEntryInput.parse(data))
  .handler(async ({ data }) => {
    const user = await requireAuth();

    if (user.role !== "super_admin" && user.role !== "area_manager") {
      throw new Error(
        "Unauthorized: hanya super_admin dan area_manager yang dapat membatalkan waste entry",
      );
    }

    const reason = (data.reason ?? "").trim();
    if (!reason) throw new Error("Alasan pembatalan wajib diisi");

    const [entry] = await db
      .select()
      .from(wasteEntries)
      .where(eq(wasteEntries.id, data.wasteEntryId))
      .limit(1);
    if (!entry) throw new Error("Waste entry tidak ditemukan");
    if (entry.status === "Cancelled") throw new Error("Waste entry sudah dibatalkan");

    if (user.role === "area_manager" && !user.assignedBranches?.includes(entry.branchId)) {
      throw new Error(
        "Unauthorized: Area Manager hanya dapat membatalkan untuk cabang yang ditugaskan",
      );
    }

    // SAFETY: entry fetched from wasteEntries above — same row type, just narrowed by select().
    const updated = await db.transaction(async (tx) =>
      applyWasteCancellation(tx, entry as typeof wasteEntries.$inferSelect, user, reason),
    );

    await logSystemAction(
      user,
      "Cancel Waste Entry",
      `Waste entry ${entry.id.slice(0, 8)} dibatalkan oleh ${user.name}. Alasan: ${reason}`,
    );
    await logAudit(user, "wasteEntries", entry.id, "STATUS_CHANGE", entry, updated);

    return updated;
  });

export const getBrokenStock = createServerFn({ method: "GET" })
  .validator((data: { branchId?: string }) => data)
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
        recipeId: wasteEntries.recipeId,
        quantity: wasteEntries.quantity,
        category: wasteEntries.category,
        notes: wasteEntries.notes,
        valuation: wasteEntries.valuation,
        createdAt: wasteEntries.createdAt,
        ingredientName: ingredients.name,
        ingredientCode: ingredients.code,
        stockUnit: ingredients.stockUnit,
        recipeName: recipes.name,
        recipeCode: recipes.code,
        branchName: branches.name,
        currentInventoryQty: inventory.quantity,
        currentRecipeQty: recipeInventory.quantity,
        operationalExpenseId: operationalExpenses.id,
        operationalExpenseAmount: operationalExpenses.amount,
        operationalExpenseDate: operationalExpenses.date,
      })
      .from(wasteEntries)
      .leftJoin(ingredients, eq(wasteEntries.ingredientId, ingredients.id))
      .leftJoin(recipes, eq(wasteEntries.recipeId, recipes.id))
      .leftJoin(branches, eq(wasteEntries.branchId, branches.id))
      .leftJoin(
        inventory,
        and(
          eq(inventory.branchId, wasteEntries.branchId),
          eq(inventory.ingredientId, wasteEntries.ingredientId),
        ),
      )
      .leftJoin(
        recipeInventory,
        and(
          eq(recipeInventory.branchId, wasteEntries.branchId),
          eq(recipeInventory.recipeId, wasteEntries.recipeId),
        ),
      )
      .leftJoin(operationalExpenses, eq(operationalExpenses.wasteEntryId, wasteEntries.id))
      .where(
        and(
          eq(wasteEntries.category, "Biaya Operasional"),
          eq(wasteEntries.status, "Active"),
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

/** Branch-centric recipe inventory for the waste picker (menu waste). */
export const getRecipeInventoryForWaste = createServerFn({ method: "GET" })
  .validator((data: { branchId: string; search?: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuth();
    let branchId = data.branchId;
    if (user.role === "branch_admin" && user.branchId) branchId = user.branchId;
    const result = await db
      .select({
        recipeId: recipes.id,
        name: recipes.name,
        code: recipes.code,
        totalCogs: recipes.totalCogs,
        stockUnit: sql<string>`'porsi'`,
        quantity: recipeInventory.quantity,
      })
      .from(recipes)
      .leftJoin(
        recipeInventory,
        and(eq(recipeInventory.recipeId, recipes.id), eq(recipeInventory.branchId, branchId)),
      )
      .where(
        and(
          eq(recipes.status, "Active"),
          branchVisibleClause({
            linkTable: recipeBranches,
            linkRowId: recipeBranches.recipeId,
            rowId: recipes.id,
            linkBranchId: recipeBranches.branchId,
            currentBranchId: user.branchId,
          }),
          data.search ? fuzzySearch(recipes.name, data.search) : undefined,
        ),
      )
      .orderBy(recipes.name);
    return result.map((r) => ({
      recipeId: r.recipeId,
      name: r.name,
      code: r.code,
      totalCogs: r.totalCogs,
      // SAFETY: sql literal 'porsi' is always a string; select returns string via sqlite int.
      stockUnit: r.stockUnit as string,
      quantity: r.quantity ?? 0,
      hasRow: r.quantity != null,
    }));
  });
