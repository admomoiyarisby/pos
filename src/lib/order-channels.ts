// ============================================================
// Order channels — single source of truth for channel labels
// used by every history list that labels or filters orders by
// channel (POS history sidebar/tab and /order-history).
// ============================================================

import { ORDER_CHANNEL_VALUES } from "#/db/schema";

/** Channel options in canonical enum order, keyed by the DB enum value. */
export const ORDER_CHANNEL_OPTIONS = ORDER_CHANNEL_VALUES.map((key) => ({
  key,
  label: key,
}));

/** Human label for a channel key; falls back to the raw key for unknown values. */
export function channelLabel(key: string): string {
  return ORDER_CHANNEL_OPTIONS.find((c) => c.key === key)?.label ?? key;
}
