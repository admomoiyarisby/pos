import { and, eq, sum } from "drizzle-orm";
import type { db as DbType } from "./db";
import {
  inTransitInventory,
  inventory,
  ingredients,
  pendingReviewInventory,
  scmProcurementItems,
  scmProcurementInvoices,
  scmProcurements,
  stockLedger,
  wasteEntries,
  branches,
} from "#/db/schema";

/**
 * Effect handlers for the SCM procurement FSM (ADR 0002).
 *
 * Every effect runs inside the transition() transaction (tx parameter).
 * Effects must be idempotent under retry only insofar as the FSM is — they
 * are NOT expected to be called twice for the same transition. Audit log
 * writes happen in transition(), not here.
 */

export type FsmTx = Parameters<Parameters<typeof DbType.transaction>[0]>[0];
export type FsmActor = { id: string; role: string };

export interface FsmPayload {
  reason?: string;
  notes?: string;
  items?: Array<{
    id: string;
    receivedQuantity?: number;
    rejectedQuantity?: number;
    reason?: string;
  }>;
  caDecisions?: Array<{
    id: string;
    caDecision: "approved" | "rejected";
    readyQuantity?: number;
    rejectionNote?: string;
  }>;
}

// -----------------------------------------------------------------------------
// accept-and-ship
// -----------------------------------------------------------------------------

/**
 * Copy readyQuantity -> pickedQuantity for every item that CA approved.
 * Items where CA decided 'rejected' get pickedQuantity = 0 (they don't ship).
 */
export async function copyReadyToPicked(
  procurementId: string,
  _payload: FsmPayload,
  _actor: FsmActor,
  tx: FsmTx,
): Promise<void> {
  const items = await tx
    .select()
    .from(scmProcurementItems)
    .where(eq(scmProcurementItems.scmProcurementId, procurementId));

  for (const item of items) {
    const picked =
      item.caDecision === "approved" ? (item.readyQuantity ?? item.quantity) : 0;
    await tx
      .update(scmProcurementItems)
      .set({ pickedQuantity: picked })
      .where(eq(scmProcurementItems.id, item.id));
  }
}

/**
 * For each approved item, decrement Central's inventory, write OUT ledger,
 * and insert an in_transit_inventory row pointing at this procurement.
 * Central = the single branch of type 'Central'. If there are multiple,
 * this is a TODO (ADR 0002 §consequences).
 */
export async function writeInTransitInventory(
  procurementId: string,
  _payload: FsmPayload,
  actor: FsmActor,
  tx: FsmTx,
): Promise<void> {
  const [proc] = await tx
    .select()
    .from(scmProcurements)
    .where(eq(scmProcurements.id, procurementId));
  if (!proc) throw new Error(`Procurement ${procurementId} not found`);

  const [central] = await tx
    .select()
    .from(branches)
    .where(eq(branches.type, "Central"))
    .limit(1);
  if (!central) throw new Error("No Central branch configured");

  const items = await tx
    .select()
    .from(scmProcurementItems)
    .where(eq(scmProcurementItems.scmProcurementId, procurementId));

  for (const item of items) {
    if (item.caDecision !== "approved" || !item.pickedQuantity || item.pickedQuantity <= 0) {
      continue;
    }

    // Decrement Central's inventory
    const [inv] = await tx
      .select()
      .from(inventory)
      .where(
        and(eq(inventory.branchId, central.id), eq(inventory.ingredientId, item.ingredientId)),
      )
      .limit(1);

    if (inv) {
      const newQty = Math.max(0, inv.quantity - item.pickedQuantity);
      await tx
        .update(inventory)
        .set({ quantity: newQty, lastUpdated: new Date() })
        .where(eq(inventory.id, inv.id));

      await tx.insert(stockLedger).values({
        branchId: central.id,
        ingredientId: item.ingredientId,
        type: "OUT",
        quantity: item.pickedQuantity,
        balance: newQty,
        reference: procurementId,
        notes: `Pengadaan ${proc.code} dikirim`,
      });
    }

    // Insert in_transit_inventory row pointing at this procurement
    await tx.insert(inTransitInventory).values({
      scmProcurementId: procurementId,
      branchId: proc.branchId,
      ingredientId: item.ingredientId,
      quantity: item.pickedQuantity,
    });
  }

  void actor; // actor used elsewhere; required by signature
}

// -----------------------------------------------------------------------------
// mark-delivered
// -----------------------------------------------------------------------------

/**
 * Move stock from in_transit_inventory to pending_review_inventory for this
 * procurement. The in_transit_inventory rows are deleted; pending_review rows
 * are inserted with the same quantity.
 */
export async function moveStockToPendingReview(
  procurementId: string,
  _payload: FsmPayload,
  actor: FsmActor,
  tx: FsmTx,
): Promise<void> {
  const inTransitRows = await tx
    .select()
    .from(inTransitInventory)
    .where(eq(inTransitInventory.scmProcurementId, procurementId));

  for (const row of inTransitRows) {
    await tx.insert(pendingReviewInventory).values({
      scmProcurementId: procurementId,
      branchId: row.branchId,
      ingredientId: row.ingredientId,
      quantity: row.quantity,
      createdById: actor.id,
    });
    await tx.delete(inTransitInventory).where(eq(inTransitInventory.id, row.id));
  }
}

// -----------------------------------------------------------------------------
// finish-receive
// -----------------------------------------------------------------------------

/**
 * Apply BA's per-item receivedQuantity / rejectedQuantity / reason from the
 * payload to the scm_procurement_items rows. Also set baDecision based on
 * whether receivedQuantity is > 0.
 */
export async function setReceivedQuantities(
  procurementId: string,
  payload: FsmPayload,
  _actor: FsmActor,
  tx: FsmTx,
): Promise<void> {
  if (!payload.items) throw new Error("finish-receive requires payload.items");

  for (const itemPatch of payload.items) {
    const received = itemPatch.receivedQuantity ?? 0;
    const rejected = itemPatch.rejectedQuantity ?? 0;
    const baDecision: "pending" | "accepted" | "rejected" =
      received > 0 ? "accepted" : rejected > 0 ? "rejected" : "pending";

    await tx
      .update(scmProcurementItems)
      .set({
        receivedQuantity: received,
        rejectedQuantity: rejected,
        reason: itemPatch.reason,
        baDecision,
      })
      .where(
        and(
          eq(scmProcurementItems.id, itemPatch.id),
          eq(scmProcurementItems.scmProcurementId, procurementId),
        ),
      );
  }
}

/**
 * Increment the branch's main inventory by receivedQuantity, write IN ledger.
 * Called as part of finish-receive.
 */
export async function writeReceivedStock(
  procurementId: string,
  payload: FsmPayload,
  actor: FsmActor,
  tx: FsmTx,
): Promise<void> {
  if (!payload.items) return;

  const [proc] = await tx
    .select()
    .from(scmProcurements)
    .where(eq(scmProcurements.id, procurementId));
  if (!proc) return;

  for (const itemPatch of payload.items) {
    const received = itemPatch.receivedQuantity ?? 0;
    if (received <= 0) continue;

    // Find the item to get ingredientId
    const [item] = await tx
      .select()
      .from(scmProcurementItems)
      .where(eq(scmProcurementItems.id, itemPatch.id));
    if (!item) continue;

    // Upsert into branch's inventory
    const [inv] = await tx
      .select()
      .from(inventory)
      .where(
        and(eq(inventory.branchId, proc.branchId), eq(inventory.ingredientId, item.ingredientId)),
      )
      .limit(1);

    if (inv) {
      const newQty = inv.quantity + received;
      await tx
        .update(inventory)
        .set({ quantity: newQty, lastUpdated: new Date() })
        .where(eq(inventory.id, inv.id));
      await tx.insert(stockLedger).values({
        branchId: proc.branchId,
        ingredientId: item.ingredientId,
        type: "IN",
        quantity: received,
        balance: newQty,
        reference: procurementId,
        notes: `Pengadaan ${proc.code} diterima`,
      });
    } else {
      await tx.insert(inventory).values({
        branchId: proc.branchId,
        ingredientId: item.ingredientId,
        quantity: received,
      });
      await tx.insert(stockLedger).values({
        branchId: proc.branchId,
        ingredientId: item.ingredientId,
        type: "IN",
        quantity: received,
        balance: received,
        reference: procurementId,
        notes: `Pengadaan ${proc.code} diterima`,
      });
    }

    // Clear the pending_review_inventory row
    await tx
      .update(pendingReviewInventory)
      .set({ clearedAt: new Date() })
      .where(
        and(
          eq(pendingReviewInventory.scmProcurementId, procurementId),
          eq(pendingReviewInventory.ingredientId, item.ingredientId),
        ),
      );
  }

  void actor;
}

/**
 * For each item with rejectedQuantity > 0, write a waste_entries row.
 * Currently we always treat rejection as Scrap (category: Spoiled). Future:
 * support Return to Source / Quarantine as alternate dispositions.
 */
export async function writeRejectedWaste(
  procurementId: string,
  payload: FsmPayload,
  actor: FsmActor,
  tx: FsmTx,
): Promise<void> {
  if (!payload.items) return;

  const [proc] = await tx
    .select()
    .from(scmProcurements)
    .where(eq(scmProcurements.id, procurementId));
  if (!proc) return;

  for (const itemPatch of payload.items) {
    const rejected = itemPatch.rejectedQuantity ?? 0;
    if (rejected <= 0) continue;

    const [item] = await tx
      .select()
      .from(scmProcurementItems)
      .where(eq(scmProcurementItems.id, itemPatch.id));
    if (!item) continue;

    await tx.insert(wasteEntries).values({
      branchId: proc.branchId,
      ingredientId: item.ingredientId,
      quantity: rejected,
      category: "Spoiled",
      notes: itemPatch.reason
        ? `Ditolak saat penerimaan: ${itemPatch.reason}`
        : `Ditolak saat penerimaan pengadaan ${proc.code}`,
      submittedBy: actor.id,
    });
  }
}

/**
 * Generate the frozen invoice snapshot. lineItems is JSON: both accepted
 * (lineTotal > 0) and rejected (lineTotal = 0, with reason).
 */
export async function generateInvoiceSnapshot(
  procurementId: string,
  _payload: FsmPayload,
  actor: FsmActor,
  tx: FsmTx,
): Promise<void> {
  const [proc] = await tx
    .select()
    .from(scmProcurements)
    .where(eq(scmProcurements.id, procurementId));
  if (!proc) throw new Error(`Procurement ${procurementId} not found`);

  const items = await tx
    .select({
      id: scmProcurementItems.id,
      ingredientId: scmProcurementItems.ingredientId,
      receivedQuantity: scmProcurementItems.receivedQuantity,
      rejectedQuantity: scmProcurementItems.rejectedQuantity,
      unitPrice: scmProcurementItems.unitPrice,
      reason: scmProcurementItems.reason,
      baDecision: scmProcurementItems.baDecision,
      caDecision: scmProcurementItems.caDecision,
      ingredientName: ingredients.name,
    })
    .from(scmProcurementItems)
    .innerJoin(ingredients, eq(ingredients.id, scmProcurementItems.ingredientId))
    .where(eq(scmProcurementItems.scmProcurementId, procurementId));

  const lineItems = items.map((item) => {
    const accepted = item.receivedQuantity ?? 0;
    const rejected = item.rejectedQuantity ?? 0;
    const unitPrice = item.unitPrice ?? 0;
    const lineTotal = accepted * unitPrice;
    return {
      itemId: item.id,
      ingredientId: item.ingredientId,
      ingredientName: item.ingredientName,
      receivedQuantity: accepted,
      rejectedQuantity: rejected,
      unitPrice,
      lineTotal,
      caDecision: item.caDecision,
      baDecision: item.baDecision,
      reason: item.reason,
    };
  });

  const totalAmount = lineItems.reduce((sum, li) => sum + li.lineTotal, 0);

  await tx.insert(scmProcurementInvoices).values({
    scmProcurementId: procurementId,
    generatedAt: new Date(),
    generatedById: actor.id,
    totalAmount,
    lineItems,
  });
}

// -----------------------------------------------------------------------------
// mark-paid
// -----------------------------------------------------------------------------

/**
 * Set the invoice snapshot's paidAt and paidBy. Also set the procurement's
 * paidAt in the main transition.
 */
export async function markInvoicePaid(
  procurementId: string,
  _payload: FsmPayload,
  actor: FsmActor,
  tx: FsmTx,
): Promise<void> {
  await tx
    .update(scmProcurementInvoices)
    .set({ paidAt: new Date(), paidById: actor.id })
    .where(eq(scmProcurementInvoices.scmProcurementId, procurementId));
}

// -----------------------------------------------------------------------------
// cancel reversals
// -----------------------------------------------------------------------------

/**
 * Cancel before any stock has been written (Draft, Pending, UnderReview).
 * No-op for stock; only the status change matters.
 */
export async function noopOnCancel(
  _procurementId: string,
  _payload: FsmPayload,
  _actor: FsmActor,
  _tx: FsmTx,
): Promise<void> {
  void _procurementId;
  void _payload;
  void _actor;
  void _tx;
}

/**
 * Cancel from InTransit: delete the in_transit_inventory rows and restore
 * Central's inventory. Writes IN ledger entries.
 */
export async function reverseInTransitOnCancel(
  procurementId: string,
  _payload: FsmPayload,
  actor: FsmActor,
  tx: FsmTx,
): Promise<void> {
  const [central] = await tx
    .select()
    .from(branches)
    .where(eq(branches.type, "Central"))
    .limit(1);
  if (!central) return;

  const rows = await tx
    .select()
    .from(inTransitInventory)
    .where(eq(inTransitInventory.scmProcurementId, procurementId));

  for (const row of rows) {
    const [inv] = await tx
      .select()
      .from(inventory)
      .where(
        and(eq(inventory.branchId, central.id), eq(inventory.ingredientId, row.ingredientId)),
      )
      .limit(1);

    if (inv) {
      const newQty = inv.quantity + row.quantity;
      await tx
        .update(inventory)
        .set({ quantity: newQty, lastUpdated: new Date() })
        .where(eq(inventory.id, inv.id));
      await tx.insert(stockLedger).values({
        branchId: central.id,
        ingredientId: row.ingredientId,
        type: "IN",
        quantity: row.quantity,
        balance: newQty,
        reference: procurementId,
        notes: `Pengadaan dibatalkan saat in-transit`,
      });
    } else {
      await tx.insert(inventory).values({
        branchId: central.id,
        ingredientId: row.ingredientId,
        quantity: row.quantity,
      });
    }

    await tx.delete(inTransitInventory).where(eq(inTransitInventory.id, row.id));
  }

  void actor;
}

/**
 * Cancel from Delivered, ReviewingSJ, or WaitingForPayment: pending_review
 * stock goes back to Central. If the procurement is past finish-receive,
 * branch inventory was already incremented — we'd also need to decrement it.
 * For Phase 2 we only handle the pending_review reversal; the branch
 * inventory reversal is a TODO for when we need cancel-after-receive.
 */
export async function reversePendingReviewOnCancel(
  procurementId: string,
  _payload: FsmPayload,
  actor: FsmActor,
  tx: FsmTx,
): Promise<void> {
  const [central] = await tx
    .select()
    .from(branches)
    .where(eq(branches.type, "Central"))
    .limit(1);
  if (!central) return;

  const rows = await tx
    .select()
    .from(pendingReviewInventory)
    .where(eq(pendingReviewInventory.scmProcurementId, procurementId));

  for (const row of rows) {
    const [inv] = await tx
      .select()
      .from(inventory)
      .where(
        and(eq(inventory.branchId, central.id), eq(inventory.ingredientId, row.ingredientId)),
      )
      .limit(1);

    if (inv) {
      const newQty = inv.quantity + row.quantity;
      await tx
        .update(inventory)
        .set({ quantity: newQty, lastUpdated: new Date() })
        .where(eq(inventory.id, inv.id));
      await tx.insert(stockLedger).values({
        branchId: central.id,
        ingredientId: row.ingredientId,
        type: "IN",
        quantity: row.quantity,
        balance: newQty,
        reference: procurementId,
        notes: `Pengadaan dibatalkan saat pending review`,
      });
    } else {
      await tx.insert(inventory).values({
        branchId: central.id,
        ingredientId: row.ingredientId,
        quantity: row.quantity,
      });
    }

    await tx
      .update(pendingReviewInventory)
      .set({ clearedAt: new Date() })
      .where(eq(pendingReviewInventory.id, row.id));
  }

  void actor;
}

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

/**
 * Lookup the total pending review qty for a (branch, ingredient) pair.
 * Useful for the branch's "stock pending review" dashboard tile.
 */
export async function getPendingReviewTotal(
  branchId: string,
  ingredientId: string,
  tx: FsmTx,
): Promise<number> {
  const [result] = await tx
    .select({ total: sum(pendingReviewInventory.quantity) })
    .from(pendingReviewInventory)
    .where(
      and(
        eq(pendingReviewInventory.branchId, branchId),
        eq(pendingReviewInventory.ingredientId, ingredientId),
      ),
    );
  return Number(result?.total ?? 0);
}
