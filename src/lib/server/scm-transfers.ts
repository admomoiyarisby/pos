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
import { z } from "zod";
import { db } from "./db";
import { requireAuth, requireRole } from "./auth";
import type { AppUser } from "./auth";
import { logSystemAction, logAudit } from "./logging";
import { branchVisibleClause } from "#/lib/server/branch-visibility";
import {
  branches,
  ingredients,
  ingredientBranches,
  inventory,
  scmTransferAuditLog,
  scmTransferItems,
  scmTransfers,
} from "#/db/schema";
import { type ScmTransferEvent, transitionTransfer, updateTransferItem } from "./scm-transfer-fsm";
import type { FsmPayload } from "./scm-effects";
import {
  assertTransferAccess,
  listTransfersForUser,
  loadTransferWithItems,
} from "./scm-transfer-queries";
import { nextTransferCode, nextTransferInvoiceCode } from "./scm-transfer-codes";
import { STOCK_CHECK_EPSILON } from "./scm-effects";
import { buildNotificationsForEvent, insertNotifications } from "./scm-transfer-notifications";

/**
 * Authorized-user shape passed to the user-parameterized Mutasi *core* functions
 * (the real business logic that the `createServerFn` transport wrappers run).
 * Mirrors what `requireAuth()` resolves: id, role, and the branch / AM branch
 * set used by the branch and FSM guards. Integration tests impersonate users
 * with this shape and call the cores directly.
 */
export type MutasiActorUser = {
  id: string;
  role: string;
  branchId?: string;
  assignedBranches?: string[] | null;
  /** Display name, when the caller has one. Only used for log rows. */
  name?: string;
  email?: string;
};

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
      .select({ qty: inventory.quantity, name: ingredients.name })
      .from(inventory)
      .innerJoin(ingredients, eq(ingredients.id, inventory.ingredientId))
      .where(
        and(eq(inventory.branchId, fromBranchId), eq(inventory.ingredientId, item.ingredientId)),
      )
      .limit(1);
    const available = inv?.qty ?? 0;
    // Tolerate float32 round-off residue in inventory.quantity (same guard as
    // the ship-time check in scm-transfer-effects.ts) so a displayed "50" is
    // not rejected because the stored value is 49.999999.
    if (item.quantity > available + STOCK_CHECK_EPSILON) {
      throw new Error(
        `Stok tidak mencukupi untuk bahan "${inv?.name ?? item.ingredientId}": tersedia ${available}, diminta ${item.quantity}`,
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
        rejectionDisposition: scmTransferItems.rejectionDisposition,
        createdAt: scmTransferItems.createdAt,
        updatedAt: scmTransferItems.updatedAt,
      })
      .from(scmTransferItems)
      .where(eq(scmTransferItems.scmTransferId, data.transferId))
      .orderBy(scmTransferItems.sortOrder);

    const invoiceLineItems = z
      .array(
        z.object({
          ingredientId: z.string(),
          ingredientName: z.string(),
          receivedQuantity: z.number(),
          rejectedQuantity: z.number(),
          unitPrice: z.number(),
          lineTotal: z.number(),
          reason: z.string().nullable(),
          rejectionDisposition: z
            .enum(["Return to Source", "Scrap", "Quarantine"])
            .catch("Return to Source"),
        }),
      )
      .catch([])
      .parse(result.invoice?.lineItems);

    // Branch admins must not see the per-unit HPP snapshot (unitPrice); line
    // totals and the invoice grand total are transaction amounts and stay.
    const isBranchAdmin = user.role === "branch_admin";
    const visibleItems = isBranchAdmin ? items.map((it) => ({ ...it, unitPrice: 0 })) : items;

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
          lineItems: isBranchAdmin
            ? invoiceLineItems.map((li) => ({ ...li, unitPrice: 0 }))
            : invoiceLineItems,
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
      items: visibleItems,
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

export async function createMutasiTransferCore(
  user: MutasiActorUser,
  data: CreateMutasiTransferInput,
): Promise<CreateMutasiTransferResult> {
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
  // Write-path defense: fold the shared branch-visibility clause into this
  // query so restricted ingredients are excluded from avgById; then reject if
  // any requested ingredient is missing. Central users (no branchId) are
  // unfiltered.
  const branchClause = branchVisibleClause({
    linkTable: ingredientBranches,
    linkRowId: ingredientBranches.ingredientId,
    rowId: ingredients.id,
    linkBranchId: ingredientBranches.branchId,
    currentBranchId: user.branchId,
  });
  const ingredientRows = await db
    .select({
      id: ingredients.id,
      name: ingredients.name,
      averageCost: ingredients.averageCost,
    })
    .from(ingredients)
    .where(branchClause);
  const avgById = new Map(ingredientRows.map((i) => [i.id, i.averageCost]));
  const nameById = new Map(ingredientRows.map((i) => [i.id, i.name]));

  const itemIngredientIds = [...new Set(data.items.map((it) => it.ingredientId))];
  if (itemIngredientIds.some((id) => !avgById.has(id))) {
    throw new Error("Forbidden: one or more ingredients are not available to your branch");
  }

  // One line per ingredient. `finish-receive` credits each line independently,
  // so the same ingredient listed twice silently credits the branch twice over —
  // MT/CENTRAL/041026/06 listed Simple Syrup as 1000 + 3000 and both landed,
  // leaving the outlet 1000 ml richer than the delivery. A unique constraint
  // (`stxi_transfer_ingredient_unique`, migration 0060) makes the database the
  // backstop; this check turns the constraint's error into advice the sender
  // can act on. See ADR 0019.
  if (itemIngredientIds.length !== data.items.length) {
    const counts = new Map<string, number>();
    for (const it of data.items)
      counts.set(it.ingredientId, (counts.get(it.ingredientId) ?? 0) + 1);
    const dupes = [...counts.entries()]
      .filter(([, n]) => n > 1)
      .map(([id]) => nameById.get(id) ?? id);
    throw new Error(
      `Bahan sama tidak boleh muncul lebih dari satu kali: ${dupes.join(", ")}. Gabungkan menjadi satu baris dengan total jumlah.`,
    );
  }

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
}

export const createMutasiTransfer = createServerFn({ method: "POST" })
  .validator((data: CreateMutasiTransferInput) => data)
  .handler(async ({ data }) => createMutasiTransferCore(await requireAuth(), data));

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
    }) => {
      for (const qty of [data.receivedQuantity, data.rejectedQuantity]) {
        if (qty !== undefined && (!Number.isFinite(qty) || qty < 0)) {
          throw new Error("Quantities must be finite and non-negative");
        }
      }
      return data;
    },
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
      rejectionDisposition?: "Return to Source" | "Scrap" | "Quarantine";
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

export async function submitMutasiTransferCore(
  user: MutasiActorUser,
  data: { transferId: string },
) {
  return runTransition({
    transferId: data.transferId,
    event: "submit",
    user,
    branchGuard: "sender",
  });
}

export const submitMutasiTransfer = createServerFn({ method: "POST" })
  .validator((data: { transferId: string }) => data)
  .handler(async ({ data }) => submitMutasiTransferCore(await requireAuth(), data));

export async function approveMutasiTransferCore(
  user: MutasiActorUser,
  data: { transferId: string; notes?: string },
) {
  if (user.role !== "area_manager" && user.role !== "super_admin") {
    throw new Error("Only an Area Manager can approve a Mutasi transfer");
  }
  return runTransition({
    transferId: data.transferId,
    event: "approve",
    user,
    payload: { notes: data.notes },
  });
}

export const approveMutasiTransfer = createServerFn({ method: "POST" })
  .validator((data: { transferId: string; notes?: string }) => data)
  .handler(async ({ data }) => approveMutasiTransferCore(await requireAuth(), data));

export async function rejectMutasiTransferCore(
  user: MutasiActorUser,
  data: { transferId: string; reason: string },
) {
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
}

export const rejectMutasiTransfer = createServerFn({ method: "POST" })
  .validator((data: { transferId: string; reason: string }) => data)
  .handler(async ({ data }) => rejectMutasiTransferCore(await requireAuth(), data));

export async function withdrawMutasiTransferCore(
  user: MutasiActorUser,
  data: { transferId: string },
) {
  return runTransition({
    transferId: data.transferId,
    event: "withdraw",
    user,
    branchGuard: "sender",
  });
}

export const withdrawMutasiTransfer = createServerFn({ method: "POST" })
  .validator((data: { transferId: string }) => data)
  .handler(async ({ data }) => withdrawMutasiTransferCore(await requireAuth(), data));

export async function shipMutasiTransferCore(user: MutasiActorUser, data: { transferId: string }) {
  return runTransition({
    transferId: data.transferId,
    event: "ship",
    user,
    branchGuard: "sender",
  });
}

export const shipMutasiTransfer = createServerFn({ method: "POST" })
  .validator((data: { transferId: string }) => data)
  .handler(async ({ data }) => shipMutasiTransferCore(await requireAuth(), data));

export async function markDeliveredMutasiTransferCore(
  user: MutasiActorUser,
  data: { transferId: string },
) {
  return runTransition({
    transferId: data.transferId,
    event: "mark-delivered",
    user,
    branchGuard: "receiver",
  });
}

export const markDeliveredMutasiTransfer = createServerFn({ method: "POST" })
  .validator((data: { transferId: string }) => data)
  .handler(async ({ data }) => markDeliveredMutasiTransferCore(await requireAuth(), data));

export async function openReceiveMutasiTransferCore(
  user: MutasiActorUser,
  data: { transferId: string },
) {
  return runTransition({
    transferId: data.transferId,
    event: "open-receive",
    user,
    branchGuard: "receiver",
  });
}

export const openReceiveMutasiTransfer = createServerFn({ method: "POST" })
  .validator((data: { transferId: string }) => data)
  .handler(async ({ data }) => openReceiveMutasiTransferCore(await requireAuth(), data));

export async function finishReceiveMutasiTransferCore(
  user: MutasiActorUser,
  data: {
    transferId: string;
    /** See the `finishReceiveMutasiTransfer` validator. */
    acceptedAllWithoutCount?: boolean;
    items: Array<{
      id: string;
      receivedQuantity: number;
      rejectedQuantity: number;
      reason?: string;
      rejectionDisposition?: "Return to Source" | "Scrap" | "Quarantine";
    }>;
  },
) {
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

  // Whole-delivery shortcut detection. The reviewing form used to pre-fill
  // `received` with the promised quantity, so submitting it untouched always
  // meant "received everything" — which is exactly what all 22 transfers in the
  // database did, with `rejected_quantity` 0 on every line and no physical
  // shortage ever representable. The form now starts at 0, so a 100%-accepted
  // payload means the sender either counted and it matched, or used the
  // shortcut. We record which, so an inflated `inventory` can be traced back to
  // a name instead of looking like a mystery. See ADR 0019.
  const acceptedWhole = data.items.every(
    (it) => (it.rejectedQuantity ?? 0) === 0 && it.receivedQuantity > 0,
  );
  const withoutCount = acceptedWhole && data.acceptedAllWithoutCount === true;

  const payload: FsmPayload = { items: data.items, invoiceCode };
  if (withoutCount) payload.acceptedWholeWithoutCount = true;

  const result = await runTransition({
    transferId: data.transferId,
    event: "finish-receive",
    user,
    branchGuard: "receiver",
    payload,
  });

  if (withoutCount) {
    // The document's own audit note already carries the marker (written inside
    // the transition, so it commits atomically with the stock effect). This is
    // the branch-wide searchable copy.
    const logActor: AppUser = {
      id: user.id,
      name: user.name ?? user.id,
      email: user.email ?? "",
      // SAFETY: `MutasiActorUser.role` is `string` because the FSM transition
      // table is keyed by role name; the FSM has already matched this actor
      // against `requireAuth()`'s UserRole-typed value before reaching here.
      role: user.role as AppUser["role"],
      status: "Active",
      branchId: user.branchId,
    };
    await logSystemAction(
      logActor,
      "Accept Whole Delivery Without Count",
      `Penerimaan ${invoiceCode} dicatat 100% tanpa menghitung per-item oleh ${logActor.name}. Selisih fisik (jika ada) tidak tercatat di sistem.`,
      // Marked Warning, not Success: the stock effect is correct, but this row
      // is the lead on any later POS-vs-physical gap on this delivery.
      "Warning",
    );
  }

  return result;
}

export const finishReceiveMutasiTransfer = createServerFn({ method: "POST" })
  .validator(
    (data: {
      transferId: string;
      /**
       * Set by the reviewing form when the receiver used the "accept
       * everything as promised" shortcut instead of counting each line.
       * Recorded in the system log so a later POS-vs-physical gap on this
       * delivery has a documented cause. Never inferred server-side.
       */
      acceptedAllWithoutCount?: boolean;
      // Quantities are real (fractional allowed) — guarded to finite non-negatives.
      items: Array<{
        id: string;
        receivedQuantity: number;
        rejectedQuantity: number;
        reason?: string;
        rejectionDisposition?: "Return to Source" | "Scrap" | "Quarantine";
      }>;
    }) => {
      for (const it of data.items) {
        for (const qty of [it.receivedQuantity, it.rejectedQuantity]) {
          if (!Number.isFinite(qty) || qty < 0) {
            throw new Error("Quantities must be finite and non-negative");
          }
        }
      }
      return data;
    },
  )
  .handler(async ({ data }) => finishReceiveMutasiTransferCore(await requireAuth(), data));

export async function markPaidMutasiTransferCore(
  user: MutasiActorUser,
  data: { transferId: string },
) {
  return runTransition({
    transferId: data.transferId,
    event: "mark-paid",
    user,
    branchGuard: "sender",
  });
}

export const markPaidMutasiTransfer = createServerFn({ method: "POST" })
  .validator((data: { transferId: string }) => data)
  .handler(async ({ data }) => markPaidMutasiTransferCore(await requireAuth(), data));

export async function cancelMutasiTransferCore(
  user: MutasiActorUser,
  data: { transferId: string; reason: string },
) {
  if (!data.reason.trim()) throw new Error("A cancellation reason is required");
  return runTransition({
    transferId: data.transferId,
    event: "cancel",
    user,
    payload: { reason: data.reason },
  });
}

export const cancelMutasiTransfer = createServerFn({ method: "POST" })
  .validator((data: { transferId: string; reason: string }) => data)
  .handler(async ({ data }) => cancelMutasiTransferCore(await requireAuth(), data));

// ─── Soft Delete (admin housekeeping) ──────────────────────────────────
// Tombstones the transfer (deleted_at = now). Its items, audit log and invoice
// stay intact — a hard delete would cascade them away and orphan the stock
// history the flow produced. Only the super_admin may tombstone.
export const softDeleteMutasiTransfer = createServerFn({ method: "POST" })
  .validator((data: { transferId: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin");

    const [existing] = await db
      .select()
      .from(scmTransfers)
      .where(eq(scmTransfers.id, data.transferId))
      .limit(1);
    if (!existing) throw new Error("Transfer tidak ditemukan");
    if (existing.deletedAt) throw new Error("Transfer sudah dihapus");

    const [updated] = await db
      .update(scmTransfers)
      .set({ deletedAt: new Date() })
      .where(eq(scmTransfers.id, data.transferId))
      .returning();

    await logSystemAction(
      user,
      "Delete Mutasi Transfer",
      `Mutasi ${existing.code} dihapus dari riwayat oleh ${user.name}`,
      "Warning",
    );
    await logAudit(user, "scmTransfers", data.transferId, "DELETE", existing, updated);

    return { success: true };
  });
