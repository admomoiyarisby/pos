import { createServerFn } from "@tanstack/react-start";
import { db } from "#/db/index";
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
} from "#/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth, requireRole } from "./auth";
import { logSystemAction, logAudit } from "./logging";
import { recalculateRecipeCostsForIngredient } from "./cost-rollup";

// ─── Purchase Requisitions ───

export const getPurchaseRequisitions = createServerFn({ method: "GET" })
  .inputValidator((data: { branchId?: string; status?: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuth();
    let branchFilter = data.branchId;
    if (user.role === "branch_admin" && user.branchId) {
      branchFilter = user.branchId;
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
  .inputValidator((data: { id: string }) => data)
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
  .inputValidator(
    (data: {
      branchId: string;
      code: string;
      items: { ingredientId: string; quantity: number }[];
      notes?: string;
    }) => data,
  )
  .handler(async ({ data }) => {
    const user = await requireAuth();
    if (user.role === "branch_admin" && user.branchId !== data.branchId) {
      throw new Error("Unauthorized branch");
    }

    const [pr] = await db
      .insert(purchaseRequisitions)
      .values({
        code: data.code,
        branchId: data.branchId,
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
    await logAudit(
      user,
      "purchaseRequisitions",
      pr.id,
      "CREATE",
      undefined,
      pr as Record<string, unknown>,
    );

    return pr;
  });

export const updatePurchaseRequisition = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      id: string;
      items?: { ingredientId: string; quantity: number }[];
      status?: string;
      rejectionReason?: string;
    }) => data,
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

    // Role-based validation
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
      if (status && !["Approved", "Processed", "Rejected"].includes(status)) {
        throw new Error("Unauthorized status change");
      }
    }

    if (status) {
      const updateData: Record<string, unknown> = {
        status: status as typeof purchaseRequisitions.$inferSelect.status,
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
      oldPr as Record<string, unknown>,
      updatedPr as Record<string, unknown>,
    );

    return { success: true };
  });

export const processPurchaseRequisition = createServerFn({ method: "POST" })
  .inputValidator(
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

    // Get PR items
    const items = await db
      .select()
      .from(purchaseRequisitionItems)
      .where(eq(purchaseRequisitionItems.purchaseRequisitionId, data.id));

    // Update PR status to Processed
    await db
      .update(purchaseRequisitions)
      .set({
        status: "Processed",
        approvedBy: user.id,
        updatedAt: new Date(),
      })
      .where(eq(purchaseRequisitions.id, data.id));

    let dn: { id: string; code: string } | null = null;

    // Auto-create Delivery Note if requested
    if (data.alsoCreateSJ) {
      const [centralBranch] = await db
        .select()
        .from(branches)
        .where(eq(branches.type, "Central"))
        .limit(1);

      const fromBranchId = centralBranch?.id ?? pr.branchId;

      // Generate SJ code
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

      // Copy PR items to DN items
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

      // Create in-transit inventory records
      for (const item of items) {
        await db.insert(inTransitInventory).values({
          deliveryNoteId: dn.id,
          branchId: pr.branchId,
          ingredientId: item.ingredientId,
          quantity: item.quantity,
        });
      }

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
  .inputValidator((data: { status?: string }) => data)
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

export const createPurchaseOrder = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      code: string;
      purchaseRequisitionId: string;
      fromBranchId: string;
      toBranchId: string;
      items: { ingredientId: string; quantity: number }[];
    }) => data,
  )
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");

    const [po] = await db
      .insert(purchaseOrders)
      .values({
        code: data.code,
        purchaseRequisitionId: data.purchaseRequisitionId,
        fromBranchId: data.fromBranchId,
        toBranchId: data.toBranchId,
        status: "Draft",
        createdBy: user.id,
      })
      .returning();

    if (data.items.length > 0) {
      await db.insert(purchaseOrderItems).values(
        data.items.map((item) => ({
          purchaseOrderId: po.id,
          ingredientId: item.ingredientId,
          quantity: item.quantity,
        })),
      );
    }

    await logSystemAction(
      user,
      "Create Purchase Order",
      `PO "${data.code}" dibuat oleh ${user.name}`,
    );
    await logAudit(
      user,
      "purchaseOrders",
      po.id,
      "CREATE",
      undefined,
      po as Record<string, unknown>,
    );

    return po;
  });

// ─── Delivery Notes (Surat Jalan) ───

export const getDeliveryNotes = createServerFn({ method: "GET" })
  .inputValidator((data: { branchId?: string; status?: string }) => data)
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
  .inputValidator((data: { id: string }) => data)
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
  .inputValidator(
    (data: {
      code: string;
      prId?: string;
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
    await logAudit(
      user,
      "deliveryNotes",
      dn.id,
      "CREATE",
      undefined,
      dn as Record<string, unknown>,
    );

    return dn;
  });

export const shipDeliveryNote = createServerFn({ method: "POST" })
  .inputValidator((data: { dnId: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");

    // Get DN items
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

    // Deduct from source inventory
    for (const item of items) {
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
        const newQty = Math.max(0, inv.quantity - (item.pickedQuantity ?? item.quantity));
        await db
          .update(inventory)
          .set({ quantity: newQty, lastUpdated: new Date() })
          .where(eq(inventory.id, inv.id));

        // Create ledger OUT
        await db.insert(stockLedger).values({
          branchId: dn.fromBranchId,
          ingredientId: item.ingredientId,
          type: "OUT",
          quantity: item.pickedQuantity ?? item.quantity,
          balance: newQty,
          reference: data.dnId,
          notes: `SJ Kirim ${dn.code}`,
        });
      }

      // Create in-transit record
      await db.insert(inTransitInventory).values({
        deliveryNoteId: data.dnId,
        branchId: dn.toBranchId,
        ingredientId: item.ingredientId,
        quantity: item.pickedQuantity ?? item.quantity,
      });
    }

    // Update DN status
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
    await logAudit(
      user,
      "deliveryNotes",
      data.dnId,
      "STATUS_CHANGE",
      dn as Record<string, unknown>,
      updatedDn as Record<string, unknown>,
    );

    return { success: true };
  });

export const receiveDeliveryNote = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      dnId: string;
      items: {
        itemId: string;
        receivedQuantity: number;
        rejectedQuantity: number;
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

    // Update each item
    for (const item of data.items) {
      await db
        .update(deliveryNoteItems)
        .set({
          receivedQuantity: item.receivedQuantity,
          rejectedQuantity: item.rejectedQuantity,
          discrepancyNote: item.discrepancyNote,
        })
        .where(eq(deliveryNoteItems.id, item.itemId));

      // Add received to destination inventory
      await db
        .select()
        .from(inventory)
        .where(
          and(
            eq(inventory.branchId, dn.toBranchId),
            eq(
              inventory.ingredientId,
              (
                await db
                  .select({ ingredientId: deliveryNoteItems.ingredientId })
                  .from(deliveryNoteItems)
                  .where(eq(deliveryNoteItems.id, item.itemId))
                  .limit(1)
              )[0]?.ingredientId ?? "",
            ),
          ),
        )
        .limit(1);

      const dnItem = await db
        .select()
        .from(deliveryNoteItems)
        .where(eq(deliveryNoteItems.id, item.itemId))
        .limit(1);

      const ingredientId = dnItem[0]?.ingredientId;
      if (!ingredientId) continue;

      const [targetInv] = await db
        .select()
        .from(inventory)
        .where(and(eq(inventory.branchId, dn.toBranchId), eq(inventory.ingredientId, ingredientId)))
        .limit(1);

      if (targetInv) {
        const newQty = targetInv.quantity + item.receivedQuantity;
        await db
          .update(inventory)
          .set({ quantity: newQty, lastUpdated: new Date() })
          .where(eq(inventory.id, targetInv.id));

        // Ledger IN
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
        // Create new inventory record
        await db
          .insert(inventory)
          .values({
            branchId: dn.toBranchId,
            ingredientId,
            quantity: item.receivedQuantity,
          })
          .returning();

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

    // Update DN status
    await db
      .update(deliveryNotes)
      .set({
        status: "Received",
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
      `SJ "${dn?.code}" diterima oleh ${user.name}`,
    );
    await logAudit(
      user,
      "deliveryNotes",
      data.dnId,
      "STATUS_CHANGE",
      dn as Record<string, unknown>,
      updatedDn as Record<string, unknown>,
    );

    // Trigger BOM cost roll-up for all received ingredients
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

    // Notify admin pusat that items were received
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

    return { success: true };
  });

// ─── Review Delivery Note ───

export const reviewDeliveryNote = createServerFn({ method: "POST" })
  .inputValidator((data: { dnId: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");

    const [dn] = await db
      .select()
      .from(deliveryNotes)
      .where(eq(deliveryNotes.id, data.dnId))
      .limit(1);

    if (!dn) throw new Error("Delivery note not found");
    if (dn.status !== "Received") throw new Error("Only Received SJ can be reviewed");

    await db
      .update(deliveryNotes)
      .set({ reviewedByAdminPusat: true, updatedAt: new Date() })
      .where(eq(deliveryNotes.id, data.dnId));

    await logSystemAction(
      user,
      "Review Delivery Note",
      `SJ "${dn.code}" direview oleh ${user.name}`,
    );

    return { success: true };
  });

// ─── SCM Invoices ───

export const getSCMInvoices = createServerFn({ method: "GET" })
  .inputValidator((data: { status?: string }) => data)
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
  .inputValidator((data: { id: string }) => data)
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
  .inputValidator((data: { dnId: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");

    const [dn] = await db
      .select()
      .from(deliveryNotes)
      .where(eq(deliveryNotes.id, data.dnId))
      .limit(1);

    if (!dn) throw new Error("Delivery note not found");

    // Get received items
    const items = await db
      .select({
        ingredientId: deliveryNoteItems.ingredientId,
        receivedQuantity: deliveryNoteItems.receivedQuantity,
      })
      .from(deliveryNoteItems)
      .where(eq(deliveryNoteItems.deliveryNoteId, data.dnId));

    // Get ingredient costs
    let totalAmount = 0;
    const invoiceItems = [];

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

    const [invoice] = await db
      .insert(scmInvoices)
      .values({
        code: `INV-${dn.code}`,
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
    await logAudit(
      user,
      "scmInvoices",
      invoice.id,
      "CREATE",
      undefined,
      invoice as Record<string, unknown>,
    );

    return invoice;
  });

export const paySCMInvoice = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
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
    await logAudit(
      user,
      "scmInvoices",
      data.id,
      "STATUS_CHANGE",
      oldInv as Record<string, unknown>,
      invoice as Record<string, unknown>,
    );

    return invoice;
  });

export const cancelSCMInvoice = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
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
    await logAudit(
      user,
      "scmInvoices",
      data.id,
      "STATUS_CHANGE",
      oldInv as Record<string, unknown>,
      invoice as Record<string, unknown>,
    );

    return invoice;
  });

// ─── Stock Transfers (Mutasi Stok) ───

export const getStockTransfers = createServerFn({ method: "GET" })
  .inputValidator((data: { branchId?: string }) => data)
  .handler(async ({ data: _data }) => {
    await requireAuth();

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
        createdAt: stockTransfers.createdAt,
      })
      .from(stockTransfers)
      .orderBy(desc(stockTransfers.createdAt));

    return result;
  });

export const createStockTransfer = createServerFn({ method: "POST" })
  .inputValidator(
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
    await logAudit(
      user,
      "stockTransfers",
      transfer.id,
      "CREATE",
      undefined,
      transfer as Record<string, unknown>,
    );

    return transfer;
  });

export const approveStockTransfer = createServerFn({ method: "POST" })
  .inputValidator((data: { transferId: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuth();
    await requireRole("super_admin", "area_manager");

    const [transfer] = await db
      .select()
      .from(stockTransfers)
      .where(eq(stockTransfers.id, data.transferId))
      .limit(1);

    if (!transfer) throw new Error("Transfer not found");

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

    // Add to target
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

    await db
      .update(stockTransfers)
      .set({ status: "Completed", approvedBy: user.id })
      .where(eq(stockTransfers.id, data.transferId));

    await logSystemAction(
      user,
      "Approve Stock Transfer",
      `Mutasi stok "${transfer.code}" diapprove oleh ${user.name}`,
    );
    await logAudit(
      user,
      "stockTransfers",
      data.transferId,
      "STATUS_CHANGE",
      transfer as Record<string, unknown>,
      { ...transfer, status: "Completed", approvedBy: user.id } as Record<string, unknown>,
    );

    return { success: true };
  });
