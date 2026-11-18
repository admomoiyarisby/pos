import { describe, expect, it } from "vite-plus/test";
import {
  brandLifecycle,
  cancelRequestLifecycle,
  deliveryNoteLifecycle,
  ingredientLifecycle,
  periodLifecycle,
  printRequestLifecycle,
  productionLifecycle,
  purchaseOrderLifecycle,
  purchaseRequisitionLifecycle,
  recipeLifecycle,
  scmInvoiceLifecycle,
  scmReturnLifecycle,
  stockOpnameLifecycle,
  stockTransferLifecycle,
  supplierDeliveryLifecycle,
  userStatusLifecycle,
  voucherLifecycle,
  wasteEntryLifecycle,
  yieldCancelRequestLifecycle,
} from "./lifecycles";
import type { Lifecycle } from "./lifecycle";

/**
 * Generic self-check for every registered small lifecycle.
 *
 * The type system already prevents an edge from targeting an undeclared state.
 * This adds the runtime invariants the types cannot express: unique states,
 * declared initial states, reachability, terminal consistency, and the
 * can/to/assert helpers agreeing with each other.
 */
function validate<S extends string, E extends string>(name: string, lifecycle: Lifecycle<S, E>) {
  expect(new Set(lifecycle.states).size, `${name}: duplicate state`).toBe(lifecycle.states.length);
  expect(lifecycle.initialStates.length, `${name}: no initial state`).toBeGreaterThan(0);

  for (const state of lifecycle.initialStates) {
    expect(lifecycle.states, `${name}: initial ${state} is not a state`).toContain(state);
  }

  // Every declared state must be reachable from some initial state.
  const seen = new Set<S>(lifecycle.initialStates);
  const queue = [...lifecycle.initialStates];
  for (;;) {
    const from = queue.pop();
    if (from === undefined) break;
    for (const to of lifecycle.targetsFrom(from)) {
      if (!seen.has(to)) {
        seen.add(to);
        queue.push(to);
      }
    }
  }
  for (const state of lifecycle.states) {
    expect(seen.has(state), `${name}: state ${state} is unreachable`).toBe(true);
  }

  const usedEvents = new Set<E>();
  for (const state of lifecycle.states) {
    const events = lifecycle.eventsFrom(state);
    expect(lifecycle.isTerminal(state), `${name}: terminal mismatch at ${state}`).toBe(
      events.length === 0,
    );
    for (const event of events) {
      usedEvents.add(event);
      expect(lifecycle.can(state, event), `${name}: ${state}/${event} can() disagrees`).toBe(true);
      expect(lifecycle.to(state, event), `${name}: ${state}/${event} to() disagrees`).toBe(
        lifecycle.assert(state, event),
      );
    }
  }

  // A declared event that no state can fire is dead weight (or a typo).
  for (const event of lifecycle.events) {
    expect(usedEvents.has(event), `${name}: event ${event} is never used`).toBe(true);
  }
}

describe("small lifecycles — generic invariants", () => {
  it("every registered machine is well-formed", () => {
    validate("scm invoice", scmInvoiceLifecycle);
    validate("voucher", voucherLifecycle);
    validate("recipe", recipeLifecycle);
    validate("ingredient", ingredientLifecycle);
    validate("user status", userStatusLifecycle);
    validate("supplier delivery", supplierDeliveryLifecycle);
    validate("scm return", scmReturnLifecycle);
    validate("print request", printRequestLifecycle);
    validate("cancel request", cancelRequestLifecycle);
    validate("waste entry", wasteEntryLifecycle);
    validate("production", productionLifecycle);
    validate("yield cancel request", yieldCancelRequestLifecycle);
    validate("stock opname", stockOpnameLifecycle);
    validate("period", periodLifecycle);
    validate("brand", brandLifecycle);
    validate("purchase requisition", purchaseRequisitionLifecycle);
    validate("purchase order", purchaseOrderLifecycle);
    validate("delivery note", deliveryNoteLifecycle);
    validate("stock transfer", stockTransferLifecycle);
  });

  it("rejects an edge that is not in the table with a readable error", () => {
    expect(() => voucherLifecycle.assert("Active", "delete")).toThrow(
      "Cannot delete voucher from Active",
    );
    expect(() =>
      voucherLifecycle.assert("Active", "delete", "Nonaktifkan voucher terlebih dahulu"),
    ).toThrow("Nonaktifkan voucher terlebih dahulu");
  });
});

describe("small lifecycles — expected edges", () => {
  it("scm invoice: Unpaid → Paid | Cancelled only", () => {
    expect(scmInvoiceLifecycle.to("Unpaid", "pay")).toBe("Paid");
    expect(scmInvoiceLifecycle.to("Unpaid", "cancel")).toBe("Cancelled");
    expect(scmInvoiceLifecycle.to("Paid", "pay")).toBeUndefined();
    expect(scmInvoiceLifecycle.to("Cancelled", "pay")).toBeUndefined();
    expect(scmInvoiceLifecycle.isTerminal("Paid")).toBe(true);
    expect(scmInvoiceLifecycle.isTerminal("Cancelled")).toBe(true);
  });

  it("voucher: Active → Inactive → Deleted", () => {
    expect(voucherLifecycle.to("Active", "deactivate")).toBe("Inactive");
    expect(voucherLifecycle.to("Inactive", "delete")).toBe("Deleted");
    expect(voucherLifecycle.to("Active", "delete")).toBeUndefined();
    expect(voucherLifecycle.to("Deleted", "deactivate")).toBeUndefined();
    expect(voucherLifecycle.eventsFrom("Deleted")).toEqual([]);
  });

  it("recipe/ingredient: Active ⇄ Inactive, delete from either, Deleted terminal", () => {
    for (const lifecycle of [recipeLifecycle, ingredientLifecycle]) {
      expect(lifecycle.to("Active", "deactivate")).toBe("Inactive");
      expect(lifecycle.to("Inactive", "activate")).toBe("Active");
      expect(lifecycle.to("Active", "delete")).toBe("Deleted");
      expect(lifecycle.to("Inactive", "delete")).toBe("Deleted");
      expect(lifecycle.to("Deleted", "activate")).toBeUndefined();
      expect(lifecycle.to("Deleted", "deactivate")).toBeUndefined();
      expect(lifecycle.to("Deleted", "delete")).toBeUndefined();
    }
  });

  it("user status: Active ⇄ Inactive, no third state", () => {
    expect(userStatusLifecycle.to("Active", "deactivate")).toBe("Inactive");
    expect(userStatusLifecycle.to("Inactive", "activate")).toBe("Active");
    expect(userStatusLifecycle.eventsFrom("Inactive")).toEqual(["activate"]);
  });

  it("supplier delivery: Pending Invoice → Completed", () => {
    expect(supplierDeliveryLifecycle.to("Pending Invoice", "complete")).toBe("Completed");
    expect(supplierDeliveryLifecycle.to("Completed", "complete")).toBeUndefined();
  });

  it("scm return: Pending ⇄ PickedUp", () => {
    expect(scmReturnLifecycle.to("Pending", "pickup")).toBe("PickedUp");
    expect(scmReturnLifecycle.to("PickedUp", "reopen")).toBe("Pending");
    expect(scmReturnLifecycle.to("Pending", "reopen")).toBeUndefined();
  });

  it("print request: Pending → Approved | Rejected, only Approved is consumed", () => {
    expect(printRequestLifecycle.to("Pending", "approve")).toBe("Approved");
    expect(printRequestLifecycle.to("Pending", "reject")).toBe("Rejected");
    expect(printRequestLifecycle.to("Approved", "consume")).toBe("Consumed");
    // A pending request cannot be consumed, and a consumed one cannot be
    // re-approved: the paper is already out.
    expect(printRequestLifecycle.to("Pending", "consume")).toBeUndefined();
    expect(printRequestLifecycle.to("Consumed", "approve")).toBeUndefined();
    expect(printRequestLifecycle.to("Rejected", "consume")).toBeUndefined();
  });

  it("cancel request: Pending → Rejected | Executed only", () => {
    expect(cancelRequestLifecycle.to("Pending", "execute")).toBe("Executed");
    expect(cancelRequestLifecycle.to("Pending", "reject")).toBe("Rejected");
    expect(cancelRequestLifecycle.to("Rejected", "execute")).toBeUndefined();
    expect(cancelRequestLifecycle.to("Executed", "reject")).toBeUndefined();
  });
});

describe("newly explicit machines — expected edges", () => {
  it("waste and production cancel once and stay terminal", () => {
    for (const lifecycle of [wasteEntryLifecycle, productionLifecycle]) {
      expect(lifecycle.to("Active", "cancel")).toBe("Cancelled");
      expect(lifecycle.to("Cancelled", "cancel")).toBeUndefined();
    }
  });

  it("yield cancel request executes from Pending, never from Rejected", () => {
    expect(yieldCancelRequestLifecycle.to("Pending", "execute")).toBe("Executed");
    expect(yieldCancelRequestLifecycle.to("Pending", "reject")).toBe("Rejected");
    expect(yieldCancelRequestLifecycle.to("Rejected", "execute")).toBeUndefined();
    expect(yieldCancelRequestLifecycle.to("Executed", "reject")).toBeUndefined();
  });

  it("stock opname allows a recount but keeps approve and realize ordered", () => {
    expect(stockOpnameLifecycle.to("Triggered", "submit")).toBe("Submitted");
    expect(stockOpnameLifecycle.to("Submitted", "investigate")).toBe("Under Investigation");
    expect(stockOpnameLifecycle.to("Under Investigation", "submit")).toBe("Submitted");
    expect(stockOpnameLifecycle.to("Under Investigation", "approve")).toBe("Approved");
    expect(stockOpnameLifecycle.to("Approved", "realize")).toBe("Realized");
    expect(stockOpnameLifecycle.to("Submitted", "realize")).toBeUndefined();
    expect(stockOpnameLifecycle.to("Approved", "submit")).toBeUndefined();
    expect(stockOpnameLifecycle.to("Realized", "realize")).toBeUndefined();
  });

  it("period and brand are two-state machines", () => {
    expect(periodLifecycle.to("Open", "close")).toBe("Closed");
    expect(periodLifecycle.to("Closed", "close")).toBeUndefined();
    expect(brandLifecycle.to("Active", "deactivate")).toBe("Inactive");
    expect(brandLifecycle.to("Inactive", "activate")).toBe("Active");
  });

  it("purchase requisition follows the approval chain", () => {
    expect(purchaseRequisitionLifecycle.to("Draft", "submit")).toBe("Pending");
    expect(purchaseRequisitionLifecycle.to("Pending", "approve")).toBe("Approved");
    expect(purchaseRequisitionLifecycle.to("Approved", "reject")).toBe("Rejected");
    expect(purchaseRequisitionLifecycle.to("Pending", "process")).toBe("Processed");
    expect(purchaseRequisitionLifecycle.to("Processed", "fulfill")).toBe("Fulfilled");
    expect(purchaseRequisitionLifecycle.to("Fulfilled", "approve")).toBeUndefined();
    expect(purchaseRequisitionLifecycle.to("Rejected", "process")).toBeUndefined();
  });

  it("purchase order cancels before completion and never twice", () => {
    expect(purchaseOrderLifecycle.to("Draft", "send")).toBe("Sent");
    expect(purchaseOrderLifecycle.to("Sent", "receive")).toBe("Partial");
    expect(purchaseOrderLifecycle.to("Partial", "complete")).toBe("Completed");
    expect(purchaseOrderLifecycle.to("Sent", "cancel")).toBe("Cancelled");
    expect(purchaseOrderLifecycle.to("Cancelled", "cancel")).toBeUndefined();
    expect(purchaseOrderLifecycle.to("Completed", "cancel")).toBeUndefined();
  });

  it("delivery note can partially receive, cancel in transit, and not after receipt", () => {
    expect(deliveryNoteLifecycle.to("Picking", "ship")).toBe("In Transit");
    expect(deliveryNoteLifecycle.to("In Transit", "receive")).toBe("Partial Received");
    expect(deliveryNoteLifecycle.to("Partial Received", "complete")).toBe("Received");
    expect(deliveryNoteLifecycle.to("In Transit", "cancel")).toBe("Cancelled");
    expect(deliveryNoteLifecycle.to("Received", "cancel")).toBeUndefined();
  });

  it("legacy stock transfer moves Pending → Approved → In Transit → Completed", () => {
    expect(stockTransferLifecycle.to("Pending Approval", "approve")).toBe("Approved");
    expect(stockTransferLifecycle.to("Approved", "ship")).toBe("In Transit");
    expect(stockTransferLifecycle.to("In Transit", "complete")).toBe("Completed");
    expect(stockTransferLifecycle.to("In Transit", "cancel")).toBe("Cancelled");
    expect(stockTransferLifecycle.to("Completed", "cancel")).toBeUndefined();
  });
});
