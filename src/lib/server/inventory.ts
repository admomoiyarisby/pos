import { createServerFn } from "@tanstack/react-start";
import { db } from "#/lib/server/db";
import {
  inventory,
  stockLedger,
  ingredients,
  branches,
  stockOpnames,
  stockOpnameItems,
  systemNotifications,
  areaManagerBranches,
} from "#/db/schema";
import { eq, and, ilike, desc, asc, count, inArray } from "drizzle-orm";
import { requireAuth, requireRole } from "./auth";
import { logSystemAction, logAudit } from "./logging";

export const getInventory = createServerFn({ method: "GET" })
  .inputValidator(
    (data: {
      branchId?: string;
      search?: string;
      category?: "Fresh" | "Dry" | "Packaging" | null;
      skuType?: "RM" | "SFG" | "FG" | null;
      page?: number;
      limit?: number;
      sortBy?: string;
      sortOrder?: "asc" | "desc";
    }) => data,
  )
  .handler(async ({ data }) => {
    const user = await requireAuth();

    let branchFilter = data.branchId;
    if (user.role === "branch_admin" && user.branchId) {
      branchFilter = user.branchId;
    } else if (user.role === "admin_pusat") {
      // Admin pusat sees central warehouse or all depending on preference
      // Default to no filter (all) for now
    }

    const conditions = [
      branchFilter ? eq(inventory.branchId, branchFilter) : undefined,
      data.search ? ilike(ingredients.name, `%${data.search}%`) : undefined,
      data.category ? eq(ingredients.category, data.category) : undefined,
      data.skuType ? eq(ingredients.skuType, data.skuType) : undefined,
    ];
    const where = and(...conditions.filter(Boolean));

    // Get total count
    const [totalResult] = await db
      .select({ total: count() })
      .from(inventory)
      .leftJoin(ingredients, eq(inventory.ingredientId, ingredients.id))
      .leftJoin(branches, eq(inventory.branchId, branches.id))
      .where(where);

    const total = totalResult?.total ?? 0;
    const limit = Math.min(data.limit ?? 50, 100);
    const offset = (data.page ?? 0) * limit;

    const result = await db
      .select({
        id: inventory.id,
        branchId: inventory.branchId,
        ingredientId: inventory.ingredientId,
        quantity: inventory.quantity,
        lastUpdated: inventory.lastUpdated,
        ingredientName: ingredients.name,
        ingredientCode: ingredients.code,
        ingredientCategory: ingredients.category,
        ingredientSkuType: ingredients.skuType,
        purchaseUnit: ingredients.purchaseUnit,
        stockUnit: ingredients.stockUnit,
        branchName: branches.name,
      })
      .from(inventory)
      .leftJoin(ingredients, eq(inventory.ingredientId, ingredients.id))
      .leftJoin(branches, eq(inventory.branchId, branches.id))
      .where(where)
      .orderBy(data.sortOrder === "desc" ? desc(ingredients.name) : asc(ingredients.name))
      .limit(limit)
      .offset(offset);

    return { data: result, total };
  });

export const getStockLedger = createServerFn({ method: "GET" })
  .inputValidator(
    (data: {
      branchId?: string;
      ingredientId?: string;
      dateFrom?: string;
      dateTo?: string;
      page?: number;
      limit?: number;
    }) => data,
  )
  .handler(async ({ data }) => {
    await requireAuth();

    const result = await db
      .select({
        id: stockLedger.id,
        branchId: stockLedger.branchId,
        ingredientId: stockLedger.ingredientId,
        type: stockLedger.type,
        quantity: stockLedger.quantity,
        balance: stockLedger.balance,
        reference: stockLedger.reference,
        notes: stockLedger.notes,
        createdAt: stockLedger.createdAt,
        ingredientName: ingredients.name,
        branchName: branches.name,
      })
      .from(stockLedger)
      .leftJoin(ingredients, eq(stockLedger.ingredientId, ingredients.id))
      .leftJoin(branches, eq(stockLedger.branchId, branches.id))
      .where(
        and(
          data.branchId ? eq(stockLedger.branchId, data.branchId) : undefined,
          data.ingredientId ? eq(stockLedger.ingredientId, data.ingredientId) : undefined,
        ),
      )
      .orderBy(desc(stockLedger.createdAt))
      .limit(data.limit ?? 50)
      .offset((data.page ?? 0) * (data.limit ?? 50));

    return result;
  });

export const triggerStockOpname = createServerFn({ method: "POST" })
  .inputValidator((data: { branchId: string; date: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuth();
    await requireRole("super_admin", "admin_pusat", "area_manager");

    // Get current inventory for the branch (only countable items)
    const invItems = await db
      .select({
        ingredientId: inventory.ingredientId,
        quantity: inventory.quantity,
      })
      .from(inventory)
      .leftJoin(ingredients, eq(inventory.ingredientId, ingredients.id))
      .where(
        and(eq(inventory.branchId, data.branchId), eq(ingredients.countable, true)),
      );

    // Create stock opname
    const [so] = await db
      .insert(stockOpnames)
      .values({
        branchId: data.branchId,
        date: data.date,
        triggeredBy: user.id,
        submittedBy: user.id,
      })
      .returning();

    // Create SO items with system stock
    for (const item of invItems) {
      await db.insert(stockOpnameItems).values({
        stockOpnameId: so.id,
        ingredientId: item.ingredientId,
        systemStock: item.quantity,
        physicalStock: 0,
        variance: 0,
      });
    }

    await logSystemAction(
      user,
      "Trigger Stock Opname",
      `Stock opname "${so.id}" dimulai untuk cabang ${data.branchId} oleh ${user.name}`,
    );
    await logAudit(user, "stockOpnames", so.id, "CREATE", undefined, so as Record<string, unknown>);

    return so;
  });

export const getStockOpnames = createServerFn({ method: "GET" })
  .inputValidator((data: { branchId?: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuth();

    let branchFilter = data.branchId;
    if (user.role === "branch_admin" && user.branchId) {
      branchFilter = user.branchId;
    } else if (user.role === "admin_pusat") {
      // Admin pusat sees only Central Warehouse
      const [centralBranch] = await db
        .select({ id: branches.id })
        .from(branches)
        .where(eq(branches.type, "Central"))
        .limit(1);
      branchFilter = centralBranch?.id;
    } else if (user.role === "area_manager") {
      // Area manager sees only assigned branches
      const assigned = await db
        .select({ branchId: areaManagerBranches.branchId })
        .from(areaManagerBranches)
        .where(eq(areaManagerBranches.userId, user.id));
      const assignedIds = assigned.map((a) => a.branchId);
      if (assignedIds.length === 0) {
        return [];
      }
      branchFilter = assignedIds[0];
      // Use inArray if multiple branches assigned
      const result = await db
        .select({
          id: stockOpnames.id,
          branchId: stockOpnames.branchId,
          date: stockOpnames.date,
          status: stockOpnames.status,
          triggeredBy: stockOpnames.triggeredBy,
          submittedBy: stockOpnames.submittedBy,
          approvedBy: stockOpnames.approvedBy,
          createdAt: stockOpnames.createdAt,
          branchName: branches.name,
        })
        .from(stockOpnames)
        .leftJoin(branches, eq(stockOpnames.branchId, branches.id))
        .where(inArray(stockOpnames.branchId, assignedIds))
        .orderBy(desc(stockOpnames.createdAt));

      return result;
    }

    const result = await db
      .select({
        id: stockOpnames.id,
        branchId: stockOpnames.branchId,
        date: stockOpnames.date,
        status: stockOpnames.status,
        triggeredBy: stockOpnames.triggeredBy,
        submittedBy: stockOpnames.submittedBy,
        approvedBy: stockOpnames.approvedBy,
        createdAt: stockOpnames.createdAt,
        branchName: branches.name,
      })
      .from(stockOpnames)
      .leftJoin(branches, eq(stockOpnames.branchId, branches.id))
      .where(branchFilter ? eq(stockOpnames.branchId, branchFilter) : undefined)
      .orderBy(desc(stockOpnames.createdAt));

    return result;
  });

export const getStockOpnameDetail = createServerFn({ method: "GET" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuth();

    const [so] = await db.select().from(stockOpnames).where(eq(stockOpnames.id, data.id)).limit(1);

    if (!so) return null;

    // Branch access check
    if (user.role === "branch_admin" && user.branchId && so.branchId !== user.branchId) {
      throw new Error("Unauthorized: you can only view Stock Opnames for your branch");
    }

    // Fetch branch name
    const [branch] = await db
      .select({ name: branches.name })
      .from(branches)
      .where(eq(branches.id, so.branchId))
      .limit(1);

    const items = await db
      .select({
        id: stockOpnameItems.id,
        ingredientId: stockOpnameItems.ingredientId,
        systemStock: stockOpnameItems.systemStock,
        physicalStock: stockOpnameItems.physicalStock,
        variance: stockOpnameItems.variance,
        variancePercentage: stockOpnameItems.variancePercentage,
        investigationNote: stockOpnameItems.investigationNote,
        ingredientName: ingredients.name,
        ingredientCode: ingredients.code,
        ingredientCategory: ingredients.category,
      })
      .from(stockOpnameItems)
      .leftJoin(ingredients, eq(stockOpnameItems.ingredientId, ingredients.id))
      .where(eq(stockOpnameItems.stockOpnameId, data.id));

    // Access check for admin_pusat - can only view Central Warehouse SOs
    if (user.role === "admin_pusat") {
      const [centralBranch] = await db
        .select({ id: branches.id })
        .from(branches)
        .where(eq(branches.type, "Central"))
        .limit(1);
      if (centralBranch && so.branchId !== centralBranch.id) {
        throw new Error("Unauthorized: Admin Pusat can only view Central Warehouse Stock Opnames");
      }
    }

    // For blind roles, strip system stock
    const isBlind = user.role === "branch_admin" || user.role === "admin_pusat";

    return {
      ...so,
      branchName: branch?.name ?? so.branchId,
      items: isBlind
        ? items.map((i) => ({
            ...i,
            systemStock: 0 as number,
            variance: 0 as number,
          }))
        : items,
      isBlind,
    };
  });

export const submitStockOpname = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { soId: string; items: { itemId: string; physicalStock: number }[] }) => data,
  )
  .handler(async ({ data }) => {
    const user = await requireAuth();

    const [oldSo] = await db
      .select()
      .from(stockOpnames)
      .where(eq(stockOpnames.id, data.soId))
      .limit(1);

    if (!oldSo) throw new Error("Stock opname not found");

    // Branch access check
    if (user.role === "branch_admin" && user.branchId && oldSo.branchId !== user.branchId) {
      throw new Error("Unauthorized: you can only submit Stock Opnames for your branch");
    }

    for (const item of data.items) {
      // Get current system stock
      const [soItem] = await db
        .select()
        .from(stockOpnameItems)
        .where(eq(stockOpnameItems.id, item.itemId))
        .limit(1);

      if (!soItem) continue;

      const variance = item.physicalStock - soItem.systemStock;
      const variancePercentage =
        soItem.systemStock > 0
          ? Number(((Math.abs(variance) / soItem.systemStock) * 100).toFixed(2))
          : 0;

      await db
        .update(stockOpnameItems)
        .set({
          physicalStock: item.physicalStock,
          variance,
          variancePercentage: String(variancePercentage),
        })
        .where(eq(stockOpnameItems.id, item.itemId));
    }

    // Always set to "Submitted" — supervisor decides if investigation is needed
    const newStatus = "Submitted";

    await db
      .update(stockOpnames)
      .set({
        status: newStatus,
        submittedBy: user.id,
      })
      .where(eq(stockOpnames.id, data.soId));

    await logSystemAction(
      user,
      "Submit Stock Opname",
      `Stock opname "${data.soId}" disubmit oleh ${user.name}`,
    );
    await logAudit(
      user,
      "stockOpnames",
      data.soId,
      "STATUS_CHANGE",
      oldSo as Record<string, unknown>,
      { ...oldSo, status: newStatus } as Record<string, unknown>,
    );

    return { success: true, status: newStatus };
  });

export const markStockOpnameInvestigation = createServerFn({ method: "POST" })
  .inputValidator((data: { soId: string; investigationNote?: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuth();
    await requireRole("super_admin", "area_manager");

    const [so] = await db
      .select()
      .from(stockOpnames)
      .where(eq(stockOpnames.id, data.soId))
      .limit(1);

    if (!so) throw new Error("Stock opname not found");
    if (so.status !== "Submitted") throw new Error("Stock opname is not in Submitted status");

    const oldSo = { ...so };

    await db
      .update(stockOpnames)
      .set({
        status: "Under Investigation",
        investigationNote: data.investigationNote || null,
      })
      .where(eq(stockOpnames.id, data.soId));

    await logSystemAction(
      user,
      "Mark SO Investigation",
      `Stock opname "${data.soId}" ditandai Under Investigation oleh ${user.name}`,
    );
    await logAudit(
      user,
      "stockOpnames",
      data.soId,
      "STATUS_CHANGE",
      oldSo as Record<string, unknown>,
      { ...oldSo, status: "Under Investigation", investigationNote: data.investigationNote } as Record<string, unknown>,
    );

    // Notify branch admin
    await db.insert(systemNotifications).values({
      userId: so.submittedBy,
      title: "SO Under Investigation",
      message: `Stock opname memerlukan hitung ulang. ${data.investigationNote ? "Catatan: " + data.investigationNote : ""}`,
      type: "warning",
    });

    return { success: true };
  });

export const approveStockOpname = createServerFn({ method: "POST" })
  .inputValidator((data: { soId: string; investigationNote?: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuth();
    await requireRole("super_admin", "area_manager");

    // Get the SO
    const [so] = await db
      .select()
      .from(stockOpnames)
      .where(eq(stockOpnames.id, data.soId))
      .limit(1);

    if (!so) throw new Error("Stock opname not found");

    const oldSo = { ...so };

    // Adjust inventory to physical stock
    const items = await db
      .select()
      .from(stockOpnameItems)
      .where(eq(stockOpnameItems.stockOpnameId, data.soId));

    for (const item of items) {
      // Find inventory record
      const [inv] = await db
        .select()
        .from(inventory)
        .where(
          and(eq(inventory.branchId, so.branchId), eq(inventory.ingredientId, item.ingredientId)),
        )
        .limit(1);

      if (inv) {
        await db
          .update(inventory)
          .set({
            quantity: item.physicalStock,
            lastUpdated: new Date(),
          })
          .where(eq(inventory.id, inv.id));

        // Create ledger adjustment entry using current inventory as reference
        const currentVariance = item.physicalStock - inv.quantity;
        if (currentVariance !== 0) {
          await db.insert(stockLedger).values({
            branchId: so.branchId,
            ingredientId: item.ingredientId,
            type: currentVariance > 0 ? "IN" : "OUT",
            quantity: Math.abs(currentVariance),
            balance: item.physicalStock,
            reference: data.soId,
            notes: `SO Adjustment${data.investigationNote ? ": " + data.investigationNote : ""}`,
          });
        }

        // Alert if inventory went negative
        if (item.physicalStock < 0) {
          await db.insert(systemNotifications).values({
            userId: so.submittedBy,
            title: "⚠️ Stok Negatif setelah SO",
            message: `Item ${item.ingredientId} menjadi ${item.physicalStock} setelah penyesuaian SO.`,
            type: "alert",
          });
        }
      }
    }

    await db
      .update(stockOpnames)
      .set({
        status: "Approved",
        approvedBy: user.id,
        investigationNote: data.investigationNote || null,
      })
      .where(eq(stockOpnames.id, data.soId));

    // Notify the branch admin who submitted the SO
    await db.insert(systemNotifications).values({
      userId: so.submittedBy,
      title: "Stock Opname Approved",
      message: `Stock opname cabang telah disetujui oleh ${user.name}${data.investigationNote ? ". Catatan: " + data.investigationNote : ""}`,
      type: "info",
    });

    // Also notify area managers if there was significant variance
    const soItems = await db
      .select()
      .from(stockOpnameItems)
      .where(eq(stockOpnameItems.stockOpnameId, data.soId));
    const highVariance = soItems.filter((i) => {
      const pct = i.variancePercentage ? Number(i.variancePercentage) : 0;
      return pct > 3;
    });
    if (highVariance.length > 0) {
      const ams = await db
        .select({ userId: areaManagerBranches.userId })
        .from(areaManagerBranches)
        .where(eq(areaManagerBranches.branchId, so.branchId));
      for (const am of ams) {
        await db.insert(systemNotifications).values({
          userId: am.userId,
          title: "⚠️ Variance SO Signifikan",
          message: `${highVariance.length} item memiliki variance > 3% pada SO ${data.soId.slice(0, 8)}`,
          type: "alert",
        });
      }
    }

    await logSystemAction(
      user,
      "Approve Stock Opname",
      `Stock opname "${data.soId}" diapprove oleh ${user.name}`,
    );
    await logAudit(
      user,
      "stockOpnames",
      data.soId,
      "STATUS_CHANGE",
      oldSo as Record<string, unknown>,
      { ...oldSo, status: "Approved", approvedBy: user.id } as Record<string, unknown>,
    );

    return { success: true };
  });

export const updateStockOpnameCounts = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { soId: string; items: { itemId: string; physicalStock: number }[] }) => data,
  )
  .handler(async ({ data }) => {
    const user = await requireAuth();
    // Branch admin and supervisors can update during investigation
    await requireRole("branch_admin", "super_admin", "area_manager");

    const [so] = await db
      .select()
      .from(stockOpnames)
      .where(eq(stockOpnames.id, data.soId))
      .limit(1);

    if (!so) throw new Error("Stock opname not found");
    if (so.status !== "Under Investigation")
      throw new Error("Stock opname is not under investigation");
    // Branch admin can only update their own branch SOs
    if (user.role === "branch_admin" && user.branchId && so.branchId !== user.branchId)
      throw new Error("Unauthorized: you can only update Stock Opnames for your branch");

    const oldSo = { ...so };

    for (const item of data.items) {
      const [soItem] = await db
        .select()
        .from(stockOpnameItems)
        .where(eq(stockOpnameItems.id, item.itemId))
        .limit(1);

      if (!soItem) continue;

      const variance = item.physicalStock - soItem.systemStock;
      const variancePercentage =
        soItem.systemStock > 0
          ? Number(((Math.abs(variance) / soItem.systemStock) * 100).toFixed(2))
          : 0;

      await db
        .update(stockOpnameItems)
        .set({
          physicalStock: item.physicalStock,
          variance,
          variancePercentage: String(variancePercentage),
        })
        .where(eq(stockOpnameItems.id, item.itemId));
    }

    await logSystemAction(
      user,
      "Update SO Counts",
      `Branch Admin updated counts for SO ${data.soId}`,
    );
    await logAudit(
      user,
      "stockOpnames",
      data.soId,
      "UPDATE",
      oldSo as Record<string, unknown>,
      { ...oldSo, items: data.items } as Record<string, unknown>,
    );

    return { success: true };
  });

export const getAssignedBranchIds = createServerFn({ method: "GET" })
  .handler(async () => {
    const user = await requireAuth();

    if (user.role === "area_manager") {
      const assigned = await db
        .select({ branchId: areaManagerBranches.branchId })
        .from(areaManagerBranches)
        .where(eq(areaManagerBranches.userId, user.id));
      return assigned.map((a) => a.branchId);
    }

    return [];
  });
