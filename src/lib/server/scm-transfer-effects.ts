import { and, eq, sql } from "drizzle-orm";
import type { db as DbType } from "./db";
import {
  inTransitInventory,
  inventory,
  ingredients,
  pendingReviewInventory,
  scmTransferInvoices,
  scmTransferItems,
  scmTransfers,
  stockLedger,
  wasteEntries,
} from "#/db/schema";
import { InsufficientStockError } from "./scm-transfer-errors";

// =============================================================================
// Effect handlers for the Mutasi Stok FSM (ADR 0006).
//
// Every effect runs inside the transitionTransfer() transaction (tx parameter).
// Effects must be idempotent under retry only insofar as the FSM is — they
// are NOT expected to be called twice for the same transition. Audit log
// writes happen in transitionTransfer(), not here.
//
// Naming convention: every effect is prefixed with the transfer verb it
// implements (e.g. `writeTransferInTransitInventory`) so it is unambiguous
// when both the Pengadaan and Mutasi effects are imported in the same file.
// =============================================================================

export type FsmTx = Parameters<Parameters<typeof DbType.transaction>[0]>[0];
export type FsmActor = { id: string; role: string };

export interface FsmPayload {
  reason?: string;
  notes?: string;
  /**
   * Auto-generated invoice code, passed by the `finish-receive` server
   * function so the `generateTransferInvoiceSnapshot` effect can write it on
   * the `scm_transfer_invoices` row. Only meaningful for the `finish-receive`
   * event on Mutasi transfers. Not used by Pengadaan.
   */
  invoiceCode?: string;
  items?: Array<{
    id: string;
    receivedQuantity?: number;
    rejectedQuantity?: number;
    reason?: string;
  }>;
}

// -----------------------------------------------------------------------------
// ship (Approved → InTransit)
// -----------------------------------------------------------------------------

/**
 * For each item, run a **strict** stock check (Q9): read the Sender's current
 * `inventory.quantity` for that ingredient; if it is below the item's
 * `quantity`, throw `InsufficientStockError` and abort the transaction. Then
 * decrement Sender's inventory, write OUT ledger, and insert an
 * `in_transit_inventory` row pointing at this transfer (with `scm_transfer_id`
 * set, per the 4-column CHECK constraint).
 *
 * This is the *correctness* boundary for the stock check. The soft warning at
 * `create` is a UX nudge (in the form), not a guarantee.
 *
 * Note: there is no `caDecision` / `readyQuantity` adjustment for Mutasi (Q6).
 * The Sender BA's `quantity` is what ships — full stop.
 */
export async function writeTransferInTransitInventory(
  transferId: string,
  _payload: FsmPayload,
  _actor: FsmActor,
  tx: FsmTx,
): Promise<void> {
  const [tr] = await tx.select().from(scmTransfers).where(eq(scmTransfers.id, transferId));
  if (!tr) throw new Error(`Transfer ${transferId} not found`);

  const items = await tx
    .select()
    .from(scmTransferItems)
    .where(eq(scmTransferItems.scmTransferId, transferId));

  for (const item of items) {
    if (item.quantity <= 0) continue;

    // Read current inventory at the Sender's branch
    const [inv] = await tx
      .select()
      .from(inventory)
      .where(
        and(eq(inventory.branchId, tr.fromBranchId), eq(inventory.ingredientId, item.ingredientId)),
      )
      .limit(1);

    const currentQty = inv?.quantity ?? 0;
    if (currentQty < item.quantity) {
      throw new InsufficientStockError(item.ingredientId, item.quantity, currentQty);
    }

    // Decrement Sender's inventory
    const newQty = currentQty - item.quantity;
    await tx
      .update(inventory)
      .set({ quantity: newQty, lastUpdated: new Date() })
      .where(eq(inventory.id, inv!.id));

    await tx.insert(stockLedger).values({
      branchId: tr.fromBranchId,
      ingredientId: item.ingredientId,
      type: "OUT",
      quantity: item.quantity,
      balance: newQty,
      reference: transferId,
      notes: `Mutasi ${tr.code} dikirim`,
    });

    // Insert in_transit_inventory row pointing at this transfer
    await tx.insert(inTransitInventory).values({
      scmTransferId: transferId,
      branchId: tr.toBranchId,
      ingredientId: item.ingredientId,
      quantity: item.quantity,
    });
  }
}

// -----------------------------------------------------------------------------
// mark-delivered (InTransit → Delivered)
// -----------------------------------------------------------------------------

/**
 * Move stock from `in_transit_inventory` to `pending_review_inventory` for
 * this transfer. The in-transit rows are deleted; pending-review rows are
 * inserted with the same quantity at the Receiver's branch.
 *
 * The 2-column CHECK constraint on `pending_review_inventory` (exactly one
 * of `scm_procurement_id` / `scm_transfer_id`) is satisfied by setting only
 * `scm_transfer_id`.
 */
export async function moveTransferToPendingReview(
  transferId: string,
  _payload: FsmPayload,
  actor: FsmActor,
  tx: FsmTx,
): Promise<void> {
  const inTransitRows = await tx
    .select()
    .from(inTransitInventory)
    .where(eq(inTransitInventory.scmTransferId, transferId));

  for (const row of inTransitRows) {
    await tx.insert(pendingReviewInventory).values({
      scmTransferId: transferId,
      branchId: row.branchId,
      ingredientId: row.ingredientId,
      quantity: row.quantity,
      createdById: actor.id,
    });
    await tx.delete(inTransitInventory).where(eq(inTransitInventory.id, row.id));
  }
}

// -----------------------------------------------------------------------------
// finish-receive (ReviewingSJ → WaitingForPayment)
// -----------------------------------------------------------------------------

/**
 * Apply the Receiver BA's per-item `receivedQuantity` / `rejectedQuantity` /
 * `reason` from the payload to the `scm_transfer_items` rows.
 *
 * Validation: if any line has `rejectedQuantity > 0`, that line's `reason`
 * is required (Q11). Throws on the first such line.
 */
export async function setTransferReceivedQuantities(
  transferId: string,
  payload: FsmPayload,
  _actor: FsmActor,
  tx: FsmTx,
): Promise<void> {
  if (!payload.items) throw new Error("finish-receive requires payload.items");

  for (const itemPatch of payload.items) {
    const received = itemPatch.receivedQuantity ?? 0;
    const rejected = itemPatch.rejectedQuantity ?? 0;
    if (rejected > 0 && !(itemPatch.reason ?? "").trim()) {
      throw new Error(
        `Item ${itemPatch.id}: a per-line reason is required when rejectedQuantity > 0`,
      );
    }

    await tx
      .update(scmTransferItems)
      .set({
        receivedQuantity: received,
        rejectedQuantity: rejected,
        reason: itemPatch.reason,
      })
      .where(
        and(eq(scmTransferItems.id, itemPatch.id), eq(scmTransferItems.scmTransferId, transferId)),
      );
  }
}

/**
 * For each line with `receivedQuantity > 0`, increment the Receiver's main
 * `inventory` and write an IN ledger entry. Then clear the matching
 * `pending_review_inventory` row (set `clearedAt`).
 */
export async function writeTransferReceivedStock(
  transferId: string,
  payload: FsmPayload,
  _actor: FsmActor,
  tx: FsmTx,
): Promise<void> {
  console.log(`[writeTransferReceivedStock] Starting stock update for transfer ${transferId}`);
  if (!payload.items) {
    console.warn(`[writeTransferReceivedStock] No items in payload for transfer ${transferId}`);
    return;
  }

  const [tr] = await tx.select().from(scmTransfers).where(eq(scmTransfers.id, transferId));
  if (!tr) {
    console.error(`[writeTransferReceivedStock] Transfer ${transferId} not found`);
    return;
  }
  console.log(
    `[writeTransferReceivedStock] Processing transfer ${tr.code} from ${tr.fromBranchId} to ${tr.toBranchId}`,
  );

  for (const itemPatch of payload.items) {
    const received = itemPatch.receivedQuantity ?? 0;
    if (received <= 0) {
      console.log(
        `[writeTransferReceivedStock] Skipping item ${itemPatch.id}: received quantity ${received}`,
      );
      continue;
    }

    const [item] = await tx
      .select()
      .from(scmTransferItems)
      .where(eq(scmTransferItems.id, itemPatch.id));
    if (!item) {
      console.warn(`[writeTransferReceivedStock] Item ${itemPatch.id} not found`);
      continue;
    }

    console.log(
      `[writeTransferReceivedStock] Processing item ${item.ingredientId}: ${received} units`,
    );

    // Upsert into Receiver's inventory
    const [inv] = await tx
      .select()
      .from(inventory)
      .where(
        and(eq(inventory.branchId, tr.toBranchId), eq(inventory.ingredientId, item.ingredientId)),
      )
      .limit(1);

    if (inv) {
      const newQty = inv.quantity + received;
      console.log(
        `[writeTransferReceivedStock] Updating existing inventory: ${inv.quantity} → ${newQty}`,
      );
      await tx
        .update(inventory)
        .set({ quantity: newQty, lastUpdated: new Date() })
        .where(eq(inventory.id, inv.id));
      await tx.insert(stockLedger).values({
        branchId: tr.toBranchId,
        ingredientId: item.ingredientId,
        type: "IN",
        quantity: received,
        balance: newQty,
        reference: transferId,
        notes: `Mutasi ${tr.code} diterima`,
      });
    } else {
      console.log(`[writeTransferReceivedStock] Creating new inventory entry: ${received}`);
      await tx.insert(inventory).values({
        branchId: tr.toBranchId,
        ingredientId: item.ingredientId,
        quantity: received,
      });
      await tx.insert(stockLedger).values({
        branchId: tr.toBranchId,
        ingredientId: item.ingredientId,
        type: "IN",
        quantity: received,
        balance: received,
        reference: transferId,
        notes: `Mutasi ${tr.code} diterima`,
      });
    }

    // Clear the pending_review_inventory row
    await tx
      .update(pendingReviewInventory)
      .set({ clearedAt: new Date() })
      .where(
        and(
          eq(pendingReviewInventory.scmTransferId, transferId),
          eq(pendingReviewInventory.ingredientId, item.ingredientId),
        ),
      );
  }
  console.log(`[writeTransferReceivedStock] Completed stock update for transfer ${transferId}`);
}

/**
 * For each line with `rejectedQuantity > 0`, write a `waste_entries` row at
 * the **Receiver's** branch (Q13, the Pengadaan pattern: the receiver decided
 * to reject, so they own the physical disposition). The waste entry is
 * valued at `rejectedQuantity * ingredient.averageCost` — the same global
 * average cost used for the invoice's `unitPrice` snapshot.
 */
export async function writeTransferRejectedWaste(
  transferId: string,
  payload: FsmPayload,
  actor: FsmActor,
  tx: FsmTx,
): Promise<void> {
  if (!payload.items) return;

  const [tr] = await tx.select().from(scmTransfers).where(eq(scmTransfers.id, transferId));
  if (!tr) return;

  for (const itemPatch of payload.items) {
    const rejected = itemPatch.rejectedQuantity ?? 0;
    if (rejected <= 0) continue;

    const [item] = await tx
      .select()
      .from(scmTransferItems)
      .where(eq(scmTransferItems.id, itemPatch.id));
    if (!item) continue;

    const [ing] = await tx
      .select()
      .from(ingredients)
      .where(eq(ingredients.id, item.ingredientId))
      .limit(1);
    const valuation = rejected * (ing?.averageCost ?? 0);

    await tx.insert(wasteEntries).values({
      branchId: tr.toBranchId,
      ingredientId: item.ingredientId,
      quantity: rejected,
      category: "Spoiled",
      notes: itemPatch.reason ?? null,
      valuation,
      submittedBy: actor.id,
    });
  }
}

// -----------------------------------------------------------------------------
// generate-invoice-snapshot (called as part of finish-receive)
// -----------------------------------------------------------------------------

/**
 * Generate the frozen invoice snapshot for the transfer. Reads each item's
 * `receivedQuantity` and `unitPrice` (snapshotted at item creation), computes
 * the per-line subtotal and the grand total, and inserts a row in
 * `scm_transfer_invoices`. The `lineItems` JSONB column carries the full
 * per-line breakdown for the printable invoice and the audit log.
 *
 * Note: the `code` for the invoice is generated in Phase 3's
 * `generateNextTransferInvoiceCode()` server function and passed via payload.
 * If not provided, this effect throws — the server function is responsible
 * for generating it before calling `transitionTransfer`.
 */
export async function generateTransferInvoiceSnapshot(
  transferId: string,
  payload: FsmPayload,
  actor: FsmActor,
  tx: FsmTx,
): Promise<void> {
  if (!payload.invoiceCode) {
    throw new Error("finish-receive requires payload.invoiceCode");
  }
  if (!payload.items) {
    throw new Error("finish-receive requires payload.items");
  }

  const [tr] = await tx.select().from(scmTransfers).where(eq(scmTransfers.id, transferId));
  if (!tr) throw new Error(`Transfer ${transferId} not found`);

  // Build the per-line snapshot with ingredient name for the printable invoice.
  const itemIds = payload.items.map((i) => i.id);
  if (itemIds.length === 0) {
    throw new Error("finish-receive requires at least one item");
  }

  const itemRows = await tx
    .select({
      id: scmTransferItems.id,
      ingredientId: scmTransferItems.ingredientId,
      receivedQuantity: scmTransferItems.receivedQuantity,
      rejectedQuantity: scmTransferItems.rejectedQuantity,
      unitPrice: scmTransferItems.unitPrice,
      reason: scmTransferItems.reason,
    })
    .from(scmTransferItems)
    .where(eq(scmTransferItems.scmTransferId, transferId));

  const ingredientRows = await tx
    .select({ id: ingredients.id, name: ingredients.name })
    .from(ingredients);
  const ingredientNameById = new Map(ingredientRows.map((i) => [i.id, i.name]));

  let totalAmount = 0;
  const lineItems = itemRows.map((row) => {
    const received = row.receivedQuantity ?? 0;
    const lineTotal = received * row.unitPrice;
    totalAmount += lineTotal;
    return {
      ingredientId: row.ingredientId,
      ingredientName: ingredientNameById.get(row.ingredientId) ?? row.ingredientId,
      receivedQuantity: received,
      rejectedQuantity: row.rejectedQuantity ?? 0,
      unitPrice: row.unitPrice,
      lineTotal,
      reason: row.reason,
    };
  });

  await tx.insert(scmTransferInvoices).values({
    scmTransferId: transferId,
    code: payload.invoiceCode,
    totalAmount,
    lineItems,
    createdById: actor.id,
  });
}

// -----------------------------------------------------------------------------
// mark-paid (WaitingForPayment → Finished)
// -----------------------------------------------------------------------------

/**
 * Mark the transfer's invoice as paid. Sets `paid_at` and `paid_by_id` on the
 * `scm_transfer_invoices` row. The transfer row's `paid_at` and `paid_by_id`
 * are set by the `transitionTransfer()` function's per-event metadata
 * (driven by the `mark-paid` event).
 */
export async function markTransferInvoicePaid(
  transferId: string,
  _payload: FsmPayload,
  actor: FsmActor,
  tx: FsmTx,
): Promise<void> {
  const [inv] = await tx
    .select()
    .from(scmTransferInvoices)
    .where(eq(scmTransferInvoices.scmTransferId, transferId))
    .limit(1);
  if (!inv) throw new Error(`No invoice found for transfer ${transferId}`);

  await tx
    .update(scmTransferInvoices)
    .set({ paidAt: new Date(), paidById: actor.id })
    .where(eq(scmTransferInvoices.id, inv.id));
}

// -----------------------------------------------------------------------------
// cancel (early state, no stock to reverse)
// -----------------------------------------------------------------------------

/**
 * No-op for early-state cancels. The terminal `Cancelled` state and the
 * `cancelled_at` / `cancelled_by_id` / `cancellation_reason` metadata are
 * set by the `transitionTransfer()` function. The audit log row carries
 * the reason in its `note` column.
 */
export async function noopOnCancel(
  _transferId: string,
  _payload: FsmPayload,
  _actor: FsmActor,
  _tx: FsmTx,
): Promise<void> {
  // intentional no-op
}

// -----------------------------------------------------------------------------
// cancel (InTransit → Cancelled)
// -----------------------------------------------------------------------------

/**
 * Reverse the `in_transit_inventory` rows back to the Sender's main
 * `inventory`. Writes a compensating IN ledger entry at the Sender for
 * traceability.
 */
export async function reverseTransferInTransitOnCancel(
  transferId: string,
  _payload: FsmPayload,
  _actor: FsmActor,
  tx: FsmTx,
): Promise<void> {
  const inTransitRows = await tx
    .select()
    .from(inTransitInventory)
    .where(eq(inTransitInventory.scmTransferId, transferId));

  for (const row of inTransitRows) {
    // Credit back to the Sender
    const [inv] = await tx
      .select()
      .from(inventory)
      .where(
        and(eq(inventory.branchId, row.branchId), eq(inventory.ingredientId, row.ingredientId)),
      )
      .limit(1);

    if (inv) {
      const newQty = inv.quantity + row.quantity;
      await tx
        .update(inventory)
        .set({ quantity: newQty, lastUpdated: new Date() })
        .where(eq(inventory.id, inv.id));
      await tx.insert(stockLedger).values({
        branchId: row.branchId,
        ingredientId: row.ingredientId,
        type: "IN",
        quantity: row.quantity,
        balance: newQty,
        reference: transferId,
        notes: `Mutasi ${transferId} dibatalkan saat InTransit`,
      });
    } else {
      await tx.insert(inventory).values({
        branchId: row.branchId,
        ingredientId: row.ingredientId,
        quantity: row.quantity,
      });
      await tx.insert(stockLedger).values({
        branchId: row.branchId,
        ingredientId: row.ingredientId,
        type: "IN",
        quantity: row.quantity,
        balance: row.quantity,
        reference: transferId,
        notes: `Mutasi ${transferId} dibatalkan saat InTransit`,
      });
    }

    await tx.delete(inTransitInventory).where(eq(inTransitInventory.id, row.id));
  }
}

// -----------------------------------------------------------------------------
// cancel (Delivered / ReviewingSJ / WaitingForPayment → Cancelled)
// -----------------------------------------------------------------------------

/**
 * Reverse the `pending_review_inventory` rows back to the Sender's main
 * `inventory`. Used for cancels from `Delivered`, `ReviewingSJ`, and
 * `WaitingForPayment` (the latter only if `finish-receive` had already moved
 * the stock into the Receiver's inventory — which it has, by the time we're
 * in `WaitingForPayment` — so we also need to debit the Receiver and credit
 * the Sender). This is a simplification: for `WaitingForPayment` cancel, the
 * generated invoice is also marked as cancelled. For `Delivered` /
 * `ReviewingSJ` cancel, no invoice exists yet.
 */
export async function reverseTransferPendingReviewOnCancel(
  transferId: string,
  _payload: FsmPayload,
  _actor: FsmActor,
  tx: FsmTx,
): Promise<void> {
  const [tr] = await tx.select().from(scmTransfers).where(eq(scmTransfers.id, transferId));
  if (!tr) return;

  // Phase 1: if there are pending_review_inventory rows, credit them back to
  // the Sender and clear them.
  const pendingRows = await tx
    .select()
    .from(pendingReviewInventory)
    .where(eq(pendingReviewInventory.scmTransferId, transferId));

  for (const row of pendingRows) {
    await creditBranchInventory(
      tx,
      tr.fromBranchId,
      row.ingredientId,
      row.quantity,
      transferId,
      `Mutasi ${tr.code} dibatalkan saat pending-review`,
    );
    await tx.delete(pendingReviewInventory).where(eq(pendingReviewInventory.id, row.id));
  }

  // Phase 2: if the transfer is in WaitingForPayment, finish-receive has
  // already moved the received qty into the Receiver's inventory. Reverse
  // that too: debit the Receiver, credit the Sender.
  if (tr.status === "WaitingForPayment") {
    const items = await tx
      .select()
      .from(scmTransferItems)
      .where(eq(scmTransferItems.scmTransferId, transferId));

    for (const item of items) {
      const received = item.receivedQuantity ?? 0;
      if (received <= 0) continue;

      // Debit the Receiver
      const [recvInv] = await tx
        .select()
        .from(inventory)
        .where(
          and(eq(inventory.branchId, tr.toBranchId), eq(inventory.ingredientId, item.ingredientId)),
        )
        .limit(1);

      if (recvInv) {
        const newQty = Math.max(0, recvInv.quantity - received);
        await tx
          .update(inventory)
          .set({ quantity: newQty, lastUpdated: new Date() })
          .where(eq(inventory.id, recvInv.id));
        await tx.insert(stockLedger).values({
          branchId: tr.toBranchId,
          ingredientId: item.ingredientId,
          type: "OUT",
          quantity: received,
          balance: newQty,
          reference: transferId,
          notes: `Mutasi ${tr.code} dibatalkan saat WaitingForPayment`,
        });
      }

      // Credit the Sender
      await creditBranchInventory(
        tx,
        tr.fromBranchId,
        item.ingredientId,
        received,
        transferId,
        `Mutasi ${tr.code} dibatalkan saat WaitingForPayment`,
      );
    }

    // Mark the invoice as cancelled
    await tx
      .update(scmTransferInvoices)
      .set({ cancelledAt: new Date() })
      .where(eq(scmTransferInvoices.scmTransferId, transferId));
  }
}

// -----------------------------------------------------------------------------
// Internal helpers
// -----------------------------------------------------------------------------

async function creditBranchInventory(
  tx: FsmTx,
  branchId: string,
  ingredientId: string,
  quantity: number,
  reference: string,
  notes: string,
): Promise<void> {
  const [inv] = await tx
    .select()
    .from(inventory)
    .where(and(eq(inventory.branchId, branchId), eq(inventory.ingredientId, ingredientId)))
    .limit(1);

  if (inv) {
    const newQty = inv.quantity + quantity;
    await tx
      .update(inventory)
      .set({ quantity: newQty, lastUpdated: new Date() })
      .where(eq(inventory.id, inv.id));
    await tx.insert(stockLedger).values({
      branchId,
      ingredientId,
      type: "IN",
      quantity,
      balance: newQty,
      reference,
      notes,
    });
  } else {
    await tx.insert(inventory).values({
      branchId,
      ingredientId,
      quantity,
    });
    await tx.insert(stockLedger).values({
      branchId,
      ingredientId,
      type: "IN",
      quantity,
      balance: quantity,
      reference,
      notes,
    });
  }
}

// Re-export the sql template tag for any helpers that need it (kept for
// future use; not currently used in this file).
export { sql };
