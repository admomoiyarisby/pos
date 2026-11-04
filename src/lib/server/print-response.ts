import { escapeHtml } from "./html-utils";

/**
 * Responses for the `/api/print/*` documents.
 *
 * A print document opens in its own window and cannot lean on the app shell,
 * the toast stack, or the router's error boundary. Whatever goes wrong has to be
 * *readable on that page* — otherwise the user gets a blank sheet (or Chrome's
 * bare "Failed to fetch") and has nothing to report back. Every print endpoint
 * answers through these helpers so the failures look the same everywhere.
 */

const HTML_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  // A report is a snapshot of one moment; never let a proxy replay an old one.
  "cache-control": "no-store",
};

/** The finished document, which prints itself on load. */
export function printHtmlResponse(html: string): Response {
  return new Response(html, { headers: HTML_HEADERS });
}

/**
 * Handler body for a print document identified by one query parameter.
 *
 * Every `/api/print/*` route is the same three steps — read the id, build the
 * document, explain any failure on the page — so they share this instead of
 * repeating it. `param` is the query key (`soId`, `procurementId`, …) the URL
 * builders in `src/lib/print-links.ts` write.
 */
export function printDocumentHandler(
  param: string,
  build: (id: string) => Promise<string>,
): (context: { request: Request }) => Promise<Response> {
  return async ({ request }) => {
    const id = new URL(request.url).searchParams.get(param);
    if (!id) return printNotFoundResponse();
    try {
      return printHtmlResponse(await build(id));
    } catch (err) {
      // Anything that is not an Error carries no message worth printing; let
      // the framework's 500 page take it.
      if (!(err instanceof Error)) throw err;
      return printFailureResponse(err);
    }
  };
}

/**
 * Turn a print handler's error into a page that explains itself, with the status
 * a caller or a log can act on:
 *
 *  - `Unauthorized` — no session at all: a stale tab, or the cookie expired
 *    between the click and the request.
 *  - `Unauthorized: …` — signed in, but out of scope for this document (branch
 *    access). Those messages are already written for a human.
 *  - `Forbidden…` — signed in, wrong role. The raw message names the user and
 *    their role, which does not belong on a sheet that gets printed and passed
 *    around, so it is replaced with the plain-language version.
 *  - `<domain> not found` — the document's subject is gone (deleted record).
 *  - anything else — a real failure. The DB error boundary has already stripped
 *    the SQL, so the message is safe to show.
 */
export function printFailureResponse(error: Error): Response {
  if (error.message === "Unauthorized") {
    return failurePage(
      "Sesi berakhir",
      "Silakan login ulang di tab Omoiyari POS, lalu cetak ulang.",
      401,
    );
  }
  if (error.message.startsWith("Unauthorized:")) {
    return failurePage("Tidak punya akses", error.message, 403);
  }
  if (error.message.startsWith("Forbidden")) {
    return failurePage(
      "Tidak punya akses",
      "Akun ini tidak dapat mencetak dokumen tersebut. Cetak dari akun dengan peran yang sesuai.",
      403,
    );
  }
  if (error.message.endsWith("not found")) {
    return printNotFoundResponse();
  }
  return failurePage("Gagal membuat dokumen", error.message, 500);
}

/** The record is gone (deleted, or never existed): nothing to print. */
export function printNotFoundResponse(): Response {
  return failurePage("Data tidak ditemukan", "Data yang ingin dicetak sudah tidak ada.", 404);
}

/** Minimal standalone page — the print window has no app shell to lean on. */
function failurePage(title: string, message: string, status: number): Response {
  const html = `<!DOCTYPE html>
<html lang="id"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  body { font-family: 'Helvetica', 'Arial', sans-serif; margin: 0; padding: 56px 24px; text-align: center; color: #111; }
  h1 { font-size: 18px; margin: 0 0 8px; }
  p { font-size: 14px; color: #444; max-width: 48ch; margin: 0 auto; line-height: 1.55; }
</style></head><body>
<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(message)}</p>
</body></html>`;
  return new Response(html, { status, headers: HTML_HEADERS });
}
