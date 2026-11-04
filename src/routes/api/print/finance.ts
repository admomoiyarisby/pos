import { createFileRoute } from "@tanstack/react-router";
import { buildFinancePrintHtml } from "#/lib/server/finance";
import { printFailureResponse, printHtmlResponse } from "#/lib/server/print-response";

/**
 * Printable finance report (A4), as a plain GET document.
 *
 * The Cetak PDF button opens this URL in its own window instead of asking a
 * server function for the HTML and writing it into a blank popup. Reasons, in
 * order of how often they bite:
 *
 *  - A navigation survives what an RPC does not. If the browser, a proxy, or the
 *    Wi-Fi drops the request, the print window says so and can be reloaded; a
 *    dropped `fetch` only produced a "Failed to fetch" toast with no document.
 *  - The report is reloadable and shareable — support can be handed a URL.
 *  - Failures land *in the print window*, where the user is already looking.
 *
 * Auth is the session cookie (same as any page), so a signed-out or wrong-role
 * user gets a readable page rather than an empty sheet.
 */
export const Route = createFileRoute("/api/print/finance")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        try {
          return printHtmlResponse(
            await buildFinancePrintHtml({
              dateFrom: url.searchParams.get("dateFrom") ?? undefined,
              dateTo: url.searchParams.get("dateTo") ?? undefined,
              branchId: url.searchParams.get("branchId") ?? undefined,
              channel: url.searchParams.get("channel") ?? undefined,
            }),
          );
        } catch (err) {
          // Anything that is not an Error carries no message worth printing;
          // let the framework's 500 page take it.
          if (!(err instanceof Error)) throw err;
          return printFailureResponse(err);
        }
      },
    },
  },
});
