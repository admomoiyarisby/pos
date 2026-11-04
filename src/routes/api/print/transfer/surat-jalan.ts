import { createFileRoute } from "@tanstack/react-router";
import { buildTransferSuratJalanHtml } from "#/lib/server/scm-transfer-print";
import { printDocumentHandler } from "#/lib/server/print-response";

/**
 * Surat jalan for one branch-to-branch stock transfer, as a plain GET document.
 * The builder re-checks transfer access, so the URL is not a way around it.
 */
export const Route = createFileRoute("/api/print/transfer/surat-jalan")({
  server: {
    handlers: {
      GET: printDocumentHandler("transferId", buildTransferSuratJalanHtml),
    },
  },
});
