/**
 * Links to printable documents.
 *
 * Printing is a **navigation**, not an RPC: `/api/print/*` answers with a
 * finished HTML document that calls `window.print()` on load. Keeping the URLs
 * here means a button and its route can never disagree about the path or the
 * query-parameter names.
 */

export const PRINT_FINANCE_PATH = "/api/print/finance";
export const PRINT_STOCK_OPNAME_PATH = "/api/print/stock-opname";
export const PRINT_PROCUREMENT_SURAT_JALAN_PATH = "/api/print/procurement/surat-jalan";
export const PRINT_PROCUREMENT_INVOICE_PATH = "/api/print/procurement/invoice";
export const PRINT_TRANSFER_SURAT_JALAN_PATH = "/api/print/transfer/surat-jalan";
export const PRINT_TRANSFER_INVOICE_PATH = "/api/print/transfer/invoice";

/**
 * Query flag asking for the preparation sheet: the same surat jalan, with the
 * Qty column left empty so it can be filled in by hand.
 */
export const PRINT_BLANK_QTY_PARAM = "blankQty";

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
  return documentUrl(PRINT_STOCK_OPNAME_PATH, "soId", soId);
}

/** Surat jalan (delivery note) for one procurement. */
export function procurementSuratJalanPrintUrl(
  procurementId: string,
  options: { blankQty?: boolean } = {},
): string {
  const url = documentUrl(PRINT_PROCUREMENT_SURAT_JALAN_PATH, "procurementId", procurementId);
  return options.blankQty ? `${url}&${PRINT_BLANK_QTY_PARAM}=1` : url;
}

/**
 * Whether a print request asks for the blank-quantity preparation sheet.
 * Mirrors `procurementSuratJalanPrintUrl`, so the button and the route can never
 * disagree about the flag or its value.
 */
export function wantsBlankQtySheet(params: URLSearchParams): boolean {
  return params.get(PRINT_BLANK_QTY_PARAM) === "1";
}

/** Invoice for one procurement. */
export function procurementInvoicePrintUrl(procurementId: string): string {
  return documentUrl(PRINT_PROCUREMENT_INVOICE_PATH, "procurementId", procurementId);
}

/** Surat jalan for one branch-to-branch stock transfer. */
export function transferSuratJalanPrintUrl(transferId: string): string {
  return documentUrl(PRINT_TRANSFER_SURAT_JALAN_PATH, "transferId", transferId);
}

/** Invoice for one branch-to-branch stock transfer. */
export function transferInvoicePrintUrl(transferId: string): string {
  return documentUrl(PRINT_TRANSFER_INVOICE_PATH, "transferId", transferId);
}

/**
 * One document, one identifying query parameter. Relative on purpose: the print
 * window must stay same-origin so the session cookie rides along.
 */
function documentUrl(path: string, param: string, value: string): string {
  return `${path}?${new URLSearchParams({ [param]: value }).toString()}`;
}
