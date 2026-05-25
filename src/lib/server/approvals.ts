import { createServerFn } from "@tanstack/react-start";
import { db } from "#/lib/server/db";
import { printRequests, orders, users, systemNotifications } from "#/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "./auth";
import { logSystemAction, logAudit } from "./logging";

// ─── Get all pending approvals for Area Manager dashboard ───

export const getPendingApprovals = createServerFn({ method: "GET" })
  .inputValidator((data: { branchId?: string }) => data)
  .handler(async ({ data }) => {
    await requireAuth();

    const conditions = [eq(printRequests.status, "Pending")];
    if (data.branchId) {
      conditions.push(eq(orders.branchId, data.branchId));
    }

    const printReqs = await db
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

    return { printRequests: printReqs };
  });

// ─── Approve a print request ───

export const approvePrintRequest = createServerFn({ method: "POST" })
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

    // Notify the requesting cashier
    await db.insert(systemNotifications).values({
      userId: old.requestedBy,
      title: "Print Request Approved",
      message: `Permintaan cetak ulang untuk order #${old.orderId.slice(0, 8)} telah disetujui`,
      type: "info",
    });

    await logSystemAction(
      user,
      "Approve Print Request",
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

// ─── Reject a print request ───

export const rejectPrintRequest = createServerFn({ method: "POST" })
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

    // Notify the requesting cashier
    await db.insert(systemNotifications).values({
      userId: old.requestedBy,
      title: "Print Request Rejected",
      message: `Permintaan cetak ulang untuk order #${old.orderId.slice(0, 8)} ditolak`,
      type: "warning",
    });

    await logSystemAction(
      user,
      "Reject Print Request",
      `Print request #${data.requestId.slice(0, 8)} ditolak oleh ${user.name}`,
    );

    return req;
  });
