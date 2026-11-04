/**
 * Links to printable documents.
 *
 * Printing is a **navigation**, not an RPC: `/api/print/*` answers with a
 * finished HTML document that calls `window.print()` on load. Keeping the URL
 * here means the button and the route can never disagree about the path or the
 * query-parameter names.
 */

export const PRINT_FINANCE_PATH = "/api/print/finance";
export const PRINT_STOCK_OPNAME_PATH = "/api/print/stock-opname";

/** Filters the printable finance report can be narrowed by. */
export interface FinancePrintLinkFilters {
  dateFrom?: string;
  dateTo?: string;
  branchId?: string;
  channel?: string;
}

/**
 * URL of the printable finance report. Empty filters are dropped, so a URL
 * without a query string means "everything", never `dateFrom=undefined`.
 */
export function financePrintUrl(filters: FinancePrintLinkFilters): string {
  const params = new URLSearchParams();
  if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) params.set("dateTo", filters.dateTo);
  if (filters.branchId) params.set("branchId", filters.branchId);
  if (filters.channel) params.set("channel", filters.channel);
  const query = params.toString();
  return query ? `${PRINT_FINANCE_PATH}?${query}` : PRINT_FINANCE_PATH;
}

/** URL of the printable stock-opname sheet for one stock opname. */
export function stockOpnamePrintUrl(soId: string): string {
  return `${PRINT_STOCK_OPNAME_PATH}?${new URLSearchParams({ soId }).toString()}`;
}
