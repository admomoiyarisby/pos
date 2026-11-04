import { createFileRoute } from "@tanstack/react-router";
import { buildStockOpnamePrintHtml } from "#/lib/server/inventory";
import { printDocumentHandler } from "#/lib/server/print-response";

/**
 * Printable stock-opname sheet (A4 landscape), as a plain GET document.
 *
 * Same reason as `/api/print/finance`: the Cetak PDF button opens this URL in
 * its own window instead of fetching the HTML through a server function, so a
 * dropped connection or a strict proxy cannot reduce printing to a
 * "Failed to fetch" toast, and a failure is readable on the page itself.
 *
 * `soId` is the stock opname the detail page is showing; the builder re-checks
 * branch scope, so the URL is not a way around `getStockOpnameDetail`.
 */
export const Route = createFileRoute("/api/print/stock-opname")({
  server: {
    handlers: {
      GET: printDocumentHandler("soId", buildStockOpnamePrintHtml),
    },
  },
});
