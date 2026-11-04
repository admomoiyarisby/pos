import { createFileRoute } from "@tanstack/react-router";
import { buildTransferInvoiceHtml } from "#/lib/server/scm-transfer-print";
import { printDocumentHandler } from "#/lib/server/print-response";

/**
 * Invoice for one branch-to-branch stock transfer, as a plain GET document.
 * Only exists once the receiver has finished receiving, which the builder
 * reports as a 404 page rather than a blank sheet.
 */
export const Route = createFileRoute("/api/print/transfer/invoice")({
  server: {
    handlers: {
      GET: printDocumentHandler("transferId", buildTransferInvoiceHtml),
    },
  },
});
