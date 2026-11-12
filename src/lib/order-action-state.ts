// ============================================================
// What the two order-row action buttons should do.
//
// Shared by the POS desktop list and the POS history sidebar so the
// rules cannot drift: the print button depends on the reprint request
// state (and whether the device can print directly), while the cancel
// button depends on the order status and any pending request.
//
// `intent` is the click decision, not just the visual state, so the
// handlers do not re-derive the same conditions a third time.
// ============================================================

export type OrderPrintState = "hidden" | "direct" | "active" | "pending" | "neutral";
export type OrderCancelState = "hidden" | "pending" | "neutral";

export type OrderPrintIntent = "none" | "direct" | "consume-and-print" | "request";
export type OrderCancelIntent = "none" | "request";

export interface OrderActionState {
  print: OrderPrintState;
  cancel: OrderCancelState;
  printIntent: OrderPrintIntent;
  cancelIntent: OrderCancelIntent;
}

export interface OrderActionInput {
  /** Omit when the caller only has the request row (e.g. a history callback). */
  status?: string;
  canDirectPrint?: boolean;
  printRequestStatus?: string | null;
  cancelRequestStatus?: string | null;
}

export function deriveOrderActionState(input: OrderActionInput): OrderActionState {
  const isVoid = input.status === "Void";

  // Direct printing stays available on a voided order (an admin may need a
  // copy); the approval flow does not.
  const print: OrderPrintState = input.canDirectPrint
    ? "direct"
    : isVoid
      ? "hidden"
      : input.printRequestStatus === "Approved"
        ? "active"
        : input.printRequestStatus === "Pending"
          ? "pending"
          : "neutral";

  const cancel: OrderCancelState = isVoid
    ? "hidden"
    : input.cancelRequestStatus === "Pending"
      ? "pending"
      : "neutral";

  const printIntent: OrderPrintIntent =
    print === "direct"
      ? "direct"
      : print === "active"
        ? "consume-and-print"
        : print === "neutral"
          ? "request"
          : "none";

  const cancelIntent: OrderCancelIntent = cancel === "neutral" ? "request" : "none";

  return { print, cancel, printIntent, cancelIntent };
}
