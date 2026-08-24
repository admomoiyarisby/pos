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
  recipes,
  systemNotifications,
  users,
  areaManagerBranches,
  ORDER_CHANNEL_VALUES,
} from "#/db/schema";
import { requireAuth, requireRole } from "#/lib/server/auth";
import { eq, and, gte, lte, sql, desc, count } from "drizzle-orm";

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
      conditions.push(gte(orders.createdAt, new Date(data.dateFrom)));
    }
    if (data.dateTo) {
      // Add 1 day to include the full day
      const toDate = new Date(data.dateTo);
      toDate.setDate(toDate.getDate() + 1);
      conditions.push(lte(orders.createdAt, toDate));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    // Get orders with item count and total COGS
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

    return { ...order, items };
  });

/**
 * Create a new sales order with items.
 * Used by Admin Pusat to enter external channel orders.
 */
export const createSalesOrder = createServerFn({ method: "POST" })
  .validator(
    (data: {
      branchId: string;
      channel: (typeof ORDER_CHANNEL_VALUES)[number];
      orderCode?: string;
      customerName?: string;
      notes?: string;
      date?: string; // Override createdAt date (YYYY-MM-DD)
      items: {
        recipeId: string;
        quantity: number;
        price: number;
        notes?: string;
      }[];
    }) => data,
  )
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");

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
  });

/**
 * Update an existing sales order and its items.
 */
export const updateSalesOrder = createServerFn({ method: "POST" })
  .validator(
    (data: {
      id: string;
      branchId: string;
      channel: (typeof ORDER_CHANNEL_VALUES)[number];
      orderCode?: string;
      customerName?: string;
      notes?: string;
      date?: string;
      items: {
        id?: string; // Existing item ID (for updates)
        recipeId: string;
        quantity: number;
        price: number;
        notes?: string;
      }[];
    }) => data,
  )
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");

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
  });

/**
 * Delete a sales order.
 */
export const deleteSalesOrder = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");

    // Get order details before deletion (for notification)
    const [order] = await db.select().from(orders).where(eq(orders.id, data.id)).limit(1);

    if (!order) throw new Error("Order not found");

    // Get items for notification
    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, data.id));

    // Delete (cascade will remove items)
    await db.delete(orders).where(eq(orders.id, data.id));

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
  });

/**
 * Get sales summary (aggregated by channel for a date range).
 */
export const getSalesSummary = createServerFn({ method: "GET" })
  .validator((data: { branchId?: string; dateFrom?: string; dateTo?: string }) => data)
  .handler(async ({ data }) => {
    await requireAuth();

    const conditions = [];
    if (data.branchId) {
      conditions.push(eq(orders.branchId, data.branchId));
    }
    if (data.dateFrom) {
      conditions.push(gte(orders.createdAt, new Date(data.dateFrom)));
    }
    if (data.dateTo) {
      const toDate = new Date(data.dateTo);
      toDate.setDate(toDate.getDate() + 1);
      conditions.push(lte(orders.createdAt, toDate));
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
