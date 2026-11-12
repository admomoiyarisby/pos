import { voucherLifecycle } from "./lifecycles";

export type VoucherStatus = (typeof voucherLifecycle.states)[number];
export type VoucherLifecycleAction = "deactivate" | "delete";

/**
 * The single action available from a status, derived from the shared lifecycle
 * table so the UI and the server can never disagree about the next edge.
 */
export function voucherActionForStatus(status: VoucherStatus): VoucherLifecycleAction | null {
  const [event] = voucherLifecycle.eventsFrom(status);
  return event ?? null;
}
