// ============================================================
// POS Print Utilities — receipt and bill generation
// ============================================================

import { toast } from "sonner";

import { printViaBridge } from "./print-bridge";
import type { BridgeBlock } from "./print-bridge";
import type { CartItem, OrderResult } from "./pos-types";

interface PrintBillParams {
  cartItems: CartItem[];
  branchName: string;
  /** Outlet address (branches.location) — printed under the brand name. */
  branchAddress?: string | null;
  /** Outlet phone (branches.phone) — printed under the address. */
  branchPhone?: string | null;
  subtotal: number;
  voucherDiscount: number;
  taxAmount: number;
  finalTotal: number;
  /** Customer name for the pre-checkout bill (dine-in). Omit to show "-". */
  customerName?: string;
  /** External order code (delivery platforms). Omit to show "-". */
  orderCode?: string;
}

interface PrintReceiptParams {
  order: OrderResult;
  cartItems: CartItem[];
  branchName: string;
  /** Outlet address (branches.location) — printed under the brand name. */
  branchAddress?: string | null;
  /** Outlet phone (branches.phone) — printed under the address. */
  branchPhone?: string | null;
}

// Thermal receipt paper is 57mm wide; keep ~2mm padding each side so the
// printable content is ~53mm.
const RECEIPT_WIDTH_MM = 57;

/**
 * Receipt item layout: Jumlah | Nama menu | Harga, with add-ons (modifiers)
 * indented under the item name. Shared by the customer receipt only — the
 * dine-in bill keeps its own Nama | Qty | Harga layout.
 */
function buildReceiptItemsHtml(cartItems: CartItem[]): string {
  let itemsHtml = "";
  for (let i = 0; i < cartItems.length; i++) {
    let item = cartItems[i];
    let addonLines = "";
    if (item.modifiers.length > 0) {
      let parts: string[] = [];
      for (let j = 0; j < item.modifiers.length; j++) {
        let m = item.modifiers[j];
        parts.push((m.isExclusion ? "X " : "+ ") + m.name);
      }
      addonLines =
        '<div style="font-size: 10px; color: #444; padding-left: 8mm;">' +
        parts.join("<br>") +
        "</div>";
    }
    let noteLine = item.notes
      ? '<div style="font-size: 10px; font-style: italic; color: #666; padding-left: 8mm;">Note: ' +
        item.notes +
        "</div>"
      : "";
    itemsHtml +=
      '<div style="margin-bottom: 2mm;">' +
      '<div style="display: flex; font-size: 11px; font-weight: bold;">' +
      '<div style="width: 8mm; text-align: left;">' +
      item.quantity +
      "</div>" +
      '<div style="flex: 1;">' +
      item.name +
      "</div>" +
      '<div style="text-align: right; white-space: nowrap;">' +
      (item.price * item.quantity).toLocaleString("id-ID") +
      "</div>" +
      "</div>" +
      addonLines +
      noteLine +
      "</div>";
  }
  return itemsHtml;
}

// ============================================================
// Thermal layouts — block payloads for the Cleanter bridge
//
// The browser paths build HTML because the browser draws the page. A
// thermal printer gets no page: Cleanter turns a flat list of blocks into
// ESC/POS bytes, so these carry the same content as blocks instead.
// ============================================================

/** Cleanter's line widths: 48 characters on 80mm paper, 32 on 58mm. */
const THERMAL_80MM_CHARS = 48;
const THERMAL_58MM_CHARS = 32;

/** How much of a line our own item labels may take before the price. */
const THERMAL_ITEM_LABEL_CHARS = THERMAL_58MM_CHARS - 10;

/**
 * Receipt text lands on paper, not in a DOM: a stray newline would split a
 * line in two, so flatten all whitespace before it becomes ESC/POS.
 */
function thermalText(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

/** Thermal print heads stop at the paper edge, so clip and mark the cut. */
function fitThermal(text: string, maxChars: number): string {
  let flat = thermalText(text);
  if (flat.length <= maxChars) return flat;
  return flat.slice(0, Math.max(maxChars - 3, 0)) + "...";
}

function thermalMoney(value: number): string {
  return "Rp " + value.toLocaleString("id-ID");
}

/**
 * Item lines as blocks: `2x Nasi Goreng .... 50.000`, with modifiers and
 * notes indented underneath in a smaller size.
 */
function thermalItemLines(cartItems: CartItem[]): BridgeBlock[] {
  let blocks: BridgeBlock[] = [];
  for (let i = 0; i < cartItems.length; i++) {
    let item = cartItems[i];
    blocks.push({
      type: "row",
      left: fitThermal(item.quantity + "x " + item.name, THERMAL_ITEM_LABEL_CHARS),
      right: (item.price * item.quantity).toLocaleString("id-ID"),
      bold: true,
    });
    for (let j = 0; j < item.modifiers.length; j++) {
      let m = item.modifiers[j];
      blocks.push({
        type: "text",
        text: fitThermal((m.isExclusion ? "X " : "+ ") + m.name, THERMAL_58MM_CHARS),
        size: "small",
      });
    }
    if (item.notes) {
      blocks.push({
        type: "text",
        text: fitThermal("Note: " + item.notes, THERMAL_58MM_CHARS),
        size: "small",
      });
    }
  }
  return blocks;
}

/**
 * A thermal printer failure has to reach the cashier in words they can act
 * on. Cleanter's 503 body is written for exactly that ("Turn Bluetooth
 * on"), so surface it verbatim instead of a generic error.
 */
function reportPrintFailure(message: string): void {
  toast.error("Gagal mencetak: " + message);
}

/**
 * Receipt for the customer: same content as the browser document, laid out
 * as blocks for a 58mm roll.
 */
function receiptBlocks({
  order,
  cartItems,
  branchName,
  branchAddress,
  branchPhone,
}: PrintReceiptParams): BridgeBlock[] {
  let idStr = order.id.slice(0, 8).toUpperCase();
  let blocks: BridgeBlock[] = [
    { type: "text", text: "Omoiyari", align: "center", bold: true, size: "large" },
    {
      type: "text",
      text: thermalText(branchAddress || branchName),
      align: "center",
      size: "small",
    },
  ];
  if (branchAddress) {
    blocks.push({
      type: "text",
      text: thermalText(branchName),
      align: "center",
      size: "small",
    });
  }
  blocks.push(
    {
      type: "text",
      text: "Telp: " + thermalText(branchPhone || "-"),
      align: "center",
      size: "small",
    },
    {
      type: "text",
      text: new Date().toLocaleString("id-ID"),
      align: "center",
      size: "small",
    },
    { type: "divider" },
    { type: "row", left: "Kode Order", right: thermalText(order.orderCode || idStr) },
    { type: "row", left: "Pelanggan", right: thermalText(order.customerName || "-") },
    { type: "row", left: "Channel", right: thermalText(order.channel) },
    { type: "row", left: "Pembayaran", right: thermalText(order.paymentMethod || "-") },
    { type: "divider" },
    { type: "row", left: "Jml  Nama Menu", right: "Harga" },
  );
  for (const block of thermalItemLines(cartItems)) blocks.push(block);
  blocks.push(
    { type: "divider" },
    { type: "row", left: "Subtotal", right: order.subtotal.toLocaleString("id-ID") },
  );
  if (order.voucherDiscount) {
    blocks.push({
      type: "row",
      left: "Diskon",
      right: "-" + order.voucherDiscount.toLocaleString("id-ID"),
    });
  }
  if (order.taxAmount) {
    blocks.push({
      type: "row",
      left: "PB1",
      right: order.taxAmount.toLocaleString("id-ID"),
    });
  }
  blocks.push(
    { type: "row", left: "TOTAL", right: order.totalAmount.toLocaleString("id-ID"), bold: true },
    { type: "divider" },
    {
      type: "text",
      text: "Terima kasih sudah makan di Omoiyari! Selamat menikmati",
      align: "center",
      size: "small",
    },
    { type: "text", text: "INI BARU KARAAGE!!", align: "center", bold: true },
    { type: "feed", lines: 3 },
  );
  return blocks;
}

/**
 * Prints the customer receipt on the thermal printer when a printer is
 * attached (Android tablet running Cleanter). Otherwise falls back to the
 * browser print dialog, which is the only option on desktop.
 */
export async function printReceipt(params: PrintReceiptParams): Promise<void> {
  let result = await printViaBridge({
    content: receiptBlocks(params),
    paperWidth: 58,
    cut: true,
    reference: params.order.orderCode ?? params.order.id.slice(0, 8).toUpperCase(),
  });
  if (result.kind === "printed") return;
  if (result.kind === "unavailable") {
    printReceiptInBrowser(params);
    return;
  }
  reportPrintFailure(result.message);
}

function printReceiptInBrowser({
  order,
  cartItems,
  branchName,
  branchAddress,
  branchPhone,
}: PrintReceiptParams) {
  let printWindow = window.open("", "_blank");
  if (!printWindow) return;

  let itemsHtml = buildReceiptItemsHtml(cartItems);
  let idStr = order.id.slice(0, 8).toUpperCase();

  const lines: string[] = [
    "<html><head>",
    "<title>Struk - " + idStr + "</title>",
    "<style>",
    "@page { margin: 0; size: " + RECEIPT_WIDTH_MM + "mm auto; }",
    "body { font-family: 'Courier New', monospace; width: " +
      RECEIPT_WIDTH_MM +
      "mm; margin: 0; padding: 2mm; font-size: 11px; position: relative; }",
    ".wm-wrap { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; z-index: 0; }",
    ".wm-wrap img { max-width: 45mm; opacity: 0.06; }",
    ".content { position: relative; z-index: 1; }",
    ".center { text-align: center; }",
    ".logo { max-width: 25mm; max-height: 15mm; margin-bottom: 1mm; }",
    ".header { font-size: 14px; font-weight: bold; margin-bottom: 1mm; }",
    ".subheader { font-size: 10px; color: #444; margin-bottom: 1mm; }",
    ".divider { border-top: 1px dashed #000; margin: 2mm 0; }",
    ".colhead { display: flex; font-size: 10px; color: #444; margin-bottom: 1mm; }",
    ".colhead .qty { width: 8mm; }",
    ".row { display: flex; justify-content: space-between; }",
    ".total { font-size: 13px; font-weight: bold; margin-top: 2mm; }",
    ".footer { margin-top: 4mm; font-size: 10px; color: #444; text-align: center; }",
    ".tagline { margin-top: 1mm; font-size: 12px; font-weight: bold; text-align: center; }",
    "</style></head><body>",
    '<div class="wm-wrap"><img src="/logo-for-light-mode.png" alt="" /></div>',
    '<div class="content">',
    // Header: Logo + brand, then outlet address & phone from branch info.
    '<div class="center"><img class="logo" src="/logo-for-light-mode.png" alt="Omoiyari" /></div>',
    '<div class="center header">Omoiyari</div>',
    '<div class="center subheader">' + (branchAddress || branchName) + "</div>",
    branchAddress ? '<div class="center subheader">' + branchName + "</div>" : "",
    '<div class="center subheader">Telp: ' + (branchPhone || "-") + "</div>",
    '<div class="center subheader">' + new Date().toLocaleString("id-ID") + "</div>",
    '<div class="divider"></div>',
    '<div class="row"><span>Kode Order:</span><span>' +
      (order.orderCode || idStr) +
      "</span></div>",
    '<div class="row"><span>Pelanggan:</span><span>' +
      (order.customerName || "-") +
      "</span></div>",
    '<div class="row"><span>Channel:</span><span>' + order.channel + "</span></div>",
    '<div class="row"><span>Pembayaran:</span><span>' +
      (order.paymentMethod || "-") +
      "</span></div>",
    '<div class="divider"></div>',
    // Column header: Jumlah | Nama menu | Harga
    '<div class="colhead"><span class="qty">Jml</span><span>Nama Menu</span><span>Harga</span></div>',
    itemsHtml,
    '<div class="divider"></div>',
    '<div class="row"><span>Subtotal</span><span>Rp ' +
      order.subtotal.toLocaleString("id-ID") +
      "</span></div>",
  ];

  if (order.voucherDiscount) {
    lines.push(
      '<div class="row"><span>Diskon</span><span>-Rp ' +
        order.voucherDiscount.toLocaleString("id-ID") +
        "</span></div>",
    );
  }
  if (order.taxAmount) {
    lines.push(
      '<div class="row"><span>PB1</span><span>Rp ' +
        order.taxAmount.toLocaleString("id-ID") +
        "</span></div>",
    );
  }
  lines.push(
    '<div class="row total"><span>TOTAL</span><span>Rp ' +
      order.totalAmount.toLocaleString("id-ID") +
      "</span></div>",
    '<div class="divider"></div>',
    '<div class="footer">Terima kasih sudah makan di Omoiyari! Selamat menikmati 🙏</div>',
    '<div class="tagline">INI BARU KARAAGE!!</div>',
    "</div>",
    "<script>window.onload = function() { window.print(); setTimeout(function() { window.close(); }, 500); }</script>",
    "</body></html>",
  );

  printWindow.document.write(lines.join("\n"));
  printWindow.document.close();
}

/**
 * Pre-checkout bill as blocks for a 58mm roll. Carries the same UNPAID
 * marking as the browser document so it cannot be mistaken for a receipt.
 */
function billBlocks({
  cartItems,
  branchName,
  branchAddress,
  branchPhone,
  subtotal,
  voucherDiscount,
  taxAmount,
  finalTotal,
  customerName,
  orderCode,
}: PrintBillParams): BridgeBlock[] {
  let blocks: BridgeBlock[] = [
    { type: "text", text: "BELUM DIBAYAR / UNPAID", align: "center", bold: true, size: "large" },
    { type: "text", text: "Omoiyari", align: "center", bold: true },
    {
      type: "text",
      text: thermalText(branchAddress || branchName),
      align: "center",
      size: "small",
    },
  ];
  if (branchAddress) {
    blocks.push({
      type: "text",
      text: thermalText(branchName),
      align: "center",
      size: "small",
    });
  }
  blocks.push(
    {
      type: "text",
      text: "Telp: " + thermalText(branchPhone || "-"),
      align: "center",
      size: "small",
    },
    {
      type: "text",
      text: new Date().toLocaleString("id-ID"),
      align: "center",
      size: "small",
    },
    { type: "divider" },
    { type: "row", left: "Kode Order", right: thermalText(orderCode || "-") },
    { type: "row", left: "Pelanggan", right: thermalText(customerName || "-") },
    { type: "divider" },
    { type: "row", left: "Jml  Nama Menu", right: "Harga" },
  );
  for (const block of thermalItemLines(cartItems)) blocks.push(block);
  blocks.push(
    { type: "divider" },
    { type: "row", left: "Subtotal", right: subtotal.toLocaleString("id-ID") },
  );
  if (voucherDiscount > 0) {
    blocks.push({
      type: "row",
      left: "Diskon",
      right: "-" + voucherDiscount.toLocaleString("id-ID"),
    });
  }
  if (taxAmount > 0) {
    blocks.push({
      type: "row",
      left: "PB1",
      right: taxAmount.toLocaleString("id-ID"),
    });
  }
  blocks.push(
    { type: "row", left: "TOTAL", right: finalTotal.toLocaleString("id-ID"), bold: true },
    { type: "divider" },
    {
      type: "text",
      text: "Terima kasih sudah makan di Omoiyari! Selamat menikmati",
      align: "center",
      size: "small",
    },
    { type: "text", text: "INI BARU KARAAGE!!", align: "center", bold: true },
    { type: "text", text: "BELUM DIBAYAR", align: "center", bold: true },
    { type: "feed", lines: 3 },
  );
  return blocks;
}

/** Falls back to the browser print dialog when no thermal printer is attached. */
export async function printBill(params: PrintBillParams): Promise<void> {
  let result = await printViaBridge({
    content: billBlocks(params),
    paperWidth: 58,
    cut: true,
    reference: params.orderCode,
  });
  if (result.kind === "printed") return;
  if (result.kind === "unavailable") {
    printBillInBrowser(params);
    return;
  }
  reportPrintFailure(result.message);
}

function printBillInBrowser({
  cartItems,
  branchName,
  branchAddress,
  branchPhone,
  subtotal,
  voucherDiscount,
  taxAmount,
  finalTotal,
  customerName,
  orderCode,
}: PrintBillParams) {
  let printWindow = window.open("", "_blank");
  if (!printWindow) return;

  let itemsHtml = buildReceiptItemsHtml(cartItems);

  const lines: string[] = [
    "<html><head>",
    "<title>Bill</title>",
    "<style>",
    "@page { margin: 0; size: " + RECEIPT_WIDTH_MM + "mm auto; }",
    "body { font-family: 'Courier New', monospace; width: " +
      RECEIPT_WIDTH_MM +
      "mm; margin: 0; padding: 2mm; font-size: 11px; position: relative; }",
    ".wm-wrap { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; z-index: 0; }",
    ".wm-wrap img { max-width: 45mm; opacity: 0.06; }",
    ".content { position: relative; z-index: 1; }",
    ".center { text-align: center; }",
    ".logo { max-width: 25mm; max-height: 15mm; margin-bottom: 1mm; }",
    ".header { font-size: 14px; font-weight: bold; margin-bottom: 1mm; }",
    ".subheader { font-size: 10px; color: #444; margin-bottom: 1mm; }",
    ".divider { border-top: 1px dashed #000; margin: 2mm 0; }",
    ".colhead { display: flex; font-size: 10px; color: #444; margin-bottom: 1mm; }",
    ".colhead .qty { width: 8mm; }",
    ".row { display: flex; justify-content: space-between; }",
    ".total { font-size: 13px; font-weight: bold; margin-top: 2mm; }",
    ".footer { margin-top: 4mm; font-size: 10px; color: #444; text-align: center; }",
    ".tagline { margin-top: 1mm; font-size: 12px; font-weight: bold; text-align: center; }",
    ".watermark { text-align: center; border: 2px dashed #999; padding: 2mm; margin: 3mm 0; color: #999; font-weight: bold; font-size: 13px; }",
    "</style></head><body>",
    '<div class="wm-wrap"><img src="/logo-for-light-mode.png" alt="" /></div>',
    '<div class="content">',
    '<div class="watermark">BELUM DIBAYAR / UNPAID</div>',
    // Header: Logo + brand, then outlet address & phone from branch info.
    '<div class="center"><img class="logo" src="/logo-for-light-mode.png" alt="Omoiyari" /></div>',
    '<div class="center header">Omoiyari</div>',
    '<div class="center subheader">' + (branchAddress || branchName) + "</div>",
    branchAddress ? '<div class="center subheader">' + branchName + "</div>" : "",
    '<div class="center subheader">Telp: ' + (branchPhone || "-") + "</div>",
    '<div class="center subheader">' + new Date().toLocaleString("id-ID") + "</div>",
    '<div class="divider"></div>',
    '<div class="row"><span>Kode Order:</span><span>' + (orderCode || "-") + "</span></div>",
    '<div class="row"><span>Pelanggan:</span><span>' + (customerName || "-") + "</span></div>",
    '<div class="divider"></div>',
    // Column header: Jumlah | Nama menu | Harga
    '<div class="colhead"><span class="qty">Jml</span><span>Nama Menu</span><span>Harga</span></div>',
    itemsHtml,
    '<div class="divider"></div>',
    '<div class="row"><span>Subtotal</span><span>Rp ' +
      subtotal.toLocaleString("id-ID") +
      "</span></div>",
  ];

  if (voucherDiscount > 0) {
    lines.push(
      '<div class="row"><span>Diskon</span><span>-Rp ' +
        voucherDiscount.toLocaleString("id-ID") +
        "</span></div>",
    );
  }
  if (taxAmount > 0) {
    lines.push(
      '<div class="row"><span>PB1</span><span>Rp ' +
        taxAmount.toLocaleString("id-ID") +
        "</span></div>",
    );
  }
  lines.push(
    '<div class="row total"><span>TOTAL</span><span>Rp ' +
      finalTotal.toLocaleString("id-ID") +
      "</span></div>",
    '<div class="divider"></div>',
    '<div class="footer">Terima kasih sudah makan di Omoiyari! Selamat menikmati 🙏</div>',
    '<div class="tagline">INI BARU KARAAGE!!</div>',
    '<div class="watermark">BELUM DIBAYAR</div>',
    "</div>",
    "<script>window.onload = function() { window.print(); setTimeout(function() { window.close(); }, 500); }</script>",
    "</body></html>",
  );

  printWindow.document.write(lines.join("\n"));
  printWindow.document.close();
}

// ============================================================
// SCM Print Utilities — Surat Jalan and Invoice
// ============================================================

export function printSuratJalan(dn: {
  code: string;
  fromBranchName: string;
  toBranchName: string;
  driverName: string | null;
  vehicleNumber: string | null;
  status: string;
  items: {
    ingredientName: string;
    quantity: number;
    readyQuantity: number | null;
    stockUnit: string | null;
  }[];
  createdAt: Date;
}) {
  const lines: string[] = [
    "<html><head>",
    "<title>Surat Jalan - " + dn.code + "</title>",
    "<style>",
    "@page { margin: 10mm; }",
    "body { font-family: 'Courier New', monospace; max-width: 210mm; margin: 0 auto; padding: 10mm; font-size: 12px; }",
    ".header { text-align: center; font-size: 18px; font-weight: bold; margin-bottom: 2mm; }",
    ".subheader { text-align: center; font-size: 11px; color: #444; margin-bottom: 5mm; }",
    ".info-grid { display: flex; justify-content: space-between; margin-bottom: 5mm; }",
    ".info-block { font-size: 11px; }",
    ".divider { border-top: 1px solid #000; margin: 3mm 0; }",
    "table { width: 100%; border-collapse: collapse; font-size: 11px; }",
    "th { border-bottom: 1px solid #000; padding: 2mm; text-align: left; }",
    "td { padding: 2mm; border-bottom: 1px dashed #ccc; }",
    "td:last-child, th:last-child { text-align: right; }",
    ".footer { margin-top: 10mm; font-size: 10px; text-align: center; color: #666; }",
    "</style></head><body>",
    '<div style="text-align: center; margin-bottom: 3mm;"><img src="/logo.png" alt="Logo" style="max-height: 40px;"/></div>',
    '<div class="header">SURAT JALAN</div>',
    '<div class="subheader">' + dn.code + "</div>",
    '<div class="subheader">' + new Date(dn.createdAt).toLocaleString("id-ID") + "</div>",
    '<div class="divider"></div>',
    '<div class="info-grid">',
    '<div class="info-block"><strong>Dari:</strong><br>' + dn.fromBranchName + "</div>",
    '<div class="info-block"><strong>Ke:</strong><br>' + dn.toBranchName + "</div>",
    '<div class="info-block"><strong>Driver:</strong><br>' + (dn.driverName || "-") + "</div>",
    '<div class="info-block"><strong>Kendaraan:</strong><br>' +
      (dn.vehicleNumber || "-") +
      "</div>",
    "</div>",
    '<div class="divider"></div>',
    "<table>",
    "<thead><tr><th>Bahan</th><th>Order</th><th>Ready</th><th>Satuan</th></tr></thead>",
    "<tbody>",
  ];

  for (const item of dn.items) {
    lines.push(
      "<tr><td>" +
        item.ingredientName +
        "</td><td>" +
        item.quantity +
        "</td><td>" +
        (item.readyQuantity ?? "-") +
        "</td><td>" +
        (item.stockUnit || "-") +
        "</td></tr>",
    );
  }

  lines.push(
    "</tbody></table>",
    '<div class="divider"></div>',
    '<div class="footer">Dokumen ini dicetak dari Omoiyari POS</div>',
    "</body></html>",
  );

  const pw = window.open("", "_blank");
  if (!pw) return;
  pw.document.write(lines.join("\n"));
  pw.document.close();
}

/** Invoice payload shared by the thermal blocks and the browser document. */
interface SCMInvoiceParams {
  code: string;
  dnCode: string;
  totalAmount: number;
  status: string;
  items: {
    ingredientName: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
  }[];
  createdAt: Date;
}

/**
 * Invoice as blocks for an 80mm roll. An A4 invoice cannot be squeezed
 * onto 58mm paper, so each item prints as a name line followed by a
 * quantity / total line instead of a four-column table.
 */
function scmInvoiceBlocks(inv: SCMInvoiceParams, showUnitPrice: boolean): BridgeBlock[] {
  let blocks: BridgeBlock[] = [
    { type: "text", text: "INVOICE SCM", align: "center", bold: true, size: "large" },
    { type: "text", text: inv.code, align: "center" },
    {
      type: "text",
      text: new Date(inv.createdAt).toLocaleString("id-ID"),
      align: "center",
      size: "small",
    },
    { type: "divider" },
    { type: "row", left: "Surat Jalan", right: inv.dnCode },
    { type: "divider" },
  ];
  for (let i = 0; i < inv.items.length; i++) {
    let item = inv.items[i];
    blocks.push({
      type: "text",
      text: fitThermal(item.ingredientName, THERMAL_80MM_CHARS),
      bold: true,
    });
    blocks.push({
      type: "row",
      left: showUnitPrice
        ? item.quantity + " x " + thermalMoney(item.unitPrice)
        : "Qty " + item.quantity,
      right: thermalMoney(item.totalPrice),
    });
  }
  blocks.push(
    { type: "divider" },
    { type: "row", left: "TOTAL", right: thermalMoney(inv.totalAmount), bold: true },
    { type: "divider" },
    {
      type: "text",
      text: "Status: " + (inv.status === "Unpaid" ? "BELUM DIBAYAR" : "LUNAS"),
      align: "center",
      size: "small",
    },
    { type: "text", text: "Dicetak dari Omoiyari POS", align: "center", size: "small" },
    { type: "feed", lines: 3 },
  );
  return blocks;
}

/** Falls back to the browser print dialog when no thermal printer is attached. */
export async function printSCMInvoice(
  inv: SCMInvoiceParams,
  opts?: { showUnitPrice?: boolean },
): Promise<void> {
  // Per-unit prices are the HPP snapshot — hidden for branch_admin.
  const showUnitPrice = opts?.showUnitPrice ?? true;
  let result = await printViaBridge({
    content: scmInvoiceBlocks(inv, showUnitPrice),
    paperWidth: 80,
    cut: true,
    reference: inv.code,
  });
  if (result.kind === "printed") return;
  if (result.kind === "unavailable") {
    printSCMInvoiceInBrowser(inv, showUnitPrice);
    return;
  }
  reportPrintFailure(result.message);
}

function printSCMInvoiceInBrowser(inv: SCMInvoiceParams, showUnitPrice: boolean) {
  const lines: string[] = [
    "<html><head>",
    "<title>Invoice - " + inv.code + "</title>",
    "<style>",
    "@page { margin: 10mm; }",
    "body { font-family: 'Courier New', monospace; max-width: 210mm; margin: 0 auto; padding: 10mm; font-size: 12px; }",
    ".header { text-align: center; font-size: 18px; font-weight: bold; margin-bottom: 2mm; }",
    ".subheader { text-align: center; font-size: 11px; color: #444; margin-bottom: 5mm; }",
    ".info { font-size: 11px; margin-bottom: 5mm; }",
    ".divider { border-top: 1px solid #000; margin: 3mm 0; }",
    "table { width: 100%; border-collapse: collapse; font-size: 11px; }",
    "th { border-bottom: 1px solid #000; padding: 2mm; text-align: left; }",
    "td { padding: 2mm; border-bottom: 1px dashed #ccc; }",
    "td:nth-child(2), td:nth-child(3), td:nth-child(4) { text-align: right; }",
    "th:nth-child(2), th:nth-child(3), th:nth-child(4) { text-align: right; }",
    ".total-row td { font-weight: bold; border-top: 1px solid #000; font-size: 13px; }",
    ".footer { margin-top: 10mm; font-size: 10px; text-align: center; color: #666; }",
    "</style></head><body>",
    '<div style="text-align: center; margin-bottom: 3mm;"><img src="/logo.png" alt="Logo" style="max-height: 40px;"/></div>',
    '<div class="header">INVOICE SCM</div>',
    '<div class="subheader">' + inv.code + "</div>",
    '<div class="subheader">' + new Date(inv.createdAt).toLocaleString("id-ID") + "</div>",
    '<div class="info"><strong>Surat Jalan:</strong> ' + inv.dnCode + "</div>",
    '<div class="divider"></div>',
    "<table>",
    "<thead><tr><th>Bahan</th><th>Qty</th>" +
      (showUnitPrice ? "<th>Harga Satuan</th>" : "") +
      "<th>Total</th></tr></thead>",
    "<tbody>",
  ];

  for (const item of inv.items) {
    lines.push(
      "<tr><td>" +
        item.ingredientName +
        "</td><td>" +
        item.quantity +
        "</td>" +
        (showUnitPrice ? "<td>Rp " + item.unitPrice.toLocaleString("id-ID") + "</td>" : "") +
        "<td>Rp " +
        item.totalPrice.toLocaleString("id-ID") +
        "</td></tr>",
    );
  }

  lines.push(
    '<tr class="total-row"><td colspan="' +
      (showUnitPrice ? 3 : 2) +
      '">TOTAL</td><td>Rp ' +
      inv.totalAmount.toLocaleString("id-ID") +
      "</td></tr>",
    "</tbody></table>",
    '<div class="divider"></div>',
    '<div class="footer">Status: ' +
      (inv.status === "Unpaid" ? "BELUM DIBAYAR" : "LUNAS") +
      " | Dicetak dari Omoiyari POS</div>",
    "</body></html>",
  );

  const pw = window.open("", "_blank");
  if (!pw) return;
  pw.document.write(lines.join("\n"));
  pw.document.close();
}
