import { toast } from "sonner";

/**
 * Client-side helper to open a print window and write HTML to it.
 * The HTML is expected to include a <script> at the end that calls
 * window.print() and window.close() on load (matching the POS receipt
 * pattern in src/lib/pos-print.ts).
 *
 * Prefer `openPrintDocument` + a `/api/print/*` URL where the document exists
 * server-side: this path needs a server function to succeed first.
 */
export function openPrintWindow(html: string): void {
  // Try popup first
  const printWindow = window.open("", "_blank");

  if (printWindow) {
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    return;
  }

  // Fallback: use iframe for popup-blocked browsers
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "none";
  document.body.appendChild(iframe);

  const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
  if (iframeDoc) {
    iframeDoc.open();
    iframeDoc.write(html);
    iframeDoc.close();

    // Clean up after print dialog closes
    const cleanup = () => {
      if (iframe.parentNode) {
        document.body.removeChild(iframe);
      }
    };
    iframe.contentWindow?.addEventListener("afterprint", cleanup);
    // Fallback cleanup after 5 seconds
    setTimeout(cleanup, 5000);
  } else {
    // Last resort: open in same window
    const newWindow = window.open("", "_self");
    if (newWindow) {
      newWindow.document.write(html);
      newWindow.document.close();
    }
  }
}

/**
 * Open a print document URL in its own window and let the document print
 * itself on load.
 *
 * Preferred over `openPrintWindow(html)` wherever the document can be a URL:
 * nothing has to be fetched by script first, so a flaky connection, a strict
 * proxy, or an antivirus HTTPS scanner cannot turn "Cetak PDF" into a silent
 * `TypeError: Failed to fetch`. The window is also reloadable, which is what a
 * user reaches for after any failure.
 *
 * Returns false when the pop-up was blocked. Deliberately no hidden-iframe
 * fallback: a print job that appears from nowhere — or, worse, prints the page
 * behind it — is harder to diagnose than the one instruction the user needs.
 * The caller turns false into "allow pop-ups, then print again", the same
 * wording the thermal-receipt fallback uses (src/lib/pos-print.ts).
 */
export function openPrintUrl(url: string): boolean {
  return window.open(url, "_blank") !== null;
}

/**
 * Open a print document, or tell the user why it did not happen.
 *
 * Every print button goes through this so a blocked pop-up always produces the
 * same instruction instead of a button that appears to do nothing.
 */
export function openPrintDocument(url: string): void {
  if (openPrintUrl(url)) return;
  toast.error("Jendela cetak diblokir", {
    description: "Izinkan pop-up untuk situs ini, lalu cetak ulang.",
  });
}
