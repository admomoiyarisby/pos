import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "./db";
import { requireAuth, requireRole } from "./auth";
import {
  ingredients,
  scmProcurementAuditLog,
  scmProcurementInvoices,
  scmProcurementItems,
  scmProcurements,
  branches,
  users,
} from "#/db/schema";
import type { ScmProcurementStatus } from "./scm-fsm";
import { availableEvents, transition, updateItem } from "./scm-fsm";
import { generateDocumentCode } from "./document-codes";

// =============================================================================
// createProcurement
// =============================================================================

export const createProcurement = createServerFn({ method: "POST" })
  .validator(
    (data: {
      branchId: string;
      items: Array<{
        ingredientId: string;
        quantity: number;
        sortOrder?: number;
      }>;
      notes?: string;
      requestSource?: string;
    }) => data,
  )
  .handler(async ({ data }) => {
    const user = await requireRole("branch_admin", "super_admin");

    // Look up branch code for the document code format:
    // PR/<branch_code>/ddmmyy/serial (see document-codes.ts)
    const [branch] = await db
      .select({ code: branches.code })
      .from(branches)
      .where(eq(branches.id, data.branchId))
      .limit(1);
    if (!branch) throw new Error("Branch not found");

    const code = await generateDocumentCode("PR", branch.code);

    const [proc] = await db
      .insert(scmProcurements)
      .values({
        code,
        branchId: data.branchId,
        status: "Draft",
        requestedById: user.id,
        notes: data.notes,
        requestSource: data.requestSource,
      })
      .returning();

    if (!proc) throw new Error("Failed to create procurement");

    if (data.items.length > 0) {
      // Snapshot unitPrice from ingredients.averageCost for each item
      // (ADR 0003). One query for all items, then a Map lookup in the
      // insert below. If an ingredient somehow doesn't exist (FK
      // guarantees it does at insert time, but defensively), unitPrice
      // is null and the invoice will show Rp 0 for that line.
      const ingredientIds = data.items.map((it) => it.ingredientId);
      const priceRows = await db
        .select({ id: ingredients.id, averageCost: ingredients.averageCost })
        .from(ingredients)
        .where(inArray(ingredients.id, ingredientIds));
      const priceById = new Map(priceRows.map((p) => [p.id, p.averageCost]));

      await db.insert(scmProcurementItems).values(
        data.items.map((it, idx) => ({
          scmProcurementId: proc.id,
          ingredientId: it.ingredientId,
          quantity: it.quantity,
          sortOrder: it.sortOrder ?? idx,
          unitPrice: priceById.get(it.ingredientId) ?? null,
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
  .validator((data: ListProcurementsFilters) => data)
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
      .select({
        id: scmProcurements.id,
        code: scmProcurements.code,
        branchId: scmProcurements.branchId,
        status: scmProcurements.status,
        requestedById: scmProcurements.requestedById,
        requestSource: scmProcurements.requestSource,
        createdAt: scmProcurements.createdAt,
        submittedAt: scmProcurements.submittedAt,
        branchName: branches.name,
        requestedByName: users.name,
      })
      .from(scmProcurements)
      .leftJoin(branches, eq(scmProcurements.branchId, branches.id))
      .leftJoin(users, eq(scmProcurements.requestedById, users.id))
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
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuth();

    const [proc] = await db
      .select({
        id: scmProcurements.id,
        code: scmProcurements.code,
        branchId: scmProcurements.branchId,
        status: scmProcurements.status,
        requestedById: scmProcurements.requestedById,
        reviewingById: scmProcurements.reviewingById,
        receivingById: scmProcurements.receivingById,
        lastEvent: scmProcurements.lastEvent,
        lastEventAt: scmProcurements.lastEventAt,
        createdAt: scmProcurements.createdAt,
        updatedAt: scmProcurements.updatedAt,
        submittedAt: scmProcurements.submittedAt,
        shippedAt: scmProcurements.shippedAt,
        receivedAt: scmProcurements.receivedAt,
        paidAt: scmProcurements.paidAt,
        rejectedAt: scmProcurements.rejectedAt,
        rejectionReason: scmProcurements.rejectionReason,
        cancelledAt: scmProcurements.cancelledAt,
        cancelledById: scmProcurements.cancelledById,
        cancellationReason: scmProcurements.cancellationReason,
        notes: scmProcurements.notes,
        requestSource: scmProcurements.requestSource,
        requestedByName: users.name,
        branchName: branches.name,
      })
      .from(scmProcurements)
      .leftJoin(users, eq(scmProcurements.requestedById, users.id))
      .leftJoin(branches, eq(scmProcurements.branchId, branches.id))
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
  .validator((data: { procurementId: string }) => data)
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
  .validator((data: { procurementId: string; limit?: number; offset?: number }) => data)
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
  .validator(
    (data: { procurementId: string; event: string; payload?: Record<string, unknown> }) => data,
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
  .validator(
    (data: { procurementId: string; itemId: string; patch: Record<string, unknown> }) => data,
  )
  .handler(async ({ data }) => {
    const user = await requireAuth();
    const result = await updateItem(data.procurementId, data.itemId, data.patch as never, {
      id: user.id,
      role: user.role,
    });
    return result;
  });

// =============================================================================
// addProcurementItem (Draft-only)
// =============================================================================
//
// Adds an item to a Draft procurement. Gated on Draft status. Snapshots
// the current ingredients.averageCost as unitPrice, mirroring createProcurement.
// Audit event: 'item-add'. (ADR 0004 §3)

export const addProcurementItem = createServerFn({ method: "POST" })
  .validator((data: { procurementId: string; ingredientId: string; quantity: number }) => data)
  .handler(async ({ data }) => {
    const user = await requireRole("branch_admin", "super_admin");
    return await db.transaction(async (tx) => {
      const [proc] = await tx
        .select({
          id: scmProcurements.id,
          status: scmProcurements.status,
          branchId: scmProcurements.branchId,
        })
        .from(scmProcurements)
        .where(eq(scmProcurements.id, data.procurementId))
        .for("update");
      if (!proc) throw new Error("Procurement not found");
      if (proc.status !== "Draft") {
        throw new Error("Items can only be added while the procurement is in Draft");
      }
      if (user.role === "branch_admin" && user.branchId && proc.branchId !== user.branchId) {
        throw new Error("Forbidden");
      }

      // Determine next sortOrder
      const [{ next }] = await tx
        .select({
          next: sql<number>`cast(coalesce(max(${scmProcurementItems.sortOrder}), -1) + 1 as integer)`,
        })
        .from(scmProcurementItems)
        .where(eq(scmProcurementItems.scmProcurementId, data.procurementId));

      // Snapshot unitPrice (ADR 0003)
      const [ing] = await tx
        .select({ averageCost: ingredients.averageCost })
        .from(ingredients)
        .where(eq(ingredients.id, data.ingredientId))
        .limit(1);
      if (!ing) throw new Error("Ingredient not found");

      const [row] = await tx
        .insert(scmProcurementItems)
        .values({
          scmProcurementId: data.procurementId,
          ingredientId: data.ingredientId,
          quantity: data.quantity,
          sortOrder: next,
          unitPrice: ing.averageCost ?? null,
        })
        .returning({ id: scmProcurementItems.id });

      await tx.insert(scmProcurementAuditLog).values({
        scmProcurementId: data.procurementId,
        event: "item-add",
        fromState: "Draft",
        toState: "Draft",
        itemId: row?.id ?? null,
        actorId: user.id,
        actorRole: user.role,
        note: JSON.stringify({ ingredientId: data.ingredientId, quantity: data.quantity }),
      });

      return { id: row?.id };
    });
  });

// =============================================================================
// removeProcurementItem (Draft-only)
// =============================================================================
//
// Removes an item from a Draft procurement. Gated on Draft status.
// Audit event: 'item-remove'. (ADR 0004 §3)

export const removeProcurementItem = createServerFn({ method: "POST" })
  .validator((data: { procurementId: string; itemId: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireRole("branch_admin", "super_admin");
    return await db.transaction(async (tx) => {
      const [proc] = await tx
        .select({
          id: scmProcurements.id,
          status: scmProcurements.status,
          branchId: scmProcurements.branchId,
        })
        .from(scmProcurements)
        .where(eq(scmProcurements.id, data.procurementId))
        .for("update");
      if (!proc) throw new Error("Procurement not found");
      if (proc.status !== "Draft") {
        throw new Error("Items can only be removed while the procurement is in Draft");
      }
      if (user.role === "branch_admin" && user.branchId && proc.branchId !== user.branchId) {
        throw new Error("Forbidden");
      }

      const deleted = await tx
        .delete(scmProcurementItems)
        .where(
          and(
            eq(scmProcurementItems.id, data.itemId),
            eq(scmProcurementItems.scmProcurementId, data.procurementId),
          ),
        )
        .returning({ id: scmProcurementItems.id });

      if (deleted.length === 0) throw new Error("Item not found");

      await tx.insert(scmProcurementAuditLog).values({
        scmProcurementId: data.procurementId,
        event: "item-remove",
        fromState: "Draft",
        toState: "Draft",
        itemId: data.itemId,
        actorId: user.id,
        actorRole: user.role,
        note: null,
      });

      return { ok: true };
    });
  });

// =============================================================================
// getProcurementInvoice (header + line items)
// =============================================================================

export const getProcurementInvoice = createServerFn({ method: "GET" })
  .validator((data: { procurementId: string }) => data)
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
        lineItems: sql<Array<ScmProcurementInvoiceLineItem>>`${scmProcurementInvoices.lineItems}`,
        paidAt: scmProcurementInvoices.paidAt,
        paidById: scmProcurementInvoices.paidById,
      })
      .from(scmProcurementInvoices)
      .where(eq(scmProcurementInvoices.scmProcurementId, data.procurementId))
      .limit(1);
    if (!inv) throw new Error("Invoice not found for this procurement");
    return inv;
  });
