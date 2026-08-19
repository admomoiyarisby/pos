import { createServerFn } from "@tanstack/react-start";
import { db } from "#/lib/server/db";
import {
  recipes,
  recipeBrands,
  brands,
  recipeIngredients,
  recipeChildRecipes,
  recipeModifierGroups,
  modifierGroups,
  modifiers,
  inventory,
  stockLedger,
  orders,
  orderItems,
  orderItemModifiers,
  orderItemExclusions,
  recipeModifierExclusions,
  recipeBranches,
  shifts,
  platformFees,
  branches,
  systemNotifications,
  areaManagerBranches,
  printRequests,
  cancelRequests,
  users,
} from "#/db/schema";
import { eq, and, desc, inArray, sql } from "drizzle-orm";
import { requireAuth } from "./auth";
import { logSystemAction, logAudit } from "./logging";
import {
  resolveNewItemIngredients,
  resolvePersistedItemIngredients,
  type DbTx,
} from "./ingredient-resolver";
import { z } from "zod";

export const getPosMenu = createServerFn({ method: "GET" })
  .validator(
    (data: { branchId?: string; brandId?: string; category?: string; search?: string }) => data,
  )
  .handler(async ({ data }) => {
    await requireAuth();

    // Branch visibility: hide recipes that are assigned to other branches
    // but NOT to this branch. Recipes with no assignments are shown everywhere.
    const whereConditions: Array<ReturnType<typeof eq>> = [eq(recipes.status, "Active")];

    if (data.branchId) {
      // Has no branch assignments (unrestricted) OR is assigned to this branch
      whereConditions.push(
        sql`NOT EXISTS (SELECT 1 FROM ${recipeBranches} WHERE ${recipeBranches.recipeId} = ${recipes.id})
            OR EXISTS (SELECT 1 FROM ${recipeBranches} WHERE ${recipeBranches.recipeId} = ${recipes.id} AND ${recipeBranches.branchId} = ${data.branchId})`,
      );
    }

    const result = await db
      .select({
        id: recipes.id,
        code: recipes.code,
        name: recipes.name,
        imageUrl: recipes.imageUrl,
        category: recipes.category,
        basePrice: recipes.basePrice,
        isBOGO: recipes.isBOGO,
        isStaffMeal: recipes.isStaffMeal,
        status: recipes.status,
      })
      .from(recipes)
      .where(and(...whereConditions))
      .orderBy(recipes.name);

    const recipeIds = result.map((r) => r.id);

    // Batch fetch all related data
    const [brandLinks, modGroupLinks, allRecipeIngredients, childLinks] = await Promise.all([
      recipeIds.length > 0
        ? db
            .select({
              recipeId: recipeBrands.recipeId,
              brandId: recipeBrands.brandId,
              brandName: brands.name,
            })
            .from(recipeBrands)
            .leftJoin(brands, eq(recipeBrands.brandId, brands.id))
            .where(inArray(recipeBrands.recipeId, recipeIds))
        : [],
      recipeIds.length > 0
        ? db
            .select({
              recipeId: recipeModifierGroups.recipeId,
              modifierGroupId: recipeModifierGroups.modifierGroupId,
              groupName: modifierGroups.name,
              minSelection: modifierGroups.minSelection,
              maxSelection: modifierGroups.maxSelection,
            })
            .from(recipeModifierGroups)
            .leftJoin(modifierGroups, eq(recipeModifierGroups.modifierGroupId, modifierGroups.id))
            .where(inArray(recipeModifierGroups.recipeId, recipeIds))
        : [],
      recipeIds.length > 0
        ? db.select().from(recipeIngredients).where(inArray(recipeIngredients.recipeId, recipeIds))
        : [],
      recipeIds.length > 0
        ? db
            .select()
            .from(recipeChildRecipes)
            .where(inArray(recipeChildRecipes.parentRecipeId, recipeIds))
        : [],
    ]);

    const groupIds = [...new Set(modGroupLinks.map((m) => m.modifierGroupId))];
    const allModifiers =
      groupIds.length > 0
        ? await db
            .select({
              id: modifiers.id,
              modifierGroupId: modifiers.modifierGroupId,
              code: modifiers.code,
              name: modifiers.name,
              price: modifiers.price,
              isExclusion: modifiers.isExclusion,
            })
            .from(modifiers)
            .where(inArray(modifiers.modifierGroupId, groupIds))
        : [];

    const allModifierIds = [...new Set(allModifiers.map((m) => m.id))];
    const allExclusions =
      allModifierIds.length > 0
        ? await db
            .select()
            .from(recipeModifierExclusions)
            .where(inArray(recipeModifierExclusions.modifierId, allModifierIds))
        : [];

    return result
      .filter((r) => {
        if (data.brandId) {
          const rb = brandLinks.filter((b) => b.recipeId === r.id);
          return rb.some((b) => b.brandId === data.brandId);
        }
        if (data.category && r.category !== data.category) return false;
        if (data.search) {
          const q = data.search.toLowerCase();
          return r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q);
        }
        return true;
      })
      .map((r) => ({
        ...r,
        brands: brandLinks
          .filter((b) => b.recipeId === r.id)
          .map((b) => ({ id: b.brandId, name: b.brandName })),
        modifierGroups: modGroupLinks
          .filter((m) => m.recipeId === r.id)
          .map((g) => ({
            ...g,
            modifiers: allModifiers
              .filter((m) => m.modifierGroupId === g.modifierGroupId)
              .map((m) => ({
                id: m.id,
                name: m.name,
                price: m.price,
                isExclusion: m.isExclusion,
                excludedIngredientId: m.isExclusion
                  ? (allExclusions.find((e) => e.modifierId === m.id)?.ingredientId ?? null)
                  : null,
              })),
          })),
        ingredientIds: (() => {
          // Collect ingredients: parent recipe + child recipes (for bundles)
          const recipeIdsForStock = [r.id];
          for (const cl of childLinks.filter((c) => c.parentRecipeId === r.id)) {
            recipeIdsForStock.push(cl.childRecipeId);
          }
          // Aggregate quantities by ingredientId across all relevant recipes
          const agg = new Map<string, number>();
          for (const ri of allRecipeIngredients.filter((rri) =>
            recipeIdsForStock.includes(rri.recipeId),
          )) {
            agg.set(ri.ingredientId, (agg.get(ri.ingredientId) ?? 0) + ri.quantity);
          }
          // Double all quantities for BOGO items
          const factor = r.isBOGO ? 2 : 1;
          return [...agg.entries()].map(([ingredientId, quantity]) => ({
            ingredientId,
            quantity: quantity * factor,
          }));
        })(),
        isBundle: childLinks.some((c) => c.parentRecipeId === r.id),
        childRecipes: childLinks
          .filter((c) => c.parentRecipeId === r.id)
          .map((c) => ({ recipeId: c.childRecipeId, quantity: c.quantity })),
      }));
  });

export const getShiftStatus = createServerFn({ method: "GET" })
  .validator((data: { branchId: string; userId: string }) => data)
  .handler(async ({ data }) => {
    await requireAuth();

    const [openShift] = await db
      .select()
      .from(shifts)
      .where(
        and(
          eq(shifts.branchId, data.branchId),
          eq(shifts.userId, data.userId),
          eq(shifts.status, "Open"),
        ),
      )
      .orderBy(shifts.startTime)
      .limit(1);

    return openShift ?? null;
  });

export const openShift = createServerFn({ method: "POST" })
  .validator((data: { branchId: string; userId: string; cashFloat: number }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuth();

    const [shift] = await db
      .insert(shifts)
      .values({
        branchId: data.branchId,
        userId: data.userId,
        startTime: new Date(),
        cashFloat: data.cashFloat,
        status: "Open",
      })
      .returning();

    const [branch] = await db
      .select({ name: branches.name })
      .from(branches)
      .where(eq(branches.id, data.branchId))
      .limit(1);

    await logSystemAction(
      user,
      "Open Shift",
      `Shift dibuka di cabang "${branch?.name ?? data.branchId}" oleh ${user.name}`,
    );
    await logAudit(user, "shifts", shift.id, "CREATE", undefined, shift);

    return shift;
  });

export const closeShift = createServerFn({ method: "POST" })
  .validator((data: { shiftId: string; actualCash: number; notes?: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuth();

    const [oldShift] = await db.select().from(shifts).where(eq(shifts.id, data.shiftId)).limit(1);

    const [shift] = await db
      .update(shifts)
      .set({
        endTime: new Date(),
        actualCash: data.actualCash,
        status: "Closed",
        notes: data.notes,
      })
      .where(eq(shifts.id, data.shiftId))
      .returning();

    const [branch] = await db
      .select({ name: branches.name })
      .from(branches)
      .where(eq(branches.id, shift.branchId))
      .limit(1);

    await logSystemAction(
      user,
      "Close Shift",
      `Shift ditutup di cabang "${branch?.name ?? shift.branchId}" oleh ${user.name}`,
    );
    await logAudit(user, "shifts", data.shiftId, "UPDATE", oldShift, shift);

    return shift;
  });

const orderItemInput = z.object({
  recipeId: z.string().uuid(),
  brandId: z.string().uuid().optional(),
  quantity: z.number().int().min(1),
  price: z.number().int().min(0),
  selectedModifiers: z
    .array(
      z.object({
        groupId: z.string().uuid(),
        modifierId: z.string().uuid(),
        price: z.number().int().min(0),
        isExclusion: z.boolean().optional(),
      }),
    )
    .optional(),
  notes: z.string().optional(),
});

export const createOrder = createServerFn({ method: "POST" })
  .validator(
    (data: {
      branchId: string;
      channel: "Gofood" | "Grabfood" | "ShopeeFood" | "Dine-in" | "TikTok";
      customerName?: string;
      orderCode?: string;
      items: z.infer<typeof orderItemInput>[];
      voucherCode?: string;
      voucherDiscount?: number;
      taxAmount?: number;
      paymentMethod?: string;
      shiftId?: string;
      notes?: string;
    }) => data,
  )
  .handler(async ({ data }) => {
    const user = await requireAuth();

    const [branchInfo] = await db
      .select({ name: branches.name })
      .from(branches)
      .where(eq(branches.id, data.branchId))
      .limit(1);
    const branchName = branchInfo?.name ?? data.branchId;

    // ─── Resolve ingredients ONCE per item (batched, includes cost) ───
    const resolvedPerItem = await Promise.all(
      data.items.map((item) =>
        resolveNewItemIngredients(item.recipeId, item.quantity, item.selectedModifiers, {
          includeCost: true,
        }),
      ),
    );

    // ─── Soft stock check + COGS calculation (read-only) ───
    const negativeStockAlerts: { ingredientName: string; shortfall: number; branchName: string }[] =
      [];
    let subtotal = 0;
    let totalCogs = 0;
    const voucherDiscount = data.voucherDiscount ?? 0;
    const taxAmount = data.taxAmount ?? 0;
    const itemCogsList: number[] = [];

    for (let i = 0; i < data.items.length; i++) {
      const item = data.items[i];
      const resolved = resolvedPerItem[i];

      subtotal += item.price * item.quantity;

      const itemCogs = resolved.ingredients.reduce((sum, ing) => sum + (ing.cost ?? 0), 0);
      itemCogsList.push(itemCogs);
      totalCogs += itemCogs;

      for (const ing of resolved.ingredients) {
        if (ing.quantity <= 0) continue;
        const [inv] = await db
          .select()
          .from(inventory)
          .where(
            and(
              eq(inventory.branchId, data.branchId),
              eq(inventory.ingredientId, ing.ingredientId),
            ),
          )
          .limit(1);
        const currentQty = inv?.quantity ?? 0;
        if (currentQty < ing.quantity) {
          negativeStockAlerts.push({
            ingredientName: ing.ingredientName,
            shortfall: ing.quantity - currentQty,
            branchName,
          });
        }
      }
    }

    const totalAmount = subtotal - voucherDiscount + taxAmount;

    const [fee] = await db
      .select()
      .from(platformFees)
      .where(eq(platformFees.channel, data.channel))
      .limit(1);
    const mdrFee = fee ? Math.round((subtotal * fee.feePercentage) / 100) + fee.fixedFee : 0;
    const netSales = totalAmount - mdrFee;

    // ─── All writes inside a single transaction ───
    const order = await db.transaction(async (tx) => {
      // Create order
      const [newOrder] = await tx
        .insert(orders)
        .values({
          branchId: data.branchId,
          channel: data.channel,
          subtotal,
          taxAmount,
          totalAmount,
          totalCogs,
          mdrFee,
          netSales,
          orderCode: data.orderCode,
          customerName: data.customerName,
          paymentMethod: data.paymentMethod,
          voucherCode: data.voucherCode,
          voucherDiscount,
          notes: data.notes,
          shiftId: data.shiftId,
        })
        .returning();

      // Create order items, modifiers, exclusions
      for (let i = 0; i < data.items.length; i++) {
        const item = data.items[i];
        const itemCogs = itemCogsList[i];
        const resolved = resolvedPerItem[i];

        const [orderItem] = await tx
          .insert(orderItems)
          .values({
            orderId: newOrder.id,
            recipeId: item.recipeId,
            brandId: item.brandId || undefined,
            quantity: item.quantity,
            price: item.price,
            cogsAtTransaction:
              item.quantity > 0 ? Math.max(0, Math.round(itemCogs / item.quantity)) : 0,
            notes: item.notes,
          })
          .returning();

        if (item.selectedModifiers?.length) {
          for (const mod of item.selectedModifiers) {
            await tx.insert(orderItemModifiers).values({
              orderItemId: orderItem.id,
              modifierGroupId: mod.groupId,
              modifierId: mod.modifierId,
            });
          }
        }

        for (const ex of resolved.exclusionRecords) {
          await tx.insert(orderItemExclusions).values({
            orderItemId: orderItem.id,
            ingredientId: ex.ingredientId,
            quantity: ex.quantity,
          });
        }
      }

      // Deduct inventory (with FOR UPDATE row locks to prevent double-spend)
      const seenIngredients = new Set<string>();
      for (let i = 0; i < data.items.length; i++) {
        const resolved = resolvedPerItem[i];
        for (const ing of resolved.ingredients) {
          if (seenIngredients.has(ing.ingredientId)) continue;
          seenIngredients.add(ing.ingredientId);

          const [inv] = await tx
            .select()
            .from(inventory)
            .where(
              and(
                eq(inventory.branchId, data.branchId),
                eq(inventory.ingredientId, ing.ingredientId),
              ),
            )
            .for("update")
            .limit(1);

          if (inv) {
            // Calculate net delta: sum across all items for this ingredient
            let netDelta = 0;
            for (let j = 0; j < data.items.length; j++) {
              const r = resolvedPerItem[j];
              const match = r.ingredients.find((x) => x.ingredientId === ing.ingredientId);
              if (match) netDelta += match.quantity;
            }

            const newQty = inv.quantity - netDelta;
            await tx
              .update(inventory)
              .set({ quantity: newQty, lastUpdated: new Date() })
              .where(eq(inventory.id, inv.id));

            await tx.insert(stockLedger).values({
              branchId: data.branchId,
              ingredientId: ing.ingredientId,
              type: netDelta > 0 ? "OUT" : "IN",
              quantity: Math.abs(netDelta),
              balance: newQty,
              reference: newOrder.id,
              notes:
                netDelta > 0
                  ? `POS Order ${newOrder.id.slice(0, 8)}`
                  : `Exclusion restore: ${newOrder.id.slice(0, 8)}`,
            });
          }
        }
      }

      return newOrder;
    });

    // ─── Notifications (non-critical, outside transaction) ───
    if (negativeStockAlerts.length > 0) {
      const ams = await db
        .select({ userId: areaManagerBranches.userId })
        .from(areaManagerBranches)
        .where(eq(areaManagerBranches.branchId, data.branchId));

      for (const alert of negativeStockAlerts) {
        for (const am of ams) {
          await db.insert(systemNotifications).values({
            userId: am.userId,
            title: "Stok Minus",
            message: `${alert.ingredientName}: minus ${alert.shortfall} di ${branchName}. Order #${order.id.slice(0, 8)}`,
            type: "alert",
          });
        }
      }
    }

    await logSystemAction(
      user,
      "Create Order",
      `Order #${order.orderCode ?? order.id.slice(0, 8)} (${data.channel}) Rp${totalAmount.toLocaleString()} dibuat oleh ${user.name}`,
    );
    await logAudit(user, "orders", order.id, "CREATE", undefined, order);

    return order;
  });

export const getOrders = createServerFn({ method: "GET" })
  .validator(
    (data: {
      branchId?: string;
      dateFrom?: string;
      dateTo?: string;
      status?: string;
      search?: string;
      limit?: number;
      page?: number;
    }) => data,
  )
  .handler(async ({ data }) => {
    await requireAuth();

    const limit = data.limit ?? 20;
    const offset = (data.page ?? 0) * limit;

    const result = await db
      .select({
        id: orders.id,
        branchId: orders.branchId,
        channel: orders.channel,
        subtotal: orders.subtotal,
        taxAmount: orders.taxAmount,
        totalAmount: orders.totalAmount,
        totalCogs: orders.totalCogs,
        orderCode: orders.orderCode,
        customerName: orders.customerName,
        paymentMethod: orders.paymentMethod,
        voucherCode: orders.voucherCode,
        voucherDiscount: orders.voucherDiscount,
        status: orders.status,
        voidReason: orders.voidReason,
        notes: orders.notes,
        shiftId: orders.shiftId,
        createdAt: orders.createdAt,
        completedAt: orders.completedAt,
      })
      .from(orders)
      .where(data.branchId ? eq(orders.branchId, data.branchId) : undefined)
      .orderBy(desc(orders.createdAt))
      .limit(limit)
      .offset(offset);

    return result;
  });

export const getOrderWithItems = createServerFn({ method: "GET" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    await requireAuth();

    const [order] = await db.select().from(orders).where(eq(orders.id, data.id)).limit(1);
    if (!order) return null;

    const items = await db
      .select({
        id: orderItems.id,
        recipeId: orderItems.recipeId,
        recipeName: recipes.name,
        quantity: orderItems.quantity,
        price: orderItems.price,
        cogsAtTransaction: orderItems.cogsAtTransaction,
        notes: orderItems.notes,
      })
      .from(orderItems)
      .leftJoin(recipes, eq(orderItems.recipeId, recipes.id))
      .where(eq(orderItems.orderId, data.id));

    const itemIds = items.map((i) => i.id);
    let mods: { orderItemId: string; modifierName: string | null }[] = [];
    if (itemIds.length > 0) {
      mods = await db
        .select({
          orderItemId: orderItemModifiers.orderItemId,
          modifierName: modifiers.name,
        })
        .from(orderItemModifiers)
        .leftJoin(modifiers, eq(orderItemModifiers.modifierId, modifiers.id))
        .where(inArray(orderItemModifiers.orderItemId, itemIds));
    }

    return {
      ...order,
      items: items.map((i) => ({
        ...i,
        modifiers: mods.filter((m) => m.orderItemId === i.id).map((m) => m.modifierName),
      })),
    };
  });

export const completeOrder = createServerFn({ method: "POST" })
  .validator((data: { orderId: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuth();

    const [old] = await db.select().from(orders).where(eq(orders.id, data.orderId)).limit(1);
    if (!old) throw new Error("Order not found");

    const [order] = await db
      .update(orders)
      .set({ status: "Completed", completedAt: new Date() })
      .where(eq(orders.id, data.orderId))
      .returning();

    await logSystemAction(
      user,
      "Complete Order",
      `Order #${order.orderCode ?? order.id.slice(0, 8)} diselesaikan oleh ${user.name}`,
    );
    await logAudit(user, "orders", data.orderId, "STATUS_CHANGE", old, order);

    return order;
  });

// ─── Shared helper: restore inventory for a voided order ───

async function restoreInventoryForVoid(
  orderId: string,
  branchId: string,
  reason: string,
  tx: DbTx,
): Promise<void> {
  const orderItemsList = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));

  const orderIdShort = orderId.slice(0, 8);

  for (const oi of orderItemsList) {
    const resolved = await resolvePersistedItemIngredients(oi.id, { tx });

    for (const ing of resolved.ingredients) {
      const [inv] = await tx
        .select()
        .from(inventory)
        .where(and(eq(inventory.branchId, branchId), eq(inventory.ingredientId, ing.ingredientId)))
        .for("update")
        .limit(1);

      if (inv) {
        const newQty = inv.quantity + ing.quantity;
        await tx
          .update(inventory)
          .set({ quantity: newQty, lastUpdated: new Date() })
          .where(eq(inventory.id, inv.id));

        if (ing.quantity !== 0) {
          await tx.insert(stockLedger).values({
            branchId,
            ingredientId: ing.ingredientId,
            type: ing.quantity > 0 ? "IN" : "OUT",
            quantity: Math.abs(ing.quantity),
            balance: newQty,
            reference: orderId,
            notes:
              ing.quantity > 0
                ? `Void Order ${orderIdShort}: ${reason}`
                : `Void re-deduct exclusion: ${orderIdShort}`,
          });
        }
      }
    }
  }
}

export const voidOrder = createServerFn({ method: "POST" })
  .validator((data: { orderId: string; reason: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuth();

    const [old] = await db.select().from(orders).where(eq(orders.id, data.orderId)).limit(1);
    if (!old) throw new Error("Order not found");
    if (old.status === "Void") throw new Error("Order sudah dibatalkan");

    const order = await db.transaction(async (tx) => {
      const [updatedOrder] = await tx
        .update(orders)
        .set({ status: "Void", voidReason: data.reason })
        .where(eq(orders.id, data.orderId))
        .returning();

      await restoreInventoryForVoid(data.orderId, old.branchId, data.reason, tx);

      return updatedOrder;
    });

    await logSystemAction(
      user,
      "Void Order",
      `Order #${order.orderCode ?? order.id.slice(0, 8)} dibatalkan oleh ${user.name}. Alasan: ${data.reason}`,
      "Warning",
    );
    await logAudit(user, "orders", data.orderId, "STATUS_CHANGE", old, order);

    return order;
  });

export const updateOrderStatus = createServerFn({ method: "POST" })
  .validator(
    z.object({
      orderId: z.string(),
      newStatus: z.enum(["New", "Processing", "In Delivery", "Completed"]),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireAuth();

    const [old] = await db.select().from(orders).where(eq(orders.id, data.orderId)).limit(1);

    if (!old) throw new Error("Order not found");

    const [updated] = await db
      .update(orders)
      .set({ status: data.newStatus })
      .where(eq(orders.id, data.orderId))
      .returning();

    await logAudit(user, "orders", data.orderId, "STATUS_CHANGE", old, updated);

    return updated;
  });

// ─── Print Request (Re-print Approval Flow) ───

export const requestReprint = createServerFn({ method: "POST" })
  .validator((data: { orderId: string; requestType?: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuth();

    // Return existing Pending request (don't create duplicates)
    const [existing] = await db
      .select()
      .from(printRequests)
      .where(and(eq(printRequests.orderId, data.orderId), eq(printRequests.status, "Pending")))
      .limit(1);

    if (existing) {
      return { ...existing, alreadyPending: true };
    }

    const [req] = await db
      .insert(printRequests)
      .values({
        orderId: data.orderId,
        requestType: data.requestType ?? "reprint",
        requestedBy: user.id,
        status: "Pending",
      })
      .returning();

    await logSystemAction(
      user,
      "Request Reprint",
      `Permintaan cetak ulang untuk order #${data.orderId.slice(0, 8)} oleh ${user.name}`,
    );

    return req;
  });

export const getReprintRequestStatus = createServerFn({ method: "GET" })
  .validator((data: { orderId: string }) => data)
  .handler(async ({ data }) => {
    await requireAuth();

    const [req] = await db
      .select({
        id: printRequests.id,
        orderId: printRequests.orderId,
        status: printRequests.status,
        approvedBy: printRequests.approvedBy,
        approvedAt: printRequests.approvedAt,
        createdAt: printRequests.createdAt,
      })
      .from(printRequests)
      .where(eq(printRequests.orderId, data.orderId))
      .orderBy(desc(printRequests.createdAt))
      .limit(1);

    return req ?? null;
  });

export const getPendingPrintRequests = createServerFn({ method: "GET" })
  .validator((data: { branchId?: string } | null | undefined) => data ?? {})
  .handler(async ({ data }) => {
    await requireAuth();

    const conditions = [eq(printRequests.status, "Pending")];
    if (data.branchId) {
      conditions.push(eq(orders.branchId, data.branchId));
    }

    const result = await db
      .select({
        id: printRequests.id,
        orderId: printRequests.orderId,
        requestType: printRequests.requestType,
        requestedBy: printRequests.requestedBy,
        requestedByName: users.name,
        status: printRequests.status,
        createdAt: printRequests.createdAt,
        orderCode: orders.orderCode,
        orderChannel: orders.channel,
        orderTotal: orders.totalAmount,
        orderCreatedAt: orders.createdAt,
      })
      .from(printRequests)
      .leftJoin(orders, eq(printRequests.orderId, orders.id))
      .leftJoin(users, eq(printRequests.requestedBy, users.id))
      .where(and(...conditions))
      .orderBy(desc(printRequests.createdAt));

    return result;
  });

export const approveReprint = createServerFn({ method: "POST" })
  .validator((data: { requestId: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuth();

    const [old] = await db
      .select()
      .from(printRequests)
      .where(eq(printRequests.id, data.requestId))
      .limit(1);

    if (!old) throw new Error("Print request not found");
    if (old.status !== "Pending") throw new Error("Request sudah diproses");

    const [req] = await db
      .update(printRequests)
      .set({
        status: "Approved",
        approvedBy: user.id,
        approvedAt: new Date(),
      })
      .where(eq(printRequests.id, data.requestId))
      .returning();

    // Notify the requesting cashier
    await db.insert(systemNotifications).values({
      userId: old.requestedBy,
      title: "Print Request Approved",
      message: `Permintaan cetak ulang untuk order #${old.orderId.slice(0, 8)} telah disetujui. Klik tombol Cetak untuk mencetak.`,
      type: "info",
    });

    await logSystemAction(
      user,
      "Approve Reprint",
      `Print request #${data.requestId.slice(0, 8)} diapprove oleh ${user.name}`,
    );
    await logAudit(user, "printRequests", data.requestId, "STATUS_CHANGE", old, req);

    return req;
  });

export const rejectReprint = createServerFn({ method: "POST" })
  .validator((data: { requestId: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuth();

    const [old] = await db
      .select()
      .from(printRequests)
      .where(eq(printRequests.id, data.requestId))
      .limit(1);

    if (!old) throw new Error("Print request not found");

    const [req] = await db
      .update(printRequests)
      .set({
        status: "Rejected",
        approvedBy: user.id,
        approvedAt: new Date(),
      })
      .where(eq(printRequests.id, data.requestId))
      .returning();

    // Notify the requesting cashier
    await db.insert(systemNotifications).values({
      userId: old.requestedBy,
      title: "Print Request Rejected",
      message: `Permintaan cetak ulang untuk order #${old.orderId.slice(0, 8)} ditolak`,
      type: "warning",
    });

    await logSystemAction(
      user,
      "Reject Reprint",
      `Print request #${data.requestId.slice(0, 8)} ditolak oleh ${user.name}`,
    );

    return req;
  });

export const consumePrintRequest = createServerFn({ method: "POST" })
  .validator((data: { requestId: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuth();

    const [old] = await db
      .select()
      .from(printRequests)
      .where(eq(printRequests.id, data.requestId))
      .limit(1);

    if (!old) throw new Error("Print request not found");
    if (old.status !== "Approved")
      throw new Error("Hanya request dengan status Approved yang dapat dikonsumsi");

    const [req] = await db
      .update(printRequests)
      .set({
        status: "Consumed",
      })
      .where(eq(printRequests.id, data.requestId))
      .returning();

    await logSystemAction(
      user,
      "Consume Print Request",
      `Print request #${data.requestId.slice(0, 8)} telah digunakan oleh ${user.name}`,
    );
    await logAudit(user, "printRequests", data.requestId, "STATUS_CHANGE", old, req);

    return req;
  });

// ─── Cancel Requests ───

export const createCancelRequest = createServerFn({ method: "POST" })
  .validator(
    (data: {
      orderId: string;
      reason: "Stok Habis" | "Salah Input" | "Customer Cancel";
      detail?: string;
    }) => data,
  )
  .handler(async ({ data }) => {
    const user = await requireAuth();

    const [req] = await db
      .insert(cancelRequests)
      .values({
        orderId: data.orderId,
        reason: data.reason,
        detail: data.detail,
        requestedBy: user.id,
        status: "Pending",
      })
      .returning();

    await logSystemAction(
      user,
      "Create Cancel Request",
      `Cancel request untuk order #${data.orderId.slice(0, 8)} dibuat oleh ${user.name}. Alasan: ${data.reason}`,
    );

    return req;
  });

export const getCancelRequests = createServerFn({ method: "GET" })
  .validator((data: { status?: string; branchId?: string }) => ({
    status: z
      .enum(["Pending", "Approved", "Rejected"])
      .optional()
      .catch(undefined)
      .parse(data.status),
    branchId: data.branchId,
  }))
  .handler(async ({ data }) => {
    await requireAuth();

    const conditions = [];
    if (data.status) {
      conditions.push(eq(cancelRequests.status, data.status));
    }
    if (data.branchId) {
      conditions.push(eq(orders.branchId, data.branchId));
    }

    const result = await db
      .select({
        id: cancelRequests.id,
        orderId: cancelRequests.orderId,
        reason: cancelRequests.reason,
        detail: cancelRequests.detail,
        requestedBy: cancelRequests.requestedBy,
        requestedByName: users.name,
        status: cancelRequests.status,
        createdAt: cancelRequests.createdAt,
      })
      .from(cancelRequests)
      .leftJoin(users, eq(cancelRequests.requestedBy, users.id))
      .leftJoin(orders, eq(cancelRequests.orderId, orders.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(cancelRequests.createdAt));

    return result;
  });

export const approveCancelRequest = createServerFn({ method: "POST" })
  .validator((data: { requestId: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuth();

    const [old] = await db
      .select()
      .from(cancelRequests)
      .where(eq(cancelRequests.id, data.requestId))
      .limit(1);

    if (!old) throw new Error("Cancel request not found");
    if (old.status !== "Pending") throw new Error("Request sudah diproses");

    const [req] = await db
      .update(cancelRequests)
      .set({ status: "Approved", approvedBy: user.id, approvedAt: new Date() })
      .where(eq(cancelRequests.id, data.requestId))
      .returning();

    // Notify the requesting cashier
    await db.insert(systemNotifications).values({
      userId: old.requestedBy,
      title: "Cancel Request Approved",
      message: `Permintaan pembatalan untuk order #${old.orderId.slice(0, 8)} telah disetujui. Klik tombol Batal untuk menjalankan pembatalan.`,
      type: "info",
    });

    await logSystemAction(
      user,
      "Approve Cancel Request",
      `Cancel request #${data.requestId.slice(0, 8)} diapprove oleh ${user.name}`,
    );
    await logAudit(user, "cancelRequests", data.requestId, "STATUS_CHANGE", old, req);

    return req;
  });

export const rejectCancelRequest = createServerFn({ method: "POST" })
  .validator((data: { requestId: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuth();

    const [old] = await db
      .select()
      .from(cancelRequests)
      .where(eq(cancelRequests.id, data.requestId))
      .limit(1);

    if (!old) throw new Error("Cancel request not found");

    const [req] = await db
      .update(cancelRequests)
      .set({ status: "Rejected", approvedBy: user.id, approvedAt: new Date() })
      .where(eq(cancelRequests.id, data.requestId))
      .returning();

    // Notify the requesting cashier
    await db.insert(systemNotifications).values({
      userId: old.requestedBy,
      title: "Cancel Request Rejected",
      message: `Permintaan pembatalan untuk order #${old.orderId.slice(0, 8)} ditolak`,
      type: "warning",
    });

    await logSystemAction(
      user,
      "Reject Cancel Request",
      `Cancel request #${data.requestId.slice(0, 8)} ditolak oleh ${user.name}`,
    );

    return req;
  });

// ─── Execute Approved Cancel (cashier-side) ───

export const executeApprovedCancel = createServerFn({ method: "POST" })
  .validator((data: { requestId: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuth();

    const [old] = await db
      .select()
      .from(cancelRequests)
      .where(eq(cancelRequests.id, data.requestId))
      .limit(1);

    if (!old) throw new Error("Cancel request not found");
    if (old.status !== "Approved") throw new Error("Request belum disetujui atau sudah dieksekusi");

    const [order] = await db.select().from(orders).where(eq(orders.id, old.orderId)).limit(1);

    if (!order) throw new Error("Order not found");
    if (order.status === "Void") throw new Error("Order sudah dibatalkan");

    const voidedOrder = await db.transaction(async (tx) => {
      // Mark the request as Executed
      await tx
        .update(cancelRequests)
        .set({ status: "Executed" })
        .where(eq(cancelRequests.id, data.requestId));

      // Void the order
      const [updatedOrder] = await tx
        .update(orders)
        .set({ status: "Void", voidReason: `Cancel: ${old.reason}` })
        .where(eq(orders.id, old.orderId))
        .returning();

      await restoreInventoryForVoid(old.orderId, order.branchId, old.reason, tx);

      return updatedOrder;
    });

    await logSystemAction(
      user,
      "Execute Cancel",
      `Order #${order.orderCode ?? order.id.slice(0, 8)} dibatalkan oleh ${user.name} (cancel request #${data.requestId.slice(0, 8)}). Alasan: ${old.reason}`,
    );
    await logAudit(user, "orders", old.orderId, "STATUS_CHANGE", order, voidedOrder);

    return voidedOrder;
  });

// ─── Active Requests for Orders (POS polling source) ───

export const getActiveRequestsForOrders = createServerFn({ method: "GET" })
  .validator((data: { orderIds: string[] }) => data)
  .handler(async ({ data }) => {
    await requireAuth();

    if (data.orderIds.length === 0) return [];

    // Get latest print request per order (Pending or Approved)
    const printReqs = await db
      .select({
        id: printRequests.id,
        orderId: printRequests.orderId,
        status: printRequests.status,
        createdAt: printRequests.createdAt,
      })
      .from(printRequests)
      .where(
        and(
          inArray(printRequests.orderId, data.orderIds),
          inArray(printRequests.status, ["Pending", "Approved"]),
        ),
      )
      .orderBy(desc(printRequests.createdAt));

    // Get latest cancel request per order (Pending or Approved)
    const cancelReqs = await db
      .select({
        id: cancelRequests.id,
        orderId: cancelRequests.orderId,
        status: cancelRequests.status,
        reason: cancelRequests.reason,
        createdAt: cancelRequests.createdAt,
      })
      .from(cancelRequests)
      .where(
        and(
          inArray(cancelRequests.orderId, data.orderIds),
          inArray(cancelRequests.status, ["Pending", "Approved"]),
        ),
      )
      .orderBy(desc(cancelRequests.createdAt));

    // Deduplicate to latest per orderId
    const latestPrint = new Map<string, { id: string; status: string; createdAt: Date }>();
    for (const r of printReqs) {
      if (!latestPrint.has(r.orderId)) {
        latestPrint.set(r.orderId, { id: r.id, status: r.status, createdAt: r.createdAt });
      }
    }

    const latestCancel = new Map<
      string,
      { id: string; status: string; reason: string; createdAt: Date }
    >();
    for (const r of cancelReqs) {
      if (!latestCancel.has(r.orderId)) {
        latestCancel.set(r.orderId, {
          id: r.id,
          status: r.status,
          reason: r.reason,
          createdAt: r.createdAt,
        });
      }
    }

    // Combine into a single result per order
    const result: Array<{
      orderId: string;
      print: { requestId: string; status: string; createdAt: Date } | null;
      cancel: { requestId: string; status: string; reason: string; createdAt: Date } | null;
    }> = [];

    for (const orderId of data.orderIds) {
      const rawPrint = latestPrint.get(orderId) ?? null;
      const rawCancel = latestCancel.get(orderId) ?? null;
      const print = rawPrint
        ? { requestId: rawPrint.id, status: rawPrint.status, createdAt: rawPrint.createdAt }
        : null;
      const cancel = rawCancel
        ? {
            requestId: rawCancel.id,
            status: rawCancel.status,
            reason: rawCancel.reason,
            createdAt: rawCancel.createdAt,
          }
        : null;
      if (print || cancel) {
        result.push({ orderId, print, cancel });
      }
    }

    return result;
  });
