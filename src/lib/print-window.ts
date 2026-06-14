/**
 * Client-side helper to open a print window and write HTML to it.
 * The HTML is expected to include a <script> at the end that calls
 * window.print() and window.close() on load (matching the POS receipt
 * pattern in src/lib/pos-print.ts).
 */
export function openPrintWindow(html: string): void {
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    alert("Popup diblokir. Mohon izinkan popup untuk mencetak.");
    return;
  }
  printWindow.document.write(html);
  printWindow.document.close();
}
