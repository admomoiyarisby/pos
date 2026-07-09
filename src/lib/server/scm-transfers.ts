// =============================================================================
// Mutasi Stok server functions (ADR 0006, Phase 3).
//
// Each function is a thin wrapper over the FSM (transitionTransfer) plus
// authorization (assertTransferAccess), code generation, and notification
// fan-out. The FSM is the security boundary for *role*; these functions are
// the security boundary for *branch* (and the data-validation entry point).
// =============================================================================

import { createServerFn } from "@tanstack/react-start";
import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { requireAuth } from "./auth";
import {
  branches,
  ingredients,
  inventory,
  scmTransferAuditLog,
  scmTransferItems,
  scmTransfers,
} from "#/db/schema";
import { type ScmTransferEvent, transitionTransfer, updateTransferItem } from "./scm-transfer-fsm";
import {
  assertTransferAccess,
  listTransfersForUser,
  loadTransferWithItems,
} from "./scm-transfer-queries";
import { nextTransferCode, nextTransferInvoiceCode } from "./scm-transfer-codes";
import { buildNotificationsForEvent, insertNotifications } from "./scm-transfer-notifications";

// -----------------------------------------------------------------------------
// Soft stock check (Q9 / Phase 3.3.1)
// -----------------------------------------------------------------------------

/**
 * Read the sender's current inventory for the given (ingredientId, quantity)
 * pairs and return a list of warnings for any line where the requested
 * quantity exceeds the available stock. Non-blocking — the form is still
 * submittable; this is a UX nudge.
 */
async function softStockCheck(
  fromBranchId: string,
  items: { ingredientId: string; quantity: number }[],
): Promise<Array<{ ingredientId: string; requested: number; available: number }>> {
  const warnings: Array<{ ingredientId: string; requested: number; available: number }> = [];
  for (const item of items) {
    const [inv] = await db
      .select()
      .from(inventory)
      .where(
        and(eq(inventory.branchId, fromBranchId), eq(inventory.ingredientId, item.ingredientId)),
      )
      .limit(1);
    const available = inv?.quantity ?? 0;
    if (item.quantity > available) {
      warnings.push({ ingredientId: item.ingredientId, requested: item.quantity, available });
    }
  }
  return warnings;
}

// -----------------------------------------------------------------------------
// Hard stock check (guardrail — throws if insufficient)
// -----------------------------------------------------------------------------

async function hardStockCheck(
  fromBranchId: string,
  items: { ingredientId: string; quantity: number }[],
): Promise<void> {
  for (const item of items) {
    const [inv] = await db
      .select({ qty: inventory.quantity })
      .from(inventory)
      .where(
        and(eq(inventory.branchId, fromBranchId), eq(inventory.ingredientId, item.ingredientId)),
      )
      .limit(1);
    const available = inv?.qty ?? 0;
    if (item.quantity > available) {
      throw new Error(
        `Stok tidak mencukupi untuk bahan yang dipilih: tersedia ${available}, diminta ${item.quantity}`,
      );
    }
  }
}

// =============================================================================
// READ: list
// =============================================================================

export const getMutasiTransfers = createServerFn({ method: "GET" })
  .validator((data: Record<string, never> | undefined) => data ?? {})
  .handler(async () => {
    const user = await requireAuth();
    return listTransfersForUser(user);
  });

// =============================================================================
// READ: single transfer with items, invoice, audit log
// =============================================================================

export const getMutasiTransfer = createServerFn({ method: "GET" })
  .validator((data: { transferId: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuth();
    const result = await loadTransferWithItems(data.transferId);
    if (!result) return null;
    assertTransferAccess(user, result.transfer, "view");

    const items = await db
      .select({
        id: scmTransferItems.id,
        scmTransferId: scmTransferItems.scmTransferId,
        ingredientId: scmTransferItems.ingredientId,
        sortOrder: scmTransferItems.sortOrder,
        quantity: scmTransferItems.quantity,
        receivedQuantity: scmTransferItems.receivedQuantity,
        rejectedQuantity: scmTransferItems.rejectedQuantity,
        unitPrice: scmTransferItems.unitPrice,
        reason: scmTransferItems.reason,
        createdAt: scmTransferItems.createdAt,
        updatedAt: scmTransferItems.updatedAt,
      })
      .from(scmTransferItems)
      .where(eq(scmTransferItems.scmTransferId, data.transferId))
      .orderBy(scmTransferItems.sortOrder);

    const invoice = result.invoice
      ? ({
          id: result.invoice.id,
          scmTransferId: result.invoice.scmTransferId,
          code: result.invoice.code,
          totalAmount: result.invoice.totalAmount,
          createdAt: result.invoice.createdAt,
          createdById: result.invoice.createdById,
          paidAt: result.invoice.paidAt,
          paidById: result.invoice.paidById,
          cancelledAt: result.invoice.cancelledAt,
          lineItems: result.invoice.lineItems as Array<{
            ingredientId: string;
            ingredientName: string;
            receivedQuantity: number;
            rejectedQuantity: number;
            unitPrice: number;
            lineTotal: number;
            reason: string | null;
          }>,
        } as const)
      : null;

    const auditRows = await db
      .select({
        id: scmTransferAuditLog.id,
        scmTransferId: scmTransferAuditLog.scmTransferId,
        event: scmTransferAuditLog.event,
        fromState: scmTransferAuditLog.fromState,
        toState: scmTransferAuditLog.toState,
        itemId: scmTransferAuditLog.itemId,
        actorId: scmTransferAuditLog.actorId,
        actorRole: scmTransferAuditLog.actorRole,
        note: scmTransferAuditLog.note,
        createdAt: scmTransferAuditLog.createdAt,
      })
      .from(scmTransferAuditLog)
      .where(eq(scmTransferAuditLog.scmTransferId, data.transferId))
      .orderBy(scmTransferAuditLog.createdAt);

    return {
      transfer: result.transfer,
      items,
      invoice,
      auditLog: auditRows,
    };
  });

// =============================================================================
// CREATE: a new Mutasi transfer in SuratJalanDraft
// =============================================================================

export interface CreateMutasiTransferInput {
  fromBranchId: string;
  toBranchId: string;
  items: Array<{ ingredientId: string; quantity: number }>;
  notes?: string;
}

export interface CreateMutasiTransferResult {
  transfer: typeof scmTransfers.$inferSelect;
  warnings: Array<{ ingredientId: string; requested: number; available: number }>;
}

export const createMutasiTransfer = createServerFn({ method: "POST" })
  .validator((data: CreateMutasiTransferInput) => data)
  .handler(async ({ data }): Promise<CreateMutasiTransferResult> => {
    const user = await requireAuth();

    // Branch-level guard: only branch_admin (at their own branch) or
    // super_admin (on behalf of any branch) can create.
    if (user.role !== "super_admin") {
      if (user.role !== "branch_admin" || user.branchId !== data.fromBranchId) {
        throw new Error("Only the Branch Admin at the sender branch can create a Mutasi transfer");
      }
    }
    if (data.fromBranchId === data.toBranchId) {
      throw new Error("Sender and receiver must be different branches");
    }
    if (!data.items.length) {
      throw new Error("At least one item is required");
    }

    // Hard stock guardrail: block submit if any item exceeds available stock.
    await hardStockCheck(data.fromBranchId, data.items);

    // Soft stock check (kept for UX feedback — returns warnings alongside the result)
    const warnings = await softStockCheck(data.fromBranchId, data.items);

    // Snapshot the unitPrice from the global ingredients.averageCost at this
    // moment. (Q11 / ADR 0006 sub-decision: matches Pengadaan's pattern in
    // ADR 0003. Per-branch inventory.averageCost is a future migration.)
    const ingredientRows = await db
      .select({ id: ingredients.id, averageCost: ingredients.averageCost })
      .from(ingredients);
    const avgById = new Map(ingredientRows.map((i) => [i.id, i.averageCost]));

    // Get branch code for document code generation
    const [fromBranch] = await db
      .select({ code: branches.code })
      .from(branches)
      .where(eq(branches.id, data.fromBranchId))
      .limit(1);
    if (!fromBranch) throw new Error("Sender branch not found");

    const code = await nextTransferCode(fromBranch.code);

    // Insert the transfer row
    const [transfer] = await db
      .insert(scmTransfers)
      .values({
        code,
        fromBranchId: data.fromBranchId,
        toBranchId: data.toBranchId,
        status: "SuratJalanDraft",
        requestedById: user.id,
        notes: data.notes ?? null,
      })
      .returning();

    // Insert the item rows
    if (data.items.length > 0) {
      await db.insert(scmTransferItems).values(
        data.items.map((it, idx) => ({
          scmTransferId: transfer.id,
          ingredientId: it.ingredientId,
          sortOrder: idx,
          quantity: it.quantity,
          unitPrice: avgById.get(it.ingredientId) ?? 0,
        })),
      );
    }

    return { transfer, warnings };
  });

// =============================================================================
// UPDATE: in-draft item edits (not a state transition; no FSM call)
// =============================================================================

export const updateMutasiTransferDraftItems = createServerFn({ method: "POST" })
  .validator((data: { transferId: string; items: Array<{ id: string; quantity: number }> }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuth();
    const result = await loadTransferWithItems(data.transferId);
    if (!result) throw new Error("Transfer not found");
    assertTransferAccess(user, result.transfer, "act");

    if (result.transfer.status !== "SuratJalanDraft") {
      throw new Error("Items can only be edited while in SuratJalanDraft");
    }
    if (user.branchId !== result.transfer.fromBranchId) {
      throw new Error("Only the sender branch can edit the draft");
    }

    // Hard stock guardrail: block save if any item exceeds available stock.
    const candidateItems = data.items.map((it) => {
      const orig = result.items.find((i) => i.id === it.id);
      return { ingredientId: orig!.ingredientId, quantity: it.quantity };
    });
    await hardStockCheck(result.transfer.fromBranchId, candidateItems);

    for (const item of data.items) {
      await db
        .update(scmTransferItems)
        .set({ quantity: item.quantity })
        .where(
          and(
            eq(scmTransferItems.id, item.id),
            eq(scmTransferItems.scmTransferId, data.transferId),
          ),
        );
    }

    return { success: true };
  });

// =============================================================================
// UPDATE: in-state per-line edits (Q11, only in Delivered/ReviewingSJ)
// =============================================================================

export const updateMutasiTransferItem = createServerFn({ method: "POST" })
  .validator(
    (data: {
      transferId: string;
      itemId: string;
      receivedQuantity?: number;
      rejectedQuantity?: number;
      reason?: string;
    }) => data,
  )
  .handler(async ({ data }) => {
    const user = await requireAuth();
    const result = await loadTransferWithItems(data.transferId);
    if (!result) throw new Error("Transfer not found");
    assertTransferAccess(user, result.transfer, "act");

    if (user.role !== "branch_admin" || user.branchId !== result.transfer.toBranchId) {
      throw new Error("Only the Receiver Branch Admin can edit received/rejected quantities");
    }

    return updateTransferItem(
      data.transferId,
      data.itemId,
      {
        receivedQuantity: data.receivedQuantity,
        rejectedQuantity: data.rejectedQuantity,
        reason: data.reason,
      },
      { id: user.id, role: user.role },
    );
  });

// =============================================================================
// TRANSITIONS — generic helper
// =============================================================================

async function runTransition(args: {
  transferId: string;
  event: ScmTransferEvent;
  user: { id: string; role: string; branchId?: string | null; assignedBranches?: string[] | null };
  payload?: {
    reason?: string;
    notes?: string;
    items?: Array<{
      id: string;
      receivedQuantity?: number;
      rejectedQuantity?: number;
      reason?: string;
    }>;
    invoiceCode?: string;
  };
  /**
   * Optional branch-level guard. If provided, the user must be a branch_admin
   * at exactly one of the two branches. The string indicates which side:
   *   "sender"  → user must be BA at fromBranchId
   *   "receiver" → user must be BA at toBranchId
   *   "either"   → user must be BA at fromBranchId OR toBranchId
   * If omitted, the branch check is skipped (used for AM transitions).
   */
  branchGuard?: "sender" | "receiver" | "either";
}) {
  const result = await loadTransferWithItems(args.transferId);
  if (!result) throw new Error("Transfer not found");
  assertTransferAccess(args.user, result.transfer, "act");

  if (args.branchGuard) {
    if (args.user.role !== "branch_admin") {
      throw new Error(`Only a Branch Admin can perform ${args.event}`);
    }
    const ub = args.user.branchId;
    if (args.branchGuard === "sender" && ub !== result.transfer.fromBranchId) {
      throw new Error("Only the sender branch admin can perform this action");
    }
    if (args.branchGuard === "receiver" && ub !== result.transfer.toBranchId) {
      throw new Error("Only the receiver branch admin can perform this action");
    }
    if (
      args.branchGuard === "either" &&
      ub !== result.transfer.fromBranchId &&
      ub !== result.transfer.toBranchId
    ) {
      throw new Error("Only a branch admin at one of the two branches can perform this action");
    }
  }

  const tr = await transitionTransfer(args.transferId, args.event, args.payload ?? {}, {
    id: args.user.id,
    role: args.user.role,
  });

  if (!tr.success) {
    throw new Error(tr.error.message);
  }

  // Notifications (after the FSM transaction has committed, so we don't
  // double-write the audit log). The Q10 matrix.
  const fresh = await loadTransferWithItems(args.transferId);
  if (fresh) {
    const targets = await buildNotificationsForEvent({
      transfer: fresh.transfer,
      event: args.event,
      actorUserId: args.user.id,
    });
    await insertNotifications(targets);
  }

  return { success: true, status: tr.status };
}

// =============================================================================
// TRANSITION wrappers — one per event
// =============================================================================

export const submitMutasiTransfer = createServerFn({ method: "POST" })
  .validator((data: { transferId: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuth();
    return runTransition({
      transferId: data.transferId,
      event: "submit",
      user,
      branchGuard: "sender",
    });
  });

export const approveMutasiTransfer = createServerFn({ method: "POST" })
  .validator((data: { transferId: string; notes?: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuth();
    if (user.role !== "area_manager" && user.role !== "super_admin") {
      throw new Error("Only an Area Manager can approve a Mutasi transfer");
    }
    return runTransition({
      transferId: data.transferId,
      event: "approve",
      user,
      payload: { notes: data.notes },
    });
  });

export const rejectMutasiTransfer = createServerFn({ method: "POST" })
  .validator((data: { transferId: string; reason: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuth();
    if (user.role !== "area_manager" && user.role !== "super_admin") {
      throw new Error("Only an Area Manager can reject a Mutasi transfer");
    }
    if (!data.reason.trim()) throw new Error("A rejection reason is required");
    return runTransition({
      transferId: data.transferId,
      event: "reject",
      user,
      payload: { reason: data.reason },
    });
  });

export const withdrawMutasiTransfer = createServerFn({ method: "POST" })
  .validator((data: { transferId: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuth();
    return runTransition({
      transferId: data.transferId,
      event: "withdraw",
      user,
      branchGuard: "sender",
    });
  });

export const shipMutasiTransfer = createServerFn({ method: "POST" })
  .validator((data: { transferId: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuth();
    return runTransition({
      transferId: data.transferId,
      event: "ship",
      user,
      branchGuard: "sender",
    });
  });

export const markDeliveredMutasiTransfer = createServerFn({ method: "POST" })
  .validator((data: { transferId: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuth();
    return runTransition({
      transferId: data.transferId,
      event: "mark-delivered",
      user,
      branchGuard: "receiver",
    });
  });

export const openReceiveMutasiTransfer = createServerFn({ method: "POST" })
  .validator((data: { transferId: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuth();
    return runTransition({
      transferId: data.transferId,
      event: "open-receive",
      user,
      branchGuard: "receiver",
    });
  });

export const finishReceiveMutasiTransfer = createServerFn({ method: "POST" })
  .validator(
    (data: {
      transferId: string;
      items: Array<{
        id: string;
        receivedQuantity: number;
        rejectedQuantity: number;
        reason?: string;
      }>;
    }) => data,
  )
  .handler(async ({ data }) => {
    const user = await requireAuth();

    // Get the transfer to find the receiver branch code
    const [transfer] = await db
      .select({ toBranchId: scmTransfers.toBranchId })
      .from(scmTransfers)
      .where(eq(scmTransfers.id, data.transferId))
      .limit(1);
    if (!transfer) throw new Error("Transfer not found");

    const [toBranch] = await db
      .select({ code: branches.code })
      .from(branches)
      .where(eq(branches.id, transfer.toBranchId))
      .limit(1);
    if (!toBranch) throw new Error("Receiver branch not found");

    const invoiceCode = await nextTransferInvoiceCode(toBranch.code);
    return runTransition({
      transferId: data.transferId,
      event: "finish-receive",
      user,
      branchGuard: "receiver",
      payload: { items: data.items, invoiceCode },
    });
  });

export const markPaidMutasiTransfer = createServerFn({ method: "POST" })
  .validator((data: { transferId: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuth();
    return runTransition({
      transferId: data.transferId,
      event: "mark-paid",
      user,
      branchGuard: "sender",
    });
  });

export const cancelMutasiTransfer = createServerFn({ method: "POST" })
  .validator((data: { transferId: string; reason: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuth();
    if (!data.reason.trim()) throw new Error("A cancellation reason is required");
    return runTransition({
      transferId: data.transferId,
      event: "cancel",
      user,
      payload: { reason: data.reason },
    });
  });
