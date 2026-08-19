import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { requireAuth } from "./auth";
import {
  branches,
  ingredients,
  scmTransferInvoices,
  scmTransferItems,
  scmTransfers,
} from "#/db/schema";
import { assertTransferAccess } from "./scm-transfer-queries";

// =============================================================================
// Surat Jalan (Branch→Branch transfer manifest)
//
// The printable SJ shows the Sender's *promise* (transfer_item.quantity) and
// leaves a "Diterima" column for the Receiver to fill in by hand. The full
// per-line received/rejected numbers are captured at `finish-receive` and
// reflected in the Invoice, not on the SJ print.
// =============================================================================

interface MutasiSuratJalanItem {
  id: string;
  ingredientName: string;
  quantity: number;
}

interface MutasiSuratJalanData {
  code: string;
  shippedAt: Date | null;
  createdAt: Date;
  items: MutasiSuratJalanItem[];
  fromBranchName: string;
  toBranchName: string;
}

function buildMutasiSuratJalanHtml(d: MutasiSuratJalanData): string {
  const date = d.shippedAt
    ? new Date(d.shippedAt).toLocaleDateString("id-ID")
    : new Date(d.createdAt).toLocaleDateString("id-ID");

  const rows = d.items
    .filter((it) => it.quantity > 0)
    .map(
      (it, idx) => `
        <tr>
          <td style="text-align:center;">${idx + 1}</td>
          <td>${escapeHtml(it.ingredientName)}</td>
          <td style="text-align:right;">${it.quantity}</td>
          <td style="text-align:left;"></td>
        </tr>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Surat Jalan Mutasi ${escapeHtml(d.code)}</title>
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
      <div class="title">SURAT JALAN MUTASI</div>
      <div class="subtitle">Omoiyari POS</div>
    </div>
    <div class="meta">
      <div>No: <strong>${escapeHtml(d.code)}</strong></div>
      <div>Tanggal: ${escapeHtml(date)}</div>
    </div>
  </div>

  <div class="info">
    <div class="info-block">
      <div class="info-label">Pengirim (Dari)</div>
      <div class="info-value">${escapeHtml(d.fromBranchName)}</div>
    </div>
    <div class="info-block">
      <div class="info-label">Penerima (Kepada)</div>
      <div class="info-value">${escapeHtml(d.toBranchName)}</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width:30pt;">No</th>
        <th>Bahan</th>
        <th style="width:60pt; text-align:right;">Qty Janji</th>
        <th style="width:80pt;">Diterima (diisi penerima)</th>
      </tr>
    </thead>
    <tbody>
      ${rows || `<tr><td colspan="4" class="empty">Tidak ada item yang dikirim.</td></tr>`}
    </tbody>
  </table>

  <div class="signatures">
    <div class="sig-block">
      <div>Pengirim,</div>
      <div class="sig-line">${escapeHtml(d.fromBranchName)}</div>
    </div>
    <div class="sig-block">
      <div>Penerima,</div>
      <div class="sig-line">${escapeHtml(d.toBranchName)}</div>
    </div>
  </div>

  <script>window.onload = function() { window.print(); setTimeout(function() { window.close(); }, 500); }</script>
</body></html>`;
}

export const printMutasiSuratJalan = createServerFn({ method: "GET" })
  .validator((data: { transferId: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuth();

    const [tr] = await db
      .select()
      .from(scmTransfers)
      .where(eq(scmTransfers.id, data.transferId))
      .limit(1);
    if (!tr) throw new Error("Mutasi transfer not found");

    assertTransferAccess(user, tr, "view");

    const items = await db
      .select({
        id: scmTransferItems.id,
        ingredientName: ingredients.name,
        quantity: scmTransferItems.quantity,
      })
      .from(scmTransferItems)
      .innerJoin(ingredients, eq(ingredients.id, scmTransferItems.ingredientId))
      .where(eq(scmTransferItems.scmTransferId, data.transferId));

    const allBranches = await db.select().from(branches);
    const from = allBranches.find((b) => b.id === tr.fromBranchId);
    const to = allBranches.find((b) => b.id === tr.toBranchId);

    return buildMutasiSuratJalanHtml({
      code: tr.code,
      shippedAt: tr.shippedAt,
      createdAt: tr.createdAt,
      items,
      fromBranchName: from?.name ?? tr.fromBranchId,
      toBranchName: to?.name ?? tr.toBranchId,
    });
  });

// =============================================================================
// Invoice Mutasi (Branch→Branch B2B bill)
//
// Q13: rejected stock is written to waste_entries at the Receiver (Pengadaan
// pattern). The invoice is paid by the Receiver to the Sender. Signature
// blocks reflect the inversion: "Dibayar oleh: <Receiver>" / "Diterima
// oleh: <Sender>".
// =============================================================================

interface MutasiInvoiceLineItem {
  ingredientName: string;
  receivedQuantity: number;
  rejectedQuantity: number;
  unitPrice: number;
  lineTotal: number;
  reason: string | null;
}

interface MutasiInvoiceData {
  code: string;
  transferCode: string;
  generatedAt: Date;
  paidAt: Date | null;
  totalAmount: number;
  fromBranchName: string;
  toBranchName: string;
  lineItems: MutasiInvoiceLineItem[];
}

function buildMutasiInvoiceHtml(d: MutasiInvoiceData): string {
  const accepted = d.lineItems.filter((li) => li.lineTotal > 0);
  const rejected = d.lineItems.filter((li) => li.rejectedQuantity > 0);

  const acceptedRows = accepted
    .map(
      (li, idx) => `
        <tr>
          <td style="text-align:center;">${idx + 1}</td>
          <td>${escapeHtml(li.ingredientName)}</td>
          <td style="text-align:right;">${li.receivedQuantity}</td>
          <td style="text-align:right;">Rp ${li.unitPrice.toLocaleString("id-ID")}</td>
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
<html><head><meta charset="utf-8"><title>Invoice Mutasi ${escapeHtml(d.code)}</title>
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
      <div class="title">INVOICE MUTASI STOK</div>
      <div class="subtitle">Omoiyari POS</div>
    </div>
    <div class="meta">
      <div>No Invoice: <strong>${escapeHtml(d.code)}</strong></div>
      <div>No Mutasi: <strong>${escapeHtml(d.transferCode)}</strong></div>
      <div>Tanggal: ${new Date(d.generatedAt).toLocaleDateString("id-ID")}</div>
      <div class="${d.paidAt ? "paid" : "unpaid"}">
        ${d.paidAt ? `LUNAS — ${new Date(d.paidAt).toLocaleDateString("id-ID")}` : "BELUM DIBAYAR"}
      </div>
    </div>
  </div>

  <div class="info">
    <div class="info-block">
      <div class="info-label">Dari (Penerima Pembayaran)</div>
      <div class="info-value">${escapeHtml(d.fromBranchName)}</div>
    </div>
    <div class="info-block">
      <div class="info-label">Kepada (Pembayar)</div>
      <div class="info-value">${escapeHtml(d.toBranchName)}</div>
    </div>
  </div>

  <h2>Diterima</h2>
  <table>
    <thead>
      <tr>
        <th style="width:30pt;">No</th>
        <th>Bahan</th>
        <th style="width:50pt; text-align:right;">Qty</th>
        <th style="width:90pt; text-align:right;">Harga</th>
        <th style="width:100pt; text-align:right;">Subtotal</th>
      </tr>
    </thead>
    <tbody>
      ${acceptedRows || `<tr><td colspan="5" class="empty">Tidak ada item diterima.</td></tr>`}
      ${
        accepted.length > 0
          ? `<tr class="total-row">
               <td colspan="2" style="text-align:right;">Subtotal diterima (${totalQtyAccepted}):</td>
               <td colspan="3" style="text-align:right;">Rp ${d.totalAmount.toLocaleString("id-ID")}</td>
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
      <div class="sig-line">${escapeHtml(d.toBranchName)} (Penerima Barang)</div>
    </div>
    <div class="sig-block">
      <div>Dibayar oleh,</div>
      <div class="sig-line">${escapeHtml(d.toBranchName)}</div>
    </div>
  </div>

  <script>window.onload = function() { window.print(); setTimeout(function() { window.close(); }, 500); }</script>
</body></html>`;
}

export const printMutasiInvoice = createServerFn({ method: "GET" })
  .validator((data: { transferId: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuth();

    const [tr] = await db
      .select()
      .from(scmTransfers)
      .where(eq(scmTransfers.id, data.transferId))
      .limit(1);
    if (!tr) throw new Error("Mutasi transfer not found");

    assertTransferAccess(user, tr, "view");

    const [invoice] = await db
      .select()
      .from(scmTransferInvoices)
      .where(eq(scmTransferInvoices.scmTransferId, data.transferId))
      .limit(1);
    if (!invoice) throw new Error("No invoice has been generated for this transfer yet");

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

    const allBranches = await db.select().from(branches);
    const from = allBranches.find((b) => b.id === tr.fromBranchId);
    const to = allBranches.find((b) => b.id === tr.toBranchId);

    return buildMutasiInvoiceHtml({
      code: invoice.code,
      transferCode: tr.code,
      generatedAt: invoice.createdAt,
      paidAt: invoice.paidAt,
      totalAmount: invoice.totalAmount,
      fromBranchName: from?.name ?? tr.fromBranchId,
      toBranchName: to?.name ?? tr.toBranchId,
      lineItems: lineItems.map((li) => ({
        ingredientName: li.ingredientName ?? "",
        receivedQuantity: li.receivedQuantity ?? 0,
        rejectedQuantity: li.rejectedQuantity ?? 0,
        unitPrice: li.unitPrice ?? 0,
        lineTotal: li.lineTotal ?? 0,
        reason: li.reason ?? null,
      })),
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
