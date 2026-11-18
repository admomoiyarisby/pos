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

/**
 * Waste entry: Active → Cancelled. Cancellation reverses stock and is the only
 * edge; a cancelled entry stays visible for audit and is terminal.
 */
export const wasteEntryLifecycle = defineLifecycle({
  entity: "waste entry",
  states: ["Active", "Cancelled"] as const,
  events: ["cancel"] as const,
  initialStates: ["Active"] as const,
  transitions: {
    Active: { cancel: "Cancelled" },
    Cancelled: {},
  },
});

/**
 * Production (yield conversion): Active → Cancelled. Cancelling reverses the
 * consumed/produced ledger rows; a cancelled record is terminal.
 */
export const productionLifecycle = defineLifecycle({
  entity: "production",
  states: ["Active", "Cancelled"] as const,
  events: ["cancel"] as const,
  initialStates: ["Active"] as const,
  transitions: {
    Active: { cancel: "Cancelled" },
    Cancelled: {},
  },
});

/**
 * Production cancel request. Approval *executes* the cancellation in the same
 * transaction, so Pending goes straight to Executed; Rejected closes the
 * request without touching production. The DB enum still carries a legacy
 * `Approved` value from before that rule — it is not a valid live state and is
 * never written.
 */
export const yieldCancelRequestLifecycle = defineLifecycle({
  entity: "yield cancel request",
  states: ["Pending", "Executed", "Rejected"] as const,
  events: ["execute", "reject"] as const,
  initialStates: ["Pending"] as const,
  transitions: {
    Pending: { execute: "Executed", reject: "Rejected" },
    Executed: {},
    Rejected: {},
  },
});

/**
 * Stock opname sheet: Triggered → Submitted → Under Investigation → Approved →
 * Realized. A recount returns the sheet to Submitted for re-review (the
 * backwards edge is deliberate), and a submitted/investigated sheet may be
 * approved directly. Realized is terminal; approval itself never moves stock
 * (ADR 0021) — Realize is the only stock-writing edge.
 */
export const stockOpnameLifecycle = defineLifecycle({
  entity: "stock opname",
  states: ["Triggered", "Submitted", "Under Investigation", "Approved", "Realized"] as const,
  events: ["submit", "investigate", "approve", "realize"] as const,
  initialStates: ["Triggered"] as const,
  transitions: {
    Triggered: { submit: "Submitted", approve: "Approved" },
    Submitted: { submit: "Submitted", investigate: "Under Investigation", approve: "Approved" },
    "Under Investigation": { submit: "Submitted", approve: "Approved" },
    Approved: { realize: "Realized" },
    Realized: {},
  },
});

/** Accounting period: Open → Closed; a new period is a new row, not a reopen. */
export const periodLifecycle = defineLifecycle({
  entity: "period",
  states: ["Open", "Closed"] as const,
  events: ["close"] as const,
  initialStates: ["Open"] as const,
  transitions: {
    Open: { close: "Closed" },
    Closed: {},
  },
});

/** Brand master status (delete = deactivate, mirroring recipes/ingredients). */
export const brandLifecycle = defineLifecycle({
  entity: "brand",
  states: ["Active", "Inactive"] as const,
  events: ["activate", "deactivate"] as const,
  initialStates: ["Active"] as const,
  transitions: {
    Active: { deactivate: "Inactive" },
    Inactive: { activate: "Active" },
  },
});

/**
 * Legacy Purchase Requisition. The current flow creates Pending and lets an
 * approver process from Pending directly; Draft exists for older rows. A
 * Rejected or Fulfilled PR is terminal.
 */
export const purchaseRequisitionLifecycle = defineLifecycle({
  entity: "purchase requisition",
  states: ["Draft", "Pending", "Approved", "Processed", "Rejected", "Fulfilled"] as const,
  events: ["submit", "approve", "reject", "process", "fulfill"] as const,
  initialStates: ["Draft", "Pending"] as const,
  transitions: {
    Draft: { submit: "Pending" },
    Pending: { approve: "Approved", reject: "Rejected", process: "Processed" },
    Approved: { reject: "Rejected", process: "Processed" },
    Processed: { fulfill: "Fulfilled" },
    Rejected: {},
    Fulfilled: {},
  },
});

/** Legacy Purchase Order. Cancellation is allowed before completion, once. */
export const purchaseOrderLifecycle = defineLifecycle({
  entity: "purchase order",
  states: ["Draft", "Sent", "Partial", "Completed", "Cancelled"] as const,
  events: ["send", "receive", "complete", "cancel"] as const,
  initialStates: ["Draft"] as const,
  transitions: {
    Draft: { send: "Sent", cancel: "Cancelled" },
    Sent: { receive: "Partial", complete: "Completed", cancel: "Cancelled" },
    Partial: { receive: "Partial", complete: "Completed", cancel: "Cancelled" },
    Completed: {},
    Cancelled: {},
  },
});

/**
 * Legacy delivery note (Surat Jalan). Reception is cumulative: a partial
 * receipt can be received again, and only when every line is complete does it
 * become Received. Cancellation is possible while the goods are still in
 * transit; once received, only the receiving flow applies.
 */
export const deliveryNoteLifecycle = defineLifecycle({
  entity: "delivery note",
  states: ["Draft", "Picking", "In Transit", "Partial Received", "Received", "Cancelled"] as const,
  events: ["pick", "ship", "receive", "complete", "cancel"] as const,
  initialStates: ["Draft", "Picking"] as const,
  transitions: {
    Draft: { pick: "Picking", cancel: "Cancelled" },
    Picking: { ship: "In Transit", cancel: "Cancelled" },
    "In Transit": { receive: "Partial Received", complete: "Received", cancel: "Cancelled" },
    "Partial Received": { receive: "Partial Received", complete: "Received" },
    Received: {},
    Cancelled: {},
  },
});

/**
 * Legacy branch-to-branch stock transfer. The new Mutasi Stok FSM
 * (`scm-transfer-fsm.ts`) supersedes it operationally, but existing rows and
 * the /stock-transfers screens still follow this table.
 */
export const stockTransferLifecycle = defineLifecycle({
  entity: "stock transfer",
  states: [
    "Pending Approval",
    "Approved",
    "Rejected",
    "In Transit",
    "Completed",
    "Cancelled",
  ] as const,
  events: ["approve", "reject", "ship", "complete", "cancel"] as const,
  initialStates: ["Pending Approval"] as const,
  transitions: {
    "Pending Approval": { approve: "Approved", reject: "Rejected" },
    Approved: { ship: "In Transit", cancel: "Cancelled" },
    "In Transit": { complete: "Completed", cancel: "Cancelled" },
    Rejected: {},
    Completed: {},
    Cancelled: {},
  },
});
