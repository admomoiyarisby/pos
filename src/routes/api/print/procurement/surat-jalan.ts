import { createFileRoute } from "@tanstack/react-router";
import { buildProcurementSuratJalanHtml } from "#/lib/server/scm-print";
import { printDocumentHandler } from "#/lib/server/print-response";
import { wantsBlankQtySheet } from "#/lib/print-links";

/**
 * Surat jalan (delivery note) for one procurement, as a plain GET document.
 *
 * Same contract as `/api/print/finance`: the button navigates here instead of
 * fetching the HTML through a server function, so a dropped connection or a
 * strict proxy cannot reduce printing to a "Failed to fetch" toast, and any
 * failure is readable on the page itself.
 *
 * `?blankQty=1` asks for the preparation sheet printed at the review stage —
 * every line still in play, with an empty Qty column the team packing the goods
 * fills in by hand.
 */
export const Route = createFileRoute("/api/print/procurement/surat-jalan")({
  server: {
    handlers: {
      GET: printDocumentHandler("procurementId", (procurementId, params) =>
        buildProcurementSuratJalanHtml(procurementId, {
          blankQuantity: wantsBlankQtySheet(params),
        }),
      ),
    },
  },
});
