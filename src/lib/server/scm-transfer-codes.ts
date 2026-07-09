// =============================================================================
// Mutasi Stok code generation helpers (ADR 0006).
//
// Two sequences, both concurrency-safe via row-locking on the parent table:
// - nextTransferCode()         → "MT/<branch>/<ddmmyy>/<serial>"       (1 root per transfer)
// - nextTransferInvoiceCode()  → "INV/<branch>/<ddmmyy>/<serial>"      (1 invoice per transfer)
//
// Uses the shared document code generator for consistent format.
// =============================================================================

import { generateDocumentCode } from "./document-codes";

/**
 * Returns the next "MT/<branch>/<ddmmyy>/<serial>" code for a new transfer, e.g. "MT/TGL/060726/01".
 * Uses the shared document code generator for consistent format.
 */
export async function nextTransferCode(branchCode: string): Promise<string> {
  return generateDocumentCode("MT", branchCode);
}

/**
 * Returns the next "INV/<branch>/<ddmmyy>/<serial>" code for a new transfer invoice.
 * Uses the shared document code generator for consistent format.
 */
export async function nextTransferInvoiceCode(branchCode: string): Promise<string> {
  return generateDocumentCode("INV", branchCode);
}
