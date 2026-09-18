/**
 * Server functions for Data Penjualan (Sales Data) page.
 *
 * Provides CRUD for sales orders across all channels, with per-item entry.
 * External channel orders (Shopee, Grab, Gojek, TikTok) are fully editable.
 * POS orders (Dine-in) are read-only in the UI but stored in the same table.
 */
import { createServerFn } from "@tanstack/react-start";
import { db } from "#/lib/server/db";
import { z } from "zod";
import {
  orders,
  orderItems,
  orderItemModifiers,
  recipes,
  modifierGroups,
  modifiers,
  systemNotifications,
  users,
  areaManagerBranches,
  inventory,
  stockLedger,
  ORDER_CHANNEL_VALUES,
} from "#/db/schema";
import { requireAuth, requireRole } from "#/lib/server/auth";
import type { AppUser } from "./auth";
import { resolveNewItemIngredients, resolvePersistedItemIngredients } from "./ingredient-resolver";
import { eq, ne, and, sql, desc, count, inArray } from "drizzle-orm";
import type { DbTx } from "./ingredient-resolver";

// ─── Stock effects (Kartu Stok) ────────────────────────────────────────────
// Data Penjualan orders live in the same `orders` table as POS orders, so
// they must obey the same invariant: every inventory movement gets a
// stock_ledger row whose `balance` equals the post-write inventory quantity.
// These helpers apply a signed ingredient delta (BOM-resolved, modifiers and
// exclusions included) to a branch's inventory inside the caller's transaction.

type IngredientDelta = { ingredientId: string; quantity: number };

/** Apply a signed ingredient delta to inventory, writing one ledger row per
 *  ingredient. Positive quantity = consumption (OUT); negative = restore (IN). */
async function applyIngredientDelta(
  tx: DbTx,
  branchId: string,
  deltas: IngredientDelta[],
  reference: string,
  notes: string,
): Promise<void> {
  for (const delta of deltas) {
    if (delta.quantity === 0) continue;

    const [inv] = await tx
      .select()
      .from(inventory)
      .where(and(eq(inventory.branchId, branchId), eq(inventory.ingredientId, delta.ingredientId)))
      .for("update")
      .limit(1);
    if (!inv) continue;

    const newQty = inv.quantity - delta.quantity;
    await tx
      .update(inventory)
      .set({ quantity: newQty, lastUpdated: new Date() })
      .where(eq(inventory.id, inv.id));

    await tx.insert(stockLedger).values({
      branchId,
      ingredientId: delta.ingredientId,
      type: delta.quantity > 0 ? "OUT" : "IN",
      quantity: Math.abs(delta.quantity),
      balance: newQty,
      reference,
      notes,
    });
  }
}

/** Net ingredient consumption across an item list (adds matching entries). */
function sumDeltas(...groups: IngredientDelta[][]): IngredientDelta[] {
  const map = new Map<string, number>();
  for (const group of groups) {
    for (const d of group) {
      map.set(d.ingredientId, (map.get(d.ingredientId) ?? 0) + d.quantity);
    }
  }
  return [...map].map(([ingredientId, quantity]) => ({ ingredientId, quantity }));
}

/** Resolve BOM consumption for the given item list (client input shape). */
async function resolveItemsDelta(
  items: { recipeId: string; quantity: number }[],
): Promise<IngredientDelta[]> {
  const groups = await Promise.all(
    items.map((item) => resolveNewItemIngredients(item.recipeId, item.quantity)),
  );
  return sumDeltas(...groups.map((r) => r.ingredients));
}

/** Resolve BOM consumption for the order's persisted items. */
async function resolveOrderDelta(orderId: string, tx?: DbTx): Promise<IngredientDelta[]> {
  const conn = tx ?? db;
  const items = await conn.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  const groups = await Promise.all(
    items.map((oi) => resolvePersistedItemIngredients(oi.id, { tx })),
  );
  return sumDeltas(...groups.map((r) => r.ingredients));
}

/**
 * Get aggregated sales data for the sales data page.
 * Returns one row per order with item details.
 */
export const getSalesData = createServerFn({ method: "GET" })
  .validator(
    (data: {
      branchId?: string;
      channel?: string;
      dateFrom?: string;
      dateTo?: string;
      page?: number;
      limit?: number;
    }) => ({
      ...data,
      channel: z.enum(ORDER_CHANNEL_VALUES).optional().catch(undefined).parse(data.channel),
    }),
  )
  .handler(async ({ data }) => {
    await requireAuth();

    const page = data.page ?? 0;
    const limit = data.limit ?? 50;
    const offset = page * limit;

    // Build conditions
    const conditions = [];
    if (data.branchId) {
      conditions.push(eq(orders.branchId, data.branchId));
    }
    if (data.channel) {
      conditions.push(eq(orders.channel, data.channel));
    }
    if (data.dateFrom) {
      // Jakarta local dates (matching finance.ts): the UI sends YYYY-MM-DD
      // strings and orders.createdAt is a NAIVE timestamp storing UTC
      // wall-clock time (see schema.ts), so convert UTC -> WIB before
      // comparing to the local date — JS Date boundaries align to UTC days
      // and shift the window by 7 hours.
      conditions.push(
        sql`DATE((${orders.createdAt} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta') >= ${data.dateFrom}`,
      );
    }
    if (data.dateTo) {
      conditions.push(
        sql`DATE((${orders.createdAt} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta') <= ${data.dateTo}`,
      );
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    // List intentionally includes Void orders so they stay visible in the
    // table (marked void in the UI). Aggregates exclude them — see
    // getSalesSummary. Pagination total below counts all rows shown.
    const result = await db
      .select({
        id: orders.id,
        branchId: orders.branchId,
        channel: orders.channel,
        orderCode: orders.orderCode,
        customerName: orders.customerName,
        subtotal: orders.subtotal,
        merchantDiscount: orders.merchantDiscount,
        platformDiscount: orders.platformDiscount,
        taxAmount: orders.taxAmount,
        totalAmount: orders.totalAmount,
        totalCogs: orders.totalCogs,
        mdrFee: orders.mdrFee,
        netSales: orders.netSales,
        status: orders.status,
        voidReason: orders.voidReason,
        notes: orders.notes,
        createdAt: orders.createdAt,
        itemCount: count(orderItems.id),
      })
      .from(orders)
      .leftJoin(orderItems, eq(orders.id, orderItems.orderId))
      .where(where)
      .groupBy(orders.id)
      .orderBy(desc(orders.createdAt))
      .limit(limit)
      .offset(offset);

    // Get total count for pagination
    const [totalRow] = await db.select({ count: count() }).from(orders).where(where);

    return {
      orders: result,
      total: totalRow?.count ?? 0,
      page,
      limit,
    };
  });

/**
 * Get a single order with its items (for edit modal).
 */
export const getSalesOrderDetail = createServerFn({ method: "GET" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    await requireAuth();

    const [order] = await db.select().from(orders).where(eq(orders.id, data.id)).limit(1);

    if (!order) throw new Error("Order not found");

    const items = await db
      .select({
        id: orderItems.id,
        recipeId: orderItems.recipeId,
        quantity: orderItems.quantity,
        price: orderItems.price,
        cogsAtTransaction: orderItems.cogsAtTransaction,
        notes: orderItems.notes,
        recipeName: recipes.name,
      })
      .from(orderItems)
      .leftJoin(recipes, eq(orderItems.recipeId, recipes.id))
      .where(eq(orderItems.orderId, data.id));

    // Structured modifier rows (group + applied option), same shape as
    // getOrderWithItems so the detail views render "Group: options" per item.
    const itemIds = items.map((i) => i.id);
    let mods: {
      orderItemId: string;
      modifierGroupId: string;
      modifierGroupName: string | null;
      modifierId: string;
      modifierName: string | null;
      isExclusion: boolean | null;
    }[] = [];
    if (itemIds.length > 0) {
      mods = await db
        .select({
          orderItemId: orderItemModifiers.orderItemId,
          modifierGroupId: orderItemModifiers.modifierGroupId,
          modifierGroupName: modifierGroups.name,
          modifierId: orderItemModifiers.modifierId,
          modifierName: modifiers.name,
          isExclusion: modifiers.isExclusion,
        })
        .from(orderItemModifiers)
        .leftJoin(modifiers, eq(orderItemModifiers.modifierId, modifiers.id))
        .leftJoin(modifierGroups, eq(orderItemModifiers.modifierGroupId, modifierGroups.id))
        .where(inArray(orderItemModifiers.orderItemId, itemIds));
    }

    return {
      ...order,
      items: items.map((i) => ({
        ...i,
        modifiers: mods
          .filter((m) => m.orderItemId === i.id)
          .map((m) => ({
            modifierGroupId: m.modifierGroupId,
            modifierGroupName: m.modifierGroupName,
            modifierId: m.modifierId,
            modifierName: m.modifierName,
            isExclusion: m.isExclusion ?? false,
          })),
      })),
    };
  });

/**
 * Create a new sales order with items.
 * Used by Admin Pusat to enter external channel orders.
 */
const createSalesOrderInput = z.object({
  branchId: z.string(),
  channel: z.enum(ORDER_CHANNEL_VALUES),
  orderCode: z.string().optional(),
  customerName: z.string().optional(),
  notes: z.string().optional(),
  date: z.string().optional(), // Override createdAt date (YYYY-MM-DD)
  items: z.array(
    z.object({
      recipeId: z.string(),
      quantity: z.number(),
      price: z.number(),
      notes: z.string().optional(),
    }),
  ),
});

export const createSalesOrder = createServerFn({ method: "POST" })
  .validator((data: z.input<typeof createSalesOrderInput>) => createSalesOrderInput.parse(data))
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");
    return createSalesOrderCore(user, data);
  });

/** The business logic behind `createSalesOrder`, parameterized by an explicit
 *  user so it can be driven directly (e.g. from integration tests). Mirrors the
 *  wrapper's `requireRole(...)` guard. */
export async function createSalesOrderCore(
  user: AppUser,
  data: z.output<typeof createSalesOrderInput>,
) {
  // Calculate totals from items
  let subtotal = 0;
  let totalCogs = 0;

  const itemDetails = await Promise.all(
    data.items.map(async (item) => {
      const [recipe] = await db
        .select({ totalCogs: recipes.totalCogs })
        .from(recipes)
        .where(eq(recipes.id, item.recipeId))
        .limit(1);

      const itemTotal = item.price * item.quantity;
      const itemCogs = (recipe?.totalCogs ?? 0) * item.quantity;
      subtotal += itemTotal;
      totalCogs += itemCogs;

      return {
        recipeId: item.recipeId,
        quantity: item.quantity,
        price: item.price,
        notes: item.notes,
        cogsAtTransaction: recipe?.totalCogs ?? 0,
      };
    }),
  );

  const totalAmount = subtotal;
  const netSales = totalAmount;

  // Create order in transaction
  const order = await db.transaction(async (tx) => {
    // Determine createdAt date
    let createdAt = new Date();
    if (data.date) {
      createdAt = new Date(data.date + "T12:00:00");
    }

    const [newOrder] = await tx
      .insert(orders)
      .values({
        branchId: data.branchId,
        channel: data.channel,
        orderCode: data.orderCode,
        customerName: data.customerName,
        subtotal,
        totalAmount,
        totalCogs,
        netSales,
        status: "Completed",
        notes: data.notes,
        createdAt,
        completedAt: createdAt,
      })
      .returning();

    // Insert items
    if (itemDetails.length > 0) {
      await tx.insert(orderItems).values(
        itemDetails.map((item) => ({
          orderId: newOrder.id,
          recipeId: item.recipeId,
          quantity: item.quantity,
          price: item.price,
          cogsAtTransaction: item.cogsAtTransaction,
          notes: item.notes,
        })),
      );
    }

    // Deduct inventory + write Kartu Stok rows (same as POS createOrder)
    const delta = await resolveItemsDelta(data.items);
    await applyIngredientDelta(
      tx,
      data.branchId,
      delta,
      newOrder.id,
      `Data Penjualan ${newOrder.id.slice(0, 8)}`,
    );

    return newOrder;
  });

  // Create notification for affected branch
  await createSalesNotification({
    action: "create",
    orderId: order.id,
    branchId: data.branchId,
    channel: data.channel,
    orderCode: data.orderCode,
    userId: user.id,
    items: data.items,
  });

  return order;
}

const updateSalesOrderInput = z.object({
  id: z.string(),
  branchId: z.string(),
  channel: z.enum(ORDER_CHANNEL_VALUES),
  orderCode: z.string().optional(),
  customerName: z.string().optional(),
  notes: z.string().optional(),
  date: z.string().optional(),
  items: z.array(
    z.object({
      id: z.string().optional(), // Existing item ID (for updates)
      recipeId: z.string(),
      quantity: z.number(),
      price: z.number(),
      notes: z.string().optional(),
    }),
  ),
});

/**
 * Update an existing sales order and its items.
 */
export const updateSalesOrder = createServerFn({ method: "POST" })
  .validator((data: z.input<typeof updateSalesOrderInput>) => updateSalesOrderInput.parse(data))
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");
    return updateSalesOrderCore(user, data);
  });

/** The business logic behind `updateSalesOrder`, parameterized by an explicit
 *  user so it can be driven directly (e.g. from integration tests). Mirrors the
 *  wrapper's `requireRole(...)` guard. */
export async function updateSalesOrderCore(
  user: AppUser,
  data: z.output<typeof updateSalesOrderInput>,
) {
  // Calculate totals
  let subtotal = 0;
  let totalCogs = 0;

  const itemDetails = await Promise.all(
    data.items.map(async (item) => {
      const [recipe] = await db
        .select({ totalCogs: recipes.totalCogs })
        .from(recipes)
        .where(eq(recipes.id, item.recipeId))
        .limit(1);

      const itemTotal = item.price * item.quantity;
      const itemCogs = (recipe?.totalCogs ?? 0) * item.quantity;
      subtotal += itemTotal;
      totalCogs += itemCogs;

      return {
        recipeId: item.recipeId,
        quantity: item.quantity,
        price: item.price,
        notes: item.notes,
        cogsAtTransaction: recipe?.totalCogs ?? 0,
      };
    }),
  );

  const totalAmount = subtotal;
  const netSales = totalAmount;

  await db.transaction(async (tx) => {
    // Capture the order's pre-edit state for the stock reversal
    const [oldOrder] = await tx.select().from(orders).where(eq(orders.id, data.id)).limit(1);
    if (!oldOrder) throw new Error("Order not found");
    const oldDelta = await resolveOrderDelta(data.id, tx);

    // Update order
    let createdAt: Date | undefined;
    if (data.date) {
      createdAt = new Date(data.date + "T12:00:00");
    }

    await tx
      .update(orders)
      .set({
        branchId: data.branchId,
        channel: data.channel,
        orderCode: data.orderCode,
        customerName: data.customerName,
        subtotal,
        totalAmount,
        totalCogs,
        netSales,
        notes: data.notes,
        createdAt,
        completedAt: createdAt,
      })
      .where(eq(orders.id, data.id));

    // Delete existing items and re-insert
    await tx.delete(orderItems).where(eq(orderItems.orderId, data.id));

    if (itemDetails.length > 0) {
      await tx.insert(orderItems).values(
        itemDetails.map((item) => ({
          orderId: data.id,
          recipeId: item.recipeId,
          quantity: item.quantity,
          price: item.price,
          cogsAtTransaction: item.cogsAtTransaction,
          notes: item.notes,
        })),
      );
    }

    // Reconcile stock: restore what the old items consumed (from the old
    // branch), deduct what the new items consume. Each side writes its own
    // Kartu Stok rows so the edit is fully traceable.
    const newDelta = await resolveItemsDelta(data.items);
    await applyIngredientDelta(
      tx,
      oldOrder.branchId,
      oldDelta.map((d) => ({ ingredientId: d.ingredientId, quantity: -d.quantity })),
      data.id,
      `Edit Order (restore) ${data.id.slice(0, 8)}`,
    );
    await applyIngredientDelta(
      tx,
      data.branchId,
      newDelta,
      data.id,
      `Edit Order (deduct) ${data.id.slice(0, 8)}`,
    );
  });

  // Create notification
  await createSalesNotification({
    action: "update",
    orderId: data.id,
    branchId: data.branchId,
    channel: data.channel,
    orderCode: data.orderCode,
    userId: user.id,
    items: data.items,
  });

  return { success: true };
}

/**
 * Delete a sales order.
 */
export const deleteSalesOrder = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");
    return deleteSalesOrderCore(user, data);
  });

/** The business logic behind `deleteSalesOrder`, parameterized by an explicit
 *  user so it can be driven directly (e.g. from integration tests). Mirrors the
 *  wrapper's `requireRole(...)` guard. */
export async function deleteSalesOrderCore(user: AppUser, data: { id: string }) {
  // Get order details before deletion (for notification)
  const [order] = await db.select().from(orders).where(eq(orders.id, data.id)).limit(1);

  if (!order) throw new Error("Order not found");

  // Get items for notification
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, data.id));

  // Restore the stock the order consumed + write Kartu Stok reversal rows,
  // before the cascade removes the order items the resolver reads.
  await db.transaction(async (tx) => {
    const oldDelta = await resolveOrderDelta(data.id, tx);
    await applyIngredientDelta(
      tx,
      order.branchId,
      oldDelta.map((d) => ({ ingredientId: d.ingredientId, quantity: -d.quantity })),
      data.id,
      `Delete Order (restore) ${data.id.slice(0, 8)}`,
    );
    await tx.delete(orders).where(eq(orders.id, data.id));
  });

  // Create notification
  await createSalesNotification({
    action: "delete",
    orderId: data.id,
    branchId: order.branchId,
    channel: order.channel,
    orderCode: order.orderCode,
    userId: user.id,
    items: items.map((i) => ({
      recipeId: i.recipeId,
      quantity: i.quantity,
      price: i.price,
    })),
  });

  return { success: true };
}

/**
 * Get sales summary (aggregated by channel for a date range).
 */
export const getSalesSummary = createServerFn({ method: "GET" })
  .validator((data: { branchId?: string; dateFrom?: string; dateTo?: string }) => data)
  .handler(async ({ data }) => {
    await requireAuth();

    // Void orders stay visible in the list but never contribute to totals.
    const conditions = [ne(orders.status, "Void")];
    if (data.branchId) {
      conditions.push(eq(orders.branchId, data.branchId));
    }
    if (data.dateFrom) {
      // Jakarta local dates (matching finance.ts) — see getSalesData above.
      conditions.push(
        sql`DATE((${orders.createdAt} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta') >= ${data.dateFrom}`,
      );
    }
    if (data.dateTo) {
      conditions.push(
        sql`DATE((${orders.createdAt} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta') <= ${data.dateTo}`,
      );
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    // Get summary by channel
    const byChannel = await db
      .select({
        channel: orders.channel,
        orderCount: count(),
        totalAmount: sql<number>`sum(${orders.totalAmount})`,
        totalCogs: sql<number>`sum(${orders.totalCogs})`,
      })
      .from(orders)
      .where(where)
      .groupBy(orders.channel);

    // Get overall totals
    const [totals] = await db
      .select({
        orderCount: count(),
        totalAmount: sql<number>`sum(${orders.totalAmount})`,
        totalCogs: sql<number>`sum(${orders.totalCogs})`,
      })
      .from(orders)
      .where(where);

    return {
      byChannel,
      totals: {
        orderCount: totals?.orderCount ?? 0,
        totalAmount: totals?.totalAmount ?? 0,
        totalCogs: totals?.totalCogs ?? 0,
      },
    };
  });

/**
 * Internal helper to create a notification when sales data changes.
 */
async function createSalesNotification(params: {
  action: "create" | "update" | "delete";
  orderId: string;
  branchId: string;
  channel: string;
  orderCode?: string | null;
  userId: string;
  items: { recipeId: string; quantity: number; price: number }[];
}) {
  try {
    // Get branch name
    const { branches } = await import("#/db/schema");
    const [branch] = await db
      .select({ name: branches.name })
      .from(branches)
      .where(eq(branches.id, params.branchId))
      .limit(1);

    // Get recipe names for items
    const recipeIds = params.items.map((i) => i.recipeId);
    const recipeNames =
      recipeIds.length > 0
        ? await db
            .select({ id: recipes.id, name: recipes.name })
            .from(recipes)
            .where(sql`${recipes.id} IN ${recipeIds}`)
        : [];

    const nameMap = new Map(recipeNames.map((r) => [r.id, r.name]));

    const itemList = params.items
      .map((i) => `${nameMap.get(i.recipeId) ?? "Unknown"} × ${i.quantity}`)
      .join(", ");

    const actionText =
      params.action === "create" ? "Dibuat" : params.action === "update" ? "Diubah" : "Dihapus";

    const title = `Pesanan ${actionText}`;
    const message = `Pesanan ${params.orderCode ?? "-"} (${params.channel}) ${actionText} oleh Admin Pusat. ${branch?.name ?? ""}. Item: ${itemList}`;

    // Find recipients: area managers assigned to this branch + branch admins for this branch
    const amRecipients = await db
      .select({ userId: areaManagerBranches.userId })
      .from(areaManagerBranches)
      .where(eq(areaManagerBranches.branchId, params.branchId));

    const baRecipients = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.branchId, params.branchId), eq(users.role, "branch_admin")));

    // Combine and deduplicate recipient IDs
    const recipientIds = [
      ...new Set([...amRecipients.map((r) => r.userId), ...baRecipients.map((r) => r.id)]),
    ];

    // Insert notification for each recipient
    for (const recipientId of recipientIds) {
      await db.insert(systemNotifications).values({
        userId: recipientId,
        title,
        message,
        type: params.action === "delete" ? "warning" : "info",
        priority: params.action === "delete" ? "urgent" : "normal",
      });
    }
  } catch (err) {
    console.error("Failed to create notification:", err);
  }
}
