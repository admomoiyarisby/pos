import { createFileRoute } from "@tanstack/react-router";
import { buildProcurementInvoiceHtml } from "#/lib/server/scm-print";
import { printDocumentHandler } from "#/lib/server/print-response";

/**
 * Invoice for one procurement, as a plain GET document. Unit prices and money
 * totals are hidden from branch admins inside the builder, exactly as on screen.
 */
export const Route = createFileRoute("/api/print/procurement/invoice")({
  server: {
    handlers: {
      GET: printDocumentHandler("procurementId", buildProcurementInvoiceHtml),
    },
  },
});
