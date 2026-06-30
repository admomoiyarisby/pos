import { createServerFn } from "@tanstack/react-start";
import { db } from "#/lib/server/db";
import { auditLogs, systemLogs, systemNotifications, users } from "#/db/schema";
import { eq, desc, and, gte, lte, sql } from "drizzle-orm";
import { requireAuth, requireRole } from "./auth";
import { logSystemAction } from "./logging";

export const getAuditLogs = createServerFn({ method: "GET" })
  .validator(
    (data: {
      tableName?: string;
      action?: string;
      userId?: string;
      dateFrom?: string;
      dateTo?: string;
      page?: number;
      limit?: number;
    }) => data,
  )
  .handler(async ({ data }) => {
    await requireRole("super_admin");

    const conditions = [];
    if (data.tableName) conditions.push(eq(auditLogs.tableName, data.tableName));
    if (data.action) conditions.push(eq(auditLogs.action, data.action));
    if (data.userId) conditions.push(eq(auditLogs.userId, data.userId));
    if (data.dateFrom) conditions.push(gte(auditLogs.createdAt, new Date(data.dateFrom)));
    if (data.dateTo) conditions.push(lte(auditLogs.createdAt, new Date(data.dateTo)));

    const result = await db
      .select({
        id: auditLogs.id,
        tableName: auditLogs.tableName,
        recordId: auditLogs.recordId,
        action: auditLogs.action,
        oldValues: sql<string>`${auditLogs.oldValues}`,
        newValues: sql<string>`${auditLogs.newValues}`,
        userId: auditLogs.userId,
        ipAddress: auditLogs.ipAddress,
        createdAt: auditLogs.createdAt,
        userName: users.name,
      })
      .from(auditLogs)
      .leftJoin(users, eq(auditLogs.userId, users.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(auditLogs.createdAt))
      .limit(data.limit ?? 50)
      .offset((data.page ?? 0) * (data.limit ?? 50));

    return result;
  });

export const getSystemLogs = createServerFn({ method: "GET" })
  .validator(
    (data: {
      status?: "Success" | "Warning" | "Error";
      userId?: string;
      page?: number;
      limit?: number;
    }) => data,
  )
  .handler(async ({ data }) => {
    await requireRole("super_admin");

    const conditions = [];
    if (data.status) conditions.push(eq(systemLogs.status, data.status));
    if (data.userId) conditions.push(eq(systemLogs.userId, data.userId));

    const result = await db
      .select({
        id: systemLogs.id,
        action: systemLogs.action,
        detail: systemLogs.detail,
        userId: systemLogs.userId,
        userName: systemLogs.userName,
        status: systemLogs.status,
        createdAt: systemLogs.createdAt,
      })
      .from(systemLogs)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(systemLogs.createdAt))
      .limit(data.limit ?? 50)
      .offset((data.page ?? 0) * (data.limit ?? 50));

    return result;
  });

export const getNotifications = createServerFn({ method: "GET" })
  .validator((data: { unreadOnly?: boolean }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuth();

    const result = await db
      .select({
        id: systemNotifications.id,
        userId: systemNotifications.userId,
        title: systemNotifications.title,
        message: systemNotifications.message,
        type: systemNotifications.type,
        isRead: systemNotifications.isRead,
        metadata: sql<string>`${systemNotifications.metadata}`,
        createdAt: systemNotifications.createdAt,
      })
      .from(systemNotifications)
      .where(
        and(
          eq(systemNotifications.userId, user.id),
          data.unreadOnly ? eq(systemNotifications.isRead, false) : undefined,
        ),
      )
      .orderBy(desc(systemNotifications.createdAt))
      .limit(20);

    return result;
  });

export const markNotificationRead = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuth();

    await db
      .update(systemNotifications)
      .set({ isRead: true })
      .where(and(eq(systemNotifications.id, data.id), eq(systemNotifications.userId, user.id)));

    await logSystemAction(user, "Mark Notification Read", `Notifikasi dibaca oleh ${user.name}`);

    return { success: true };
  });

export const createSystemNotification = createServerFn({ method: "POST" })
  .validator(
    (data: {
      userId: string;
      title: string;
      message: string;
      type: "info" | "warning" | "alert";
    }) => data,
  )
  .handler(async ({ data }) => {
    const user = await requireAuth();

    const [notif] = await db
      .insert(systemNotifications)
      .values(data)
      .returning({
        id: systemNotifications.id,
        userId: systemNotifications.userId,
        title: systemNotifications.title,
        message: systemNotifications.message,
        type: systemNotifications.type,
        isRead: systemNotifications.isRead,
        metadata: sql<string>`${systemNotifications.metadata}`,
        createdAt: systemNotifications.createdAt,
      });

    // Fetch target user name for logging
    const [targetUser] = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, data.userId))
      .limit(1);

    await logSystemAction(
      user,
      "Create System Notification",
      `Notifikasi "${data.title}" dibuat untuk user ${targetUser?.name ?? data.userId} oleh ${user.name}`,
    );

    return notif;
  });
