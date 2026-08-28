import { createServerFn } from "@tanstack/react-start";
import { db } from "#/lib/server/db";
import {
  inventory,
  stockLedger,
  ingredients,
  branches,
  recipes,
  stockOpnames,
  stockOpnameItems,
  systemNotifications,
  areaManagerBranches,
} from "#/db/schema";
import { eq, and, or, desc, asc, count, inArray, sql, ilike, ne } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { fuzzySearch, fuzzyRank } from "./fuzzy";
import { requireAuth, requireRole } from "./auth";
import { logSystemAction, logAudit } from "./logging";
import { escapeHtml, buildPrintHtml } from "./html-utils";

export const getInventory = createServerFn({ method: "GET" })
  .validator(
    (data: {
      branchId?: string;
      search?: string;
      category?: "Fresh" | "Dry" | "Packaging" | null;
      skuType?: "RM" | "SFG" | "FG" | null;
      locationType?: "Central" | "Outlet" | null; // ID18
      // Skip the outlet-catalog (isBranchVisible) filter and return the branch's
      // actual stock — used by the waste modal, where a branch can physically
      // hold and waste items outside its display catalog.
      includeNonCatalog?: boolean;
      page?: number;
      limit?: number;
      sortBy?: string;
      sortOrder?: "asc" | "desc";
      negative?: boolean;
    }) => data,
  )
  .handler(async ({ data }) => {
    const user = await requireAuth();

    // Always use the provided branchId for filtering
    // For branch_admin, override with their assigned branch
    let branchFilter = data.branchId;
    if (user.role === "branch_admin" && user.branchId) {
      branchFilter = user.branchId;
    }

    // Ensure pg_trgm is available for similarity(); ignore if the DB user lacks CREATE privilege
    // (the fallback ILIKE path below will keep search usable).
    try {
      await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    } catch {
      // ignore - will fallback to ILIKE-only search if similarity() is missing
    }

    const buildSearchCondition = (term: string) =>
      fuzzySearch([ingredients.name, ingredients.code], term);
    const buildFallbackSearchCondition = (term: string) =>
      sql`(${ilike(ingredients.name, `%${term}%`)} OR ${ilike(ingredients.code, `%${term}%`)})`;

    // Outlet branches only see their branch (outlet) catalog — same rule as the
    // stock-opname catalog and the ingredient master (getIngredients). Central
    // warehouse and management views keep everything. Callers that need actual
    // stock (waste modal) opt out via `includeNonCatalog`.
    const branchCatalogCondition = data.includeNonCatalog
      ? undefined
      : or(ne(branches.type, "Outlet"), eq(ingredients.isBranchVisible, true));

    let useFallback = false;
    const conditions = [
      branchFilter ? eq(inventory.branchId, branchFilter) : undefined,
      data.search ? buildSearchCondition(data.search) : undefined,
      data.category ? eq(ingredients.category, data.category) : undefined,
      data.skuType ? eq(ingredients.skuType, data.skuType) : undefined,
      data.locationType ? eq(branches.type, data.locationType) : undefined, // ID18
      data.negative ? sql`${inventory.quantity} <= 0` : undefined,
      branchCatalogCondition,
    ];
    let where = and(...conditions.filter(Boolean));

    // Get total count — retry with ILIKE-only if pg_trgm/similarity() is unavailable
    let totalResult: { total: number } | undefined;
    try {
      [totalResult] = await db
        .select({ total: count() })
        .from(inventory)
        .leftJoin(ingredients, eq(inventory.ingredientId, ingredients.id))
        .leftJoin(branches, eq(inventory.branchId, branches.id))
        .where(where);
    } catch (e) {
      // SAFETY: caught value is unknown, narrow to Error to read message for pg_trgm fallback
      const msg = String((e as Error)?.message ?? e);
      if (data.search && (msg.includes("similarity") || msg.includes("pg_trgm"))) {
        useFallback = true;
        const fallbackConditions = [
          branchFilter ? eq(inventory.branchId, branchFilter) : undefined,
          data.search ? buildFallbackSearchCondition(data.search) : undefined,
          data.category ? eq(ingredients.category, data.category) : undefined,
          data.skuType ? eq(ingredients.skuType, data.skuType) : undefined,
          data.locationType ? eq(branches.type, data.locationType) : undefined,
          data.negative ? sql`${inventory.quantity} <= 0` : undefined,
          branchCatalogCondition,
        ];
        where = and(...fallbackConditions.filter(Boolean));
        [totalResult] = await db
          .select({ total: count() })
          .from(inventory)
          .leftJoin(ingredients, eq(inventory.ingredientId, ingredients.id))
          .leftJoin(branches, eq(inventory.branchId, branches.id))
          .where(where);
      } else {
        throw e;
      }
    }

    const total = totalResult?.total ?? 0;
    const limit = data.limit ? Math.min(data.limit, 1000) : 50;
    const offset = (data.page ?? 0) * limit;

    const orderByExpr = data.search
      ? useFallback
        ? asc(ingredients.name)
        : fuzzyRank([ingredients.name, ingredients.code], data.search)
      : (() => {
          const dir = data.sortOrder === "desc" ? desc : asc;
          switch (data.sortBy) {
            case "ingredientCode":
              return dir(ingredients.code);
            case "ingredientName":
              return dir(ingredients.name);
            case "ingredientSkuType":
              return dir(ingredients.skuType);
            case "ingredientCategory":
              return dir(ingredients.category);
            case "quantity":
              return dir(inventory.quantity);
            case "branchName":
              return dir(branches.name);
            default:
              return asc(ingredients.name);
          }
        })();

    let result;
    try {
      result = await db
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
        .orderBy(orderByExpr)
        .limit(limit)
        .offset(offset);
    } catch (e) {
      // SAFETY: caught value is unknown, narrow to Error to read message for pg_trgm fallback
      const msg = String((e as Error)?.message ?? e);
      if (data.search && !useFallback && (msg.includes("similarity") || msg.includes("pg_trgm"))) {
        // Fallback already prepared for count; reuse ILIKE ranking (simple name order)
        result = await db
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
          .orderBy(asc(ingredients.name))
          .limit(limit)
          .offset(offset);
      } else {
        throw e;
      }
    }

    return { data: result, total };
  });

/**
 * ADR 0013 — predicate matching ledger rows written by Waste BOM entries: the
 * row's reference is a waste entry with ingredientId set and a
 * `Waste BOM <recipe>` notes tag. When `bomRecipeName` is given, the tag must
 * match that recipe exactly (or `Waste BOM <recipe> - <notes>`), so "Iced Tea"
 * never catches "Iced Tea Latte".
 */
export function wasteBomLedgerFilter(bomRecipeName: string | null): SQL {
  const conditions = [
    // reference is text, waste_entries.id is uuid — cast the uuid side to text
    // so rows with non-UUID references (YIELD-*, PROD-*) don't break the scan.
    sql`we.id::text = ${stockLedger.reference}`,
    sql`we.ingredient_id IS NOT NULL`,
    sql`we.notes LIKE 'Waste BOM %'`,
  ];
  if (bomRecipeName) {
    conditions.push(
      sql`(we.notes = ${`Waste BOM ${bomRecipeName}`} OR we.notes LIKE ${`Waste BOM ${bomRecipeName} - %`})`,
    );
  }
  return sql`EXISTS (SELECT 1 FROM waste_entries we WHERE ${sql.join(conditions, sql` AND `)})`;
}

export const getStockLedger = createServerFn({ method: "GET" })
  .validator(
    (data: {
      branchId?: string;
      ingredientId?: string;
      recipeId?: string;
      reference?: string;
      search?: string;
      dateFrom?: string;
      dateTo?: string;
      page?: number;
      limit?: number;
      /** ADR 0013: only ledger rows written by Waste BOM entries. */
      wasteBomOnly?: boolean;
      /** ADR 0013: Waste BOM rows scoped to one recipe (implies wasteBomOnly). */
      wasteBomRecipeId?: string;
    }) => data,
  )
  .handler(async ({ data }) => {
    const user = await requireAuth();
    // Kartu Stok is branch-scoped for Branch Admin. Never trust a client-supplied
    // branchId, and do not allow an omitted filter to become a global read.
    const effectiveBranchId = user.role === "branch_admin" ? user.branchId : data.branchId;
    if (user.role === "branch_admin" && !effectiveBranchId) {
      throw new Error("Branch Admin tidak memiliki cabang");
    }

    // Waste BOM ledger rows carry ingredientId (recipeId null); the recipe
    // context lives in the linked waste entry's notes tag — "Waste BOM <recipe>"
    // exactly, or "Waste BOM <recipe> - <user notes>". Resolve the recipe name
    // once so the tag match is exact rather than a fuzzy prefix ("Iced Tea"
    // must not catch "Iced Tea Latte").
    let bomRecipeName: string | null = null;
    if (data.wasteBomRecipeId) {
      const [bomRecipe] = await db
        .select({ name: recipes.name })
        .from(recipes)
        .where(eq(recipes.id, data.wasteBomRecipeId))
        .limit(1);
      if (!bomRecipe) return [];
      bomRecipeName = bomRecipe.name;
    }

    const result = await db
      .select({
        id: stockLedger.id,
        branchId: stockLedger.branchId,
        ingredientId: stockLedger.ingredientId,
        recipeId: stockLedger.recipeId,
        type: stockLedger.type,
        quantity: stockLedger.quantity,
        balance: stockLedger.balance,
        reference: stockLedger.reference,
        notes: stockLedger.notes,
        createdAt: stockLedger.createdAt,
        ingredientName: ingredients.name,
        recipeName: recipes.name,
        stockUnit: ingredients.stockUnit,
        branchName: branches.name,
      })
      .from(stockLedger)
      .leftJoin(ingredients, eq(stockLedger.ingredientId, ingredients.id))
      .leftJoin(recipes, eq(stockLedger.recipeId, recipes.id))
      .leftJoin(branches, eq(stockLedger.branchId, branches.id))
      .where(
        and(
          effectiveBranchId ? eq(stockLedger.branchId, effectiveBranchId) : undefined,
          data.ingredientId ? eq(stockLedger.ingredientId, data.ingredientId) : undefined,
          data.recipeId ? eq(stockLedger.recipeId, data.recipeId) : undefined,
          data.reference ? eq(stockLedger.reference, data.reference) : undefined,
          data.search
            ? fuzzySearch(
                [ingredients.name, recipes.name, stockLedger.reference, stockLedger.notes],
                data.search,
              )
            : undefined,
          data.wasteBomOnly || data.wasteBomRecipeId
            ? wasteBomLedgerFilter(bomRecipeName)
            : undefined,
        ),
      )
      .orderBy(desc(stockLedger.createdAt))
      .limit(data.limit ?? 50)
      .offset((data.page ?? 0) * (data.limit ?? 50));

    return result;
  });

export const triggerStockOpname = createServerFn({ method: "POST" })
  .validator((data: { branchId: string; date: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuth();
    // ID11: branch_admin can now trigger SO for their own branch
    await requireRole("super_admin", "admin_pusat", "area_manager", "branch_admin");

    // Branch admin can only trigger for their own branch
    if (user.role === "branch_admin" && user.branchId && data.branchId !== user.branchId) {
      throw new Error("Branch Admin hanya bisa trigger SO untuk cabang sendiri");
    }

    // Outlet SOs only carry the branch (outlet) catalog (isBranchVisible = true);
    // central-warehouse SOs include everything. Deleted ingredients are
    // tombstoned from the master and never appear in an SO (mirrors getIngredients).
    const [branch] = await db
      .select({ type: branches.type })
      .from(branches)
      .where(eq(branches.id, data.branchId))
      .limit(1);
    const isOutlet = branch?.type === "Outlet";

    // Get current inventory for the branch (only countable items)
    const invItems = await db
      .select({
        ingredientId: inventory.ingredientId,
        quantity: inventory.quantity,
      })
      .from(inventory)
      .leftJoin(ingredients, eq(inventory.ingredientId, ingredients.id))
      .where(
        and(
          eq(inventory.branchId, data.branchId),
          eq(ingredients.countable, true),
          ne(ingredients.status, "Deleted"),
          isOutlet ? eq(ingredients.isBranchVisible, true) : undefined,
        ),
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
    await logAudit(user, "stockOpnames", so.id, "CREATE", undefined, so);

    return so;
  });

export const getStockOpnames = createServerFn({ method: "GET" })
  .validator((data: { branchId?: string }) => data)
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
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuth();

    const [so] = await db.select().from(stockOpnames).where(eq(stockOpnames.id, data.id)).limit(1);

    if (!so) return null;

    // Branch access check
    if (user.role === "branch_admin" && user.branchId && so.branchId !== user.branchId) {
      throw new Error("Unauthorized: you can only view Stock Opnames for your branch");
    }

    // Fetch branch name + type (type decides the SO catalog below)
    const [branch] = await db
      .select({ name: branches.name, type: branches.type })
      .from(branches)
      .where(eq(branches.id, so.branchId))
      .limit(1);

    // Outlet SOs only show the branch (outlet) catalog; central-warehouse SOs
    // show everything. Deleted ingredients are tombstoned from the master and
    // never shown (mirrors getIngredients).
    const isOutlet = branch?.type === "Outlet";

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
        isNasi: ingredients.isNasi,
      })
      .from(stockOpnameItems)
      .leftJoin(ingredients, eq(stockOpnameItems.ingredientId, ingredients.id))
      .where(
        and(
          eq(stockOpnameItems.stockOpnameId, data.id),
          ne(ingredients.status, "Deleted"),
          isOutlet ? eq(ingredients.isBranchVisible, true) : undefined,
        ),
      );

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
            systemStock: 0,
            variance: 0,
          }))
        : items,
      isBlind,
    };
  });

export const submitStockOpname = createServerFn({ method: "POST" })
  .validator((data: { soId: string; items: { itemId: string; physicalStock: number }[] }) => data)
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
    await logAudit(user, "stockOpnames", data.soId, "STATUS_CHANGE", oldSo, {
      ...oldSo,
      status: newStatus,
    });

    return { success: true, status: newStatus };
  });

export const markStockOpnameInvestigation = createServerFn({ method: "POST" })
  .validator((data: { soId: string; investigationNote?: string }) => data)
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
    await logAudit(user, "stockOpnames", data.soId, "STATUS_CHANGE", oldSo, {
      ...oldSo,
      status: "Under Investigation",
      investigationNote: data.investigationNote,
    });

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
  .validator((data: { soId: string; investigationNote?: string }) => data)
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

    // State guard: approval only proceeds from a counted SO (Submitted or
    // Under Investigation), and never re-approves an Approved one. A freshly
    // triggered SO is also "Submitted" (no enum for triggered), so the
    // blank-count guard below is what stops approving an uncounted SO.
    if (so.status === "Approved") {
      throw new Error("Stock opname sudah di-approve");
    }
    if (so.status !== "Submitted" && so.status !== "Under Investigation") {
      throw new Error(
        "Stock opname harus berstatus Submitted atau Under Investigation untuk di-approve",
      );
    }

    const oldSo = { ...so };

    // Adjust inventory to physical stock
    const items = await db
      .select()
      .from(stockOpnameItems)
      .where(eq(stockOpnameItems.stockOpnameId, data.soId));

    // Blank-submit guard (FRD §4.3 pattern 1): never approve an SO whose
    // counts were never entered — approving one would zero out inventory.
    if (items.length > 0 && items.every((i) => i.physicalStock === 0)) {
      throw new Error(
        "Belum ada stok fisik yang diisi. Simpan opname (submit) terlebih dahulu sebelum approve.",
      );
    }

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
    await logAudit(user, "stockOpnames", data.soId, "STATUS_CHANGE", oldSo, {
      ...oldSo,
      status: "Approved",
      approvedBy: user.id,
    });

    return { success: true };
  });

export const updateStockOpnameCounts = createServerFn({ method: "POST" })
  .validator((data: { soId: string; items: { itemId: string; physicalStock: number }[] }) => data)
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
    await logAudit(user, "stockOpnames", data.soId, "UPDATE", oldSo, {
      ...oldSo,
      items: data.items,
    });

    return { success: true };
  });

export const getAssignedBranchIds = createServerFn({ method: "GET" }).handler(async () => {
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

// ID12: Realize Stock Opname
// Applies SO results to live inventory on the 25th of the month
export const realizeStockOpname = createServerFn({ method: "POST" })
  .validator((data: { soId: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");

    // 1. Verify current date is the 25th
    const today = new Date();
    if (today.getDate() !== 25) {
      throw new Error("Stock Opname hanya bisa di-realize pada tanggal 25");
    }

    // 2. Get the SO and verify status is Approved
    const [so] = await db
      .select()
      .from(stockOpnames)
      .where(eq(stockOpnames.id, data.soId))
      .limit(1);

    if (!so) {
      throw new Error("Stock Opname tidak ditemukan");
    }

    if (so.status !== "Approved") {
      throw new Error("Stock Opname harus di-approve terlebih dahulu");
    }

    if (so.realizedAt) {
      throw new Error("Stock Opname sudah di-realize sebelumnya");
    }

    // 3. Get SO items with ingredient info
    const items = await db
      .select({
        id: stockOpnameItems.id,
        ingredientId: stockOpnameItems.ingredientId,
        physicalStock: stockOpnameItems.physicalStock,
        isNasi: ingredients.isNasi,
        ingredientName: ingredients.name,
      })
      .from(stockOpnameItems)
      .innerJoin(ingredients, eq(stockOpnameItems.ingredientId, ingredients.id))
      .where(eq(stockOpnameItems.stockOpnameId, data.soId));

    // Import Nasi conversion
    const { calculateNasiConversion } = await import("./nasi-conversion");
    const { ingredients: ingredientsTable } = await import("#/db/schema");

    // 4. For each item, adjust inventory to match physical stock
    for (const item of items) {
      // Special handling for Nasi: convert to raw ingredients
      if (item.isNasi) {
        const nasiPortions = item.physicalStock; // Physical stock = portions of Nasi
        const conversions = calculateNasiConversion(nasiPortions);

        for (const conv of conversions) {
          // Find the raw ingredient by name
          const [rawIngredient] = await db
            .select({ id: ingredientsTable.id })
            .from(ingredientsTable)
            .where(eq(ingredientsTable.name, conv.ingredientName))
            .limit(1);

          if (!rawIngredient) continue;

          // Get current inventory for this raw ingredient
          const [inv] = await db
            .select()
            .from(inventory)
            .where(
              and(
                eq(inventory.branchId, so.branchId),
                eq(inventory.ingredientId, rawIngredient.id),
              ),
            )
            .limit(1);

          if (inv) {
            // Nasi was made from raw ingredients, so subtract them
            const rawAmount = conv.totalAmount;
            const newQty = Math.max(0, inv.quantity - rawAmount);

            await db
              .update(inventory)
              .set({ quantity: newQty, lastUpdated: new Date() })
              .where(eq(inventory.id, inv.id));

            if (rawAmount > 0) {
              await db.insert(stockLedger).values({
                branchId: so.branchId,
                ingredientId: rawIngredient.id,
                type: "OUT",
                quantity: rawAmount,
                balance: newQty,
                reference: `SO:${data.soId}`,
                notes: `SO Realization: Nasi ${nasiPortions} porsi → ${conv.ingredientName} -${rawAmount}${conv.unit}`,
              });
            }
          }
        }
        // Skip the normal inventory adjustment for Nasi
        continue;
      }

      // Normal items: adjust inventory to match physical stock
      const [inv] = await db
        .select()
        .from(inventory)
        .where(
          and(eq(inventory.branchId, so.branchId), eq(inventory.ingredientId, item.ingredientId)),
        )
        .limit(1);

      if (inv) {
        const oldQty = inv.quantity;
        const newQty = item.physicalStock;
        const delta = newQty - oldQty;

        // Update inventory
        await db
          .update(inventory)
          .set({
            quantity: newQty,
            lastUpdated: new Date(),
          })
          .where(eq(inventory.id, inv.id));

        // Create stock ledger entry for the adjustment
        if (delta !== 0) {
          await db.insert(stockLedger).values({
            branchId: so.branchId,
            ingredientId: item.ingredientId,
            type: delta > 0 ? "IN" : "OUT",
            quantity: Math.abs(delta),
            balance: newQty,
            reference: `SO:${data.soId}`,
            notes: `SO Realization: Adjusted from ${oldQty} to ${newQty}`,
          });
        }
      }
    }

    // 5. Mark SO as realized
    await db
      .update(stockOpnames)
      .set({
        realizedAt: new Date(),
        realizedBy: user.id,
      })
      .where(eq(stockOpnames.id, data.soId));

    // 6. Log the action
    await logSystemAction(
      user,
      "Realize SO",
      `Stock Opname ${data.soId} realized by ${user.name}. Inventory adjusted for ${items.length} items.`,
    );

    return { success: true, itemsAdjusted: items.length };
  });

// ID13: Print Stock Opname to PDF (HTML + browser print)
export const printStockOpname = createServerFn({ method: "GET" })
  .validator((data: { soId: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuth();

    const [so] = await db
      .select()
      .from(stockOpnames)
      .where(eq(stockOpnames.id, data.soId))
      .limit(1);
    if (!so) throw new Error("Stock Opname not found");

    // Branch access check (mirrors getStockOpnameDetail)
    if (user.role === "branch_admin" && user.branchId && so.branchId !== user.branchId) {
      throw new Error("Unauthorized: you can only print Stock Opnames for your branch");
    }
    if (user.role === "admin_pusat") {
      const [centralBranch] = await db
        .select({ id: branches.id })
        .from(branches)
        .where(eq(branches.type, "Central"))
        .limit(1);
      if (centralBranch && so.branchId !== centralBranch.id) {
        throw new Error("Unauthorized: Admin Pusat can only print Central Warehouse Stock Opnames");
      }
    }

    const [branch] = await db.select().from(branches).where(eq(branches.id, so.branchId)).limit(1);

    // Outlet SOs only carry the branch (outlet) catalog; Deleted ingredients are
    // tombstoned from the master and never shown (mirrors getStockOpnameDetail).
    const isOutlet = branch?.type === "Outlet";

    const items = await db
      .select({
        id: stockOpnameItems.id,
        ingredientName: ingredients.name,
        ingredientCode: ingredients.code,
        systemStock: stockOpnameItems.systemStock,
        physicalStock: stockOpnameItems.physicalStock,
        variance: stockOpnameItems.variance,
      })
      .from(stockOpnameItems)
      .innerJoin(ingredients, eq(stockOpnameItems.ingredientId, ingredients.id))
      .where(
        and(
          eq(stockOpnameItems.stockOpnameId, data.soId),
          ne(ingredients.status, "Deleted"),
          isOutlet ? eq(ingredients.isBranchVisible, true) : undefined,
        ),
      )
      .orderBy(ingredients.name);

    // Blind SO: branch admins (and admin pusat on the central warehouse) must
    // not see system stock or variance — same rule as getStockOpnameDetail.
    const isBlind = user.role === "branch_admin" || user.role === "admin_pusat";

    const rows = items
      .map(
        (it, idx) => `
        <tr>
          <td style="text-align:center;">${idx + 1}</td>
          <td>${escapeHtml(it.ingredientCode ?? "")}</td>
          <td>${escapeHtml(it.ingredientName ?? "")}</td>
          ${
            isBlind
              ? `<td style="text-align:right;">${it.physicalStock.toLocaleString("id-ID")}</td>`
              : `<td style="text-align:right;">${it.systemStock.toLocaleString("id-ID")}</td>
          <td style="text-align:right;">${it.physicalStock.toLocaleString("id-ID")}</td>
          <td style="text-align:right;">${it.variance > 0 ? "+" : ""}${it.variance.toLocaleString("id-ID")}</td>`
          }
        </tr>`,
      )
      .join("");

    const statusLabel =
      so.status === "Approved"
        ? "Disetujui"
        : so.status === "Under Investigation"
          ? "Investigasi"
          : so.status;

    const body = `
<div class="header-flex">
  <div>
    <div class="title">Laporan Stock Opname</div>
    <div class="subtitle">${escapeHtml(branch?.name ?? "")} (${escapeHtml(branch?.code ?? "")})${isBlind ? " — Blind SO (Stok Sistem Tidak Ditampilkan)" : ""}</div>
  </div>
  <div class="meta">
    <div><strong>Tanggal:</strong> ${so.date}</div>
    <div><strong>Status:</strong> ${statusLabel}</div>
    <div><strong>Dibuat:</strong> ${new Date(so.createdAt).toLocaleDateString("id-ID")}</div>
  </div>
</div>
<table>
<thead><tr>
  <th style="width:40pt;">No</th>
  <th style="width:80pt;">Kode</th>
  <th>Nama Bahan</th>
  ${
    isBlind
      ? `<th style="width:80pt;text-align:right;">Stok Fisik</th>`
      : `<th style="width:80pt;text-align:right;">Stok Sistem</th>
  <th style="width:80pt;text-align:right;">Stok Fisik</th>
  <th style="width:80pt;text-align:right;">Selisih</th>`
  }
</tr></thead>
<tbody>${rows}</tbody>
</table>
<div class="signature">
  <div><p>Pencatat,</p><div class="line">( &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; )</div></div>
  <div><p>Mengetahui,</p><div class="line">( &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; )</div></div>
  <div><p>Menyetujui,</p><div class="line">( &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; )</div></div>
</div>`;

    return { html: buildPrintHtml(`Stock Opname ${branch?.name ?? ""}`, body, "landscape") };
  });

// Super Admin manual stock adjustment (batch) — adjust stock across one or many
// branches in one atomic action. Each line is a signed IN/OUT; the whole batch
// shares a single `reference` (one adjustment event, many ledger rows) and one
// reason, and is applied to every selected branch.
// Does NOT touch ingredients.averageCost (the global COGS basis). A line for an
// ingredient the branch has never stocked is auto-created on IN; OUT on a
// missing line is rejected so stock cannot be fabricated.
export const adjustBranchStockBatch = createServerFn({ method: "POST" })
  .validator(
    (data: {
      branchIds: string[];
      reason: string;
      items: { ingredientId: string; direction: "IN" | "OUT"; quantity: number }[];
    }) => data,
  )
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin");

    const branchIds = (data.branchIds ?? []).filter(Boolean);
    if (branchIds.length === 0) {
      throw new Error("Minimal satu cabang harus dipilih");
    }
    const reason = (data.reason ?? "").trim();
    if (!reason) {
      throw new Error("Alasan penyesuaian wajib diisi");
    }
    if (!Array.isArray(data.items) || data.items.length === 0) {
      throw new Error("Minimal satu bahan harus dipilih");
    }

    const seen = new Set<string>();
    for (const it of data.items) {
      if (!it.ingredientId) {
        throw new Error("Setiap baris harus memilih bahan");
      }
      if (!Number.isFinite(it.quantity) || it.quantity <= 0) {
        throw new Error("Jumlah setiap baris harus lebih dari 0");
      }
      if (seen.has(it.ingredientId)) {
        throw new Error("Bahan duplikat dalam satu penyesuaian");
      }
      seen.add(it.ingredientId);
    }

    const reference = `ADJ-${Date.now().toString(36).toUpperCase()}${Math.random()
      .toString(36)
      .slice(2, 6)
      .toUpperCase()}`;

    const results: {
      inventoryId: string;
      branchId: string;
      ingredientId: string;
      oldQuantity: number;
      newQuantity: number;
      direction: "IN" | "OUT";
    }[] = [];

    await db.transaction(async (tx) => {
      for (const branchId of branchIds) {
        for (const it of data.items) {
          const signedDelta = it.direction === "IN" ? it.quantity : -it.quantity;

          const [existing] = await tx
            .select()
            .from(inventory)
            .where(
              and(eq(inventory.branchId, branchId), eq(inventory.ingredientId, it.ingredientId)),
            )
            .limit(1);

          let inventoryId: string;
          const oldQuantity = existing?.quantity ?? 0;

          if (existing) {
            inventoryId = existing.id;
          } else {
            if (it.direction === "OUT") {
              throw new Error(`Bahan belum ada di cabang ${branchId}; tidak dapat mengurangi`);
            }
            const [inserted] = await tx
              .insert(inventory)
              .values({
                branchId,
                ingredientId: it.ingredientId,
                quantity: 0,
              })
              .returning();
            inventoryId = inserted.id;
          }

          const newQuantity = oldQuantity + signedDelta;

          await tx
            .update(inventory)
            .set({ quantity: newQuantity, lastUpdated: new Date() })
            .where(eq(inventory.id, inventoryId));

          await tx.insert(stockLedger).values({
            branchId,
            ingredientId: it.ingredientId,
            type: it.direction,
            quantity: it.quantity,
            balance: newQuantity,
            reference,
            notes: reason,
          });

          results.push({
            inventoryId,
            branchId,
            ingredientId: it.ingredientId,
            oldQuantity,
            newQuantity,
            direction: it.direction,
          });
        }
      }
    });

    for (const r of results) {
      await logAudit(
        user,
        "inventory",
        r.inventoryId,
        "UPDATE",
        { quantity: r.oldQuantity },
        {
          quantity: r.newQuantity,
          direction: r.direction,
          reason,
          reference,
          branchId: r.branchId,
        },
      );
    }

    await logSystemAction(
      user,
      "Penyesuaian Stok Manual (Batch)",
      `Super Admin ${user.name} menyesuaikan ${data.items.length} bahan di ${branchIds.length} cabang (ref ${reference}). Alasan: ${reason}`,
    );

    return {
      success: true,
      reference,
      count: data.items.length,
      branchCount: branchIds.length,
      results,
    };
  });

// Super Admin "Clean Slate" — delete inventory rows (the items) for a single
// branch or for every branch, resetting stock to empty. This is destructive: it
// removes the rows entirely (not just zeroes quantity). stockLedger and
// ingredients.averageCost are intentionally left intact for audit/COGS. Pass
// `branchId: null` (or omit) to wipe ALL branches.
export const cleanSlateInventory = createServerFn({ method: "POST" })
  .validator((data: { branchId?: string | null; alsoLedger?: boolean }) => data)
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin");
    const branchId = data.branchId || undefined;
    const alsoLedger = !!data.alsoLedger;
    const scopeCondition = branchId ? eq(inventory.branchId, branchId) : undefined;

    const [{ count: deleted } = { count: 0 }] = await db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(inventory)
      .where(scopeCondition ?? sql`1=1`);

    await db.transaction(async (tx) => {
      if (branchId) {
        await tx.delete(inventory).where(eq(inventory.branchId, branchId));
      } else {
        await tx.delete(inventory);
      }
      if (alsoLedger) {
        if (branchId) {
          await tx.delete(stockLedger).where(eq(stockLedger.branchId, branchId));
        } else {
          await tx.delete(stockLedger);
        }
      }
    });

    await logSystemAction(
      user,
      "Clean Slate Inventori",
      `Super Admin ${user.name} menghapus seluruh baris inventori${
        branchId ? ` di cabang ${branchId}` : " (SEMUA cabang)"
      }. ${deleted} baris dihapus${alsoLedger ? "; stockLedger ikut dihapus" : ""}.`,
    );
    await logAudit(
      user,
      "inventory",
      branchId ?? "ALL",
      "DELETE",
      { deleted, alsoLedger },
      undefined,
    );

    return { success: true, deleted, alsoLedger, branchId: branchId ?? null };
  });
