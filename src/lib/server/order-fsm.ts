// ============================================================
// Order FSM — one transition table, one writer per edge.
//
// Mirrors the SCM pattern (ADR 0002/0006): the table is the spec,
// `transitionOrderTx` is the only place an order's status changes, and
// effects (stock restore, pending-request cleanup) run in the same
// transaction as the status update. The pure edge map lives in
// `#/lib/order-lifecycle` so the client can render the same options.
// ============================================================

import { and, eq } from "drizzle-orm";
import { db } from "./db";
import {
  cancelRequests,
  inventory,
  orderItems,
  orders,
  stockLedger,
  systemNotifications,
  USER_ROLE_VALUES,
} from "#/db/schema";
import type { AppUser, UserRole } from "./auth";
import type { UnknownRecord } from "#/lib/unknown-record";
import { ensureInventoryRow } from "./sales-data";
import { resolvePersistedItemIngredients, type DbTx } from "./ingredient-resolver";
import {
  ORDER_EVENT_VALUES,
  ORDER_TRANSITIONS,
  type OrderEvent,
  type OrderStatus,
} from "#/lib/order-lifecycle";

export { ORDER_EVENT_VALUES };
export type { OrderEvent, OrderStatus };

export type OrderRow = typeof orders.$inferSelect;

interface OrderEffectContext {
  tx: DbTx;
  order: OrderRow;
  actor: AppUser;
  reason: string | undefined;
}

type OrderEffect = (ctx: OrderEffectContext) => Promise<void>;

export interface OrderRule {
  to: OrderStatus;
  actors: readonly UserRole[];
  effects: readonly OrderEffect[];
}

/** Every authenticated role may advance fulfilment; the wrapper (`requireAuth`)
 *  is the same boundary those cores had before the table existed. */
const ALL_ROLES = USER_ROLE_VALUES satisfies readonly UserRole[];

/** Voiding reverses stock and closes a cashier's pending request, so it stays
 *  with the roles the `voidOrder` endpoint already required. `area_manager` is
 *  additionally bounded to its assigned branches in the transition. */
const VOID_ROLES = [
  "super_admin",
  "admin_pusat",
  "area_manager",
] as const satisfies readonly UserRole[];

// -----------------------------------------------------------------------------
// Effects
// -----------------------------------------------------------------------------

async function restoreInventoryForVoid({ tx, order, reason }: OrderEffectContext): Promise<void> {
  const orderItemsList = await tx.select().from(orderItems).where(eq(orderItems.orderId, order.id));

  const orderIdShort = order.id.slice(0, 8);

  for (const oi of orderItemsList) {
    const resolved = await resolvePersistedItemIngredients(oi.id, { tx });

    for (const ing of resolved.ingredients) {
      // ADR 0020 + loud-missing-row policy: the inventory row is created at 0
      // when it was never seeded instead of skipping the restore silently.
      const inv = await ensureInventoryRow(tx, order.branchId, ing.ingredientId);

      const newQty = inv.quantity + ing.quantity;
      await tx
        .update(inventory)
        .set({ quantity: newQty, lastUpdated: new Date() })
        .where(eq(inventory.id, inv.id));

      if (ing.quantity !== 0) {
        await tx.insert(stockLedger).values({
          branchId: order.branchId,
          ingredientId: ing.ingredientId,
          type: ing.quantity > 0 ? "IN" : "OUT",
          quantity: Math.abs(ing.quantity),
          balance: newQty,
          reference: order.id,
          notes:
            ing.quantity > 0
              ? `Void Order ${orderIdShort}: ${reason ?? ""}`
              : `Void re-deduct exclusion: ${orderIdShort}`,
        });
      }
    }
  }
}

/** A pending cancel request is moot the moment the order is voided. Leaving it
 *  Pending stranded it: approving would answer "Order sudah dibatalkan" and
 *  roll back, so the row kept reappearing in the review queue. */
async function closePendingCancelRequests({ tx, order, actor }: OrderEffectContext): Promise<void> {
  const closed = await tx
    .update(cancelRequests)
    .set({ status: "Executed", approvedBy: actor.id, approvedAt: new Date() })
    .where(and(eq(cancelRequests.orderId, order.id), eq(cancelRequests.status, "Pending")))
    .returning({ id: cancelRequests.id, requestedBy: cancelRequests.requestedBy });

  for (const request of closed) {
    await tx.insert(systemNotifications).values({
      userId: request.requestedBy,
      title: "Cancel Request Ditutup",
      message: `Permintaan pembatalan untuk order #${order.orderCode ?? order.id.slice(0, 8)} ditutup karena pesanannya sudah dibatalkan oleh ${actor.name}.`,
      type: "info",
    });
  }
}

// -----------------------------------------------------------------------------
// Transition table (the spec)
// -----------------------------------------------------------------------------

const voidEffects = [restoreInventoryForVoid, closePendingCancelRequests] as const;

/** Attach actors and effects to the pure edge map for one state. */
function rulesFor(state: OrderStatus): Partial<Record<OrderEvent, OrderRule>> {
  const edges = ORDER_TRANSITIONS[state];
  // SAFETY: the pure table is keyed by OrderEvent (verified by `satisfies`).
  return Object.fromEntries(
    (Object.entries(edges) as [OrderEvent, OrderStatus][]).map(([event, to]) => [
      event,
      {
        to,
        actors: event === "void" ? VOID_ROLES : ALL_ROLES,
        effects: event === "void" ? voidEffects : [],
      },
    ]),
  ) as Partial<Record<OrderEvent, OrderRule>>;
}

/**
 * The table is derived from the pure edge map so the client and the server can
 * never disagree about which edge exists; only actors and effects live here.
 */
export const orderTransitions = {
  New: rulesFor("New"),
  Processing: rulesFor("Processing"),
  "In Delivery": rulesFor("In Delivery"),
  Completed: rulesFor("Completed"),
  Void: rulesFor("Void"),
} satisfies { [state in OrderStatus]: Partial<Record<OrderEvent, OrderRule>> };

// -----------------------------------------------------------------------------
// Errors + result
// -----------------------------------------------------------------------------

export class OrderNotFoundError extends Error {
  constructor(public readonly id: string) {
    super("Order not found");
    this.name = "OrderNotFoundError";
  }
}

export class InvalidOrderTransitionError extends Error {
  constructor(
    public readonly fromState: string,
    public readonly event: string,
  ) {
    super(`Cannot ${event} an order in ${fromState}`);
    this.name = "InvalidOrderTransitionError";
  }
}

export class OrderUnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrderUnauthorizedError";
  }
}

export class OrderAlreadyVoidError extends Error {
  constructor() {
    super("Order sudah dibatalkan");
    this.name = "OrderAlreadyVoidError";
  }
}

export type OrderTransitionResult =
  | {
      success: true;
      /** The row as it was before the transition (for the audit log). */
      previous: OrderRow;
      order: OrderRow;
      from: OrderStatus;
    }
  | { success: false; error: { name: string; message: string } };

// -----------------------------------------------------------------------------
// transitionOrderTx / transitionOrder
// -----------------------------------------------------------------------------

/**
 * Move an order by event inside an existing transaction. Locks the row, checks
 * the edge against the table, checks the actor's role, runs the edge's effects,
 * then writes the new status. Returns the previous row so callers can audit it.
 */
export async function transitionOrderTx(
  tx: DbTx,
  orderId: string,
  event: OrderEvent,
  actor: AppUser,
  payload: { reason?: string } = {},
): Promise<OrderTransitionResult> {
  try {
    const [order] = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .for("update")
      .limit(1);

    if (!order) throw new OrderNotFoundError(orderId);
    if (event === "void" && order.status === "Void") throw new OrderAlreadyVoidError();

    const rule = orderTransitions[order.status]?.[event];
    if (!rule) throw new InvalidOrderTransitionError(order.status, event);

    // SAFETY: widening the role allow-list to readonly string[] only relaxes
    // the read; a role not in the list is denied.
    if (!(rule.actors as readonly string[]).includes(actor.role)) {
      throw new OrderUnauthorizedError(
        `Forbidden: insufficient role (user ${actor.id} has role "${actor.role}", required: ${rule.actors.join(" | ")})`,
      );
    }
    if (
      event === "void" &&
      actor.role === "area_manager" &&
      !(actor.assignedBranches ?? []).includes(order.branchId)
    ) {
      throw new OrderUnauthorizedError("Forbidden: order is outside your assigned branches");
    }

    for (const effect of rule.effects) {
      await effect({ tx, order, actor, reason: payload.reason });
    }

    const patch: UnknownRecord = { status: rule.to };
    if (event === "complete") patch.completedAt = new Date();
    if (event === "void") patch.voidReason = payload.reason;

    const [updated] = await tx.update(orders).set(patch).where(eq(orders.id, orderId)).returning();

    return { success: true, previous: order, order: updated, from: order.status };
  } catch (err) {
    if (
      err instanceof OrderNotFoundError ||
      err instanceof InvalidOrderTransitionError ||
      err instanceof OrderUnauthorizedError ||
      err instanceof OrderAlreadyVoidError
    ) {
      return { success: false, error: { name: err.name, message: err.message } };
    }
    throw err;
  }
}

export async function transitionOrder(
  orderId: string,
  event: OrderEvent,
  actor: AppUser,
  payload: { reason?: string } = {},
): Promise<OrderTransitionResult> {
  return db.transaction((tx) => transitionOrderTx(tx, orderId, event, actor, payload));
}

/** Events this actor may fire from `status`. */
export function availableOrderEvents(status: OrderStatus, role: string): OrderEvent[] {
  const rules = orderTransitions[status] ?? {};
  // SAFETY: the transition table is keyed by OrderEvent (verified by the
  // `satisfies` on `orderTransitions`).
  return (
    (Object.entries(rules) as [OrderEvent, OrderRule][])
      // SAFETY: widening the role allow-list to readonly string[] only relaxes
      // the read; a role not in the list is denied.
      .filter(([, rule]) => (rule.actors as readonly string[]).includes(role))
      .map(([event]) => event)
  );
}
