import { createServerFn } from "@tanstack/react-start";
import { db } from "#/lib/server/db";
import type { UnknownRecord } from "#/lib/unknown-record";
import {
  purchaseRequisitions,
  purchaseRequisitionItems,
  purchaseOrders,
  purchaseOrderItems,
  deliveryNotes,
  deliveryNoteItems,
  scmInvoices,
  scmInvoiceItems,
  stockTransfers,
  inventory,
  inTransitInventory,
  stockLedger,
  ingredients,
  branches,
  systemNotifications,
  users,
  wasteEntries,
  USER_ROLE_VALUES,
  PR_STATUS_VALUES,
} from "#/db/schema";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, requireRole } from "./auth";
import { logSystemAction, logAudit } from "./logging";
import { recalculateRecipeCostsForIngredient } from "./cost-rollup";

// ─── Helpers ───

async function notifyUsers(
  roles: (typeof USER_ROLE_VALUES)[number][],
  title: string,
  message: string,
  type: "info" | "warning" | "alert" = "info",
) {
  const targets = await db.select({ id: users.id }).from(users).where(inArray(users.role, roles));
  for (const u of targets) {
    await db.insert(systemNotifications).values({ userId: u.id, title, message, type });
  }
}

function assertBranchAccess(user: Awaited<ReturnType<typeof requireAuth>>, branchId: string) {
  if (user.role === "super_admin" || user.role === "admin_pusat") return;
  if (user.role === "branch_admin" && user.branchId === branchId) return;
  if (user.role === "area_manager" && user.assignedBranches?.includes(branchId)) return;
  throw new Error("Forbidden: you do not have access to this branch");
}

// ─── Purchase Requisitions ───

export const getPurchaseRequisitions = createServerFn({ method: "GET" })
  .validator((data: { branchId?: string; status?: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuth();
    let branchFilter = data.branchId;
    if (user.role === "branch_admin" && user.branchId) {
      branchFilter = user.branchId;
    } else if (user.role === "area_manager" && user.assignedBranches?.length) {
      if (!branchFilter || !user.assignedBranches.includes(branchFilter)) {
        // Return all assigned branches if no specific filter or filter not in assignments
        const assigned = user.assignedBranches;
        const result = await db
          .select({
            id: purchaseRequisitions.id,
            code: purchaseRequisitions.code,
            branchId: purchaseRequisitions.branchId,
            status: purchaseRequisitions.status,
            requestedBy: purchaseRequisitions.requestedBy,
            approvedBy: purchaseRequisitions.approvedBy,
            rejectionReason: purchaseRequisitions.rejectionReason,
            createdAt: purchaseRequisitions.createdAt,
            updatedAt: purchaseRequisitions.updatedAt,
            branchName: branches.name,
            approvedByName: users.name,
          })
          .from(purchaseRequisitions)
          .leftJoin(branches, eq(purchaseRequisitions.branchId, branches.id))
          .leftJoin(users, eq(purchaseRequisitions.approvedBy, users.id))
          .where(inArray(purchaseRequisitions.branchId, assigned))
          .orderBy(desc(purchaseRequisitions.createdAt));
        return result;
      }
    }

    const result = await db
      .select({
        id: purchaseRequisitions.id,
        code: purchaseRequisitions.code,
        branchId: purchaseRequisitions.branchId,
        status: purchaseRequisitions.status,
        requestedBy: purchaseRequisitions.requestedBy,
        approvedBy: purchaseRequisitions.approvedBy,
        rejectionReason: purchaseRequisitions.rejectionReason,
        createdAt: purchaseRequisitions.createdAt,
        updatedAt: purchaseRequisitions.updatedAt,
        branchName: branches.name,
        approvedByName: users.name,
      })
      .from(purchaseRequisitions)
      .leftJoin(branches, eq(purchaseRequisitions.branchId, branches.id))
      .leftJoin(users, eq(purchaseRequisitions.approvedBy, users.id))
      .where(branchFilter ? eq(purchaseRequisitions.branchId, branchFilter) : undefined)
      .orderBy(desc(purchaseRequisitions.createdAt));

    return result;
  });

export const getPurchaseRequisition = createServerFn({ method: "GET" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    await requireAuth();

    const [pr] = await db
      .select()
      .from(purchaseRequisitions)
      .where(eq(purchaseRequisitions.id, data.id))
      .limit(1);

    if (!pr) return null;

    const items = await db
      .select({
        id: purchaseRequisitionItems.id,
        ingredientId: purchaseRequisitionItems.ingredientId,
        quantity: purchaseRequisitionItems.quantity,
        ingredientName: ingredients.name,
        ingredientCode: ingredients.code,
        stockUnit: ingredients.stockUnit,
      })
      .from(purchaseRequisitionItems)
      .leftJoin(ingredients, eq(purchaseRequisitionItems.ingredientId, ingredients.id))
      .where(eq(purchaseRequisitionItems.purchaseRequisitionId, data.id));

    return { ...pr, items };
  });

export const createPurchaseRequisition = createServerFn({ method: "POST" })
  .validator(
    (data: {
      branchId: string;
      code: string;
      items: { ingredientId: string; quantity: number }[];
      notes?: string;
    }) => data,
  )
  .handler(async ({ data }) => {
    const user = await requireAuth();

    const branchId = data.branchId || (user.role === "branch_admin" ? user.branchId : undefined);
    if (!branchId) throw new Error("Branch is required");

    if (user.role === "branch_admin" && branchId !== user.branchId) {
      throw new Error(
        `Unauthorized branch: user=${user.role} userBranch=${user.branchId} dataBranch=${branchId}`,
      );
    }

    // MOQ validation
    for (const item of data.items) {
      const [ing] = await db
        .select({ moq: ingredients.moq, name: ingredients.name })
        .from(ingredients)
        .where(eq(ingredients.id, item.ingredientId))
        .limit(1);
      if (ing && ing.moq > 1 && item.quantity % ing.moq !== 0) {
        throw new Error(`Jumlah order untuk ${ing.name} harus kelipatan MOQ (${ing.moq})`);
      }
    }

    const [pr] = await db
      .insert(purchaseRequisitions)
      .values({
        code: data.code,
        branchId,
        requestedBy: user.id,
        status: "Pending",
        notes: data.notes,
      })
      .returning();

    if (data.items.length > 0) {
      await db.insert(purchaseRequisitionItems).values(
        data.items.map((item) => ({
          purchaseRequisitionId: pr.id,
          ingredientId: item.ingredientId,
          quantity: item.quantity,
        })),
      );
    }

    await logSystemAction(
      user,
      "Create Purchase Requisition",
      `PR "${data.code}" dibuat oleh ${user.name}`,
    );
    await logAudit(user, "purchaseRequisitions", pr.id, "CREATE", undefined, pr);

    // Notify admin pusat
    await notifyUsers(["admin_pusat"], "PR Baru", `PR "${data.code}" diajukan oleh ${user.name}`);

    return pr;
  });

export const updatePurchaseRequisition = createServerFn({ method: "POST" })
  .validator(
    (data: {
      id: string;
      items?: { ingredientId: string; quantity: number }[];
      status?: string;
      rejectionReason?: string;
    }) => ({
      ...data,
      status: z.enum(PR_STATUS_VALUES).optional().catch(undefined).parse(data.status),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireAuth();

    const { id, items, status, rejectionReason } = data;

    const [oldPr] = await db
      .select()
      .from(purchaseRequisitions)
      .where(eq(purchaseRequisitions.id, id))
      .limit(1);

    if (!oldPr) throw new Error("PR not found");

    if (user.role === "branch_admin") {
      if (oldPr.requestedBy !== user.id) {
        throw new Error("Unauthorized: can only edit your own PR");
      }
      if (!["Draft", "Pending"].includes(oldPr.status)) {
        throw new Error("Cannot modify PR that is already processed");
      }
      if (status && !["Draft", "Pending"].includes(status)) {
        throw new Error("Unauthorized: cannot change to this status");
      }
    }

    if (user.role === "area_manager") {
      assertBranchAccess(user, oldPr.branchId);
      if (status && !["Approved", "Processed", "Rejected"].includes(status)) {
        throw new Error("Unauthorized status change");
      }
    }

    if (status) {
      const updateData: UnknownRecord = {
        status,
        updatedAt: new Date(),
      };
      if (status === "Rejected" && rejectionReason) {
        updateData.rejectionReason = rejectionReason;
      }
      if (status === "Approved" || status === "Processed" || status === "Rejected") {
        updateData.approvedBy = user.id;
      }
      await db.update(purchaseRequisitions).set(updateData).where(eq(purchaseRequisitions.id, id));
    }

    if (items) {
      await db
        .delete(purchaseRequisitionItems)
        .where(eq(purchaseRequisitionItems.purchaseRequisitionId, id));
      if (items.length > 0) {
        await db.insert(purchaseRequisitionItems).values(
          items.map((item) => ({
            purchaseRequisitionId: id,
            ingredientId: item.ingredientId,
            quantity: item.quantity,
          })),
        );
      }
    }

    const [updatedPr] = await db
      .select()
      .from(purchaseRequisitions)
      .where(eq(purchaseRequisitions.id, id))
      .limit(1);

    await logSystemAction(
      user,
      "Update Purchase Requisition",
      `PR "${updatedPr?.code}" status diubah ke ${status ?? "-"} oleh ${user.name}`,
    );
    await logAudit(
      user,
      "purchaseRequisitions",
      id,
      status ? "STATUS_CHANGE" : "UPDATE",
      oldPr,
      updatedPr,
    );

    return { success: true };
  });

export const processPurchaseRequisition = createServerFn({ method: "POST" })
  .validator(
    (data: { id: string; alsoCreateSJ: boolean; driverName?: string; vehicleNumber?: string }) =>
      data,
  )
  .handler(async ({ data }) => {
    const user = await requireAuth();

    if (!["area_manager", "admin_pusat", "super_admin"].includes(user.role)) {
      throw new Error("Forbidden: insufficient role to process PR");
    }

    const [pr] = await db
      .select()
      .from(purchaseRequisitions)
      .where(eq(purchaseRequisitions.id, data.id))
      .limit(1);

    if (!pr) throw new Error("PR not found");
    if (!["Pending", "Approved"].includes(pr.status)) {
      throw new Error("PR must be Pending or Approved to process");
    }

    if (user.role === "area_manager") {
      assertBranchAccess(user, pr.branchId);
    }

    const items = await db
      .select()
      .from(purchaseRequisitionItems)
      .where(eq(purchaseRequisitionItems.purchaseRequisitionId, data.id));

    await db
      .update(purchaseRequisitions)
      .set({
        status: "Processed",
        approvedBy: user.id,
        updatedAt: new Date(),
      })
      .where(eq(purchaseRequisitions.id, data.id));

    let dn: { id: string; code: string } | null = null;

    if (data.alsoCreateSJ) {
      const [centralBranch] = await db
        .select()
        .from(branches)
        .where(eq(branches.type, "Central"))
        .limit(1);

      const fromBranchId = centralBranch?.id ?? pr.branchId;
      const sjCode = `SJ-${pr.code}`;

      [dn] = await db
        .insert(deliveryNotes)
        .values({
          code: sjCode,
          purchaseRequisitionId: data.id,
          fromBranchId,
          toBranchId: pr.branchId,
          status: "Picking",
          driverName: data.driverName ?? "Belum ditentukan",
          vehicleNumber: data.vehicleNumber,
        })
        .returning();

      if (items.length > 0) {
        await db.insert(deliveryNoteItems).values(
          items.map((item) => ({
            deliveryNoteId: dn!.id,
            ingredientId: item.ingredientId,
            quantity: item.quantity,
            readyQuantity: item.quantity,
            pickedQuantity: 0,
            receivedQuantity: 0,
            rejectedQuantity: 0,
          })),
        );
      }

      // NOTE: In-transit records are NOT created here.
      // They are created only when shipDeliveryNote is called.

      await logSystemAction(
        user,
        "Auto-Create Delivery Note",
        `SJ "${sjCode}" dibuat otomatis dari PR "${pr.code}" oleh ${user.name}`,
      );
    }

    await logSystemAction(
      user,
      "Process Purchase Requisition",
      `PR "${pr.code}" diproses oleh ${user.name}${data.alsoCreateSJ ? ` (dengan SJ "${dn?.code}")` : ""}`,
    );

    return { success: true, prId: data.id, dnId: dn?.id ?? null };
  });

// ─── Purchase Orders ───

export const getPurchaseOrders = createServerFn({ method: "GET" })
  .validator((data: { status?: string }) => data)
  .handler(async () => {
    await requireRole("super_admin", "admin_pusat");

    const result = await db
      .select({
        id: purchaseOrders.id,
        code: purchaseOrders.code,
        fromBranchId: purchaseOrders.fromBranchId,
        toBranchId: purchaseOrders.toBranchId,
        status: purchaseOrders.status,
        createdAt: purchaseOrders.createdAt,
      })
      .from(purchaseOrders)
      .orderBy(desc(purchaseOrders.createdAt));

    return result;
  });

export const getPurchaseOrder = createServerFn({ method: "GET" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    await requireRole("super_admin", "admin_pusat");

    const [po] = await db
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, data.id))
      .limit(1);

    if (!po) return null;

    const items = await db
      .select({
        id: purchaseOrderItems.id,
        ingredientId: purchaseOrderItems.ingredientId,
        quantity: purchaseOrderItems.quantity,
        unitPrice: purchaseOrderItems.unitPrice,
        totalPrice: purchaseOrderItems.totalPrice,
        ingredientName: ingredients.name,
        ingredientCode: ingredients.code,
      })
      .from(purchaseOrderItems)
      .leftJoin(ingredients, eq(purchaseOrderItems.ingredientId, ingredients.id))
      .where(eq(purchaseOrderItems.purchaseOrderId, data.id));

    return { ...po, items };
  });

export const createPurchaseOrder = createServerFn({ method: "POST" })
  .validator(
    (data: {
      code: string;
      purchaseRequisitionId?: string;
      supplierId?: string;
      fromBranchId: string;
      toBranchId: string;
      items: { ingredientId: string; quantity: number; unitPrice?: number }[];
      notes?: string;
    }) => data,
  )
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");

    const [po] = await db
      .insert(purchaseOrders)
      .values({
        code: data.code,
        purchaseRequisitionId: data.purchaseRequisitionId,
        supplierId: data.supplierId,
        fromBranchId: data.fromBranchId,
        toBranchId: data.toBranchId,
        status: "Draft",
        notes: data.notes,
        createdBy: user.id,
      })
      .returning();

    if (data.items.length > 0) {
      await db.insert(purchaseOrderItems).values(
        data.items.map((item) => ({
          purchaseOrderId: po.id,
          ingredientId: item.ingredientId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalPrice: item.unitPrice ? item.unitPrice * item.quantity : null,
        })),
      );
    }

    await logSystemAction(
      user,
      "Create Purchase Order",
      `PO "${data.code}" dibuat oleh ${user.name}`,
    );
    await logAudit(user, "purchaseOrders", po.id, "CREATE", undefined, po);

    return po;
  });

export const updatePurchaseOrder = createServerFn({ method: "POST" })
  .validator(
    (data: {
      id: string;
      items?: { ingredientId: string; quantity: number; unitPrice?: number }[];
      notes?: string;
    }) => data,
  )
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");

    const [oldPo] = await db
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, data.id))
      .limit(1);

    if (!oldPo) throw new Error("PO not found");
    if (oldPo.status !== "Draft") throw new Error("Only Draft PO can be edited");

    await db
      .update(purchaseOrders)
      .set({ notes: data.notes, updatedAt: new Date() })
      .where(eq(purchaseOrders.id, data.id));

    if (data.items) {
      await db.delete(purchaseOrderItems).where(eq(purchaseOrderItems.purchaseOrderId, data.id));
      if (data.items.length > 0) {
        await db.insert(purchaseOrderItems).values(
          data.items.map((item) => ({
            purchaseOrderId: data.id,
            ingredientId: item.ingredientId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: item.unitPrice ? item.unitPrice * item.quantity : null,
          })),
        );
      }
    }

    const [updatedPo] = await db
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, data.id))
      .limit(1);

    await logAudit(user, "purchaseOrders", data.id, "UPDATE", oldPo, updatedPo);

    return { success: true };
  });

export const sendPurchaseOrder = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");

    const [oldPo] = await db
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, data.id))
      .limit(1);

    if (!oldPo) throw new Error("PO not found");
    if (oldPo.status !== "Draft") throw new Error("Only Draft PO can be sent");

    const [po] = await db
      .update(purchaseOrders)
      .set({ status: "Sent", updatedAt: new Date() })
      .where(eq(purchaseOrders.id, data.id))
      .returning();

    await logSystemAction(user, "Send Purchase Order", `PO "${po.code}" dikirim oleh ${user.name}`);
    await logAudit(user, "purchaseOrders", data.id, "STATUS_CHANGE", oldPo, po);

    return po;
  });

export const receivePurchaseOrder = createServerFn({ method: "POST" })
  .validator((data: { id: string; items: { itemId: string; receivedQuantity: number }[] }) => data)
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");

    const [po] = await db
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, data.id))
      .limit(1);

    if (!po) throw new Error("PO not found");
    if (!["Sent", "Partial"].includes(po.status)) {
      throw new Error("PO must be Sent or Partial to receive");
    }

    for (const item of data.items) {
      await db
        .update(purchaseOrderItems)
        .set({ receivedQuantity: item.receivedQuantity })
        .where(eq(purchaseOrderItems.id, item.itemId));
    }

    // Determine if fully received
    const poItems = await db
      .select()
      .from(purchaseOrderItems)
      .where(eq(purchaseOrderItems.purchaseOrderId, data.id));

    const allReceived = poItems.every((item) => (item.receivedQuantity ?? 0) >= item.quantity);
    const newStatus = allReceived ? "Completed" : "Partial";

    const [updatedPo] = await db
      .update(purchaseOrders)
      .set({ status: newStatus, updatedAt: new Date() })
      .where(eq(purchaseOrders.id, data.id))
      .returning();

    await logSystemAction(
      user,
      "Receive Purchase Order",
      `PO "${po.code}" status diubah ke ${newStatus} oleh ${user.name}`,
    );
    await logAudit(user, "purchaseOrders", data.id, "STATUS_CHANGE", po, updatedPo);

    return updatedPo;
  });

export const cancelPurchaseOrder = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");

    const [oldPo] = await db
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, data.id))
      .limit(1);

    if (!oldPo) throw new Error("PO not found");
    if (oldPo.status === "Completed") throw new Error("Completed PO cannot be cancelled");

    const [po] = await db
      .update(purchaseOrders)
      .set({ status: "Cancelled", updatedAt: new Date() })
      .where(eq(purchaseOrders.id, data.id))
      .returning();

    await logSystemAction(
      user,
      "Cancel Purchase Order",
      `PO "${po.code}" dibatalkan oleh ${user.name}`,
    );
    await logAudit(user, "purchaseOrders", data.id, "STATUS_CHANGE", oldPo, po);

    return po;
  });

// ─── Delivery Notes (Surat Jalan) ───

export const getDeliveryNotes = createServerFn({ method: "GET" })
  .validator((data: { branchId?: string; status?: string }) => data)
  .handler(async ({ data: _data }) => {
    await requireAuth();

    const result = await db
      .select({
        id: deliveryNotes.id,
        code: deliveryNotes.code,
        fromBranchId: deliveryNotes.fromBranchId,
        toBranchId: deliveryNotes.toBranchId,
        status: deliveryNotes.status,
        driverName: deliveryNotes.driverName,
        vehicleNumber: deliveryNotes.vehicleNumber,
        purchaseRequisitionId: deliveryNotes.purchaseRequisitionId,
        purchaseOrderId: deliveryNotes.purchaseOrderId,
        reviewedByAdminPusat: deliveryNotes.reviewedByAdminPusat,
        receivedBy: deliveryNotes.receivedBy,
        receivedAt: deliveryNotes.receivedAt,
        createdAt: deliveryNotes.createdAt,
        updatedAt: deliveryNotes.updatedAt,
      })
      .from(deliveryNotes)
      .orderBy(desc(deliveryNotes.createdAt));

    return result;
  });

export const getDeliveryNote = createServerFn({ method: "GET" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    await requireAuth();

    const [dn] = await db
      .select()
      .from(deliveryNotes)
      .where(eq(deliveryNotes.id, data.id))
      .limit(1);

    if (!dn) return null;

    const items = await db
      .select({
        id: deliveryNoteItems.id,
        ingredientId: deliveryNoteItems.ingredientId,
        quantity: deliveryNoteItems.quantity,
        readyQuantity: deliveryNoteItems.readyQuantity,
        pickedQuantity: deliveryNoteItems.pickedQuantity,
        receivedQuantity: deliveryNoteItems.receivedQuantity,
        rejectedQuantity: deliveryNoteItems.rejectedQuantity,
        rejectionDisposition: deliveryNoteItems.rejectionDisposition,
        discrepancyNote: deliveryNoteItems.discrepancyNote,
        ingredientName: ingredients.name,
        ingredientCode: ingredients.code,
      })
      .from(deliveryNoteItems)
      .leftJoin(ingredients, eq(deliveryNoteItems.ingredientId, ingredients.id))
      .where(eq(deliveryNoteItems.deliveryNoteId, data.id));

    return { ...dn, items };
  });

export const createDeliveryNote = createServerFn({ method: "POST" })
  .validator(
    (data: {
      code: string;
      prId?: string;
      poId?: string;
      fromBranchId: string;
      toBranchId: string;
      driverName: string;
      vehicleNumber?: string;
      items: { ingredientId: string; quantity: number; readyQuantity: number }[];
    }) => data,
  )
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");

    const [dn] = await db
      .insert(deliveryNotes)
      .values({
        code: data.code,
        purchaseRequisitionId: data.prId,
        purchaseOrderId: data.poId,
        fromBranchId: data.fromBranchId,
        toBranchId: data.toBranchId,
        driverName: data.driverName,
        vehicleNumber: data.vehicleNumber,
        status: "Picking",
      })
      .returning();

    if (data.items.length > 0) {
      await db.insert(deliveryNoteItems).values(
        data.items.map((item) => ({
          deliveryNoteId: dn.id,
          ingredientId: item.ingredientId,
          quantity: item.quantity,
          readyQuantity: item.readyQuantity,
        })),
      );
    }

    await logSystemAction(
      user,
      "Create Delivery Note",
      `SJ "${data.code}" dibuat oleh ${user.name}`,
    );
    await logAudit(user, "deliveryNotes", dn.id, "CREATE", undefined, dn);

    return dn;
  });

export const updateDeliveryNote = createServerFn({ method: "POST" })
  .validator(
    (data: {
      dnId: string;
      items: { itemId: string; pickedQuantity: number }[];
      driverName?: string;
      vehicleNumber?: string;
    }) => data,
  )
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");

    const [dn] = await db
      .select()
      .from(deliveryNotes)
      .where(eq(deliveryNotes.id, data.dnId))
      .limit(1);

    if (!dn) throw new Error("Delivery note not found");
    if (!["Picking", "Draft"].includes(dn.status)) {
      throw new Error("Can only edit SJ in Picking or Draft status");
    }

    for (const item of data.items) {
      await db
        .update(deliveryNoteItems)
        .set({ pickedQuantity: item.pickedQuantity })
        .where(eq(deliveryNoteItems.id, item.itemId));
    }

    if (data.driverName || data.vehicleNumber) {
      await db
        .update(deliveryNotes)
        .set({
          driverName: data.driverName ?? dn.driverName,
          vehicleNumber: data.vehicleNumber ?? dn.vehicleNumber,
          updatedAt: new Date(),
        })
        .where(eq(deliveryNotes.id, data.dnId));
    }

    await logSystemAction(user, "Update Delivery Note", `SJ "${dn.code}" diedit oleh ${user.name}`);
    await logAudit(user, "deliveryNotes", data.dnId, "UPDATE", dn, undefined);

    return { success: true };
  });

export const shipDeliveryNote = createServerFn({ method: "POST" })
  .validator((data: { dnId: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");

    const items = await db
      .select()
      .from(deliveryNoteItems)
      .where(eq(deliveryNoteItems.deliveryNoteId, data.dnId));

    const [dn] = await db
      .select()
      .from(deliveryNotes)
      .where(eq(deliveryNotes.id, data.dnId))
      .limit(1);

    if (!dn) throw new Error("Delivery note not found");
    if (dn.status !== "Picking") throw new Error("SJ must be in Picking status to ship");

    for (const item of items) {
      const shipQty = item.pickedQuantity ?? item.quantity;

      const [inv] = await db
        .select()
        .from(inventory)
        .where(
          and(
            eq(inventory.branchId, dn.fromBranchId),
            eq(inventory.ingredientId, item.ingredientId),
          ),
        )
        .limit(1);

      if (inv) {
        const newQty = Math.max(0, inv.quantity - shipQty);
        await db
          .update(inventory)
          .set({ quantity: newQty, lastUpdated: new Date() })
          .where(eq(inventory.id, inv.id));

        await db.insert(stockLedger).values({
          branchId: dn.fromBranchId,
          ingredientId: item.ingredientId,
          type: "OUT",
          quantity: shipQty,
          balance: newQty,
          reference: data.dnId,
          notes: `SJ Kirim ${dn.code}`,
        });
      }

      await db.insert(inTransitInventory).values({
        deliveryNoteId: data.dnId,
        branchId: dn.toBranchId,
        ingredientId: item.ingredientId,
        quantity: shipQty,
      });
    }

    await db
      .update(deliveryNotes)
      .set({ status: "In Transit", updatedAt: new Date() })
      .where(eq(deliveryNotes.id, data.dnId));

    const [updatedDn] = await db
      .select()
      .from(deliveryNotes)
      .where(eq(deliveryNotes.id, data.dnId))
      .limit(1);

    await logSystemAction(user, "Ship Delivery Note", `SJ "${dn?.code}" dikirim oleh ${user.name}`);
    await logAudit(user, "deliveryNotes", data.dnId, "STATUS_CHANGE", dn, updatedDn);

    // Notify branch admin
    const branchAdminUsers = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, "branch_admin"), eq(users.branchId, dn.toBranchId)));
    for (const u of branchAdminUsers) {
      await db.insert(systemNotifications).values({
        userId: u.id,
        title: "SJ Dikirim",
        message: `SJ "${dn.code}" sedang dalam perjalanan ke cabang Anda`,
        type: "info",
      });
    }

    return { success: true };
  });

export const receiveDeliveryNote = createServerFn({ method: "POST" })
  .validator(
    (data: {
      dnId: string;
      items: {
        itemId: string;
        receivedQuantity: number;
        rejectedQuantity: number;
        rejectionDisposition?: "Return to Source" | "Scrap" | "Quarantine";
        discrepancyNote?: string;
      }[];
    }) => data,
  )
  .handler(async ({ data }) => {
    const user = await requireAuth();

    const [dn] = await db
      .select()
      .from(deliveryNotes)
      .where(eq(deliveryNotes.id, data.dnId))
      .limit(1);

    if (!dn) throw new Error("Delivery note not found");
    if (!["In Transit", "Partial Received"].includes(dn.status)) {
      throw new Error("SJ must be In Transit or Partial Received to receive");
    }

    const dnItems = await db
      .select()
      .from(deliveryNoteItems)
      .where(eq(deliveryNoteItems.deliveryNoteId, data.dnId));

    // Validate quantities
    for (const item of data.items) {
      const dnItem = dnItems.find((i) => i.id === item.itemId);
      if (!dnItem) throw new Error("Invalid item ID");

      const pickedQty = dnItem.pickedQuantity ?? dnItem.quantity;
      if (item.receivedQuantity + item.rejectedQuantity > pickedQty) {
        throw new Error(
          `Item ${dnItem.ingredientId}: Diterima (${item.receivedQuantity}) + Reject (${item.rejectedQuantity}) tidak boleh melebihi jumlah dikirim (${pickedQty})`,
        );
      }
    }

    // Process each item
    console.log(`[receiveDeliveryNote] Processing ${data.items.length} items for DN ${data.dnId}`);
    for (const item of data.items) {
      console.log(
        `[receiveDeliveryNote] Processing item ${item.itemId}: received=${item.receivedQuantity}, rejected=${item.rejectedQuantity}`,
      );
      await db
        .update(deliveryNoteItems)
        .set({
          receivedQuantity: item.receivedQuantity,
          rejectedQuantity: item.rejectedQuantity,
          rejectionDisposition: item.rejectionDisposition,
          discrepancyNote: item.discrepancyNote,
        })
        .where(eq(deliveryNoteItems.id, item.itemId));

      const dnItem = dnItems.find((i) => i.id === item.itemId)!;
      const ingredientId = dnItem.ingredientId;

      // Add received to destination inventory
      console.log(
        `[receiveDeliveryNote] Updating inventory for ingredient ${ingredientId} at branch ${dn.toBranchId}`,
      );
      const [targetInv] = await db
        .select()
        .from(inventory)
        .where(and(eq(inventory.branchId, dn.toBranchId), eq(inventory.ingredientId, ingredientId)))
        .limit(1);

      if (targetInv) {
        const newQty = targetInv.quantity + item.receivedQuantity;
        console.log(
          `[receiveDeliveryNote] Updating existing inventory: ${targetInv.quantity} → ${newQty}`,
        );
        await db
          .update(inventory)
          .set({ quantity: newQty, lastUpdated: new Date() })
          .where(eq(inventory.id, targetInv.id));

        await db.insert(stockLedger).values({
          branchId: dn.toBranchId,
          ingredientId,
          type: "IN",
          quantity: item.receivedQuantity,
          balance: newQty,
          reference: data.dnId,
          notes: `SJ Terima ${dn.code}${item.rejectedQuantity > 0 ? ` (Reject: ${item.rejectedQuantity})` : ""}`,
        });
      } else {
        console.log(`[receiveDeliveryNote] Creating new inventory entry: ${item.receivedQuantity}`);
        await db.insert(inventory).values({
          branchId: dn.toBranchId,
          ingredientId,
          quantity: item.receivedQuantity,
        });

        await db.insert(stockLedger).values({
          branchId: dn.toBranchId,
          ingredientId,
          type: "IN",
          quantity: item.receivedQuantity,
          balance: item.receivedQuantity,
          reference: data.dnId,
          notes: `SJ Terima ${dn.code}`,
        });
      }

      // Handle rejected quantity disposition
      if (item.rejectedQuantity > 0) {
        if (item.rejectionDisposition === "Return to Source") {
          // Return stock to source branch
          const [sourceInv] = await db
            .select()
            .from(inventory)
            .where(
              and(
                eq(inventory.branchId, dn.fromBranchId),
                eq(inventory.ingredientId, ingredientId),
              ),
            )
            .limit(1);

          if (sourceInv) {
            const newQty = sourceInv.quantity + item.rejectedQuantity;
            await db
              .update(inventory)
              .set({ quantity: newQty, lastUpdated: new Date() })
              .where(eq(inventory.id, sourceInv.id));

            await db.insert(stockLedger).values({
              branchId: dn.fromBranchId,
              ingredientId,
              type: "IN",
              quantity: item.rejectedQuantity,
              balance: newQty,
              reference: data.dnId,
              notes: `SJ Return Reject ${dn.code}`,
            });
          } else {
            await db.insert(inventory).values({
              branchId: dn.fromBranchId,
              ingredientId,
              quantity: item.rejectedQuantity,
            });

            await db.insert(stockLedger).values({
              branchId: dn.fromBranchId,
              ingredientId,
              type: "IN",
              quantity: item.rejectedQuantity,
              balance: item.rejectedQuantity,
              reference: data.dnId,
              notes: `SJ Return Reject ${dn.code}`,
            });
          }

          // Also create an OUT ledger at destination for the rejected amount
          await db.insert(stockLedger).values({
            branchId: dn.toBranchId,
            ingredientId,
            type: "OUT",
            quantity: item.rejectedQuantity,
            balance: (targetInv?.quantity ?? 0) + item.receivedQuantity - item.rejectedQuantity,
            reference: data.dnId,
            notes: `SJ Reject OUT ${dn.code}`,
          });
        } else if (item.rejectionDisposition === "Scrap") {
          // Create waste entry
          await db.insert(wasteEntries).values({
            branchId: dn.toBranchId,
            ingredientId,
            quantity: item.rejectedQuantity,
            category: "Biaya Operasional",
            notes: `Reject dari SJ ${dn.code}`,
            submittedBy: user.id,
          });

          await db.insert(stockLedger).values({
            branchId: dn.toBranchId,
            ingredientId,
            type: "OUT",
            quantity: item.rejectedQuantity,
            balance: (targetInv?.quantity ?? 0) + item.receivedQuantity - item.rejectedQuantity,
            reference: data.dnId,
            notes: `SJ Reject Scrap ${dn.code}`,
          });
        }
        // Quarantine: for now just track in ledger; future enhancement can add quarantine table
      }

      // Remove from in-transit
      await db
        .delete(inTransitInventory)
        .where(
          and(
            eq(inTransitInventory.deliveryNoteId, data.dnId),
            eq(inTransitInventory.ingredientId, ingredientId),
          ),
        );
    }

    // Determine if fully received
    const updatedItems = await db
      .select()
      .from(deliveryNoteItems)
      .where(eq(deliveryNoteItems.deliveryNoteId, data.dnId));

    const allFullyReceived = updatedItems.every((item) => {
      const picked = item.pickedQuantity ?? item.quantity;
      return (item.receivedQuantity ?? 0) + (item.rejectedQuantity ?? 0) >= picked;
    });

    const newStatus = allFullyReceived ? "Received" : "Partial Received";

    await db
      .update(deliveryNotes)
      .set({
        status: newStatus,
        receivedBy: user.id,
        receivedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(deliveryNotes.id, data.dnId));

    const [updatedDn] = await db
      .select()
      .from(deliveryNotes)
      .where(eq(deliveryNotes.id, data.dnId))
      .limit(1);

    await logSystemAction(
      user,
      "Receive Delivery Note",
      `SJ "${dn?.code}" diterima (${newStatus}) oleh ${user.name}`,
    );
    await logAudit(user, "deliveryNotes", data.dnId, "STATUS_CHANGE", dn, updatedDn);

    // Trigger BOM cost roll-up
    for (const item of data.items) {
      const dnItem = await db
        .select({ ingredientId: deliveryNoteItems.ingredientId })
        .from(deliveryNoteItems)
        .where(eq(deliveryNoteItems.id, item.itemId))
        .limit(1);
      if (dnItem[0]?.ingredientId) {
        await recalculateRecipeCostsForIngredient(dnItem[0].ingredientId);
      }
    }

    // Notify admin pusat
    const [branchName] = await db
      .select({ name: branches.name })
      .from(branches)
      .where(eq(branches.id, dn.toBranchId))
      .limit(1);
    const adminPusatUsers = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, "admin_pusat"));
    for (const u of adminPusatUsers) {
      await db.insert(systemNotifications).values({
        userId: u.id,
        title: "SJ Diterima",
        message: `SJ "${dn.code}" telah diterima oleh ${branchName?.name ?? dn.toBranchId}`,
        type: "info",
      });
    }

    return { success: true, status: newStatus };
  });

export const cancelDeliveryNote = createServerFn({ method: "POST" })
  .validator((data: { dnId: string; reason: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");

    const [dn] = await db
      .select()
      .from(deliveryNotes)
      .where(eq(deliveryNotes.id, data.dnId))
      .limit(1);

    if (!dn) throw new Error("Delivery note not found");
    if (!["Picking", "In Transit"].includes(dn.status)) {
      throw new Error("Can only cancel SJ in Picking or In Transit status");
    }

    const items = await db
      .select()
      .from(deliveryNoteItems)
      .where(eq(deliveryNoteItems.deliveryNoteId, data.dnId));

    if (dn.status === "In Transit") {
      // Reverse source inventory deduction and clean up in-transit
      for (const item of items) {
        const shipQty = item.pickedQuantity ?? item.quantity;

        const [sourceInv] = await db
          .select()
          .from(inventory)
          .where(
            and(
              eq(inventory.branchId, dn.fromBranchId),
              eq(inventory.ingredientId, item.ingredientId),
            ),
          )
          .limit(1);

        if (sourceInv) {
          const newQty = sourceInv.quantity + shipQty;
          await db
            .update(inventory)
            .set({ quantity: newQty, lastUpdated: new Date() })
            .where(eq(inventory.id, sourceInv.id));

          await db.insert(stockLedger).values({
            branchId: dn.fromBranchId,
            ingredientId: item.ingredientId,
            type: "IN",
            quantity: shipQty,
            balance: newQty,
            reference: data.dnId,
            notes: `SJ Batal ${dn.code}`,
          });
        }

        await db
          .delete(inTransitInventory)
          .where(
            and(
              eq(inTransitInventory.deliveryNoteId, data.dnId),
              eq(inTransitInventory.ingredientId, item.ingredientId),
            ),
          );
      }
    }

    const [updatedDn] = await db
      .update(deliveryNotes)
      .set({ status: "Cancelled", updatedAt: new Date() })
      .where(eq(deliveryNotes.id, data.dnId))
      .returning();

    await logSystemAction(
      user,
      "Cancel Delivery Note",
      `SJ "${dn.code}" dibatalkan oleh ${user.name}. Alasan: ${data.reason}`,
    );
    await logAudit(user, "deliveryNotes", data.dnId, "STATUS_CHANGE", dn, updatedDn);

    return { success: true };
  });

// ─── Review Delivery Note ───

export const reviewDeliveryNote = createServerFn({ method: "POST" })
  .validator((data: { dnId: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");

    const [dn] = await db
      .select()
      .from(deliveryNotes)
      .where(eq(deliveryNotes.id, data.dnId))
      .limit(1);

    if (!dn) throw new Error("Delivery note not found");
    if (!["Received", "Partial Received"].includes(dn.status)) {
      throw new Error("Only Received or Partial Received SJ can be reviewed");
    }

    await db
      .update(deliveryNotes)
      .set({ reviewedByAdminPusat: true, updatedAt: new Date() })
      .where(eq(deliveryNotes.id, data.dnId));

    // Auto-transition linked PR to Fulfilled if fully received
    if (dn.purchaseRequisitionId && dn.status === "Received") {
      const [pr] = await db
        .select()
        .from(purchaseRequisitions)
        .where(eq(purchaseRequisitions.id, dn.purchaseRequisitionId))
        .limit(1);

      if (pr && pr.status === "Processed") {
        await db
          .update(purchaseRequisitions)
          .set({ status: "Fulfilled", updatedAt: new Date() })
          .where(eq(purchaseRequisitions.id, pr.id));

        await logSystemAction(
          user,
          "Fulfill Purchase Requisition",
          `PR "${pr.code}" otomatis ditandai Fulfilled karena SJ "${dn.code}" sudah diterima dan direview`,
        );
      }
    }

    await logSystemAction(
      user,
      "Review Delivery Note",
      `SJ "${dn.code}" direview oleh ${user.name}`,
    );

    return { success: true };
  });

// ─── SCM Invoices ───

export const getSCMInvoices = createServerFn({ method: "GET" })
  .validator((data: { status?: string }) => data)
  .handler(async () => {
    await requireAuth();

    const result = await db
      .select({
        id: scmInvoices.id,
        code: scmInvoices.code,
        deliveryNoteId: scmInvoices.deliveryNoteId,
        fromBranchId: scmInvoices.fromBranchId,
        toBranchId: scmInvoices.toBranchId,
        totalAmount: scmInvoices.totalAmount,
        status: scmInvoices.status,
        createdAt: scmInvoices.createdAt,
      })
      .from(scmInvoices)
      .orderBy(desc(scmInvoices.createdAt));

    return result;
  });

export const getSCMInvoice = createServerFn({ method: "GET" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    await requireAuth();

    const [inv] = await db.select().from(scmInvoices).where(eq(scmInvoices.id, data.id)).limit(1);

    if (!inv) return null;

    const items = await db
      .select({
        id: scmInvoiceItems.id,
        ingredientId: scmInvoiceItems.ingredientId,
        quantity: scmInvoiceItems.quantity,
        unitPrice: scmInvoiceItems.unitPrice,
        totalPrice: scmInvoiceItems.totalPrice,
        ingredientName: ingredients.name,
      })
      .from(scmInvoiceItems)
      .leftJoin(ingredients, eq(scmInvoiceItems.ingredientId, ingredients.id))
      .where(eq(scmInvoiceItems.scmInvoiceId, data.id));

    return { ...inv, items };
  });

export const generateSCMInvoice = createServerFn({ method: "POST" })
  .validator((data: { dnId: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");

    const [dn] = await db
      .select()
      .from(deliveryNotes)
      .where(eq(deliveryNotes.id, data.dnId))
      .limit(1);

    if (!dn) throw new Error("Delivery note not found");

    const [existing] = await db
      .select({ id: scmInvoices.id })
      .from(scmInvoices)
      .where(eq(scmInvoices.deliveryNoteId, data.dnId))
      .limit(1);
    if (existing) throw new Error(`Invoice already exists for this delivery note (${existing.id})`);

    const items = await db
      .select({
        ingredientId: deliveryNoteItems.ingredientId,
        receivedQuantity: deliveryNoteItems.receivedQuantity,
      })
      .from(deliveryNoteItems)
      .where(eq(deliveryNoteItems.deliveryNoteId, data.dnId));

    if (items.length === 0) {
      throw new Error("No items found in delivery note");
    }

    let totalAmount = 0;
    const invoiceItems: {
      ingredientId: string;
      quantity: number;
      unitPrice: number;
      totalPrice: number;
    }[] = [];

    for (const item of items) {
      const [ing] = await db
        .select()
        .from(ingredients)
        .where(eq(ingredients.id, item.ingredientId))
        .limit(1);

      const unitPrice = ing?.averageCost ?? 0;
      const qty = item.receivedQuantity ?? 0;
      const totalPrice = unitPrice * qty;
      totalAmount += totalPrice;

      invoiceItems.push({
        ingredientId: item.ingredientId,
        quantity: qty,
        unitPrice,
        totalPrice,
      });
    }

    if (totalAmount <= 0) {
      throw new Error(
        `Cannot create invoice with zero amount (totalAmount=${totalAmount}). Received quantities may be zero or ingredient costs not set.`,
      );
    }

    const code = `INV-${dn.code}`;

    const [invoice] = await db
      .insert(scmInvoices)
      .values({
        code,
        deliveryNoteId: data.dnId,
        fromBranchId: dn.fromBranchId,
        toBranchId: dn.toBranchId,
        totalAmount,
        status: "Unpaid",
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      })
      .returning();

    if (invoiceItems.length > 0) {
      await db.insert(scmInvoiceItems).values(
        invoiceItems.map((item) => ({
          scmInvoiceId: invoice.id,
          ...item,
        })),
      );
    }

    await logSystemAction(
      user,
      "Generate SCM Invoice",
      `Invoice SCM "${invoice.code}" (Rp${totalAmount.toLocaleString()}) dibuat oleh ${user.name}`,
    );
    await logAudit(user, "scmInvoices", invoice.id, "CREATE", undefined, invoice);

    return invoice;
  });

export const paySCMInvoice = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");

    const [oldInv] = await db
      .select()
      .from(scmInvoices)
      .where(eq(scmInvoices.id, data.id))
      .limit(1);

    const [invoice] = await db
      .update(scmInvoices)
      .set({ status: "Paid", paidAt: new Date() })
      .where(eq(scmInvoices.id, data.id))
      .returning();

    await logSystemAction(
      user,
      "Pay SCM Invoice",
      `Invoice SCM "${invoice.code}" dibayar oleh ${user.name}`,
    );
    await logAudit(user, "scmInvoices", data.id, "STATUS_CHANGE", oldInv, invoice);

    return invoice;
  });

export const cancelSCMInvoice = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");

    const [oldInv] = await db
      .select()
      .from(scmInvoices)
      .where(eq(scmInvoices.id, data.id))
      .limit(1);

    if (!oldInv) throw new Error("Invoice not found");
    if (oldInv.status !== "Unpaid") throw new Error("Only Unpaid invoices can be cancelled");

    const [invoice] = await db
      .update(scmInvoices)
      .set({ status: "Cancelled" })
      .where(eq(scmInvoices.id, data.id))
      .returning();

    await logSystemAction(
      user,
      "Cancel SCM Invoice",
      `Invoice SCM "${invoice.code}" dibatalkan oleh ${user.name}`,
    );
    await logAudit(user, "scmInvoices", data.id, "STATUS_CHANGE", oldInv, invoice);

    return invoice;
  });

// ─── Stock Transfers (Mutasi Stok) ───

export const getStockTransfers = createServerFn({ method: "GET" })
  .validator((data: { branchId?: string }) => data)
  .handler(async ({ data: _data }) => {
    const user = await requireAuth();

    let whereClause = undefined;
    if (user.role === "branch_admin" && user.branchId) {
      whereClause = sql`(${stockTransfers.fromBranchId} = ${user.branchId} OR ${stockTransfers.toBranchId} = ${user.branchId})`;
    } else if (user.role === "area_manager" && user.assignedBranches?.length) {
      const assigned = user.assignedBranches;
      whereClause = sql`(${inArray(stockTransfers.fromBranchId, assigned)} OR ${inArray(stockTransfers.toBranchId, assigned)})`;
    }

    const result = await db
      .select({
        id: stockTransfers.id,
        code: stockTransfers.code,
        fromBranchId: stockTransfers.fromBranchId,
        toBranchId: stockTransfers.toBranchId,
        ingredientId: stockTransfers.ingredientId,
        quantity: stockTransfers.quantity,
        status: stockTransfers.status,
        requestedBy: stockTransfers.requestedBy,
        approvedBy: stockTransfers.approvedBy,
        rejectedBy: stockTransfers.rejectedBy,
        rejectionReason: stockTransfers.rejectionReason,
        createdAt: stockTransfers.createdAt,
      })
      .from(stockTransfers)
      .where(whereClause)
      .orderBy(desc(stockTransfers.createdAt));

    return result;
  });

export const getStockTransfer = createServerFn({ method: "GET" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    await requireAuth();

    const [transfer] = await db
      .select()
      .from(stockTransfers)
      .where(eq(stockTransfers.id, data.id))
      .limit(1);

    if (!transfer) return null;
    return transfer;
  });

export const createStockTransfer = createServerFn({ method: "POST" })
  .validator(
    (data: {
      code: string;
      fromBranchId: string;
      toBranchId: string;
      ingredientId: string;
      quantity: number;
    }) => data,
  )
  .handler(async ({ data }) => {
    const user = await requireAuth();

    if (user.role === "branch_admin") {
      if (data.fromBranchId !== user.branchId && data.toBranchId !== user.branchId) {
        throw new Error("Branch admin can only create transfers involving their branch");
      }
    }

    const [transfer] = await db
      .insert(stockTransfers)
      .values({
        code: data.code,
        fromBranchId: data.fromBranchId,
        toBranchId: data.toBranchId,
        ingredientId: data.ingredientId,
        quantity: data.quantity,
        status: "Pending Approval",
        requestedBy: user.id,
      })
      .returning();

    await logSystemAction(
      user,
      "Create Stock Transfer",
      `Mutasi stok "${data.code}" dibuat oleh ${user.name}`,
    );
    await logAudit(user, "stockTransfers", transfer.id, "CREATE", undefined, transfer);

    // Notify area managers
    await notifyUsers(
      ["area_manager"],
      "Mutasi Stok Baru",
      `Mutasi "${data.code}" menunggu approval`,
    );

    return transfer;
  });

export const approveStockTransfer = createServerFn({ method: "POST" })
  .validator((data: { transferId: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuth();
    await requireRole("super_admin", "area_manager");

    const [transfer] = await db
      .select()
      .from(stockTransfers)
      .where(eq(stockTransfers.id, data.transferId))
      .limit(1);

    if (!transfer) throw new Error("Transfer not found");
    if (transfer.status !== "Pending Approval")
      throw new Error("Transfer must be Pending Approval");

    if (user.role === "area_manager") {
      assertBranchAccess(user, transfer.fromBranchId);
    }

    await db
      .update(stockTransfers)
      .set({ status: "Approved", approvedBy: user.id })
      .where(eq(stockTransfers.id, data.transferId));

    await logSystemAction(
      user,
      "Approve Stock Transfer",
      `Mutasi stok "${transfer.code}" diapprove oleh ${user.name}`,
    );
    await logAudit(user, "stockTransfers", data.transferId, "STATUS_CHANGE", transfer, {
      ...transfer,
      status: "Approved",
      approvedBy: user.id,
    });

    // Notify requester
    await db.insert(systemNotifications).values({
      userId: transfer.requestedBy,
      title: "Mutasi Disetujui",
      message: `Mutasi "${transfer.code}" telah disetujui. Siap dikirim.`,
      type: "info",
    });

    return { success: true };
  });

export const rejectStockTransfer = createServerFn({ method: "POST" })
  .validator((data: { transferId: string; reason: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuth();
    await requireRole("super_admin", "area_manager");

    const [transfer] = await db
      .select()
      .from(stockTransfers)
      .where(eq(stockTransfers.id, data.transferId))
      .limit(1);

    if (!transfer) throw new Error("Transfer not found");
    if (transfer.status !== "Pending Approval")
      throw new Error("Transfer must be Pending Approval");

    if (user.role === "area_manager") {
      assertBranchAccess(user, transfer.fromBranchId);
    }

    await db
      .update(stockTransfers)
      .set({
        status: "Rejected",
        rejectedBy: user.id,
        rejectionReason: data.reason,
      })
      .where(eq(stockTransfers.id, data.transferId));

    await logSystemAction(
      user,
      "Reject Stock Transfer",
      `Mutasi stok "${transfer.code}" ditolak oleh ${user.name}. Alasan: ${data.reason}`,
    );
    await logAudit(user, "stockTransfers", data.transferId, "STATUS_CHANGE", transfer, {
      ...transfer,
      status: "Rejected",
      rejectedBy: user.id,
      rejectionReason: data.reason,
    });

    // Notify requester
    await db.insert(systemNotifications).values({
      userId: transfer.requestedBy,
      title: "Mutasi Ditolak",
      message: `Mutasi "${transfer.code}" ditolak. Alasan: ${data.reason}`,
      type: "alert",
    });

    return { success: true };
  });

export const shipStockTransfer = createServerFn({ method: "POST" })
  .validator((data: { transferId: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuth();
    await requireRole("super_admin", "admin_pusat", "branch_admin");

    const [transfer] = await db
      .select()
      .from(stockTransfers)
      .where(eq(stockTransfers.id, data.transferId))
      .limit(1);

    if (!transfer) throw new Error("Transfer not found");
    if (transfer.status !== "Approved") throw new Error("Transfer must be Approved to ship");

    if (user.role === "branch_admin" && transfer.fromBranchId !== user.branchId) {
      throw new Error("Can only ship transfers from your own branch");
    }

    // Deduct from source
    const [sourceInv] = await db
      .select()
      .from(inventory)
      .where(
        and(
          eq(inventory.branchId, transfer.fromBranchId),
          eq(inventory.ingredientId, transfer.ingredientId),
        ),
      )
      .limit(1);

    if (sourceInv) {
      const newQty = Math.max(0, sourceInv.quantity - transfer.quantity);
      await db
        .update(inventory)
        .set({ quantity: newQty, lastUpdated: new Date() })
        .where(eq(inventory.id, sourceInv.id));

      await db.insert(stockLedger).values({
        branchId: transfer.fromBranchId,
        ingredientId: transfer.ingredientId,
        type: "OUT",
        quantity: transfer.quantity,
        balance: newQty,
        reference: data.transferId,
        notes: `Mutasi ke ${transfer.toBranchId}`,
      });
    }

    // Create in-transit record
    await db.insert(inTransitInventory).values({
      stockTransferId: data.transferId,
      branchId: transfer.toBranchId,
      ingredientId: transfer.ingredientId,
      quantity: transfer.quantity,
    });

    await db
      .update(stockTransfers)
      .set({ status: "In Transit" })
      .where(eq(stockTransfers.id, data.transferId));

    await logSystemAction(
      user,
      "Ship Stock Transfer",
      `Mutasi stok "${transfer.code}" dikirim oleh ${user.name}`,
    );
    await logAudit(user, "stockTransfers", data.transferId, "STATUS_CHANGE", transfer, {
      ...transfer,
      status: "In Transit",
    });

    // Notify destination branch admin
    const destAdmins = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, "branch_admin"), eq(users.branchId, transfer.toBranchId)));
    for (const u of destAdmins) {
      await db.insert(systemNotifications).values({
        userId: u.id,
        title: "Mutasi Dikirim",
        message: `Mutasi "${transfer.code}" sedang dalam perjalanan ke cabang Anda`,
        type: "info",
      });
    }

    return { success: true };
  });

export const receiveStockTransfer = createServerFn({ method: "POST" })
  .validator((data: { transferId: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuth();
    await requireRole("super_admin", "branch_admin");

    const [transfer] = await db
      .select()
      .from(stockTransfers)
      .where(eq(stockTransfers.id, data.transferId))
      .limit(1);

    if (!transfer) throw new Error("Transfer not found");
    if (transfer.status !== "In Transit") throw new Error("Transfer must be In Transit to receive");

    if (user.role === "branch_admin" && transfer.toBranchId !== user.branchId) {
      throw new Error("Can only receive transfers to your own branch");
    }

    // Add to destination
    const [targetInv] = await db
      .select()
      .from(inventory)
      .where(
        and(
          eq(inventory.branchId, transfer.toBranchId),
          eq(inventory.ingredientId, transfer.ingredientId),
        ),
      )
      .limit(1);

    if (targetInv) {
      const newQty = targetInv.quantity + transfer.quantity;
      await db
        .update(inventory)
        .set({ quantity: newQty, lastUpdated: new Date() })
        .where(eq(inventory.id, targetInv.id));

      await db.insert(stockLedger).values({
        branchId: transfer.toBranchId,
        ingredientId: transfer.ingredientId,
        type: "IN",
        quantity: transfer.quantity,
        balance: newQty,
        reference: data.transferId,
        notes: `Mutasi dari ${transfer.fromBranchId}`,
      });
    } else {
      await db.insert(inventory).values({
        branchId: transfer.toBranchId,
        ingredientId: transfer.ingredientId,
        quantity: transfer.quantity,
      });

      await db.insert(stockLedger).values({
        branchId: transfer.toBranchId,
        ingredientId: transfer.ingredientId,
        type: "IN",
        quantity: transfer.quantity,
        balance: transfer.quantity,
        reference: data.transferId,
        notes: `Mutasi dari ${transfer.fromBranchId}`,
      });
    }

    // Remove in-transit
    await db
      .delete(inTransitInventory)
      .where(eq(inTransitInventory.stockTransferId, data.transferId));

    await db
      .update(stockTransfers)
      .set({ status: "Completed", approvedBy: user.id })
      .where(eq(stockTransfers.id, data.transferId));

    await logSystemAction(
      user,
      "Receive Stock Transfer",
      `Mutasi stok "${transfer.code}" diterima oleh ${user.name}`,
    );
    await logAudit(user, "stockTransfers", data.transferId, "STATUS_CHANGE", transfer, {
      ...transfer,
      status: "Completed",
      approvedBy: user.id,
    });

    return { success: true };
  });

export const cancelStockTransfer = createServerFn({ method: "POST" })
  .validator((data: { transferId: string; reason: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");

    const [transfer] = await db
      .select()
      .from(stockTransfers)
      .where(eq(stockTransfers.id, data.transferId))
      .limit(1);

    if (!transfer) throw new Error("Transfer not found");
    if (!["Approved", "In Transit"].includes(transfer.status)) {
      throw new Error("Can only cancel Approved or In Transit transfers");
    }

    if (transfer.status === "In Transit") {
      // Reverse source deduction
      const [sourceInv] = await db
        .select()
        .from(inventory)
        .where(
          and(
            eq(inventory.branchId, transfer.fromBranchId),
            eq(inventory.ingredientId, transfer.ingredientId),
          ),
        )
        .limit(1);

      if (sourceInv) {
        const newQty = sourceInv.quantity + transfer.quantity;
        await db
          .update(inventory)
          .set({ quantity: newQty, lastUpdated: new Date() })
          .where(eq(inventory.id, sourceInv.id));

        await db.insert(stockLedger).values({
          branchId: transfer.fromBranchId,
          ingredientId: transfer.ingredientId,
          type: "IN",
          quantity: transfer.quantity,
          balance: newQty,
          reference: data.transferId,
          notes: `Mutasi Batal ${transfer.code}`,
        });
      }

      await db
        .delete(inTransitInventory)
        .where(eq(inTransitInventory.stockTransferId, data.transferId));
    }

    await db
      .update(stockTransfers)
      .set({ status: "Cancelled" })
      .where(eq(stockTransfers.id, data.transferId));

    await logSystemAction(
      user,
      "Cancel Stock Transfer",
      `Mutasi stok "${transfer.code}" dibatalkan oleh ${user.name}. Alasan: ${data.reason}`,
    );
    await logAudit(user, "stockTransfers", data.transferId, "STATUS_CHANGE", transfer, {
      ...transfer,
      status: "Cancelled",
    });

    return { success: true };
  });
