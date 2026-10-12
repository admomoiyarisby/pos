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
import { outsideBranchCatalogItems } from "#/lib/server/branch-catalog";
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
  /** Items the receiver's branch catalog does not name (ADR 0023). */
  catalogWarnings: Array<{ ingredientId: string; ingredientName: string }>;
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

  // Destination catalog check (non-blocking). The sender check below proves the
  // ingredient is transferable FROM here; it says nothing about whether the
  // RECEIVER's branch catalog names it. Delivering an item the receiver has
  // flagged out of its catalog creates stock the receiver never counts — the
  // same disagreement the stock opname marker reports, one step earlier, at the
  // point where it is still free to fix. WARN, never block: the six production
  // cases of this shape were legitimate movements ("stock awal"), so refusing
  // them would break real work.
  const catalogWarnings = await outsideBranchCatalogItems(
    data.toBranchId,
    data.items.map((it) => it.ingredientId),
  );

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

  return { transfer, warnings, catalogWarnings };
}

export const createMutasiTransfer = createServerFn({ method: "POST" })
  .validator((data: CreateMutasiTransferInput) => data)
  .handler(async ({ data }) => createMutasiTransferCore(await requireAuth(), data));

// =============================================================================
// UPDATE: in-draft item edits (not a state transition; no FSM call)
// =============================================================================

/**
 * The one gate every in-draft item write goes through — edit, add, or remove.
 *
 * `updateTransferItem` (the FSM path) cannot serve this: adding and removing
 * lines are not per-line patches, they change the shape of the document. So the
 * three preconditions they share are asserted here rather than repeated.
 */
async function assertDraftEditable(user: MutasiActorUser, transferId: string) {
  const result = await loadTransferWithItems(transferId);
  if (!result) throw new Error("Transfer not found");
  assertTransferAccess(user, result.transfer, "act");

  if (result.transfer.status !== "SuratJalanDraft") {
    throw new Error("Items can only be edited while in SuratJalanDraft");
  }
  // super_admin edits on behalf of the sender branch (emergency override,
  // ADR 0006); every other actor must sit at the sender branch itself.
  if (user.role !== "super_admin" && user.branchId !== result.transfer.fromBranchId) {
    throw new Error("Only the sender branch can edit the draft");
  }

  return result;
}

/**
 * Current per-branch average cost for an ingredient, or null when the branch
 * cannot see it at all. The `branchVisibleClause` fold is the write-path
 * defense shared with `createMutasiTransferCore`: a restricted ingredient is
 * refused here rather than resolvable by guessing its id.
 */
async function visibleIngredient(
  user: MutasiActorUser,
  ingredientId: string,
): Promise<{ id: string; name: string; averageCost: number } | null> {
  const clause = branchVisibleClause({
    linkTable: ingredientBranches,
    linkRowId: ingredientBranches.ingredientId,
    rowId: ingredients.id,
    linkBranchId: ingredientBranches.branchId,
    currentBranchId: user.branchId,
  });
  const [row] = await db
    .select({
      id: ingredients.id,
      name: ingredients.name,
      averageCost: ingredients.averageCost,
    })
    .from(ingredients)
    .where(and(eq(ingredients.id, ingredientId), clause))
    .limit(1);
  return row ?? null;
}

export async function updateMutasiTransferDraftItemsCore(
  user: MutasiActorUser,
  data: { transferId: string; items: Array<{ id: string; quantity: number }> },
) {
  const result = await assertDraftEditable(user, data.transferId);

  // Resolve every patch against a real line up front, so an unknown item id
  // fails the whole request instead of half-applying it.
  const patches = data.items.map((it) => {
    const orig = result.items.find((i) => i.id === it.id);
    if (!orig) throw new Error(`Item ${it.id} not found in transfer ${data.transferId}`);
    return { itemId: it.id, ingredientId: orig.ingredientId, from: orig.quantity, to: it.quantity };
  });

  // Hard stock guardrail, run before any write so a rejected save leaves the
  // original quantities and audit trail untouched.
  if (patches.some((p) => p.to !== p.from)) {
    await hardStockCheck(
      result.transfer.fromBranchId,
      patches.map((p) => ({ ingredientId: p.ingredientId, quantity: p.to })),
    );
  }

  for (const p of patches) {
    if (p.to === p.from) continue;
    await db
      .update(scmTransferItems)
      .set({ quantity: p.to })
      .where(
        and(eq(scmTransferItems.id, p.itemId), eq(scmTransferItems.scmTransferId, data.transferId)),
      );
    // A changed promise belongs in the document's own trail — it is what a
    // later shortfall is measured against. Reuses the `item-update` event the
    // receiver-side edits already write (and the audit UI already renders).
    await db.insert(scmTransferAuditLog).values({
      scmTransferId: data.transferId,
      event: "item-update",
      fromState: result.transfer.status,
      toState: result.transfer.status,
      itemId: p.itemId,
      actorId: user.id,
      actorRole: user.role,
      note: JSON.stringify({ quantity: { from: p.from, to: p.to } }),
    });
  }

  return { success: true };
}

export const updateMutasiTransferDraftItems = createServerFn({ method: "POST" })
  .validator((data: { transferId: string; items: Array<{ id: string; quantity: number }> }) => {
    // Quantities are real (fractional allowed) — guarded to finite positives,
    // mirroring the receiver-side item edit. A draft line can't be zeroed out:
    // removing a line is `removeMutasiTransferDraftItem`, not a quantity of 0.
    for (const it of data.items) {
      if (!Number.isFinite(it.quantity) || it.quantity <= 0) {
        throw new Error("Quantities must be finite and greater than 0");
      }
    }
    return data;
  })
  .handler(async ({ data }) => updateMutasiTransferDraftItemsCore(await requireAuth(), data));

export async function addMutasiTransferDraftItemCore(
  user: MutasiActorUser,
  data: { transferId: string; ingredientId: string; quantity: number },
) {
  const result = await assertDraftEditable(user, data.transferId);

  // ADR 0019: one line per ingredient per SuratJalan. The unique constraint is
  // the database backstop; this turns it into advice the sender can act on,
  // and names the line already holding the ingredient.
  if (result.items.some((i) => i.ingredientId === data.ingredientId)) {
    const ing = await visibleIngredient(user, data.ingredientId);
    throw new Error(
      `Bahan "${ing?.name ?? data.ingredientId}" sudah ada di draft ini. Ubah jumlahnya pada baris yang ada, jangan tambahkan baris kedua.`,
    );
  }

  const ing = await visibleIngredient(user, data.ingredientId);
  if (!ing) {
    throw new Error("Forbidden: one or more ingredients are not available to your branch");
  }

  await hardStockCheck(result.transfer.fromBranchId, [
    { ingredientId: data.ingredientId, quantity: data.quantity },
  ]);

  // Append after the last line so the printed Surat Jalan keeps the order the
  // sender built it in.
  const nextSortOrder = result.items.reduce((max, it) => Math.max(max, it.sortOrder), -1) + 1;

  const [row] = await db
    .insert(scmTransferItems)
    .values({
      scmTransferId: data.transferId,
      ingredientId: data.ingredientId,
      sortOrder: nextSortOrder,
      quantity: data.quantity,
      // Same snapshot source and timing as `createMutasiTransferCore`: the
      // sender's promise is priced the moment the line is written.
      unitPrice: ing.averageCost ?? 0,
    })
    .returning();

  await db.insert(scmTransferAuditLog).values({
    scmTransferId: data.transferId,
    event: "item-add",
    fromState: result.transfer.status,
    toState: result.transfer.status,
    itemId: row.id,
    actorId: user.id,
    actorRole: user.role,
    note: JSON.stringify({
      ingredientId: data.ingredientId,
      ingredientName: ing.name,
      quantity: data.quantity,
    }),
  });

  return { id: row.id };
}

export const addMutasiTransferDraftItem = createServerFn({ method: "POST" })
  .validator((data: { transferId: string; ingredientId: string; quantity: number }) => {
    if (!data.ingredientId) throw new Error("An ingredient must be chosen");
    if (!Number.isFinite(data.quantity) || data.quantity <= 0) {
      throw new Error("Quantities must be finite and greater than 0");
    }
    return data;
  })
  .handler(async ({ data }) => addMutasiTransferDraftItemCore(await requireAuth(), data));

export async function removeMutasiTransferDraftItemCore(
  user: MutasiActorUser,
  data: { transferId: string; itemId: string },
) {
  const result = await assertDraftEditable(user, data.transferId);

  const item = result.items.find((i) => i.id === data.itemId);
  if (!item) throw new Error(`Item ${data.itemId} not found in transfer ${data.transferId}`);
  // A Surat Jalan with no lines can never be shipped or invoiced. Leaving the
  // sender a draft they cannot submit is a worse outcome than a rejected click.
  if (result.items.length <= 1) {
    throw new Error("Draft harus punya minimal satu item");
  }

  const ing = await visibleIngredient(user, item.ingredientId);

  // `scm_transfer_audit_log.item_id` is ON DELETE no action, so the delete below
  // is refused while any audit row still points at this line — and a line the
  // sender has already edited always has an `item-update` row pointing at it.
  // Detaching first is what makes removal possible at all; every entry itself
  // survives, with its event, actor, time and note intact.
  await db
    .update(scmTransferAuditLog)
    .set({ itemId: null })
    .where(
      and(
        eq(scmTransferAuditLog.scmTransferId, data.transferId),
        eq(scmTransferAuditLog.itemId, data.itemId),
      ),
    );

  await db
    .delete(scmTransferItems)
    .where(
      and(
        eq(scmTransferItems.id, data.itemId),
        eq(scmTransferItems.scmTransferId, data.transferId),
      ),
    );

  // Written after the delete, and with no itemId: the line it describes no
  // longer exists, so the note is the whole record. Same shape as the
  // `item-add` note — whoever reads the timeline needs the name, not a
  // dangling foreign key.
  await db.insert(scmTransferAuditLog).values({
    scmTransferId: data.transferId,
    event: "item-remove",
    fromState: result.transfer.status,
    toState: result.transfer.status,
    itemId: null,
    actorId: user.id,
    actorRole: user.role,
    note: JSON.stringify({
      ingredientId: item.ingredientId,
      ingredientName: ing?.name ?? null,
      quantity: item.quantity,
    }),
  });

  return { success: true };
}

export const removeMutasiTransferDraftItem = createServerFn({ method: "POST" })
  .validator((data: { transferId: string; itemId: string }) => data)
  .handler(async ({ data }) => removeMutasiTransferDraftItemCore(await requireAuth(), data));

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

    // super_admin acts on behalf of the receiver branch (emergency override,
    // ADR 0006); every other actor must be the receiver's own branch_admin.
    const isReceiverBa =
      user.role === "branch_admin" && user.branchId === result.transfer.toBranchId;
    if (user.role !== "super_admin" && !isReceiverBa) {
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
   *
   * `super_admin` skips the branch check entirely: it is the emergency
   * override (ADR 0006) and acts on behalf of the branch — the same
   * allowance `createMutasiTransferCore` already grants it for any sender
   * branch. Every other non-branch_admin actor is still rejected here.
   */
  branchGuard?: "sender" | "receiver" | "either";
}) {
  const result = await loadTransferWithItems(args.transferId);
  if (!result) throw new Error("Transfer not found");
  assertTransferAccess(args.user, result.transfer, "act");

  if (args.branchGuard && args.user.role !== "super_admin") {
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
