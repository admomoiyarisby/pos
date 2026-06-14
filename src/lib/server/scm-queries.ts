import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import { requireAuth, requireRole } from "./auth";
import {
  ingredients,
  pendingReviewInventory,
  scmProcurementAuditLog,
  scmProcurementInvoices,
  scmProcurementItems,
  scmProcurements,
} from "#/db/schema";
import type { ScmProcurementStatus } from "./scm-fsm";
import { availableEvents, transition, updateItem } from "./scm-fsm";

// =============================================================================
// createProcurement
// =============================================================================

export const createProcurement = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      branchId: string;
      items: Array<{
        ingredientId: string;
        quantity: number;
        sortOrder?: number;
      }>;
      notes?: string;
    }) => data,
  )
  .handler(async ({ data }) => {
    const user = await requireRole("branch_admin", "super_admin");

    // Generate a human-readable code: PROC-YYYY-NNNN where NNNN is a
    // count of procurements for this branch in this year + 1. Fallback to
    // a random suffix if the count fails for any reason.
    const year = new Date().getFullYear();
    const [{ count: existing }] = await db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(scmProcurements)
      .where(
        and(
          eq(scmProcurements.branchId, data.branchId),
          sql`extract(year from ${scmProcurements.createdAt}) = ${year}`,
        ),
      );
    const code = `PROC-${year}-${String((existing ?? 0) + 1).padStart(4, "0")}`;

    const [proc] = await db
      .insert(scmProcurements)
      .values({
        code,
        branchId: data.branchId,
        status: "Draft",
        requestedById: user.id,
        notes: data.notes,
      })
      .returning();

    if (!proc) throw new Error("Failed to create procurement");

    if (data.items.length > 0) {
      await db.insert(scmProcurementItems).values(
        data.items.map((it, idx) => ({
          scmProcurementId: proc.id,
          ingredientId: it.ingredientId,
          quantity: it.quantity,
          sortOrder: it.sortOrder ?? idx,
        })),
      );
    }

    // Audit log: 'create' event
    await db.insert(scmProcurementAuditLog).values({
      scmProcurementId: proc.id,
      event: "create",
      fromState: null,
      toState: "Draft",
      actorId: user.id,
      actorRole: user.role,
      note: null,
    });

    return { id: proc.id, code: proc.code };
  });

// =============================================================================
// listProcurements
// =============================================================================

export interface ListProcurementsFilters {
  status?: ScmProcurementStatus | ScmProcurementStatus[];
  branchId?: string;
  requestedById?: string;
  limit?: number;
}

type FsmRole = "branch_admin" | "admin_pusat" | "super_admin" | "area_manager";

export const listProcurements = createServerFn({ method: "GET" })
  .inputValidator((data: ListProcurementsFilters) => data)
  .handler(async ({ data }) => {
    const user = await requireAuth();
    const conditions = [];

    if (data.status) {
      const statuses = Array.isArray(data.status) ? data.status : [data.status];
      conditions.push(inArray(scmProcurements.status, statuses));
    }
    if (data.branchId) {
      conditions.push(eq(scmProcurements.branchId, data.branchId));
    }
    if (data.requestedById) {
      conditions.push(eq(scmProcurements.requestedById, data.requestedById));
    }

    // Role-based filtering: branch_admin sees their branch only; others see all.
    if (user.role === "branch_admin" && user.branchId) {
      conditions.push(eq(scmProcurements.branchId, user.branchId));
    }

    const rows = await db
      .select()
      .from(scmProcurements)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(scmProcurements.createdAt))
      .limit(data.limit ?? 100);

    return rows.map((r) => ({
      ...r,
      availableEvents: availableEvents(r.status, user.role as FsmRole),
    }));
  });

// =============================================================================
// getProcurement
// =============================================================================

export const getProcurement = createServerFn({ method: "GET" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuth();

    const [proc] = await db
      .select()
      .from(scmProcurements)
      .where(eq(scmProcurements.id, data.id))
      .limit(1);

    if (!proc) throw new Error("Procurement not found");

    // Branch admins can only see their own branch's procurements
    if (user.role === "branch_admin" && user.branchId && proc.branchId !== user.branchId) {
      throw new Error("Forbidden");
    }

    return {
      ...proc,
      availableEvents: availableEvents(proc.status, user.role as FsmRole),
    };
  });

// =============================================================================
// getProcurementItems
// =============================================================================

export const getProcurementItems = createServerFn({ method: "GET" })
  .inputValidator((data: { procurementId: string }) => data)
  .handler(async ({ data }) => {
    await requireAuth();
    const rows = await db
      .select({
        id: scmProcurementItems.id,
        ingredientId: scmProcurementItems.ingredientId,
        ingredientName: ingredients.name,
        sortOrder: scmProcurementItems.sortOrder,
        quantity: scmProcurementItems.quantity,
        readyQuantity: scmProcurementItems.readyQuantity,
        pickedQuantity: scmProcurementItems.pickedQuantity,
        receivedQuantity: scmProcurementItems.receivedQuantity,
        rejectedQuantity: scmProcurementItems.rejectedQuantity,
        caDecision: scmProcurementItems.caDecision,
        baDecision: scmProcurementItems.baDecision,
        unitPrice: scmProcurementItems.unitPrice,
        reason: scmProcurementItems.reason,
        rejectionNote: scmProcurementItems.rejectionNote,
      })
      .from(scmProcurementItems)
      .innerJoin(ingredients, eq(ingredients.id, scmProcurementItems.ingredientId))
      .where(eq(scmProcurementItems.scmProcurementId, data.procurementId))
      .orderBy(scmProcurementItems.sortOrder);

    return rows;
  });

// =============================================================================
// getProcurementAuditLog (paginated)
// =============================================================================

export const getProcurementAuditLog = createServerFn({ method: "GET" })
  .inputValidator(
    (data: { procurementId: string; limit?: number; offset?: number }) => data,
  )
  .handler(async ({ data }) => {
    await requireAuth();
    const limit = Math.max(1, Math.min(100, data.limit ?? 10));
    const offset = Math.max(0, data.offset ?? 0);
    const rows = await db
      .select()
      .from(scmProcurementAuditLog)
      .where(eq(scmProcurementAuditLog.scmProcurementId, data.procurementId))
      .orderBy(desc(scmProcurementAuditLog.timestamp))
      .limit(limit)
      .offset(offset);
    const [{ count: total }] = await db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(scmProcurementAuditLog)
      .where(eq(scmProcurementAuditLog.scmProcurementId, data.procurementId));
    return {
      entries: rows as Array<{
        id: string;
        scmProcurementId: string;
        event: string;
        fromState: string | null;
        toState: string | null;
        itemId: string | null;
        actorId: string;
        actorRole: string;
        timestamp: Date | string;
        note: string | null;
      }>,
      total: Number(total),
      limit,
      offset,
    };
  });

export interface ScmProcurementInvoiceLineItem {
  itemId: string;
  ingredientId: string;
  ingredientName: string;
  receivedQuantity: number;
  rejectedQuantity: number;
  unitPrice: number;
  lineTotal: number;
  caDecision: "pending" | "approved" | "rejected";
  baDecision: "pending" | "accepted" | "rejected";
  reason: string | null;
}

// =============================================================================
// FSM server functions (wrappers over scm-fsm.ts)
// =============================================================================

/**
 * Call the FSM transition function. This is the only public way the client
 * can change a procurement's state. The wrapper does input validation and
 * returns either { success: true, status } or { success: false, error }.
 */
export const transitionProcurement = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      procurementId: string;
      event: string;
      payload?: Record<string, unknown>;
    }) => data,
  )
  .handler(async ({ data }) => {
    const user = await requireAuth();
    const result = await transition(
      data.procurementId,
      data.event as never,
      (data.payload ?? {}) as never,
      { id: user.id, role: user.role },
    );
    return result;
  });

export const updateProcurementItem = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      procurementId: string;
      itemId: string;
      patch: Record<string, unknown>;
    }) => data,
  )
  .handler(async ({ data }) => {
    const user = await requireAuth();
    const result = await updateItem(
      data.procurementId,
      data.itemId,
      data.patch as never,
      { id: user.id, role: user.role },
    );
    return result;
  });

// =============================================================================
// getProcurementInvoice (header + line items)
// =============================================================================

export const getProcurementInvoice = createServerFn({ method: "GET" })
  .inputValidator((data: { procurementId: string }) => data)
  .handler(async ({ data }) => {
    await requireAuth();
    const [inv] = await db
      .select({
        id: scmProcurementInvoices.id,
        scmProcurementId: scmProcurementInvoices.scmProcurementId,
        generatedAt: scmProcurementInvoices.generatedAt,
        generatedById: scmProcurementInvoices.generatedById,
        totalAmount: scmProcurementInvoices.totalAmount,
        // jsonb -> typed via sql<>; the shape is ScmProcurementInvoiceLineItem
        // (defined above) and is enforced by generateInvoiceSnapshot() in
        // scm-effects.ts. We use a properly-typed array (not unknown) so that
        // ServerFn's serializability check passes.
        lineItems: sql<
          Array<ScmProcurementInvoiceLineItem>
        >`${scmProcurementInvoices.lineItems}`,
        paidAt: scmProcurementInvoices.paidAt,
        paidById: scmProcurementInvoices.paidById,
      })
      .from(scmProcurementInvoices)
      .where(eq(scmProcurementInvoices.scmProcurementId, data.procurementId))
      .limit(1);
    if (!inv) throw new Error("Invoice not found for this procurement");
    return inv;
  });

// =============================================================================
// getPendingReviewInventory (for branch "stock pending review" tile)
// =============================================================================

export const getPendingReviewInventory = createServerFn({ method: "GET" })
  .inputValidator((data: { branchId?: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuth();
    const branchId = data.branchId ?? user.branchId;
    if (!branchId) return [];

    const rows = await db
      .select({
        id: pendingReviewInventory.id,
        scmProcurementId: pendingReviewInventory.scmProcurementId,
        ingredientId: pendingReviewInventory.ingredientId,
        ingredientName: ingredients.name,
        quantity: pendingReviewInventory.quantity,
        createdAt: pendingReviewInventory.createdAt,
      })
      .from(pendingReviewInventory)
      .innerJoin(ingredients, eq(ingredients.id, pendingReviewInventory.ingredientId))
      .where(
        and(
          eq(pendingReviewInventory.branchId, branchId),
          isNull(pendingReviewInventory.clearedAt),
        ),
      )
      .orderBy(desc(pendingReviewInventory.createdAt));

    return rows;
  });

