// ============================================================
// POS Print Utilities — receipt and bill generation
// ============================================================

import type { CartItem, OrderResult } from "./pos-types";

interface PrintBillParams {
  cartItems: CartItem[];
  branchName: string;
  subtotal: number;
  voucherDiscount: number;
  taxAmount: number;
  finalTotal: number;
}

interface PrintReceiptParams {
  order: OrderResult;
  cartItems: CartItem[];
  branchName: string;
}

function buildItemsHtml(cartItems: CartItem[]): string {
  let itemsHtml = "";
  for (let i = 0; i < cartItems.length; i++) {
    let item = cartItems[i];
    let modLines = "";
    if (item.modifiers.length > 0) {
      let parts: string[] = [];
      for (let j = 0; j < item.modifiers.length; j++) {
        let m = item.modifiers[j];
        parts.push((m.isExclusion ? "X " : "+ ") + m.name);
      }
      modLines =
        '<div style="font-size: 10px; color: #444; padding-left: 2mm;">' +
        parts.join("<br>") +
        "</div>";
    }
    let noteLine = item.notes
      ? '<div style="font-size: 10px; font-style: italic; color: #666; padding-left: 2mm;">Note: ' +
        item.notes +
        "</div>"
      : "";
    itemsHtml +=
      '<div style="margin-bottom: 3mm;">' +
      '<div style="display: flex; justify-content: space-between; font-size: 12px; font-weight: bold;">' +
      '<div style="flex: 1;">' +
      item.name +
      "</div>" +
      '<div style="width: 10mm; text-align: center;">' +
      item.quantity +
      "</div>" +
      '<div style="width: 25mm; text-align: right;">' +
      (item.price * item.quantity).toLocaleString("id-ID") +
      "</div>" +
      "</div>" +
      modLines +
      noteLine +
      "</div>";
  }
  return itemsHtml;
}

export function printReceipt({ order, cartItems, branchName }: PrintReceiptParams) {
  let printWindow = window.open("", "_blank");
  if (!printWindow) return;

  let itemsHtml = buildItemsHtml(cartItems);
  let idStr = order.id.slice(0, 8).toUpperCase();

  const lines: string[] = [
    "<html><head>",
    "<title>Struk - " + idStr + "</title>",
    "<style>",
    "@page { margin: 0; }",
    "body { font-family: 'Courier New', monospace; max-width: 80mm; margin: 5mm auto; padding: 5mm; font-size: 12px; position: relative; }",
    ".wm-wrap { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; z-index: 0; }",
    ".wm-wrap img { max-width: 60mm; opacity: 0.06; }",
    ".content { position: relative; z-index: 1; }",
    ".center { text-align: center; }",
    ".header { font-size: 16px; font-weight: bold; margin-bottom: 2mm; }",
    ".subheader { font-size: 11px; color: #444; margin-bottom: 4mm; }",
    ".divider { border-top: 1px dashed #000; margin: 3mm 0; }",
    ".row { display: flex; justify-content: space-between; }",
    ".total { font-size: 14px; font-weight: bold; margin-top: 2mm; }",
    ".footer { margin-top: 5mm; font-size: 10px; color: #444; text-align: center; }",
    "</style></head><body>",
    '<div class="wm-wrap"><img src="/logo-for-light-mode.png" alt="" /></div>',
    '<div class="content">',
    '<div class="center header">Omoiyari POS</div>',
    '<div class="center subheader">' + branchName + "</div>",
    '<div class="center subheader">' + new Date().toLocaleString("id-ID") + "</div>",
    '<div class="divider"></div>',
    '<div class="row"><span>No. Order:</span><span>' + idStr + "</span></div>",
    '<div class="row"><span>Channel:</span><span>' + order.channel + "</span></div>",
    '<div class="row"><span>Pembayaran:</span><span>' +
      (order.paymentMethod || "-") +
      "</span></div>",
    '<div class="divider"></div>',
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
    '<div class="footer">Terima kasih telah berbelanja</div>',
    "</div>",
    "<script>window.onload = function() { window.print(); setTimeout(function() { window.close(); }, 500); }</script>",
    "</body></html>",
  );

  printWindow.document.write(lines.join("\n"));
  printWindow.document.close();
}

export function printBill({
  cartItems,
  branchName,
  subtotal,
  voucherDiscount,
  taxAmount,
  finalTotal,
}: PrintBillParams) {
  let printWindow = window.open("", "_blank");
  if (!printWindow) return;

  let itemsHtml = buildItemsHtml(cartItems);

  const lines: string[] = [
    "<html><head>",
    "<title>Bill</title>",
    "<style>",
    "@page { margin: 0; }",
    "body { font-family: 'Courier New', monospace; max-width: 80mm; margin: 5mm auto; padding: 5mm; font-size: 12px; position: relative; }",
    ".wm-wrap { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; z-index: 0; }",
    ".wm-wrap img { max-width: 60mm; opacity: 0.06; }",
    ".content { position: relative; z-index: 1; }",
    ".center { text-align: center; }",
    ".watermark { text-align: center; border: 2px dashed #999; padding: 2mm; margin: 3mm 0; color: #999; font-weight: bold; font-size: 14px; }",
    ".header { font-size: 16px; font-weight: bold; margin-bottom: 2mm; }",
    ".subheader { font-size: 11px; color: #444; margin-bottom: 4mm; }",
    ".divider { border-top: 1px dashed #000; margin: 3mm 0; }",
    ".row { display: flex; justify-content: space-between; }",
    ".total { font-size: 14px; font-weight: bold; margin-top: 2mm; }",
    "</style></head><body>",
    '<div class="wm-wrap"><img src="/logo-for-light-mode.png" alt="" /></div>',
    '<div class="content">',
    '<div class="watermark">BELUM DIBAYAR / UNPAID</div>',
    '<div class="center header">' + branchName + "</div>",
    '<div class="center subheader">' + new Date().toLocaleString("id-ID") + "</div>",
    '<div class="divider"></div>',
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
    '<div class="watermark">BELUM DIBAYAR</div>',
    "</div>",
    "<script>window.onload = function() { window.print(); setTimeout(function() { window.close(); }, 500); }</script>",
    "</body></html>",
  );

  printWindow.document.write(lines.join("\n"));
  printWindow.document.close();
}
