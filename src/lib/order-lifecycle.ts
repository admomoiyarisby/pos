// ============================================================
// Order lifecycle — the pure state map, shared by the server FSM
// (`order-fsm.ts`) and the status picker in /order-history.
//
// Orders are paid at creation, so the status tracks fulfilment, not
// payment. The machine is forward-only: an order can advance toward
// Completed, or be voided from any non-void state. There is no edge
// back to a previous status and none out of Void.
// ============================================================

import { ORDER_STATUS_VALUES } from "#/db/schema";

export type OrderStatus = (typeof ORDER_STATUS_VALUES)[number];

export const ORDER_EVENT_VALUES = ["start-processing", "dispatch", "complete", "void"] as const;

export type OrderEvent = (typeof ORDER_EVENT_VALUES)[number];

/** Allowed edges, keyed by the current state then the event. */
export const ORDER_TRANSITIONS = {
  New: {
    "start-processing": "Processing",
    // A back-office user may dispatch straight from New; the POS creates every
    // order as New and the fulfilment status is edited manually.
    dispatch: "In Delivery",
    complete: "Completed",
    void: "Void",
  },
  Processing: {
    dispatch: "In Delivery",
    complete: "Completed",
    void: "Void",
  },
  "In Delivery": {
    complete: "Completed",
    void: "Void",
  },
  // A completed order can still be voided (admin correction); Void is terminal.
  Completed: {
    void: "Void",
  },
  Void: {},
} satisfies { [state in OrderStatus]: Partial<Record<OrderEvent, OrderStatus>> };

/** The status a "change status" action targets. New is not a target: there is
 *  no edge back to it. */
export const ORDER_TARGET_STATUSES = ["Processing", "In Delivery", "Completed"] as const;

export type OrderTargetStatus = (typeof ORDER_TARGET_STATUSES)[number];

/** Event that moves an order from its current state to the requested target. */
export const ORDER_STATUS_EVENT = {
  Processing: "start-processing",
  "In Delivery": "dispatch",
  Completed: "complete",
} satisfies Record<OrderTargetStatus, OrderEvent>;

/** Forward (non-void) targets reachable from `status`, in table order.
 *  The remaining edges target exactly the three mutable statuses. */
export function orderForwardStatuses(status: OrderStatus): OrderTargetStatus[] {
  const rules = ORDER_TRANSITIONS[status] ?? {};
  // SAFETY: the table is keyed by OrderEvent and only `void` is filtered out;
  // every non-void edge points at Processing, In Delivery, or Completed.
  return (Object.entries(rules) as [OrderEvent, OrderStatus][])
    .filter(([event]) => event !== "void")
    .map(([, to]) => to as OrderTargetStatus);
}

export function orderEventsFrom(status: OrderStatus): OrderEvent[] {
  // SAFETY: the table is keyed by OrderEvent (verified by `satisfies`).
  return Object.keys(ORDER_TRANSITIONS[status] ?? {}) as OrderEvent[];
}
