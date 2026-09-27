import { sql } from "drizzle-orm";
import type { SQL, SQLWrapper } from "drizzle-orm";

/**
 * Where a stock-out movement came from — the breakdown behind
 * "Rincian Stok Keluar" on the finance page.
 *
 * That panel sums *every* `stock_ledger` OUT row in the period, so a total can
 * legitimately exceed what sales consumed: production, waste and manual
 * adjustments all draw raw ingredients without a sale. Comparing the total to a
 * sales report compares two different things, which is exactly the confusion
 * this breakdown exists to remove.
 *
 * `notes` is the only thing that distinguishes the writers: POS orders and Data
 * Penjualan rows both use a bare `orders.id` as their `reference` and land in
 * the same `orders` table with no source column, so the reference cannot tell
 * them apart. Keep the tags below in step with the `notes:` values at:
 *   - pos.ts            "POS Order …" / "Void Order …" / "Void re-deduct exclusion: …"
 *   - sales-data.ts     "Data Penjualan …"
 *   - waste.ts          "Waste: …" / "Waste dibatalkan …" / "Waste BOM <recipe>"
 *   - yield.ts          "Produksi …" / "Produksi dibatalkan …"
 *   - inventory.ts      "SO Adjustment…" / "SO Realization: …"
 */
export type UsageSource =
  | "POS"
  | "Data Penjualan"
  | "Waste"
  | "Produksi"
  | "Stock Opname"
  | "Lainnya";

/** Display order and copy for the breakdown chips. */
export const USAGE_SOURCE_LABELS = {
  POS: "POS",
  "Data Penjualan": "Data Penjualan",
  Waste: "Waste",
  Produksi: "Produksi",
  "Stock Opname": "Stok Opname",
  Lainnya: "Lainnya",
} satisfies Record<UsageSource, string>;

/** Every source in display order, so the UI does not have to sort them. */
export const USAGE_SOURCE_ORDER: UsageSource[] = [
  "POS",
  "Data Penjualan",
  "Waste",
  "Produksi",
  "Stock Opname",
  "Lainnya",
];

/**
 * SQL expression classifying a `stock_ledger.notes` value into a
 * {@link UsageSource}. This is the single source of truth for the mapping —
 * do not mirror it in TypeScript, or the two will drift.
 *
 * Order matters: the cancellation tags and the `Waste BOM` tag must not be
 * swallowed by the broader prefixes. A NULL note falls through to "Lainnya",
 * which is the honest answer: it was written by something we do not recognise.
 */
export function usageSourceSql(notes: SQLWrapper): SQL<UsageSource> {
  return sql<UsageSource>`CASE
    WHEN ${notes} LIKE 'POS Order%' THEN 'POS'
    WHEN ${notes} LIKE 'Data Penjualan%' THEN 'Data Penjualan'
    WHEN ${notes} LIKE 'Waste BOM%' THEN 'Waste'
    WHEN ${notes} LIKE 'Waste:%' THEN 'Waste'
    WHEN ${notes} LIKE 'Waste dibatalkan%' THEN 'Waste'
    WHEN ${notes} LIKE 'Produksi%' THEN 'Produksi'
    WHEN ${notes} LIKE 'SO %' THEN 'Stock Opname'
    ELSE 'Lainnya'
  END`;
}
