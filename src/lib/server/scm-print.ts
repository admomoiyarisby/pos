import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { requireAuth } from "./auth";
import {
  branches,
  ingredients,
  scmProcurementInvoices,
  scmProcurementItems,
  scmProcurements,
  users,
} from "#/db/schema";

// =============================================================================
// Surat Jalan (Delivery Note)
// =============================================================================

interface SuratJalanItem {
  id: string;
  ingredientName: string;
  pickedQuantity: number | null;
}

interface SuratJalanData {
  code: string;
  shippedAt: Date | null;
  createdAt: Date;
  items: SuratJalanItem[];
  sourceBranchName: string;
  destBranchName: string;
}

function buildSuratJalanHtml(d: SuratJalanData): string {
  const date = d.shippedAt
    ? new Date(d.shippedAt).toLocaleDateString("id-ID")
    : new Date(d.createdAt).toLocaleDateString("id-ID");

  const rows = d.items
    .filter((it) => (it.pickedQuantity ?? 0) > 0)
    .map(
      (it, idx) => `
        <tr>
          <td style="text-align:center;">${idx + 1}</td>
          <td>${escapeHtml(it.ingredientName)}</td>
          <td style="text-align:right;">${it.pickedQuantity ?? 0}</td>
          <td style="text-align:left;"></td>
        </tr>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Surat Jalan ${escapeHtml(d.code)}</title>
<style>
  @page { size: A4 portrait; margin: 1.5cm; }
  body { font-family: 'Helvetica', 'Arial', sans-serif; font-size: 11pt; color: #000; margin: 0; padding: 0; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #000; padding-bottom: 8pt; }
  .title { font-size: 18pt; font-weight: bold; }
  .subtitle { font-size: 9pt; color: #555; }
  .meta { text-align: right; font-size: 10pt; }
  .meta strong { font-size: 11pt; }
  .info { display: flex; gap: 24pt; margin: 16pt 0; }
  .info-block { flex: 1; }
  .info-label { font-size: 9pt; color: #666; text-transform: uppercase; letter-spacing: 0.5pt; }
  .info-value { font-size: 11pt; font-weight: 500; margin-top: 2pt; }
  table { width: 100%; border-collapse: collapse; margin-top: 12pt; }
  thead th { background: #f0f0f0; padding: 8pt; text-align: left; border-bottom: 1.5pt solid #000; font-size: 10pt; }
  tbody td { padding: 6pt 8pt; border-bottom: 0.5pt solid #ccc; }
  .signatures { display: flex; justify-content: space-around; margin-top: 48pt; }
  .sig-block { text-align: center; min-width: 200pt; }
  .sig-line { margin-top: 48pt; border-top: 1pt solid #000; padding-top: 4pt; }
  .empty { text-align: center; color: #999; padding: 16pt; }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div class="title">SURAT JALAN</div>
      <div class="subtitle">Omoiyari POS</div>
    </div>
    <div class="meta">
      <div>No: <strong>${escapeHtml(d.code)}</strong></div>
      <div>Tanggal: ${escapeHtml(date)}</div>
    </div>
  </div>

  <div class="info">
    <div class="info-block">
      <div class="info-label">Dari</div>
      <div class="info-value">${escapeHtml(d.sourceBranchName)}</div>
    </div>
    <div class="info-block">
      <div class="info-label">Kepada</div>
      <div class="info-value">${escapeHtml(d.destBranchName)}</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width:30pt;">No</th>
        <th>Bahan</th>
        <th style="width:60pt; text-align:right;">Qty</th>
        <th style="width:80pt;">Satuan</th>
      </tr>
    </thead>
    <tbody>
      ${rows || `<tr><td colspan="4" class="empty">Tidak ada item yang dikirim.</td></tr>`}
    </tbody>
  </table>

  <div class="signatures">
    <div class="sig-block">
      <div>Pengirim,</div>
      <div class="sig-line">${escapeHtml(d.sourceBranchName)}</div>
    </div>
    <div class="sig-block">
      <div>Penerima,</div>
      <div class="sig-line">${escapeHtml(d.destBranchName)}</div>
    </div>
  </div>

  <script>window.onload = function() { window.print(); setTimeout(function() { window.close(); }, 500); }</script>
</body></html>`;
}

export const printSuratJalan = createServerFn({ method: "GET" })
  .validator((data: { procurementId: string }) => data)
  .handler(async ({ data }) => {
    await requireAuth();

    const [proc] = await db
      .select()
      .from(scmProcurements)
      .where(eq(scmProcurements.id, data.procurementId))
      .limit(1);
    if (!proc) throw new Error("Procurement not found");

    const items = await db
      .select({
        id: scmProcurementItems.id,
        ingredientName: ingredients.name,
        pickedQuantity: scmProcurementItems.pickedQuantity,
      })
      .from(scmProcurementItems)
      .innerJoin(ingredients, eq(ingredients.id, scmProcurementItems.ingredientId))
      .where(eq(scmProcurementItems.scmProcurementId, data.procurementId));

    const allBranches = await db.select().from(branches);
    const dest = allBranches.find((b) => b.id === proc.branchId);
    const central = allBranches.find((b) => b.type === "Central");

    return buildSuratJalanHtml({
      code: proc.code,
      shippedAt: proc.shippedAt,
      createdAt: proc.createdAt,
      items,
      sourceBranchName: central?.name ?? "Central Kitchen",
      destBranchName: dest?.name ?? "-",
    });
  });

// =============================================================================
// Invoice SCM
// =============================================================================

interface InvoiceLineItem {
  ingredientName: string;
  receivedQuantity: number;
  rejectedQuantity: number;
  unitPrice: number;
  lineTotal: number;
  reason: string | null;
}

interface InvoiceData {
  code: string;
  generatedAt: Date;
  paidAt: Date | null;
  totalAmount: number;
  sourceBranchName: string;
  destBranchName: string;
  requestedByName: string | null;
  requestSource: string | null;
  lineItems: InvoiceLineItem[];
  /** Per-unit prices are the HPP snapshot — hidden for branch_admin. */
  showUnitPrice: boolean;
}

function buildInvoiceHtml(d: InvoiceData): string {
  const accepted = d.lineItems.filter((li) => li.lineTotal > 0);
  const rejected = d.lineItems.filter((li) => li.rejectedQuantity > 0);

  const acceptedRows = accepted
    .map(
      (li, idx) => `
        <tr>
          <td style="text-align:center;">${idx + 1}</td>
          <td>${escapeHtml(li.ingredientName)}</td>
          <td style="text-align:right;">${li.receivedQuantity}</td>
          ${d.showUnitPrice ? `<td style="text-align:right;">Rp ${li.unitPrice.toLocaleString("id-ID")}</td>` : ""}
          <td style="text-align:right;">Rp ${li.lineTotal.toLocaleString("id-ID")}</td>
        </tr>`,
    )
    .join("");

  const rejectedRows = rejected
    .map(
      (li, idx) => `
        <tr>
          <td style="text-align:center;">${idx + 1}</td>
          <td>${escapeHtml(li.ingredientName)}</td>
          <td style="text-align:right;">${li.rejectedQuantity}</td>
          <td>${escapeHtml(li.reason ?? "-")}</td>
        </tr>`,
    )
    .join("");

  const totalQtyAccepted = accepted.reduce((s, li) => s + li.receivedQuantity, 0);

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Invoice ${escapeHtml(d.code)}</title>
<style>
  @page { size: A4 portrait; margin: 1.5cm; }
  body { font-family: 'Helvetica', 'Arial', sans-serif; font-size: 11pt; color: #000; margin: 0; padding: 0; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #000; padding-bottom: 8pt; }
  .title { font-size: 18pt; font-weight: bold; }
  .subtitle { font-size: 9pt; color: #555; }
  .meta { text-align: right; font-size: 10pt; }
  .meta strong { font-size: 11pt; }
  .paid { color: #067647; font-weight: bold; }
  .unpaid { color: #a16207; font-weight: bold; }
  .info { display: flex; gap: 24pt; margin: 16pt 0; }
  .info-block { flex: 1; }
  .info-label { font-size: 9pt; color: #666; text-transform: uppercase; letter-spacing: 0.5pt; }
  .info-value { font-size: 11pt; font-weight: 500; margin-top: 2pt; }
  h2 { font-size: 12pt; margin: 16pt 0 4pt 0; padding: 4pt 8pt; background: #f0f0f0; border-left: 4pt solid #000; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 8pt; }
  thead th { background: #f0f0f0; padding: 8pt; text-align: left; border-bottom: 1.5pt solid #000; font-size: 10pt; }
  tbody td { padding: 6pt 8pt; border-bottom: 0.5pt solid #ccc; }
  .total-row td { font-weight: bold; background: #fafafa; border-top: 1pt solid #000; }
  .grand { display: flex; justify-content: flex-end; margin-top: 16pt; padding-top: 8pt; border-top: 2pt solid #000; }
  .grand-box { min-width: 250pt; }
  .grand-row { display: flex; justify-content: space-between; font-size: 13pt; font-weight: bold; padding: 4pt 8pt; }
  .signatures { display: flex; justify-content: space-around; margin-top: 48pt; }
  .sig-block { text-align: center; min-width: 200pt; }
  .sig-line { margin-top: 48pt; border-top: 1pt solid #000; padding-top: 4pt; }
  .empty { text-align: center; color: #999; padding: 16pt; }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div class="title">INVOICE</div>
      <div class="subtitle">Omoiyari POS</div>
    </div>
    <div class="meta">
      <div>No Invoice: <strong>INV-${escapeHtml(d.code)}</strong></div>
      <div>No Pengadaan: ${escapeHtml(d.code)}</div>
      <div>Tanggal: ${new Date(d.generatedAt).toLocaleDateString("id-ID")}</div>
      <div class="${d.paidAt ? "paid" : "unpaid"}">
        ${d.paidAt ? `LUNAS — ${new Date(d.paidAt).toLocaleDateString("id-ID")}` : "BELUM DIBAYAR"}
      </div>
    </div>
  </div>

  <div class="info">
    <div class="info-block">
      <div class="info-label">Dari</div>
      <div class="info-value">${escapeHtml(d.sourceBranchName)}</div>
    </div>
    <div class="info-block">
      <div class="info-label">Kepada</div>
      <div class="info-value">${escapeHtml(d.destBranchName)}</div>
    </div>
  </div>

  <div class="info">
    <div class="info-block">
      <div class="info-label">Pemohon</div>
      <div class="info-value">${escapeHtml(d.requestedByName ?? "-")}</div>
    </div>
    <div class="info-block">
      <div class="info-label">Sumber</div>
      <div class="info-value">${escapeHtml(d.requestSource ?? "-")}</div>
    </div>
  </div>

  <h2>Diterima</h2>
  <table>
    <thead>
      <tr>
        <th style="width:30pt;">No</th>
        <th>Bahan</th>
        <th style="width:50pt; text-align:right;">Qty</th>
        ${d.showUnitPrice ? `<th style="width:90pt; text-align:right;">Harga</th>` : ""}
        <th style="width:100pt; text-align:right;">Subtotal</th>
      </tr>
    </thead>
    <tbody>
      ${acceptedRows || `<tr><td colspan="${d.showUnitPrice ? 5 : 4}" class="empty">Tidak ada item diterima.</td></tr>`}
      ${
        accepted.length > 0
          ? `<tr class="total-row">
               <td colspan="2" style="text-align:right;">Subtotal diterima (${totalQtyAccepted}):</td>
               <td colspan="${d.showUnitPrice ? 3 : 2}" style="text-align:right;">Rp ${d.totalAmount.toLocaleString("id-ID")}</td>
             </tr>`
          : ""
      }
    </tbody>
  </table>

  ${
    rejected.length > 0
      ? `
    <h2>Ditolak (Rp 0)</h2>
    <table>
      <thead>
        <tr>
          <th style="width:30pt;">No</th>
          <th>Bahan</th>
          <th style="width:50pt; text-align:right;">Qty</th>
          <th>Alasan</th>
        </tr>
      </thead>
      <tbody>
        ${rejectedRows}
      </tbody>
    </table>`
      : ""
  }

  <div class="grand">
    <div class="grand-box">
      <div class="grand-row">
        <span>TOTAL:</span>
        <span>Rp ${d.totalAmount.toLocaleString("id-ID")}</span>
      </div>
    </div>
  </div>

  <div class="signatures">
    <div class="sig-block">
      <div>Diterima oleh,</div>
      <div class="sig-line">${escapeHtml(d.destBranchName)}</div>
    </div>
    <div class="sig-block">
      <div>Dibayar oleh,</div>
      <div class="sig-line">${escapeHtml(d.sourceBranchName)}</div>
    </div>
  </div>

  <script>window.onload = function() { window.print(); setTimeout(function() { window.close(); }, 500); }</script>
</body></html>`;
}

export const printInvoice = createServerFn({ method: "GET" })
  .validator((data: { procurementId: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuth();

    const [proc] = await db
      .select()
      .from(scmProcurements)
      .where(eq(scmProcurements.id, data.procurementId))
      .limit(1);
    if (!proc) throw new Error("Procurement not found");

    const [invoice] = await db
      .select()
      .from(scmProcurementInvoices)
      .where(eq(scmProcurementInvoices.scmProcurementId, data.procurementId))
      .limit(1);
    if (!invoice) throw new Error("Invoice not found for this procurement");

    const lineItems = z
      .array(
        z.object({
          ingredientName: z.string(),
          receivedQuantity: z.number(),
          rejectedQuantity: z.number(),
          unitPrice: z.number(),
          lineTotal: z.number(),
          reason: z.string().nullable(),
        }),
      )
      .catch([])
      .parse(invoice.lineItems);

    // Fetch requester name
    const [requester] = proc.requestedById
      ? await db
          .select({ name: users.name })
          .from(users)
          .where(eq(users.id, proc.requestedById))
          .limit(1)
      : [];

    const allBranches = await db.select().from(branches);
    const dest = allBranches.find((b) => b.id === proc.branchId);
    const central = allBranches.find((b) => b.type === "Central");

    return buildInvoiceHtml({
      code: proc.code,
      generatedAt: invoice.generatedAt,
      paidAt: invoice.paidAt,
      totalAmount: invoice.totalAmount,
      lineItems,
      sourceBranchName: central?.name ?? "Central Kitchen",
      destBranchName: dest?.name ?? "-",
      requestedByName: requester?.name ?? null,
      requestSource: proc.requestSource ?? null,
      showUnitPrice: user.role !== "branch_admin",
    });
  });

// =============================================================================
// Helpers
// =============================================================================

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
