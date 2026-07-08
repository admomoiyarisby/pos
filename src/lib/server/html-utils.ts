/**
 * Shared HTML utilities for server-side PDF/print generation.
 *
 * Used by printStockOpname, printFinancePage, and future print functions.
 */

/**
 * Escape HTML special characters to prevent XSS in generated HTML.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Format a number as Indonesian Rupiah (absolute value, no sign).
 */
export function formatRupiah(value: number): string {
  return `Rp${Math.abs(value).toLocaleString("id-ID")}`;
}

/**
 * Build a complete HTML document for browser print (Save as PDF).
 * Wraps the body content with standard Omoiyari POS print styling.
 *
 * @param title - Document title (shown in browser tab and print header)
 * @param bodyHtml - The inner HTML content
 * @param orientation - Page orientation: "portrait" (default) or "landscape"
 */
export function buildPrintHtml(
  title: string,
  bodyHtml: string,
  orientation: "portrait" | "landscape" = "portrait",
): string {
  const size = orientation === "landscape" ? "A4 landscape" : "A4";

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  @page { size: ${size}; margin: 1.5cm; }
  body { font-family: 'Helvetica', 'Arial', sans-serif; font-size: 10pt; color: #000; margin: 0; padding: 0; }
  .header { border-bottom: 2px solid #000; padding-bottom: 8pt; margin-bottom: 16pt; }
  .header-flex { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #000; padding-bottom: 8pt; margin-bottom: 16pt; }
  .title { font-size: 18pt; font-weight: bold; }
  .subtitle { font-size: 9pt; color: #555; margin-top: 2pt; }
  .meta { text-align: right; font-size: 10pt; }
  .meta strong { font-size: 11pt; }
  .cards { display: flex; flex-wrap: wrap; gap: 12pt; margin-bottom: 16pt; }
  .card { border: 1px solid #ddd; border-radius: 4pt; padding: 10pt 14pt; flex: 1; min-width: 140pt; }
  .card-label { font-size: 8pt; color: #888; text-transform: uppercase; letter-spacing: 0.5pt; }
  .card-value { font-size: 14pt; font-weight: bold; margin-top: 4pt; }
  .card-value.green { color: #16a34a; }
  .card-value.red { color: #dc2626; }
  .section-title { font-size: 12pt; font-weight: bold; margin-top: 20pt; margin-bottom: 8pt; border-bottom: 1px solid #eee; padding-bottom: 4pt; }
  table { width: 100%; border-collapse: collapse; margin-top: 8pt; }
  th { background: #f0f0f0; font-weight: bold; padding: 6pt 8pt; border: 1px solid #ccc; text-align: left; font-size: 9pt; }
  td { padding: 5pt 8pt; border: 1px solid #ddd; font-size: 9pt; }
  .summary-table { margin-top: 16pt; }
  .summary-table td.label { font-weight: bold; padding: 4pt 8pt; border: none; }
  .summary-table td.value { text-align: right; font-weight: bold; padding: 4pt 8pt; border: none; }
  .signature { margin-top: 40pt; display: flex; justify-content: space-between; }
  .signature div { width: 30%; }
  .signature p { margin: 0; font-size: 10pt; }
  .signature .line { border-top: 1px solid #000; margin-top: 36pt; padding-top: 4pt; font-size: 10pt; text-align: center; }
  .footer { position: fixed; bottom: 0; left: 0; right: 0; text-align: center; font-size: 8pt; color: #999; padding: 8pt; border-top: 1px solid #eee; }
</style>
</head><body>
${bodyHtml}
<div class="footer">Dicetak dari Omoiyari POS — ${new Date().toLocaleDateString("id-ID")}</div>
<script>window.print();window.close();</script>
</body></html>`;
}
