import { and, eq, isNull, sum } from "drizzle-orm";
import { getCentralWarehouse } from "./central-warehouse";
import { z } from "zod";
import type { db as DbType } from "./db";
import {
  inTransitInventory,
  inventory,
  ingredients,
  pendingReviewInventory,
  scmProcurementItems,
  scmProcurementInvoices,
  scmProcurements,
  scmReturns,
  stockLedger,
  wasteEntries,
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

/**
 * Float32 (real column) round-off tolerance. `inventory.quantity` is a
 * `real` (float32) column while item quantities are integers, so POS / BOM /
 * yield deductions leave fractional residue (e.g. 49.999999 instead of 50).
 * An exact `available < requested` comparison then rejects a shipment the UI
 * shows as fully stocked. Treat anything within 0.5 of the requested amount
 * as sufficient (client report: "Surat jalan tidak bisa dibuat — insufficient
 * ingredient, tapi stok pusat ada").
 */
export const STOCK_CHECK_EPSILON = 0.5;

/**
 * Thrown by `writeInTransitInventory` (the `accept-and-ship` effect) when
 * Central's current inventory for an ingredient is below the item's
 * `pickedQuantity` (beyond float32 round-off tolerance). Mirrors Mutasi's
 * `InsufficientStockError` (ADR 0006): the system tracks Central's stock as a
 * concrete quantity, so shipping more than Central has would fabricate stock
 * and desync the ledger — the transition is refused instead. The caller (server
 * fn) maps this to a user-facing error.
 */
export class ProcurementInsufficientStockError extends Error {
  constructor(
    public readonly ingredientId: string,
    public readonly ingredientName: string,
    public readonly requested: number,
    public readonly available: number,
  ) {
    super(
      `Stok tidak cukup di Central Warehouse untuk bahan "${ingredientName}": dibutuhkan ${requested}, tersedia ${available}`,
    );
    this.name = "ProcurementInsufficientStockError";
  }
}

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
    /**
     * Receiving BA's disposition for the rejected stock (issue #93 follow-up).
     * Default (undefined / "Return to Source"): the quantity is credited back
     * to the source branch's inventory by the reject effects. "Scrap": the
     * stock is written off — only the waste entry records it. "Quarantine":
     * stock is tracked like Return to Source (no quarantine location exists
     * yet) but the choice is recorded on the item and invoice.
     */
    rejectionDisposition?: "Return to Source" | "Scrap" | "Quarantine";
  }>;
  caDecisions?: Array<{
    id: string;
    caDecision: "approved" | "rejected";
    readyQuantity?: number;
    rejectionNote?: string;
  }>;
}

export const FsmPayloadSchema = z.object({
  reason: z.string().optional(),
  notes: z.string().optional(),
  invoiceCode: z.string().optional(),
  // Quantities are real (fractional allowed) — guarded to finite non-negatives
  // so a NaN/Infinity/negative from the client can never reach the stock math.
  // A blank reason on a rejected line is rejected by validateReceivePayload
  // (semantic check, not shape).
  items: z
    .array(
      z.object({
        id: z.string(),
        receivedQuantity: z.number().finite().min(0).optional(),
        rejectedQuantity: z.number().finite().min(0).optional(),
        reason: z.string().optional(),
        rejectionDisposition: z.enum(["Return to Source", "Scrap", "Quarantine"]).optional(),
      }),
    )
    .optional(),
  caDecisions: z
    .array(
      z.object({
        id: z.string(),
        caDecision: z.enum(["approved", "rejected"]),
        readyQuantity: z.number().finite().min(0).optional(),
        rejectionNote: z.string().optional(),
      }),
    )
    .optional(),
});

/**
 * Thrown by `validateReceivePayload` when a finish-receive payload would
 * reject stock without stating why. Surfaced as a domain failure ({ success:
 * false }) by both FSMs so the UI shows a clean toast (Jambangan incident,
 * 2026-09-30: a BA cleared the Diterima inputs on every row — clearing a
 * numeric input yields Number("") === 0 — and submitted a 100% rejection
 * with no reason on two procurements).
 */
export class ReceiveValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReceiveValidationError";
  }
}

/**
 * Guard for finish-receive payloads (both Pengadaan and Mutasi):
 *
 *  1. Every item id in the payload must exist on the document.
 *  2. received + rejected must not exceed the shipped/ordered quantity.
 *  3. A line with rejectedQuantity > 0 MUST carry a non-blank reason —
 *     silent full rejections are the failure mode we are guarding against.
 *
 * Runs inside the transition transaction (before any effects) so an invalid
 * payload aborts with zero side effects.
 *
 * @param docItems the document's persisted items (scm_procurement_items or
 *                 scm_transfer_items rows).
 * @param shippedOf the per-item shipped quantity (pickedQuantity for
 *                  Pengadaan, quantity for Mutasi).
 */
export function validateReceivePayload<T extends { id: string; ingredientId: string }>(
  payload: FsmPayload,
  docItems: T[],
  shippedOf: (item: T) => number,
): void {
  if (!payload.items) return;
  const byId = new Map(docItems.map((i) => [i.id, i]));
  for (const patch of payload.items) {
    const item = byId.get(patch.id);
    if (!item) {
      throw new ReceiveValidationError(
        `Item ${patch.id} tidak ada pada dokumen ini — muat ulang halaman lalu coba lagi.`,
      );
    }
    const received = patch.receivedQuantity ?? 0;
    const rejected = patch.rejectedQuantity ?? 0;
    const shipped = shippedOf(item);
    if (received + rejected > shipped + STOCK_CHECK_EPSILON) {
      throw new ReceiveValidationError(
        `Diterima (${received}) + Ditolak (${rejected}) tidak boleh melebihi jumlah dikirim (${shipped}).`,
      );
    }
    if (rejected > 0 && !(patch.reason ?? "").trim()) {
      throw new ReceiveValidationError("Alasan penolakan wajib diisi untuk barang yang ditolak.");
    }
  }
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
    const picked = item.caDecision === "approved" ? (item.readyQuantity ?? item.quantity) : 0;
    await tx
      .update(scmProcurementItems)
      .set({ pickedQuantity: picked })
      .where(eq(scmProcurementItems.id, item.id));
  }
}

/**
 * For each approved item, decrement Central's inventory, write OUT ledger,
 * and insert an in_transit_inventory row pointing at this procurement.
 * Central = the Central-type branch that owns inventory (`getCentralWarehouse`),
 * stable even when several branches have type 'Central' (ADR 0002 §consequences).
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

  // Multi-Central safe: ships from the Central that owns inventory.
  const central = await getCentralWarehouse(tx);
  if (!central) throw new Error("No Central branch configured");

  const items = await tx
    .select()
    .from(scmProcurementItems)
    .where(eq(scmProcurementItems.scmProcurementId, procurementId));

  for (const item of items) {
    if (item.caDecision !== "approved" || !item.pickedQuantity || item.pickedQuantity <= 0) {
      continue;
    }

    // Strict stock check (mirrors Mutasi's ship-time guard, ADR 0006):
    // the system tracks Central's inventory as a concrete quantity, so
    // shipping more than Central has would fabricate stock. The old
    // Math.max clamp wrote an OUT ledger larger than the balance delta
    // and put phantom stock in transit. Refuse the transition instead.
    const [inv] = await tx
      .select({ id: inventory.id, quantity: inventory.quantity, name: ingredients.name })
      .from(inventory)
      .innerJoin(ingredients, eq(ingredients.id, inventory.ingredientId))
      .where(and(eq(inventory.branchId, central.id), eq(inventory.ingredientId, item.ingredientId)))
      .limit(1);

    const currentQty = inv?.quantity ?? 0;
    // Tolerate float32 round-off residue so a displayed "50" is not rejected
    // because the stored value is 49.999999 (see STOCK_CHECK_EPSILON above).
    if (currentQty < item.pickedQuantity - STOCK_CHECK_EPSILON) {
      throw new ProcurementInsufficientStockError(
        item.ingredientId,
        inv?.name ?? item.ingredientId,
        item.pickedQuantity,
        currentQty,
      );
    }

    // Decrement Central's inventory (inv is guaranteed non-null here — the
    // check above throws when no inventory row exists)
    const newQty = inv!.quantity - item.pickedQuantity;
    await tx
      .update(inventory)
      .set({ quantity: newQty, lastUpdated: new Date() })
      .where(eq(inventory.id, inv!.id));

    await tx.insert(stockLedger).values({
      branchId: central.id,
      ingredientId: item.ingredientId,
      type: "OUT",
      quantity: item.pickedQuantity,
      balance: newQty,
      reference: procurementId,
      notes: `Pengadaan ${proc.code} dikirim`,
    });

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
        // Persist the BA's disposition so the invoice and audit trail record
        // what was decided (undefined → NULL → reported as Return to Source).
        rejectionDisposition:
          rejected > 0 ? (itemPatch.rejectionDisposition ?? "Return to Source") : null,
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
 *
 * Rejected stock disposition: lines with `rejectedQuantity > 0` are NOT
 * received — their `pending_review_inventory` row is cleared here and the
 * rejected quantity is returned to Central's main inventory by
 * `writeRejectedWaste` (issue #93: the branch never owned the stock; Central
 * still does).
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

  // Rejected lines received 0 and are skipped above, which leaves their
  // pending_review_inventory rows uncleared. Clear them here (never in a
  // loop keyed on received > 0) so a fully-rejected procurement doesn't
  // strand stock in "pending review" forever (issue #93).
  await tx
    .update(pendingReviewInventory)
    .set({ clearedAt: new Date() })
    .where(
      and(
        eq(pendingReviewInventory.scmProcurementId, procurementId),
        isNull(pendingReviewInventory.clearedAt),
      ),
    );
}

/**
 * Disposition for rejected stock, by the receiver's choice (ADR 0018).
 *
 * Three outcomes, and the record each one leaves:
 *
 *  - **Scrap** — the goods are destroyed. A `waste_entries` row at the
 *    receiver, valued at `rejected × ingredient.averageCost` so it reaches
 *    Total Kerugian as a real loss. No stock credit: the goods are gone.
 *  - **Return to Source** (default) / **Quarantine** — the goods go home. The
 *    quantity is credited straight back to Central's `inventory` (IN ledger
 *    `Pengadaan Reject …`) because the branch never owned it, AND a
 *    `scm_returns` row is opened at `Pending` — the branch physically still
 *    has the box, and that pickup is a liability someone has to close.
 *
 * Why not a waste row for a return (ADR 0006's original call, reverted here):
 * the old effect wrote `category: 'Spoiled'` at the receiver unconditionally,
 * before the disposition check, while *also* crediting Central. The same units
 * were then counted in Central's stock and reported as a Spoiled loss at the
 * branch — at Rp0, because this effect never set `valuation`. Waste is a loss
 * report; a return is a transfer in progress, and conflating them made the
 * Waste page useless for both.
 *
 * `Quarantine` is tracked as a return until a quarantine location exists.
 */
export async function writeRejectedDisposition(
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

    const disposition = itemPatch.rejectionDisposition ?? "Return to Source";
    const reason = itemPatch.reason ?? `procurement rejected at receiving ${proc.code}`;

    // Valued from the ingredient's global average cost — the same basis the
    // transfer effect and the Waste form use, so a scrap line and a manual
    // spoilage entry are comparable.
    const [ing] = await tx
      .select({ averageCost: ingredients.averageCost })
      .from(ingredients)
      .where(eq(ingredients.id, item.ingredientId))
      .limit(1);
    const valuation = Math.round(rejected * (ing?.averageCost ?? 0));

    if (disposition === "Scrap") {
      // Genuinely destroyed: this is the only branch that produces a loss record.
      await tx.insert(wasteEntries).values({
        branchId: proc.branchId,
        ingredientId: item.ingredientId,
        quantity: rejected,
        category: "Spoiled",
        valuation,
        notes: `Discard (Scrap) — rejected at receiving: ${itemPatch.reason ?? "no reason given"}`,
        submittedBy: actor.id,
      });
      continue;
    }

    // Returned, not destroyed: open the return BEFORE crediting Central, so a
    // failure anywhere below leaves the transaction aborted (the FSM runs every
    // effect in one transaction) rather than stock with no liability record.
    await tx.insert(scmReturns).values({
      branchId: proc.branchId,
      scmProcurementId: procurementId,
      ingredientId: item.ingredientId,
      quantity: rejected,
      valuation,
      disposition,
      reason,
      status: "Pending",
      createdById: actor.id,
    });

    const central = await getCentralWarehouse(tx);
    if (central) {
      const [centralInv] = await tx
        .select()
        .from(inventory)
        .where(
          and(eq(inventory.branchId, central.id), eq(inventory.ingredientId, item.ingredientId)),
        )
        .limit(1);

      if (centralInv) {
        const newQty = centralInv.quantity + rejected;
        await tx
          .update(inventory)
          .set({ quantity: newQty, lastUpdated: new Date() })
          .where(eq(inventory.id, centralInv.id));
        await tx.insert(stockLedger).values({
          branchId: central.id,
          ingredientId: item.ingredientId,
          type: "IN",
          quantity: rejected,
          balance: newQty,
          reference: procurementId,
          notes: `Pengadaan Reject ${proc.code}`,
        });
      } else {
        await tx.insert(inventory).values({
          branchId: central.id,
          ingredientId: item.ingredientId,
          quantity: rejected,
        });
        await tx.insert(stockLedger).values({
          branchId: central.id,
          ingredientId: item.ingredientId,
          type: "IN",
          quantity: rejected,
          balance: rejected,
          reference: procurementId,
          notes: `Pengadaan Reject ${proc.code}`,
        });
      }
    }
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
      rejectionDisposition: scmProcurementItems.rejectionDisposition,
      baDecision: scmProcurementItems.baDecision,
      caDecision: scmProcurementItems.caDecision,
      ingredientName: ingredients.name,
      stockUnit: ingredients.stockUnit,
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
      stockUnit: item.stockUnit,
      receivedQuantity: accepted,
      rejectedQuantity: rejected,
      unitPrice,
      lineTotal,
      caDecision: item.caDecision,
      baDecision: item.baDecision,
      reason: item.reason,
      rejectionDisposition: item.rejectionDisposition ?? "Return to Source",
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
  // Multi-Central safe: restores to the Central the shipment left from.
  const central = await getCentralWarehouse(tx);
  if (!central) return;

  const rows = await tx
    .select()
    .from(inTransitInventory)
    .where(eq(inTransitInventory.scmProcurementId, procurementId));

  for (const row of rows) {
    const [inv] = await tx
      .select()
      .from(inventory)
      .where(and(eq(inventory.branchId, central.id), eq(inventory.ingredientId, row.ingredientId)))
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
 * Cancel from Delivered / ReviewingSJ: the stock sits in
 * `pending_review_inventory` (delivered but not yet received) — it goes back
 * to Central. Cancel from WaitingForPayment (past `finish-receive`): the
 * received qty has already moved into the branch's main inventory, so debit
 * the branch, credit Central, and void the frozen invoice snapshot.
 *
 * Mirrors Mutasi's `reverseTransferPendingReviewOnCancel` (ADR 0006 Phase 2).
 * Phase 1 only touches *uncleared* pending rows — rows cleared at
 * `finish-receive` are accounted for in Phase 2, so they must not be credited
 * twice (see issue #93).
 */
export async function reversePendingReviewOnCancel(
  procurementId: string,
  _payload: FsmPayload,
  actor: FsmActor,
  tx: FsmTx,
): Promise<void> {
  const central = await getCentralWarehouse(tx);
  if (!central) return;

  const [proc] = await tx
    .select()
    .from(scmProcurements)
    .where(eq(scmProcurements.id, procurementId));
  if (!proc) return;

  // Phase 1: uncleared pending-review rows (stock at the branch but not yet
  // received, e.g. fully-rejected lines) go back to Central.
  const rows = await tx
    .select()
    .from(pendingReviewInventory)
    .where(
      and(
        eq(pendingReviewInventory.scmProcurementId, procurementId),
        isNull(pendingReviewInventory.clearedAt),
      ),
    );

  for (const row of rows) {
    const [inv] = await tx
      .select()
      .from(inventory)
      .where(and(eq(inventory.branchId, central.id), eq(inventory.ingredientId, row.ingredientId)))
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

  // Phase 2: cancel from WaitingForPayment — `finish-receive` already moved
  // the received qty into the branch's main inventory and cleared the
  // pending rows. Debit the branch, credit Central, void the invoice.
  if (proc.status === "WaitingForPayment") {
    const items = await tx
      .select()
      .from(scmProcurementItems)
      .where(eq(scmProcurementItems.scmProcurementId, procurementId));

    for (const item of items) {
      const received = item.receivedQuantity ?? 0;
      if (received <= 0) continue;

      // Debit the branch's main inventory
      const [inv] = await tx
        .select()
        .from(inventory)
        .where(
          and(eq(inventory.branchId, proc.branchId), eq(inventory.ingredientId, item.ingredientId)),
        )
        .limit(1);

      if (inv) {
        const newQty = Math.max(0, inv.quantity - received);
        await tx
          .update(inventory)
          .set({ quantity: newQty, lastUpdated: new Date() })
          .where(eq(inventory.id, inv.id));
        await tx.insert(stockLedger).values({
          branchId: proc.branchId,
          ingredientId: item.ingredientId,
          type: "OUT",
          quantity: received,
          balance: newQty,
          reference: procurementId,
          notes: `Pengadaan dibatalkan saat menunggu pembayaran`,
        });
      }

      // Credit Central
      const [centralInv] = await tx
        .select()
        .from(inventory)
        .where(
          and(eq(inventory.branchId, central.id), eq(inventory.ingredientId, item.ingredientId)),
        )
        .limit(1);

      if (centralInv) {
        const newQty = centralInv.quantity + received;
        await tx
          .update(inventory)
          .set({ quantity: newQty, lastUpdated: new Date() })
          .where(eq(inventory.id, centralInv.id));
        await tx.insert(stockLedger).values({
          branchId: central.id,
          ingredientId: item.ingredientId,
          type: "IN",
          quantity: received,
          balance: newQty,
          reference: procurementId,
          notes: `Pengadaan dibatalkan saat menunggu pembayaran`,
        });
      } else {
        await tx.insert(inventory).values({
          branchId: central.id,
          ingredientId: item.ingredientId,
          quantity: received,
        });
      }
    }

    // Void the frozen invoice snapshot
    await tx
      .update(scmProcurementInvoices)
      .set({ cancelledAt: new Date() })
      .where(eq(scmProcurementInvoices.scmProcurementId, procurementId));
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
