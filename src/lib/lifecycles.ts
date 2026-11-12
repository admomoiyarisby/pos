// ============================================================
// Registered small lifecycles.
//
// Each definition is the single source of truth for its edges. The
// server cores call `.assert(...)` before writing, and the UI helpers
// (e.g. voucherActionForStatus) derive from the same table.
//
// Add a new machine here, then register it in lifecycles.test.ts (the
// generic self-check walks this list only if it is exported as a map).
// ============================================================

import { defineLifecycle } from "./lifecycle";

/** Legacy SCM invoice (the 3-document model). Unpaid → Paid | Cancelled. */
export const scmInvoiceLifecycle = defineLifecycle({
  entity: "invoice",
  states: ["Unpaid", "Paid", "Cancelled"] as const,
  events: ["pay", "cancel"] as const,
  initialStates: ["Unpaid"] as const,
  transitions: {
    Unpaid: { pay: "Paid", cancel: "Cancelled" },
    Paid: {},
    Cancelled: {},
  },
});

/** Voucher: Active → Inactive → Deleted. Deleted is terminal. */
export const voucherLifecycle = defineLifecycle({
  entity: "voucher",
  states: ["Active", "Inactive", "Deleted"] as const,
  events: ["deactivate", "delete"] as const,
  initialStates: ["Active"] as const,
  transitions: {
    Active: { deactivate: "Inactive" },
    Inactive: { delete: "Deleted" },
    Deleted: {},
  },
});

/** Recipe: Active ⇄ Inactive, either may be soft-deleted. */
export const recipeLifecycle = defineLifecycle({
  entity: "recipe",
  states: ["Active", "Inactive", "Deleted"] as const,
  events: ["activate", "deactivate", "delete"] as const,
  initialStates: ["Active"] as const,
  transitions: {
    Active: { deactivate: "Inactive", delete: "Deleted" },
    Inactive: { activate: "Active", delete: "Deleted" },
    Deleted: {},
  },
});

/** Ingredient: same lifecycle as recipes (ADR 0009 mirror). */
export const ingredientLifecycle = defineLifecycle({
  entity: "ingredient",
  states: ["Active", "Inactive", "Deleted"] as const,
  events: ["activate", "deactivate", "delete"] as const,
  initialStates: ["Active"] as const,
  transitions: {
    Active: { deactivate: "Inactive", delete: "Deleted" },
    Inactive: { activate: "Active", delete: "Deleted" },
    Deleted: {},
  },
});

/** User account status. Deletion is the separate `deletedAt` tombstone. */
export const userStatusLifecycle = defineLifecycle({
  entity: "user",
  states: ["Active", "Inactive"] as const,
  events: ["activate", "deactivate"] as const,
  initialStates: ["Active"] as const,
  transitions: {
    Active: { deactivate: "Inactive" },
    Inactive: { activate: "Active" },
  },
});

/** Supplier delivery: the invoice marker, Pending Invoice → Completed. */
export const supplierDeliveryLifecycle = defineLifecycle({
  entity: "supplier delivery",
  states: ["Pending Invoice", "Completed"] as const,
  events: ["complete"] as const,
  initialStates: ["Pending Invoice"] as const,
  transitions: {
    "Pending Invoice": { complete: "Completed" },
    Completed: {},
  },
});

/** Retur Barang: Pending ⇄ PickedUp (pickup can be reopened in error). */
export const scmReturnLifecycle = defineLifecycle({
  entity: "return",
  states: ["Pending", "PickedUp"] as const,
  events: ["pickup", "reopen"] as const,
  initialStates: ["Pending"] as const,
  transitions: {
    Pending: { pickup: "PickedUp" },
    PickedUp: { reopen: "Pending" },
  },
});

/**
 * Reprint approval (ADR-0015). Pending → Approved | Rejected; only an
 * approved request can be consumed, and consuming is what marks the paper
 * as printed. Rejected stays visible to the cashier so they can ask again.
 */
export const printRequestLifecycle = defineLifecycle({
  entity: "print request",
  states: ["Pending", "Approved", "Rejected", "Consumed"] as const,
  events: ["approve", "reject", "consume"] as const,
  initialStates: ["Pending"] as const,
  transitions: {
    Pending: { approve: "Approved", reject: "Rejected" },
    Approved: { consume: "Consumed" },
    Rejected: {},
    Consumed: {},
  },
});

/**
 * Order cancel request. Approval *executes* the cancellation (there is no
 * intermediate Approved state since migration 0067); rejection closes the
 * request without touching the order.
 */
export const cancelRequestLifecycle = defineLifecycle({
  entity: "cancel request",
  states: ["Pending", "Rejected", "Executed"] as const,
  events: ["reject", "execute"] as const,
  initialStates: ["Pending"] as const,
  transitions: {
    Pending: { reject: "Rejected", execute: "Executed" },
    Rejected: {},
    Executed: {},
  },
});
