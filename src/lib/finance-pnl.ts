/**
 * Payout-based P&L aggregation for the daily ledger (ADR 0028).
 *
 * The reporting omzet of a channel/day is the payout finance typed into
 * "Input Revenue (Per Channel)" — `channel_revenues.amount`, which is already
 * net of platform commission, promos, vouchers and delivery. When a channel
 * has no input for that day, the POS net (`Σ orders.netSales`, ADR 0017 #1)
 * is used as the fallback so the ledger never shows an empty day for a channel
 * that did sell.
 *
 * HPP stays POS COGS (`Σ orders.totalCogs`). A day-level signed adjustment —
 * the migrated `daily_overrides` row with field `omzet_adjustment` — carries
 * legacy hand-typed omzet corrections that have no channel attribution; it is
 * added to the day total and never distributed across channels (ADR 0028).
 *
 * Everything here is pure: the server function feeds it SQL aggregates, unit
 * tests feed it literals, and both see the same arithmetic.
 */

import { ORDER_CHANNEL_VALUES } from "#/db/schema";

/** Stable display order for channels — matches the POS enum, not the alphabet. */
export const PNL_CHANNEL_ORDER: readonly string[] = ORDER_CHANNEL_VALUES;

/** Where a channel's omzet came from: the typed payout, or the POS fallback. */
export type PnlBasis = "payout" | "pos";

/** Per day × channel POS aggregate. Void/soft-deleted orders are filtered in SQL. */
export interface OrderAggregate {
  /** Jakarta calendar day, `YYYY-MM-DD`. */
  date: string;
  channel: string;
  orderCount: number;
  /** Σ orders.totalAmount — gross before discounts. */
  grossSales: number;
  /** Σ orders.netSales — POS net after modelled discount + MDR (fallback basis). */
  netSales: number;
  /** Σ orders.totalCogs. */
  hpp: number;
}

/** One `channel_revenues` group — the payout actually received. */
export interface PayoutInput {
  date: string;
  channel: string;
  amount: number;
}

/** One `daily_overrides` row with field `omzet_adjustment` (signed). */
export interface OmzetAdjustmentInput {
  date: string;
  amount: number;
}

export interface ChannelPnlLine {
  date: string;
  channel: string;
  orderCount: number;
  grossSales: number;
  /** POS net — audit column and fallback omzet. */
  netSales: number;
  hpp: number;
  /** Payout input for this day+channel, or null when none was typed. */
  payout: number | null;
  /** payout ?? netSales — the omzet the ledger reports. */
  omzet: number;
  source: PnlBasis;
  /** omzet − hpp. */
  grossProfit: number;
  /**
   * Margin = grossProfit / omzet. Null when omzet ≤ 0, and also when the
   * channel has no POS orders: without a recorded HPP a payout-only row would
   * otherwise read as a 100% margin.
   */
  margin: number | null;
  /** payout − netSales ("potongan tak termodelkan"), null when no payout. */
  gap: number | null;
}

export interface DailyPnl {
  date: string;
  channels: ChannelPnlLine[];
  orderCount: number;
  /** Σ channel grossSales. */
  grossSales: number;
  /** Σ channel netSales — the modelled POS figure, kept for audit. */
  posNet: number;
  /** Σ channel payouts (only channels that have an input). */
  payout: number;
  /** Channel-less signed adjustment carried from legacy day overrides. */
  adjustment: number;
  /** Σ channel hpp. */
  hpp: number;
  /** Σ channel omzet + adjustment. */
  omzet: number;
  grossProfit: number;
  /** Total margin — weighted, not any single channel's margin. */
  margin: number | null;
}

export interface PnlTotals {
  orderCount: number;
  grossSales: number;
  posNet: number;
  payout: number;
  adjustment: number;
  hpp: number;
  omzet: number;
  grossProfit: number;
  margin: number | null;
}

const channelRank = (channel: string): number => {
  const index = PNL_CHANNEL_ORDER.indexOf(channel);
  return index === -1 ? PNL_CHANNEL_ORDER.length : index;
};

const marginOf = (omzet: number, grossProfit: number): number | null =>
  omzet > 0 ? grossProfit / omzet : null;

/**
 * Build the ledger's day rows from POS aggregates, per-channel payouts, and
 * signed day adjustments. Days are ordered ascending; channels follow the POS
 * enum order. A payout for a channel/day with no orders still produces a line
 * (orderCount 0, HPP 0, margin null) so manually-entered revenue is never lost.
 */
export function buildDailyPnl(
  orders: readonly OrderAggregate[],
  payouts: readonly PayoutInput[],
  adjustments: readonly OmzetAdjustmentInput[] = [],
): DailyPnl[] {
  const byDate = new Map<
    string,
    { orders: Map<string, OrderAggregate>; payouts: Map<string, number>; adjustment: number }
  >();

  const dayEntry = (date: string) => {
    let entry = byDate.get(date);
    if (!entry) {
      entry = { orders: new Map(), payouts: new Map(), adjustment: 0 };
      byDate.set(date, entry);
    }
    return entry;
  };

  for (const o of orders) {
    const entry = dayEntry(o.date);
    const existing = entry.orders.get(o.channel);
    if (existing) {
      existing.orderCount += o.orderCount;
      existing.grossSales += o.grossSales;
      existing.netSales += o.netSales;
      existing.hpp += o.hpp;
    } else {
      entry.orders.set(o.channel, { ...o });
    }
  }

  for (const p of payouts) {
    const entry = dayEntry(p.date);
    entry.payouts.set(p.channel, (entry.payouts.get(p.channel) ?? 0) + p.amount);
  }

  for (const a of adjustments) {
    dayEntry(a.date).adjustment += a.amount;
  }

  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, entry]) => {
      const channels = new Set<string>([...entry.orders.keys(), ...entry.payouts.keys()]);
      const lines: ChannelPnlLine[] = [...channels]
        .sort((a, b) => channelRank(a) - channelRank(b) || a.localeCompare(b))
        .map((channel) => {
          const pos = entry.orders.get(channel) ?? {
            date,
            channel,
            orderCount: 0,
            grossSales: 0,
            netSales: 0,
            hpp: 0,
          };
          const payout = entry.payouts.has(channel) ? entry.payouts.get(channel)! : null;
          const omzet = payout ?? pos.netSales;
          const grossProfit = omzet - pos.hpp;
          return {
            date,
            channel,
            orderCount: pos.orderCount,
            grossSales: pos.grossSales,
            netSales: pos.netSales,
            hpp: pos.hpp,
            payout,
            omzet,
            source: payout !== null ? ("payout" as const) : ("pos" as const),
            grossProfit,
            margin: pos.orderCount > 0 ? marginOf(omzet, grossProfit) : null,
            gap: payout !== null ? payout - pos.netSales : null,
          };
        });

      const hpp = lines.reduce((s, l) => s + l.hpp, 0);
      const omzet = lines.reduce((s, l) => s + l.omzet, 0) + entry.adjustment;
      const grossProfit = omzet - hpp;
      const orderCount = lines.reduce((s, l) => s + l.orderCount, 0);
      return {
        date,
        channels: lines,
        orderCount,
        grossSales: lines.reduce((s, l) => s + l.grossSales, 0),
        posNet: lines.reduce((s, l) => s + l.netSales, 0),
        payout: lines.reduce((s, l) => s + (l.payout ?? 0), 0),
        adjustment: entry.adjustment,
        hpp,
        omzet,
        grossProfit,
        // A day with payouts but no POS orders has no recorded HPP; its
        // grossProfit equals omzet and must not be presented as a 100% margin.
        margin: orderCount > 0 ? marginOf(omzet, grossProfit) : null,
      };
    });
}

/** Period roll-up of {@link buildDailyPnl} rows — totals only, margin weighted. */
export function summarizePnl(days: readonly DailyPnl[]): PnlTotals {
  const totals = days.reduce(
    (acc, d) => ({
      orderCount: acc.orderCount + d.orderCount,
      grossSales: acc.grossSales + d.grossSales,
      posNet: acc.posNet + d.posNet,
      payout: acc.payout + d.payout,
      adjustment: acc.adjustment + d.adjustment,
      hpp: acc.hpp + d.hpp,
      omzet: acc.omzet + d.omzet,
    }),
    {
      orderCount: 0,
      grossSales: 0,
      posNet: 0,
      payout: 0,
      adjustment: 0,
      hpp: 0,
      omzet: 0,
    },
  );
  const grossProfit = totals.omzet - totals.hpp;
  return {
    ...totals,
    grossProfit,
    // Without any POS orders there is no HPP basis for a period margin.
    margin: totals.orderCount > 0 ? marginOf(totals.omzet, grossProfit) : null,
  };
}
