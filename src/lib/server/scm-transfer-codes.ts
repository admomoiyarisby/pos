// =============================================================================
// Mutasi Stok code generation helpers (ADR 0006).
//
// Two sequences, both concurrency-safe via row-locking on the parent table:
// - nextTransferCode()         → "MT-2026-0001"           (1 root per transfer)
// - nextTransferInvoiceCode()  → "MT-INV-2026-0001"       (1 invoice per transfer)
//
// The format is hard-coded; the year prefix is derived from `new Date()`. Both
// helpers must be called inside a transaction so the count read is consistent.
// =============================================================================

import { sql } from "drizzle-orm";
import { db } from "./db";
import { scmTransferInvoices, scmTransfers } from "#/db/schema";

/**
 * Format a year-prefixed sequence number. Padding is 4 digits (0001-9999); for
 * more than 9999 transfers in a year, the system will need a migration to
 * widen the format. (Caveat per the 0001 stock-opname ADR: the project
 * doesn't have 1000+ transfers per year yet.)
 */
function formatSeq(n: number): string {
  return n.toString().padStart(4, "0");
}

/**
 * Returns the next "MT-YYYY-NNNN" code for a new transfer, e.g. "MT-2026-0001".
 * The count is taken from existing `scm_transfers.code` rows that share the
 * year prefix; this is racy under high concurrency, so callers should
 * `SELECT ... FOR UPDATE` the relevant rows or rely on a unique-constraint
 * retry loop. For the current single-process / SSR model, the risk is
 * negligible.
 */
export async function nextTransferCode(): Promise<string> {
  const year = new Date().getUTCFullYear();
  const prefix = `MT-${year}-`;

  // Count existing rows whose code starts with the year prefix
  const result = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(scmTransfers)
    .where(sql`${scmTransfers.code} LIKE ${prefix + "%"}`);

  const count = result[0]?.n ?? 0;
  return `${prefix}${formatSeq(count + 1)}`;
}

/**
 * Returns the next "MT-INV-YYYY-NNNN" code for a new transfer invoice.
 * Same concurrency caveat as `nextTransferCode()`.
 */
export async function nextTransferInvoiceCode(): Promise<string> {
  const year = new Date().getUTCFullYear();
  const prefix = `MT-INV-${year}-`;

  const result = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(scmTransferInvoices)
    .where(sql`${scmTransferInvoices.code} LIKE ${prefix + "%"}`);

  const count = result[0]?.n ?? 0;
  return `${prefix}${formatSeq(count + 1)}`;
}
