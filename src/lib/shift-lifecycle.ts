// ============================================================
// Shift lifecycle — the pure state map for a cashier's work session.
//
// A branch has at most one Open shift (enforced by `openShiftCore`).
// While Open, the holder may change (take-over) and the cash float may
// be adjusted without leaving the state. Closing is the only edge out,
// and Closed is terminal.
// ============================================================

import { SHIFT_STATUS_VALUES } from "#/db/schema";

export type ShiftStatus = (typeof SHIFT_STATUS_VALUES)[number];

export const SHIFT_EVENT_VALUES = ["take-over", "adjust-float", "close"] as const;

export type ShiftEvent = (typeof SHIFT_EVENT_VALUES)[number];

/**
 * Events each state accepts. There is no backwards edge: take-over and
 * adjust-float mutate the open shift in place, close is the only edge to
 * Closed, and Closed is terminal.
 */
export const SHIFT_TRANSITIONS = {
  Open: new Set<ShiftEvent>(["take-over", "adjust-float", "close"]),
  Closed: new Set<ShiftEvent>(),
} satisfies Record<ShiftStatus, ReadonlySet<ShiftEvent>>;

export function shiftEventAllowed(status: ShiftStatus, event: ShiftEvent): boolean {
  return SHIFT_TRANSITIONS[status].has(event);
}
