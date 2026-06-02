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
  shifts,
  platformFees,
  branches,
  systemNotifications,
  areaManagerBranches,
  printRequests,
  cancelRequests,
  users,
} from "#/db/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import { requireAuth } from "./auth";
import { logSystemAction, logAudit } from "./logging";
import { resolveNewItemIngredients, resolvePersistedItemIngredients } from "./ingredient-resolver";
import { z } from "zod";

export const getPosMenu = createServerFn({ method: "GET" })
  .inputValidator(
    (data: { branchId?: string; brandId?: string; category?: string; search?: string }) => data,
  )
  .handler(async ({ data }) => {
    await requireAuth();

    const result = await db
      .select({
        id: recipes.id,
        code: recipes.code,
        name: recipes.name,
        imageUrl: recipes.imageUrl,
        category: recipes.category,
        basePrice: recipes.basePrice,
        isBOGO: recipes.isBOGO,
        status: recipes.status,
      })
      .from(recipes)
      .where(eq(recipes.status, "Active"))
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
        ingredientIds: allRecipeIngredients
          .filter((ri) => ri.recipeId === r.id)
          .map((ri) => ({ ingredientId: ri.ingredientId, quantity: ri.quantity })),
        isBundle: childLinks.some((c) => c.parentRecipeId === r.id),
        childRecipes: childLinks
          .filter((c) => c.parentRecipeId === r.id)
          .map((c) => ({ recipeId: c.childRecipeId, quantity: c.quantity })),
      }));
  });

export const getShiftStatus = createServerFn({ method: "GET" })
  .inputValidator((data: { branchId: string; userId: string }) => data)
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
  .inputValidator((data: { branchId: string; userId: string; cashFloat: number }) => data)
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
    await logAudit(user, "shifts", shift.id, "CREATE", undefined, shift as Record<string, unknown>);

    return shift;
  });

export const closeShift = createServerFn({ method: "POST" })
  .inputValidator((data: { shiftId: string; actualCash: number; notes?: string }) => data)
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
    await logAudit(
      user,
      "shifts",
      data.shiftId,
      "UPDATE",
      oldShift as Record<string, unknown>,
      shift as Record<string, unknown>,
    );

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
  .inputValidator(
    (data: {
      branchId: string;
      channel: "Gofood" | "Grabfood" | "ShopeeFood" | "Dine-in";
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

    // ─── SOFT BLOCK: Check stock but allow negative ───
    const negativeStockAlerts: { ingredientName: string; shortfall: number; branchName: string }[] =
      [];
    const [branchInfo] = await db
      .select({ name: branches.name })
      .from(branches)
      .where(eq(branches.id, data.branchId))
      .limit(1);
    const branchName = branchInfo?.name ?? data.branchId;

    for (const item of data.items) {
      const resolved = await resolveNewItemIngredients(
        item.recipeId,
        item.quantity,
        item.selectedModifiers,
      );

      for (const ing of resolved.ingredients) {
        if (ing.quantity <= 0) continue; // only check consumed ingredients
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
          const shortfall = ing.quantity - currentQty;
          negativeStockAlerts.push({
            ingredientName: ing.ingredientName,
            shortfall,
            branchName,
          });
        }
      }
    }

    // ─── Calculate totals + COGS ───
    let subtotal = 0;
    let totalCogs = 0;
    const voucherDiscount = data.voucherDiscount ?? 0;
    const taxAmount = data.taxAmount ?? 0;

    // Per-item COGS tracking for snapshot
    const itemCogsList: number[] = [];

    for (const item of data.items) {
      subtotal += item.price * item.quantity;

      const resolved = await resolveNewItemIngredients(
        item.recipeId,
        item.quantity,
        item.selectedModifiers,
        { includeCost: true },
      );

      const itemCogs = resolved.ingredients.reduce((sum, ing) => sum + (ing.cost ?? 0), 0);

      itemCogsList.push(itemCogs);
      totalCogs += itemCogs;
    }

    const totalAmount = subtotal - voucherDiscount + taxAmount;

    // Get platform fee
    const [fee] = await db
      .select()
      .from(platformFees)
      .where(eq(platformFees.channel, data.channel))
      .limit(1);

    const mdrFee = fee ? Math.round((subtotal * fee.feePercentage) / 100) + fee.fixedFee : 0;
    const netSales = totalAmount - mdrFee;

    // Create order
    const [order] = await db
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

    // Create order items with COGS snapshot
    for (let i = 0; i < data.items.length; i++) {
      const item = data.items[i];
      const itemCogs = itemCogsList[i];
      const [orderItem] = await db
        .insert(orderItems)
        .values({
          orderId: order.id,
          recipeId: item.recipeId,
          brandId: item.brandId || undefined,
          quantity: item.quantity,
          price: item.price,
          cogsAtTransaction:
            item.quantity > 0 ? Math.max(0, Math.round(itemCogs / item.quantity)) : 0,
          notes: item.notes,
        })
        .returning();

      // Insert modifiers
      if (item.selectedModifiers?.length) {
        for (const mod of item.selectedModifiers) {
          await db.insert(orderItemModifiers).values({
            orderItemId: orderItem.id,
            modifierGroupId: mod.groupId,
            modifierId: mod.modifierId,
          });
        }
      }

      // Persist exclusion records
      const resolvedExclusions = await resolveNewItemIngredients(
        item.recipeId,
        item.quantity,
        item.selectedModifiers,
      );
      for (const ex of resolvedExclusions.exclusionRecords) {
        await db.insert(orderItemExclusions).values({
          orderItemId: orderItem.id,
          ingredientId: ex.ingredientId,
          quantity: ex.quantity,
        });
      }
    }

    // ─── Deduct inventory (soft block — allow negative) ───
    for (const item of data.items) {
      const resolved = await resolveNewItemIngredients(
        item.recipeId,
        item.quantity,
        item.selectedModifiers,
      );

      for (const ing of resolved.ingredients) {
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

        if (inv) {
          const newQty = inv.quantity - ing.quantity; // negative = restore (exclusions)
          await db
            .update(inventory)
            .set({ quantity: newQty, lastUpdated: new Date() })
            .where(eq(inventory.id, inv.id));

          await db.insert(stockLedger).values({
            branchId: data.branchId,
            ingredientId: ing.ingredientId,
            type: ing.quantity > 0 ? "OUT" : "IN",
            quantity: Math.abs(ing.quantity),
            balance: newQty,
            reference: order.id,
            notes:
              ing.quantity > 0
                ? `POS Order ${order.id.slice(0, 8)}`
                : `Exclusion restore: ${order.id.slice(0, 8)}`,
          });
        }
      }
    }

    // ─── Send negative stock alerts to Area Managers ───
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
    await logAudit(user, "orders", order.id, "CREATE", undefined, order as Record<string, unknown>);

    return order;
  });

export const getOrders = createServerFn({ method: "GET" })
  .inputValidator(
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
  .inputValidator((data: { id: string }) => data)
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
  .inputValidator((data: { orderId: string }) => data)
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
    await logAudit(
      user,
      "orders",
      data.orderId,
      "STATUS_CHANGE",
      old as Record<string, unknown>,
      order as Record<string, unknown>,
    );

    return order;
  });

export const voidOrder = createServerFn({ method: "POST" })
  .inputValidator((data: { orderId: string; reason: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuth();

    const [old] = await db.select().from(orders).where(eq(orders.id, data.orderId)).limit(1);
    if (!old) throw new Error("Order not found");
    if (old.status === "Void") throw new Error("Order sudah dibatalkan");

    const [order] = await db
      .update(orders)
      .set({ status: "Void", voidReason: data.reason })
      .where(eq(orders.id, data.orderId))
      .returning();

    // Restore inventory (including child recipes and modifier ingredients)
    const orderItemsList = await db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, data.orderId));

    for (const oi of orderItemsList) {
      const resolved = await resolvePersistedItemIngredients(oi.id);

      for (const ing of resolved.ingredients) {
        const [inv] = await db
          .select()
          .from(inventory)
          .where(
            and(eq(inventory.branchId, old.branchId), eq(inventory.ingredientId, ing.ingredientId)),
          )
          .limit(1);

        if (inv) {
          const newQty = inv.quantity + ing.quantity;
          await db
            .update(inventory)
            .set({ quantity: newQty, lastUpdated: new Date() })
            .where(eq(inventory.id, inv.id));

          if (ing.quantity !== 0) {
            await db.insert(stockLedger).values({
              branchId: old.branchId,
              ingredientId: ing.ingredientId,
              type: ing.quantity > 0 ? "IN" : "OUT",
              quantity: Math.abs(ing.quantity),
              balance: newQty,
              reference: data.orderId,
              notes:
                ing.quantity > 0
                  ? `Void Order ${order.id.slice(0, 8)}: ${data.reason}`
                  : `Void re-deduct exclusion: ${order.id.slice(0, 8)}`,
            });
          }
        }
      }
    }

    await logSystemAction(
      user,
      "Void Order",
      `Order #${order.orderCode ?? order.id.slice(0, 8)} dibatalkan oleh ${user.name}. Alasan: ${data.reason}`,
      "Warning",
    );
    await logAudit(
      user,
      "orders",
      data.orderId,
      "STATUS_CHANGE",
      old as Record<string, unknown>,
      order as Record<string, unknown>,
    );

    return order;
  });

// ─── Print Request (Re-print Approval Flow) ───

export const requestReprint = createServerFn({ method: "POST" })
  .inputValidator((data: { orderId: string; requestType?: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuth();

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
  .inputValidator((data: { orderId: string }) => data)
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
  .inputValidator((data: { branchId?: string } | null | undefined) => data ?? {})
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
  .inputValidator((data: { requestId: string }) => data)
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

    await logSystemAction(
      user,
      "Approve Reprint",
      `Print request #${data.requestId.slice(0, 8)} diapprove oleh ${user.name}`,
    );
    await logAudit(
      user,
      "printRequests",
      data.requestId,
      "STATUS_CHANGE",
      old as Record<string, unknown>,
      req as Record<string, unknown>,
    );

    return req;
  });

export const rejectReprint = createServerFn({ method: "POST" })
  .inputValidator((data: { requestId: string }) => data)
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

    await logSystemAction(
      user,
      "Reject Reprint",
      `Print request #${data.requestId.slice(0, 8)} ditolak oleh ${user.name}`,
    );

    return req;
  });

// ─── Cancel Requests ───

export const createCancelRequest = createServerFn({ method: "POST" })
  .inputValidator(
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
  .inputValidator((data: { status?: string; branchId?: string }) => data)
  .handler(async ({ data }) => {
    await requireAuth();

    const conditions = [];
    if (data.status) {
      conditions.push(
        eq(cancelRequests.status, data.status as typeof cancelRequests.$inferSelect.status),
      );
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
  .inputValidator((data: { requestId: string }) => data)
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

    // Also mark the order as Void
    await db
      .update(orders)
      .set({ status: "Void", voidReason: `Cancel: ${old.reason}` })
      .where(eq(orders.id, old.orderId));

    // Notify the requesting cashier
    await db.insert(systemNotifications).values({
      userId: old.requestedBy,
      title: "Cancel Request Approved",
      message: `Permintaan pembatalan untuk order #${old.orderId.slice(0, 8)} telah disetujui`,
      type: "info",
    });

    await logSystemAction(
      user,
      "Approve Cancel Request",
      `Cancel request #${data.requestId.slice(0, 8)} diapprove oleh ${user.name}`,
    );
    await logAudit(
      user,
      "cancelRequests",
      data.requestId,
      "STATUS_CHANGE",
      old as Record<string, unknown>,
      req as Record<string, unknown>,
    );

    return req;
  });

export const rejectCancelRequest = createServerFn({ method: "POST" })
  .inputValidator((data: { requestId: string }) => data)
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
