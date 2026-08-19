import { and, eq } from "drizzle-orm";
import { scmTransferAuditLog, scmTransferItems, scmTransfers } from "#/db/schema";
import type { FsmActor, FsmPayload, FsmTx } from "./scm-effects";
import {
  markTransferInvoicePaid,
  moveTransferToPendingReview,
  noopOnCancel,
  reverseTransferInTransitOnCancel,
  reverseTransferPendingReviewOnCancel,
  setTransferReceivedQuantities,
  writeTransferInTransitInventory,
  writeTransferReceivedStock,
  writeTransferRejectedWaste,
  generateTransferInvoiceSnapshot,
} from "./scm-transfer-effects";
import {
  InvalidTransferStateForEditError,
  InvalidTransferTransitionError,
  TransferEffectFailedError,
  TransferNotFoundError,
  TransferUnauthorizedError,
} from "./scm-transfer-errors";

/**
 * Lazy import of the DB connection. The DB module uses Vite's
 * `import.meta.env.SSR`, which is undefined in pure-node contexts (e.g.
 * `npx tsx` self-checks). Deferring the import to the function body means
 * the FSM *table* is importable without touching the DB.
 */
async function getDb() {
  const mod = await import("./db");
  return mod.db;
}

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type ScmTransferStatus =
  | "SuratJalanDraft"
  | "PendingAMReview"
  | "Approved"
  | "InTransit"
  | "Delivered"
  | "ReviewingSJ"
  | "WaitingForPayment"
  | "Finished"
  | "Rejected"
  | "Cancelled";

export type ScmTransferEvent =
  | "submit"
  | "approve"
  | "reject"
  | "withdraw"
  | "ship"
  | "mark-delivered"
  | "open-receive"
  | "finish-receive"
  | "mark-paid"
  | "cancel";

export type TransferActorRole = "branch_admin" | "area_manager" | "super_admin" | "admin_pusat";

export type TransferEffect = (
  transferId: string,
  payload: FsmPayload,
  actor: FsmActor,
  tx: FsmTx,
) => Promise<void>;

export interface TransferRule {
  to: ScmTransferStatus;
  actors: TransferActorRole[];
  effects: TransferEffect[];
  /**
   * Per-event metadata written to the transfer row on success. Used for
   * lifecycle timestamps and FK columns (reviewingById, etc.) without
   * polluting the effect list.
   */
  setTransfer?: Partial<{
    reviewingById: string;
    receivingById: string;
    paidById: string;
    cancelledById: string;
    submittedAt: Date;
    approvedAt: Date;
    shippedAt: Date;
    deliveredAt: Date;
    receivedAt: Date;
    paidAt: Date;
    rejectedAt: Date;
    rejectionReason: string;
    cancelledAt: Date;
    cancellationReason: string;
  }>;
}

export type TransferTransitionTable = {
  [state in ScmTransferStatus]?: {
    [event in ScmTransferEvent]?: TransferRule;
  };
};

// -----------------------------------------------------------------------------
// Transition table (the "spec" of the Mutasi FSM, per ADR 0006)
// -----------------------------------------------------------------------------

/**
 * 18 transitions across 10 states. `super_admin` is allowed on every transition
 * (emergency override) — but it is NOT a separate row in the table; instead, the
 * `transition()` function adds `super_admin` to the allowed-actors list at
 * dispatch time. `admin_pusat` is never an actor on Mutasi (Q4, Q8).
 */
export const transferTransitions: TransferTransitionTable = {
  SuratJalanDraft: {
    submit: { to: "PendingAMReview", actors: ["branch_admin"], effects: [] },
    cancel: { to: "Cancelled", actors: ["branch_admin"], effects: [noopOnCancel] },
  },
  PendingAMReview: {
    approve: { to: "Approved", actors: ["area_manager"], effects: [] },
    reject: { to: "Rejected", actors: ["area_manager"], effects: [] },
    withdraw: { to: "SuratJalanDraft", actors: ["branch_admin"], effects: [] },
    cancel: {
      to: "Cancelled",
      actors: ["branch_admin", "area_manager"],
      effects: [noopOnCancel],
    },
  },
  Approved: {
    ship: {
      to: "InTransit",
      actors: ["branch_admin"],
      effects: [writeTransferInTransitInventory],
    },
    withdraw: { to: "SuratJalanDraft", actors: ["branch_admin"], effects: [] },
    cancel: {
      to: "Cancelled",
      actors: ["branch_admin", "area_manager"],
      effects: [noopOnCancel],
    },
  },
  InTransit: {
    "mark-delivered": {
      to: "Delivered",
      actors: ["branch_admin"],
      effects: [moveTransferToPendingReview],
    },
    cancel: {
      to: "Cancelled",
      actors: ["area_manager"],
      effects: [reverseTransferInTransitOnCancel],
    },
  },
  Delivered: {
    "open-receive": { to: "ReviewingSJ", actors: ["branch_admin"], effects: [] },
    cancel: {
      to: "Cancelled",
      actors: ["area_manager"],
      effects: [reverseTransferPendingReviewOnCancel],
    },
  },
  ReviewingSJ: {
    "finish-receive": {
      to: "WaitingForPayment",
      actors: ["branch_admin"],
      effects: [
        setTransferReceivedQuantities,
        writeTransferReceivedStock,
        writeTransferRejectedWaste,
        generateTransferInvoiceSnapshot,
      ],
    },
    cancel: {
      to: "Cancelled",
      actors: ["area_manager"],
      effects: [reverseTransferPendingReviewOnCancel],
    },
  },
  WaitingForPayment: {
    "mark-paid": {
      to: "Finished",
      actors: ["branch_admin"],
      effects: [markTransferInvoicePaid],
    },
    cancel: {
      to: "Cancelled",
      actors: ["area_manager"],
      effects: [reverseTransferPendingReviewOnCancel],
    },
  },
  // Terminal states: no outgoing transitions.
  Rejected: {},
  Finished: {},
  Cancelled: {},
};

// -----------------------------------------------------------------------------
// transition() — state changes for Mutasi transfers
// -----------------------------------------------------------------------------

export type TransferTransitionResult =
  | { success: true; status: ScmTransferStatus }
  | { success: false; error: { name: string; message: string } };

/**
 * Move a Mutasi transfer from its current state to the next state by event.
 *
 * Mirrors `scm-fsm.ts`'s `transition()` signature, but operates on
 * `scm_transfers` and uses the `transferTransitions` table. The atomic
 * transaction guarantees: state update + all effects + audit log row commit
 * together, or none of them do.
 *
 * Authorization: in addition to the rule's `actors` list, `super_admin` is
 * always permitted (emergency override). `admin_pusat` is never permitted on
 * Mutasi (they have no business relationship with branch-to-branch transfers,
 * per Q4 and Q8).
 *
 * Note: branch-level authorization (the *specific* `branch_admin` user must
 * be from the Sender or Receiver branch as appropriate) is enforced *upstream*
 * by the server function via `assertTransferAccess`, not here. The FSM is the
 * security boundary for *role*; the server function is the security boundary
 * for *branch*.
 *
 * @throws on programmer errors (DB unavailable, etc.) — not caught.
 * @returns `TransferTransitionResult` for predictable domain failures.
 */
export async function transitionTransfer(
  transferId: string,
  event: ScmTransferEvent,
  payload: FsmPayload,
  actor: FsmActor,
): Promise<TransferTransitionResult> {
  try {
    const db = await getDb();
    const finalStatus = await db.transaction(async (tx) => {
      const [tr] = await tx
        .select()
        .from(scmTransfers)
        .where(eq(scmTransfers.id, transferId))
        .for("update");

      if (!tr) throw new TransferNotFoundError(transferId);

      const rule = transferTransitions[tr.status]?.[event];
      if (!rule) throw new InvalidTransferTransitionError(tr.status, event);

      // Actor authorization: rule's actors OR super_admin
      const isAllowed =
        rule.actors.includes(actor.role as TransferActorRole) || actor.role === "super_admin";
      if (!isAllowed) {
        throw new TransferUnauthorizedError(actor.role, event);
      }

      // Per-event metadata
      const now = new Date();
      const eventMeta: Record<string, unknown> = {};
      switch (event) {
        case "submit":
          eventMeta.submittedAt = now;
          break;
        case "approve":
          eventMeta.approvedAt = now;
          eventMeta.reviewingById = actor.id;
          break;
        case "reject":
          eventMeta.rejectedAt = now;
          eventMeta.rejectionReason = payload.reason;
          break;
        case "ship":
          eventMeta.shippedAt = now;
          break;
        case "mark-delivered":
          eventMeta.deliveredAt = now;
          break;
        case "open-receive":
          eventMeta.receivingById = actor.id;
          break;
        case "finish-receive":
          eventMeta.receivedAt = now;
          break;
        case "mark-paid":
          eventMeta.paidAt = now;
          eventMeta.paidById = actor.id;
          break;
        case "cancel":
          eventMeta.cancelledAt = now;
          eventMeta.cancelledById = actor.id;
          eventMeta.cancellationReason = payload.reason;
          break;
      }

      // Run effect handlers. A failing effect rolls back the transaction
      // (thrown out of the callback) and surfaces as a domain failure
      // ({ success: false }) rather than a raw 500 (issue #90).
      try {
        for (const effect of rule.effects) {
          await effect(transferId, payload, actor, tx);
        }
      } catch (err) {
        if (err instanceof Error) throw new TransferEffectFailedError(err);
        throw err;
      }

      // Update the transfer
      await tx
        .update(scmTransfers)
        .set({
          status: rule.to,
          lastEvent: event,
          lastEventAt: now,
          updatedAt: now,
          ...eventMeta,
        })
        .where(eq(scmTransfers.id, transferId));

      // Write audit log
      await tx.insert(scmTransferAuditLog).values({
        scmTransferId: transferId,
        event,
        fromState: tr.status,
        toState: rule.to,
        actorId: actor.id,
        actorRole: actor.role,
        note: payload.reason ?? payload.notes,
      });

      return rule.to;
    });

    return { success: true, status: finalStatus };
  } catch (err) {
    if (
      err instanceof InvalidTransferTransitionError ||
      err instanceof TransferUnauthorizedError ||
      err instanceof TransferNotFoundError ||
      err instanceof TransferEffectFailedError
    ) {
      return { success: false, error: { name: err.name, message: err.message } };
    }
    throw err;
  }
}

// -----------------------------------------------------------------------------
// updateItem() — in-state item edits for Mutasi transfers (NOT state transitions)
// -----------------------------------------------------------------------------

export type UpdateTransferItemPatch = {
  receivedQuantity?: number;
  rejectedQuantity?: number;
  reason?: string;
};

export type UpdateTransferItemResult =
  | { success: true }
  | { success: false; error: { name: string; message: string } };

/**
 * Per-item mutations within a state. Does NOT change the transfer's state.
 * Audit log records these as event='item-update' with fromState=toState.
 *
 * State guards (Q6, Q11): per-line receivedQuantity / rejectedQuantity /
 * reason are only editable in `Delivered` or `ReviewingSJ` by the Receiver BA.
 * (The Sender BA's `quantity` is editable only in `SuratJalanDraft` — that's
 * a separate `updateTransferDraftItems` server function, not a transition.)
 */
export async function updateTransferItem(
  transferId: string,
  itemId: string,
  patch: UpdateTransferItemPatch,
  actor: FsmActor,
): Promise<UpdateTransferItemResult> {
  try {
    const db = await getDb();
    await db.transaction(async (tx) => {
      const [tr] = await tx
        .select()
        .from(scmTransfers)
        .where(eq(scmTransfers.id, transferId))
        .for("update");

      if (!tr) throw new TransferNotFoundError(transferId);

      if (tr.status !== "Delivered" && tr.status !== "ReviewingSJ") {
        throw new InvalidTransferStateForEditError(tr.status, "edit received/rejected quantity");
      }

      const updateFields: Record<string, unknown> = {};
      if (patch.receivedQuantity !== undefined)
        updateFields.receivedQuantity = patch.receivedQuantity;
      if (patch.rejectedQuantity !== undefined)
        updateFields.rejectedQuantity = patch.rejectedQuantity;
      if (patch.reason !== undefined) updateFields.reason = patch.reason;

      const updated = await tx
        .update(scmTransferItems)
        .set(updateFields)
        .where(and(eq(scmTransferItems.id, itemId), eq(scmTransferItems.scmTransferId, transferId)))
        .returning({ id: scmTransferItems.id });

      if (updated.length === 0) {
        throw new Error(`Item ${itemId} not found in transfer ${transferId}`);
      }

      await tx.insert(scmTransferAuditLog).values({
        scmTransferId: transferId,
        event: "item-update",
        fromState: tr.status,
        toState: tr.status,
        itemId,
        actorId: actor.id,
        actorRole: actor.role,
        note: JSON.stringify(patch),
      });
    });

    return { success: true };
  } catch (err) {
    if (err instanceof InvalidTransferStateForEditError || err instanceof TransferNotFoundError) {
      return { success: false, error: { name: err.name, message: err.message } };
    }
    throw err;
  }
}

// -----------------------------------------------------------------------------
// Public helpers
// -----------------------------------------------------------------------------

/** Returns the next possible events for a given (state, role). */
export function availableTransferEvents(
  state: ScmTransferStatus,
  role: TransferActorRole,
): ScmTransferEvent[] {
  const stateRules = transferTransitions[state] ?? {};
  return Object.entries(stateRules)
    .filter(([, rule]) => rule.actors.includes(role) || role === "super_admin")
    .map(([event]) => event as ScmTransferEvent);
}
