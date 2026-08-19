import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { scmProcurementAuditLog, scmProcurementItems, scmProcurements } from "#/db/schema";
import type { UnknownRecord } from "#/lib/unknown-record";
import {
  copyReadyToPicked,
  generateInvoiceSnapshot,
  markInvoicePaid,
  moveStockToPendingReview,
  noopOnCancel,
  reverseInTransitOnCancel,
  reversePendingReviewOnCancel,
  setReceivedQuantities,
  writeInTransitInventory,
  writeReceivedStock,
  writeRejectedWaste,
  type FsmActor,
  type FsmPayload,
  type FsmTx,
} from "./scm-effects";
import { buildNotificationsForEvent, insertNotifications } from "./scm-procurement-notifications";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export const SCM_PROCUREMENT_STATUS_VALUES = [
  "Draft",
  "Pending",
  "UnderReview",
  "Rejected",
  "InTransit",
  "Delivered",
  "ReviewingSJ",
  "WaitingForPayment",
  "Finished",
  "Cancelled",
] as const;

export type ScmProcurementStatus = (typeof SCM_PROCUREMENT_STATUS_VALUES)[number];

export const SCM_PROCUREMENT_EVENT_VALUES = [
  "submit",
  "open-review",
  "withdraw",
  "reject",
  "accept-and-ship",
  "mark-delivered",
  "open-receive",
  "finish-receive",
  "mark-paid",
  "cancel",
] as const;

export type ScmProcurementEvent = (typeof SCM_PROCUREMENT_EVENT_VALUES)[number];

export type FsmActorRole = "branch_admin" | "admin_pusat" | "super_admin" | "area_manager";

export type FsmEffect = (
  procurementId: string,
  payload: FsmPayload,
  actor: FsmActor,
  tx: FsmTx,
) => Promise<void>;

export interface FsmRule {
  to: ScmProcurementStatus;
  actors: FsmActorRole[];
  effects: FsmEffect[];
  // Map from event name to additional procurement fields to update on success.
  // Used for simple timestamp / metadata writes (reviewingBy, shippedAt, etc.)
  // without polluting the effect list.
  setProcurement?: Partial<{
    reviewingById: string;
    receivingById: string;
    submittedAt: Date;
    shippedAt: Date;
    receivedAt: Date;
    paidAt: Date;
    rejectedAt: Date;
    rejectionReason: string;
    cancelledAt: Date;
    cancelledById: string;
    cancellationReason: string;
  }>;
}

export type FsmTransitionTable = {
  [state in ScmProcurementStatus]?: {
    [event in ScmProcurementEvent]?: FsmRule;
  };
};

// -----------------------------------------------------------------------------
// Transition table (the "spec" of the FSM)
// -----------------------------------------------------------------------------

export const transitions: FsmTransitionTable = {
  Draft: {
    submit: { to: "Pending", actors: ["branch_admin", "super_admin"], effects: [] },
    cancel: {
      to: "Cancelled",
      actors: ["branch_admin", "admin_pusat", "super_admin"],
      effects: [noopOnCancel],
    },
  },
  Pending: {
    "open-review": {
      to: "UnderReview",
      actors: ["admin_pusat", "super_admin"],
      effects: [],
    },
    withdraw: { to: "Draft", actors: ["branch_admin", "super_admin"], effects: [] },
    cancel: {
      to: "Cancelled",
      actors: ["branch_admin", "admin_pusat", "super_admin"],
      effects: [noopOnCancel],
    },
  },
  UnderReview: {
    reject: { to: "Rejected", actors: ["admin_pusat", "super_admin"], effects: [] },
    "accept-and-ship": {
      to: "InTransit",
      actors: ["admin_pusat", "super_admin"],
      effects: [copyReadyToPicked, writeInTransitInventory],
    },
    cancel: {
      to: "Cancelled",
      actors: ["branch_admin", "admin_pusat", "super_admin"],
      effects: [noopOnCancel],
    },
  },
  InTransit: {
    "mark-delivered": {
      to: "Delivered",
      actors: ["branch_admin", "super_admin"],
      effects: [moveStockToPendingReview],
    },
    cancel: {
      to: "Cancelled",
      actors: ["admin_pusat", "super_admin"],
      effects: [reverseInTransitOnCancel],
    },
  },
  Delivered: {
    "open-receive": { to: "ReviewingSJ", actors: ["branch_admin", "super_admin"], effects: [] },
    cancel: {
      to: "Cancelled",
      actors: ["admin_pusat", "super_admin"],
      effects: [reversePendingReviewOnCancel],
    },
  },
  ReviewingSJ: {
    "finish-receive": {
      to: "WaitingForPayment",
      actors: ["branch_admin", "super_admin"],
      effects: [
        setReceivedQuantities,
        writeReceivedStock,
        writeRejectedWaste,
        generateInvoiceSnapshot,
      ],
    },
    cancel: {
      to: "Cancelled",
      actors: ["admin_pusat", "super_admin"],
      effects: [reversePendingReviewOnCancel],
    },
  },
  WaitingForPayment: {
    "mark-paid": {
      to: "Finished",
      actors: ["admin_pusat", "super_admin"],
      effects: [markInvoicePaid],
    },
    cancel: {
      to: "Cancelled",
      actors: ["admin_pusat", "super_admin"],
      effects: [reversePendingReviewOnCancel],
    },
  },
  // Terminal states: no outgoing transitions.
  Rejected: {},
  Finished: {},
  Cancelled: {},
};

// -----------------------------------------------------------------------------
// Errors
// -----------------------------------------------------------------------------

export class ProcurementNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`Procurement ${id} not found`);
    this.name = "ProcurementNotFoundError";
  }
}

export class InvalidTransitionError extends Error {
  constructor(
    public readonly fromState: string,
    public readonly event: string,
  ) {
    super(`Cannot ${event} from ${fromState}`);
    this.name = "InvalidTransitionError";
  }
}

export class UnauthorizedError extends Error {
  constructor(
    public readonly actorRole: string,
    public readonly event: string,
  ) {
    super(`${actorRole} is not authorized to perform ${event}`);
    this.name = "UnauthorizedError";
  }
}

export class InvalidStateForEditError extends Error {
  constructor(
    public readonly state: string,
    public readonly editType: string,
  ) {
    super(`Cannot ${editType} in state ${state}`);
    this.name = "InvalidStateForEditError";
  }
}

// -----------------------------------------------------------------------------
// transition() — state changes
// -----------------------------------------------------------------------------

export type TransitionResult =
  | { success: true; status: ScmProcurementStatus }
  | { success: false; error: { name: string; message: string } };

/**
 * Move a procurement from its current state to the next state by event.
 *
 * - Reads the current state of the procurement (with row lock).
 * - Looks up the rule in the transition table.
 * - Validates the actor's role.
 * - Runs all effect handlers inside the same transaction.
 * - Updates the procurement's status, lastEvent, lastEventAt, and any
 *   event-specific timestamp/reason fields declared in the rule.
 * - Writes one audit log row recording fromState, toState, event, actor.
 *
 * Throws on programmer errors (DB unavailable, etc.). Returns a TransitionResult
 * for predictable domain failures so callers can map to UI messages.
 */
export async function transition(
  procurementId: string,
  event: ScmProcurementEvent,
  payload: FsmPayload,
  actor: FsmActor,
): Promise<TransitionResult> {
  try {
    const finalStatus = await db.transaction(async (tx) => {
      const [proc] = await tx
        .select()
        .from(scmProcurements)
        .where(eq(scmProcurements.id, procurementId))
        .for("update");

      if (!proc) throw new ProcurementNotFoundError(procurementId);

      const rule = transitions[proc.status]?.[event];
      if (!rule) throw new InvalidTransitionError(proc.status, event);

      // SAFETY: the actors list is FsmActorRole[]; widening it to a readonly
      // string[] only relaxes the read so the membership test can accept any
      // authenticated role string — the FSM treats unknown roles as denied.
      const isAllowed = (rule.actors as readonly string[]).includes(actor.role);
      if (!isAllowed) {
        throw new UnauthorizedError(actor.role, event);
      }

      // Build the per-event metadata patch
      const now = new Date();
      const eventMeta: UnknownRecord = {};
      switch (event) {
        case "submit":
          eventMeta.submittedAt = now;
          break;
        case "open-review":
          eventMeta.reviewingById = actor.id;
          break;
        case "reject":
          eventMeta.rejectedAt = now;
          eventMeta.rejectionReason = payload.reason;
          break;
        case "accept-and-ship":
          eventMeta.shippedAt = now;
          break;
        case "open-receive":
          eventMeta.receivingById = actor.id;
          break;
        case "finish-receive":
          eventMeta.receivedAt = now;
          break;
        case "mark-paid":
          eventMeta.paidAt = now;
          break;
        case "cancel":
          eventMeta.cancelledAt = now;
          eventMeta.cancelledById = actor.id;
          eventMeta.cancellationReason = payload.reason;
          break;
      }

      // Run effect handlers
      for (const effect of rule.effects) {
        await effect(procurementId, payload, actor, tx);
      }

      // Update the procurement
      await tx
        .update(scmProcurements)
        .set({
          status: rule.to,
          lastEvent: event,
          lastEventAt: now,
          updatedAt: now,
          ...eventMeta,
        })
        .where(eq(scmProcurements.id, procurementId));

      // Write audit log
      await tx.insert(scmProcurementAuditLog).values({
        scmProcurementId: procurementId,
        event,
        fromState: proc.status,
        toState: rule.to,
        actorId: actor.id,
        actorRole: actor.role,
        note: payload.reason ?? payload.notes,
      });

      // Notifications (same transaction — rolls back on failure)
      const notifTargets = await buildNotificationsForEvent({
        procurement: {
          id: procurementId,
          code: proc.code,
          branchId: proc.branchId,
          requestedById: proc.requestedById,
        },
        event,
        actorUserId: actor.id,
      });
      await insertNotifications(notifTargets, tx);

      return rule.to;
    });

    return { success: true, status: finalStatus };
  } catch (err) {
    if (
      err instanceof InvalidTransitionError ||
      err instanceof UnauthorizedError ||
      err instanceof ProcurementNotFoundError
    ) {
      return { success: false, error: { name: err.name, message: err.message } };
    }
    throw err;
  }
}

// -----------------------------------------------------------------------------
// updateItem() — in-state item edits (NOT state transitions)
// -----------------------------------------------------------------------------

export type UpdateItemPatch = {
  caDecision?: "approved" | "rejected";
  readyQuantity?: number;
  receivedQuantity?: number;
  rejectedQuantity?: number;
  reason?: string;
  rejectionNote?: string;
  // Draft-only: BA can edit the requested quantity before submit.
  // (ADR 0004 §3)
  quantity?: number;
};

export const UpdateItemPatchSchema = z.object({
  caDecision: z.enum(["approved", "rejected"]).optional(),
  readyQuantity: z.number().optional(),
  receivedQuantity: z.number().optional(),
  rejectedQuantity: z.number().optional(),
  reason: z.string().optional(),
  rejectionNote: z.string().optional(),
  quantity: z.number().optional(),
});

export type UpdateItemResult =
  | { success: true }
  | { success: false; error: { name: string; message: string } };

/**
 * Per-item mutations within a state. Does NOT change the procurement's state.
 * Audit log records these as event='item-update' with fromState=toState.
 *
 * State guards:
 *   - caDecision / readyQuantity: only in UnderReview
 *   - receivedQuantity / rejectedQuantity / reason: only in Delivered or ReviewingSJ
 */
export async function updateItem(
  procurementId: string,
  itemId: string,
  patch: UpdateItemPatch,
  actor: FsmActor,
): Promise<UpdateItemResult> {
  try {
    await db.transaction(async (tx) => {
      const [proc] = await tx
        .select()
        .from(scmProcurements)
        .where(eq(scmProcurements.id, procurementId))
        .for("update");

      if (!proc) throw new ProcurementNotFoundError(procurementId);

      const isCAEdit = patch.caDecision !== undefined || patch.readyQuantity !== undefined;
      const isBAEdit =
        patch.receivedQuantity !== undefined ||
        patch.rejectedQuantity !== undefined ||
        patch.reason !== undefined;
      const isDraftEdit = patch.quantity !== undefined;

      if (isCAEdit && proc.status !== "UnderReview") {
        throw new InvalidStateForEditError(proc.status, "edit CA fields");
      }
      if (isBAEdit && proc.status !== "Delivered" && proc.status !== "ReviewingSJ") {
        throw new InvalidStateForEditError(proc.status, "edit BA fields");
      }
      if (isDraftEdit && proc.status !== "Draft") {
        throw new InvalidStateForEditError(proc.status, "edit quantity in Draft");
      }

      // Apply the patch
      const updateFields: UnknownRecord = {};
      if (patch.caDecision !== undefined) updateFields.caDecision = patch.caDecision;
      if (patch.readyQuantity !== undefined) updateFields.readyQuantity = patch.readyQuantity;
      if (patch.receivedQuantity !== undefined)
        updateFields.receivedQuantity = patch.receivedQuantity;
      if (patch.rejectedQuantity !== undefined)
        updateFields.rejectedQuantity = patch.rejectedQuantity;
      if (patch.reason !== undefined) updateFields.reason = patch.reason;
      if (patch.rejectionNote !== undefined) updateFields.rejectionNote = patch.rejectionNote;
      if (patch.quantity !== undefined) updateFields.quantity = patch.quantity;

      const updated = await tx
        .update(scmProcurementItems)
        .set(updateFields)
        .where(
          and(
            eq(scmProcurementItems.id, itemId),
            eq(scmProcurementItems.scmProcurementId, procurementId),
          ),
        )
        .returning({ id: scmProcurementItems.id });

      if (updated.length === 0) {
        throw new Error(`Item ${itemId} not found in procurement ${procurementId}`);
      }

      // Audit log (item-update; fromState === toState)
      await tx.insert(scmProcurementAuditLog).values({
        scmProcurementId: procurementId,
        event: "item-update",
        fromState: proc.status,
        toState: proc.status,
        itemId,
        actorId: actor.id,
        actorRole: actor.role,
        note: JSON.stringify(patch),
      });
    });

    return { success: true };
  } catch (err) {
    if (err instanceof InvalidStateForEditError || err instanceof ProcurementNotFoundError) {
      return { success: false, error: { name: err.name, message: err.message } };
    }
    throw err;
  }
}

// -----------------------------------------------------------------------------
// Public helpers
// -----------------------------------------------------------------------------

/**
 * Returns the next possible events for a given (state, role).
 *
 * `role` is a plain string: callers pass the authenticated user's role, which
 * auth already validated against the users-table enum. The FSM treats the
 * role as a membership key against each rule's actor allow-list, so unknown
 * roles simply get no events.
 */
export function availableEvents(state: ScmProcurementStatus, role: string): ScmProcurementEvent[] {
  const stateRules = transitions[state] ?? {};
  // SAFETY: Object.entries widens keys to string, but the transitions table
  // is keyed by ScmProcurementEvent literals (verified by the spec), so each
  // key is a real event.
  const ruleEntries = Object.entries(stateRules) as [ScmProcurementEvent, FsmRule][];
  // SAFETY: widening the FsmActorRole[] allow-list to readonly string[] only
  // relaxes the read; roles not in the list are simply not allowed.
  return ruleEntries
    .filter(([, rule]) => (rule.actors as readonly string[]).includes(role))
    .map(([event]) => event);
}
