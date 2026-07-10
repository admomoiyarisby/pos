/**
 * Client-side helper to open a print window and write HTML to it.
 * The HTML is expected to include a <script> at the end that calls
 * window.print() and window.close() on load (matching the POS receipt
 * pattern in src/lib/pos-print.ts).
 */
export function openPrintWindow(html: string): void {
  // Try popup first
  const printWindow = window.open("", "_blank");

  if (printWindow) {
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

    // Clean up after print
    setTimeout(() => {
      document.body.removeChild(iframe);
    }, 1000);
  } else {
    // Last resort: open in same window
    const newWindow = window.open("", "_self");
    if (newWindow) {
      newWindow.document.write(html);
      newWindow.document.close();
    }
  }
}
