import { createFileRoute } from "@tanstack/react-router";
import { buildProcurementSuratJalanHtml } from "#/lib/server/scm-print";
import { printDocumentHandler } from "#/lib/server/print-response";

/**
 * Surat jalan (delivery note) for one procurement, as a plain GET document.
 *
 * Same contract as `/api/print/finance`: the button navigates here instead of
 * fetching the HTML through a server function, so a dropped connection or a
 * strict proxy cannot reduce printing to a "Failed to fetch" toast, and any
 * failure is readable on the page itself.
 */
export const Route = createFileRoute("/api/print/procurement/surat-jalan")({
  server: {
    handlers: {
      GET: printDocumentHandler("procurementId", buildProcurementSuratJalanHtml),
    },
  },
});
