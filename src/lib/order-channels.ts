// ============================================================
// Order channels — single source of truth for channel labels
// used by every history list that labels or filters orders by
// channel (POS history sidebar/tab and /order-history).
// ============================================================

import { ORDER_CHANNEL_VALUES } from "#/db/schema";

/** Channel options in canonical enum order, keyed by the DB enum value. */
export const ORDER_CHANNEL_OPTIONS = ORDER_CHANNEL_VALUES.map((key) => ({
  key,
  label: channelLabel(key),
}));

/**
 * Human label for a channel key; falls back to the raw key for unknown values.
 * "Dine-in" reads as "Cash" on screens and printouts, but keeps its stored
 * value so historical orders, payouts, and reports stay addressable.
 */
export function channelLabel(key: string): string {
  return key === "Dine-in" ? "Cash" : key;
}
