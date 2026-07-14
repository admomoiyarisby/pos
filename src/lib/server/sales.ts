/**
 * Sales data management with CRUD + notifications.
 *
 * Admin Pusat and Super Admin can view/edit sales data.
 * Changes trigger notifications to the affected Area Manager and Branch Admin.
 */

import { createServerFn } from "@tanstack/react-start";
import { db } from "#/lib/server/db";
import {
  orders,
  orderItems,
  branches,
  users,
  areaManagerBranches,
  systemNotifications,
} from "#/db/schema";
import { eq, and, gte, lte, desc, sql, inArray } from "drizzle-orm";
import { requireRole } from "#/lib/server/auth";
import { z } from "zod";

// =============================================================================
// Types
// =============================================================================

export interface SalesRow {
  id: string;
  orderCode: string | null;
  channel: string;
  customerName: string | null;
  totalAmount: number;
  totalCogs: number;
  netSales: number;
  status: string;
  createdAt: Date;
  branchName: string | null;
  itemCount: number;
}

// =============================================================================
// Queries
// =============================================================================

/**
 * Get sales records with filters.
 */
export const getSalesRecords = createServerFn({ method: "POST" })
  .validator(
    (data: {
      dateFrom?: string;
      dateTo?: string;
      branchId?: string;
      channel?: string;
      page?: number;
      limit?: number;
    }) => data,
  )
  .handler(async ({ data }) => {
    await requireRole("super_admin", "admin_pusat");

    const where = and(
      data.dateFrom ? gte(orders.createdAt, new Date(data.dateFrom)) : undefined,
      data.dateTo ? lte(orders.createdAt, new Date(data.dateTo + "T23:59:59")) : undefined,
      data.branchId ? eq(orders.branchId, data.branchId) : undefined,
      data.channel
        ? eq(
            orders.channel,
            data.channel as "Gofood" | "Grabfood" | "ShopeeFood" | "Dine-in" | "TikTok",
          )
        : undefined,
    );

    const page = data.page ?? 0;
    const limit = Math.min(data.limit ?? 50, 100);
    const offset = page * limit;

    const result = await db
      .select({
        id: orders.id,
        orderCode: orders.orderCode,
        channel: orders.channel,
        customerName: orders.customerName,
        totalAmount: orders.totalAmount,
        totalCogs: orders.totalCogs,
        netSales: orders.netSales,
        status: orders.status,
        createdAt: orders.createdAt,
        branchName: branches.name,
      })
      .from(orders)
      .leftJoin(branches, eq(orders.branchId, branches.id))
      .where(where)
      .orderBy(desc(orders.createdAt))
      .limit(limit)
      .offset(offset);

    // Get item counts for each order
    const orderIds = result.map((r) => r.id);
    const itemCounts =
      orderIds.length > 0
        ? await db
            .select({
              orderId: orderItems.orderId,
              count: sql<number>`COUNT(*)`.as("count"),
            })
            .from(orderItems)
            .where(inArray(orderItems.orderId, orderIds))
            .groupBy(orderItems.orderId)
        : [];

    const countMap = new Map(itemCounts.map((ic) => [ic.orderId, ic.count]));

    return result.map((r) => ({
      ...r,
      itemCount: countMap.get(r.id) ?? 0,
    }));
  });

// =============================================================================
// Mutations
// =============================================================================

// ID14: Create a new sales record
export const createSalesRecord = createServerFn({ method: "POST" })
  .validator(
    z.object({
      branchId: z.string(),
      channel: z.enum(["Gofood", "Grabfood", "ShopeeFood", "Dine-in", "TikTok"]),
      totalAmount: z.number().int(),
      totalCogs: z.number().int().default(0),
      netSales: z.number().int().default(0),
      customerName: z.string().optional(),
      orderCode: z.string().optional(),
      notes: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");

    const [created] = await db
      .insert(orders)
      .values({
        branchId: data.branchId,
        channel: data.channel,
        subtotal: data.totalAmount,
        totalAmount: data.totalAmount,
        totalCogs: data.totalCogs,
        netSales: data.netSales,
        customerName: data.customerName,
        orderCode: data.orderCode,
        status: "Completed",
      })
      .returning();

    // Send notifications
    await notifySalesChange(
      user,
      data.branchId,
      "menambahkan",
      `Order ${data.orderCode ?? created.id}`,
      `Order baru senilai Rp ${data.totalAmount.toLocaleString("id-ID")}`,
    );

    return { success: true, id: created.id };
  });

/**
 * Update a sales record.
 */
export const updateSalesRecord = createServerFn({ method: "POST" })
  .validator(
    z.object({
      id: z.string(),
      totalAmount: z.number().int().optional(),
      totalCogs: z.number().int().optional(),
      netSales: z.number().int().optional(),
      customerName: z.string().optional(),
      notes: z.string().optional(),
      channel: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");

    // Get the order before updating for notification
    const [oldOrder] = await db.select().from(orders).where(eq(orders.id, data.id)).limit(1);

    if (!oldOrder) {
      throw new Error("Order tidak ditemukan");
    }

    const { id, ...updates } = data;

    // Build the update object with explicit field mapping to match DB types
    const updateValues: Record<string, unknown> = {};
    if (updates.totalAmount !== undefined) updateValues.totalAmount = updates.totalAmount;
    if (updates.totalCogs !== undefined) updateValues.totalCogs = updates.totalCogs;
    if (updates.netSales !== undefined) updateValues.netSales = updates.netSales;
    if (updates.customerName !== undefined) updateValues.customerName = updates.customerName;
    if (updates.notes !== undefined) updateValues.notes = updates.notes;
    if (updates.channel !== undefined) updateValues.channel = updates.channel;

    // Update the order
    await db.update(orders).set(updateValues).where(eq(orders.id, id));

    // Send notifications to Area Manager and Branch Admin for this branch
    await notifySalesChange(
      user,
      oldOrder.branchId,
      "mengubah",
      `Order ${oldOrder.orderCode ?? oldOrder.id}`,
      `Total berubah dari Rp ${oldOrder.totalAmount.toLocaleString("id-ID")} ${updates.totalAmount ? `menjadi Rp ${updates.totalAmount.toLocaleString("id-ID")}` : ""}`,
    );

    return { success: true };
  });

/**
 * Delete a sales record (void it).
 */
export const deleteSalesRecord = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");

    const [order] = await db.select().from(orders).where(eq(orders.id, data.id)).limit(1);

    if (!order) {
      throw new Error("Order tidak ditemukan");
    }

    // Mark as void
    await db
      .update(orders)
      .set({
        status: "Void",
        voidReason: "Dihapus oleh Admin Pusat",
      })
      .where(eq(orders.id, data.id));

    // Send notifications
    await notifySalesChange(
      user,
      order.branchId,
      "menghapus",
      `Order ${order.orderCode ?? order.id}`,
      `Order ${order.channel} senilai Rp ${order.totalAmount.toLocaleString("id-ID")} (status: ${order.status}) telah di-void oleh ${user.name}`,
    );

    return { success: true };
  });

// =============================================================================
// Notifications
// =============================================================================

async function notifySalesChange(
  actor: { id: string; name: string },
  branchId: string,
  action: string,
  target: string,
  detail: string,
) {
  // Get this branch's Area Managers
  const ams = await db
    .select({ userId: areaManagerBranches.userId })
    .from(areaManagerBranches)
    .where(eq(areaManagerBranches.branchId, branchId));

  // Get this branch's admins
  const branchAdmins = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(
      and(eq(users.branchId, branchId), eq(users.role, "branch_admin"), eq(users.status, "Active")),
    );

  const recipients = [...ams.map((a) => a.userId), ...branchAdmins.map((a) => a.id)];

  if (recipients.length === 0) return;

  const notifications = recipients.map((userId) => ({
    userId,
    title: `Data Penjualan ${action}`,
    message: `${actor.name} ${action} data penjualan: ${target}. ${detail}`,
    type: "info" as const,
    priority: "urgent" as const,
  }));

  await db.insert(systemNotifications).values(notifications);
}
