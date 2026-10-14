// ============================================================
// POS Print Utilities — receipt and bill generation
// ============================================================

import { toast } from "sonner";

import { printViaBridge } from "./print-bridge";
import type { BridgeAlign, BridgeBlock, BridgeTextSize } from "./print-bridge";
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
 * dine-in bill keeps its own Nama | Qty | Harga layout. The checker slip is
 * the same list with `showPrice` off: it exists to be checked, not charged.
 */
function buildReceiptItemsHtml(cartItems: CartItem[], showPrice = true): string {
  let itemsHtml = "";
  for (let i = 0; i < cartItems.length; i++) {
    let item = cartItems[i];
    let addonLines = "";
    if (item.modifiers.length > 0) {
      // Same wording as the cart the cashier confirmed from: a bare add-on
      // name, or "Tanpa" for an exclusion. The kitchen reads this line, so it
      // has to say what the screen said.
      let parts: string[] = [];
      for (let j = 0; j < item.modifiers.length; j++) {
        let m = item.modifiers[j];
        parts.push((m.isExclusion ? "Tanpa " : "") + m.name);
      }
      // Full size, not bold — the same weight the item itself is set at, so
      // the only thing separating an add-on from its item is the indent and the
      // missing bold. See `thermalItemLines` for the thermal-side reasoning.
      addonLines = '<div style="color: #444; padding-left: 8mm;">' + parts.join("<br>") + "</div>";
    }
    let noteLine = item.notes
      ? '<div style="font-style: italic; color: #666; padding-left: 8mm;">Note: ' +
        item.notes +
        "</div>"
      : "";
    itemsHtml +=
      '<div style="margin-bottom: 2mm;">' +
      '<div style="display: flex; font-size: 11px; font-weight: bold;">' +
      '<div style="width: 8mm; text-align: left;">' +
      item.quantity +
      "</div>" +
      '<div style="flex: 1; min-width: 0; overflow-wrap: break-word;">' +
      item.name +
      "</div>" +
      (showPrice
        ? '<div style="text-align: right; white-space: nowrap;">' +
          (item.price * item.quantity).toLocaleString("id-ID") +
          "</div>"
        : "") +
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

/** Sign-off, shared by the receipt and the bill so the two never drift. */
const FAREWELL = "Terima kasih dan selamat menikmati.";

/** Brand line under the sign-off. */
const TAGLINE = "INI BARU KARAAGE!";

/**
 * Blank lines fed after the last text, before the cut.
 *
 * The cut lands a few millimetres past the tear bar, so a receipt trimmed to
 * the last printed line has to be pulled off the slot by hand — and a short
 * one tears while still partly inside the printer. Feeding several blank lines
 * gives the tear bar something to work against and leaves a grippable tail.
 */
const PULL_TRAILER_FEED_LINES = 6;

/**
 * Height of one line of text on the roll — used only to size the browser
 * fallback's blank trailer to match the thermal one. The receipt is set at
 * 11px with 1.5 line-height, so a line is about 3.7mm.
 */
const RECEIPT_LINE_MM = 3.7;

/** Cleanter's line widths: 48 characters on 80mm paper, 32 on 58mm. */
const THERMAL_80MM_CHARS = 48;
const THERMAL_58MM_CHARS = 32;

/** Add-ons sit this far in, and stay there however far their name wraps. */
const THERMAL_ITEM_INDENT = "   ";

/**
 * Below this a label has no room left to share a line with its value, so the
 * pair stops being columns and becomes two stacked lines instead.
 */
const THERMAL_MIN_LABEL_CHARS = 12;

interface ThermalTextOptions {
  /** Printable width in characters — 32 on 58mm, 48 on 80mm. */
  width: number;
  align?: BridgeAlign;
  bold?: boolean;
  size?: BridgeTextSize;
  /** Indent for the first line — how an add-on tucks under its item. */
  prefix?: string;
  /** Indent for wrapped continuation lines. Defaults to `prefix`. */
  indent?: string;
}

interface ThermalRowOptions {
  width: number;
  bold?: boolean;
  /** Indent that wrapped label lines hang under column one. */
  indent?: string;
}

/**
 * Receipt text lands on paper, not in a DOM: a stray newline would split a
 * line in two, so flatten all whitespace before it becomes ESC/POS.
 */
function thermalText(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

/**
 * A print head stops at the paper edge, and Cleanter marks whatever runs past
 * it with an ellipsis. On a menu like "Combo Hemat C (Caramel + Free Pork +
 * Extra Teh)" that yields "Combo Hemat C (Crum..." — which tells the kitchen
 * nothing at all. So no line is ever handed over too wide: text is wrapped
 * here instead, breaking on spaces so a word is never split.
 */
function wrapThermal(
  text: string,
  width: number,
  firstIndent = "",
  restIndent = firstIndent,
): string[] {
  let words = thermalText(text).split(" ").filter(Boolean);
  let lines: string[] = [];
  let current = "";
  for (let i = 0; i < words.length; i++) {
    let word = words[i];
    let limit = Math.max(width - (lines.length === 0 ? firstIndent.length : restIndent.length), 1);
    if (word.length > limit) {
      if (current) {
        lines.push(current);
        current = "";
      }
      // A single token longer than the paper (a code, a URL) still has to fit.
      let room = Math.max(width - restIndent.length, 1);
      let rest = word;
      while (rest.length > room) {
        lines.push(rest.slice(0, room));
        rest = rest.slice(room);
      }
      current = rest;
      continue;
    }
    let candidate = current ? current + " " + word : word;
    if (candidate.length <= limit) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word;
  }
  if (current) lines.push(current);
  return lines.map(function (line, index) {
    return (index === 0 ? firstIndent : restIndent) + line;
  });
}

/** Wrapped text as one `text` block per line — a roll has no page to flow. */
function thermalLines(text: string, opts: ThermalTextOptions): BridgeBlock[] {
  return wrapThermal(text, opts.width, opts.prefix, opts.indent ?? opts.prefix).map(
    function (line) {
      return {
        type: "text",
        text: line,
        align: opts.align,
        bold: opts.bold,
        size: opts.size,
      };
    },
  );
}

/**
 * A label/value pair that wraps instead of clipping. When both sides cannot
 * share one line, the label takes the lines it needs and the value stays
 * flush-right on the last of them — the column still lines up down the
 * receipt, and nothing is cut off.
 */
function thermalRow(left: string, right: string, opts: ThermalRowOptions): BridgeBlock[] {
  let flatLeft = thermalText(left);
  let flatRight = thermalText(right);
  if (!flatLeft) {
    return [{ type: "row", left: "", right: flatRight, bold: opts.bold }];
  }
  if (flatLeft.length + flatRight.length + 1 <= opts.width) {
    return [{ type: "row", left: flatLeft, right: flatRight, bold: opts.bold }];
  }
  let labelWidth = opts.width - flatRight.length - 1;
  if (labelWidth < THERMAL_MIN_LABEL_CHARS) {
    // The value is wider than the paper can share with anything. Stack it
    // under the label instead, wrapped, rather than let the head clip it.
    let blocks = thermalLines(flatLeft, {
      width: opts.width,
      bold: opts.bold,
      prefix: opts.indent,
    });
    blocks.push(...thermalLines(flatRight, { width: opts.width, bold: opts.bold }));
    return blocks;
  }
  let lines = wrapThermal(flatLeft, labelWidth, "", opts.indent);
  let last = lines.pop() ?? "";
  let blocks: BridgeBlock[] = lines.map(function (line) {
    return { type: "text", text: line, bold: opts.bold };
  });
  blocks.push({ type: "row", left: last, right: flatRight, bold: opts.bold });
  return blocks;
}

function thermalMoney(value: number): string {
  return "Rp " + value.toLocaleString("id-ID");
}

/**
 * Item lines as blocks: `2x Nasi Goreng .... 50.000`, with add-ons and notes
 * indented underneath. Add-on wording mirrors the cart in the Web UI — the
 * cashier confirmed the order from that screen, so the kitchen has to read the
 * same words off paper.
 *
 * Add-ons print at full size, distinguished from the item by the absence of
 * bold rather than by a smaller font: a half-height line under a full-height
 * one is hard to read on a thermal head, which has no antialiasing to keep
 * small glyphs legible.
 *
 * `showPrice` off drops the money column entirely, for the checker slip: it
 * is printed before payment to be checked against the order, not to be paid.
 */
function thermalItemLines(cartItems: CartItem[], width: number, showPrice = true): BridgeBlock[] {
  let blocks: BridgeBlock[] = [];
  for (let i = 0; i < cartItems.length; i++) {
    let item = cartItems[i];
    let label = item.quantity + "x " + item.name;
    if (showPrice) {
      blocks.push(
        ...thermalRow(label, (item.price * item.quantity).toLocaleString("id-ID"), {
          width,
          bold: true,
          indent: THERMAL_ITEM_INDENT,
        }),
      );
    } else {
      blocks.push(...thermalLines(label, { width, bold: true, indent: THERMAL_ITEM_INDENT }));
    }
    for (let j = 0; j < item.modifiers.length; j++) {
      let m = item.modifiers[j];
      blocks.push(
        ...thermalLines((m.isExclusion ? "Tanpa " : "") + m.name, {
          width,
          prefix: THERMAL_ITEM_INDENT,
        }),
      );
    }
    if (item.notes) {
      blocks.push(
        ...thermalLines("Note: " + item.notes, {
          width,
          prefix: THERMAL_ITEM_INDENT,
        }),
      );
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
  let width = THERMAL_58MM_CHARS;
  let idStr = order.id.slice(0, 8).toUpperCase();
  let blocks: BridgeBlock[] = [
    { type: "text", text: "Omoiyari", align: "center", bold: true, size: "large" },
  ];
  blocks.push(
    ...thermalLines(branchAddress || branchName, { width, align: "center", size: "small" }),
  );
  if (branchAddress) {
    blocks.push(...thermalLines(branchName, { width, align: "center", size: "small" }));
  }
  blocks.push(
    ...thermalLines("Telp: " + (branchPhone || "-"), { width, align: "center", size: "small" }),
    ...thermalLines(new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }), {
      width,
      align: "center",
      size: "small",
    }),
    { type: "divider" },
    ...thermalRow("Kode Order", order.orderCode || idStr, { width }),
    ...thermalRow("Pelanggan", order.customerName || "-", { width }),
    ...thermalRow("Channel", order.channel, { width }),
    ...thermalRow("Pembayaran", order.paymentMethod || "-", { width }),
    { type: "divider" },
    ...thermalRow("Jml  Nama Menu", "Harga", { width }),
  );
  blocks.push(...thermalItemLines(cartItems, width));
  blocks.push(
    { type: "divider" },
    ...thermalRow("Subtotal", order.subtotal.toLocaleString("id-ID"), { width }),
  );
  if (order.voucherDiscount) {
    blocks.push(
      ...thermalRow("Diskon", "-" + order.voucherDiscount.toLocaleString("id-ID"), { width }),
    );
  }
  if (order.taxAmount) {
    blocks.push(...thermalRow("PB1", order.taxAmount.toLocaleString("id-ID"), { width }));
  }
  blocks.push(
    ...thermalRow("TOTAL", order.totalAmount.toLocaleString("id-ID"), { width, bold: true }),
    { type: "divider" },
    ...thermalLines(FAREWELL, { width, align: "center" }),
    { type: "text", text: TAGLINE, align: "center", bold: true },
    { type: "feed", lines: PULL_TRAILER_FEED_LINES },
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
      "mm; margin: 0; padding: 2mm; font-size: 11px; position: relative; overflow-wrap: break-word; }",
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
    ".footer { margin-top: 4mm; font-size: 11px; color: #444; text-align: center; }",
    ".tagline { margin-top: 1mm; font-size: 12px; font-weight: bold; text-align: center; }",
    // Blank tail so the receipt can be pulled off the slot without tearing it
    // inside the printer — the browser stand-in for the thermal feed.
    ".trailer { height: " + (PULL_TRAILER_FEED_LINES * RECEIPT_LINE_MM).toString() + "mm; }",
    "</style></head><body>",
    '<div class="wm-wrap"><img src="/logo-for-light-mode.png" alt="" /></div>',
    '<div class="content">',
    // Header: Logo + brand, then outlet address & phone from branch info.
    '<div class="center"><img class="logo" src="/logo-for-light-mode.png" alt="Omoiyari" /></div>',
    '<div class="center header">Omoiyari</div>',
    '<div class="center subheader">' + (branchAddress || branchName) + "</div>",
    branchAddress ? '<div class="center subheader">' + branchName + "</div>" : "",
    '<div class="center subheader">Telp: ' + (branchPhone || "-") + "</div>",
    '<div class="center subheader">' +
      new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }) +
      "</div>",
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
    '<div class="footer">' + FAREWELL + "</div>",
    '<div class="tagline">' + TAGLINE + "</div>",
    // Blank tail for the tear bar — see PULL_TRAILER_FEED_LINES.
    '<div class="trailer"></div>',
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
  let width = THERMAL_58MM_CHARS;
  let blocks: BridgeBlock[] = [
    { type: "text", text: "BELUM DIBAYAR / UNPAID", align: "center", bold: true, size: "large" },
    { type: "text", text: "Omoiyari", align: "center", bold: true },
  ];
  blocks.push(
    ...thermalLines(branchAddress || branchName, { width, align: "center", size: "small" }),
  );
  if (branchAddress) {
    blocks.push(...thermalLines(branchName, { width, align: "center", size: "small" }));
  }
  blocks.push(
    ...thermalLines("Telp: " + (branchPhone || "-"), { width, align: "center", size: "small" }),
    ...thermalLines(new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }), {
      width,
      align: "center",
      size: "small",
    }),
    { type: "divider" },
    ...thermalRow("Kode Order", orderCode || "-", { width }),
    ...thermalRow("Pelanggan", customerName || "-", { width }),
    { type: "divider" },
    ...thermalRow("Jml  Nama Menu", "Harga", { width }),
  );
  blocks.push(...thermalItemLines(cartItems, width));
  blocks.push(
    { type: "divider" },
    ...thermalRow("Subtotal", subtotal.toLocaleString("id-ID"), { width }),
  );
  if (voucherDiscount > 0) {
    blocks.push(...thermalRow("Diskon", "-" + voucherDiscount.toLocaleString("id-ID"), { width }));
  }
  if (taxAmount > 0) {
    blocks.push(...thermalRow("PB1", taxAmount.toLocaleString("id-ID"), { width }));
  }
  blocks.push(
    ...thermalRow("TOTAL", finalTotal.toLocaleString("id-ID"), { width, bold: true }),
    { type: "divider" },
    ...thermalLines(FAREWELL, { width, align: "center" }),
    { type: "text", text: TAGLINE, align: "center", bold: true },
    { type: "text", text: "BELUM DIBAYAR", align: "center", bold: true },
    { type: "feed", lines: PULL_TRAILER_FEED_LINES },
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
      "mm; margin: 0; padding: 2mm; font-size: 11px; position: relative; overflow-wrap: break-word; }",
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
    ".footer { margin-top: 4mm; font-size: 11px; color: #444; text-align: center; }",
    ".tagline { margin-top: 1mm; font-size: 12px; font-weight: bold; text-align: center; }",
    // Blank tail so the receipt can be pulled off the slot without tearing it
    // inside the printer — the browser stand-in for the thermal feed.
    ".trailer { height: " + (PULL_TRAILER_FEED_LINES * RECEIPT_LINE_MM).toString() + "mm; }",
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
    '<div class="center subheader">' +
      new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }) +
      "</div>",
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
    '<div class="footer">' + FAREWELL + "</div>",
    '<div class="tagline">' + TAGLINE + "</div>",
    '<div class="watermark">BELUM DIBAYAR</div>',
    // Blank tail for the tear bar — see PULL_TRAILER_FEED_LINES.
    '<div class="trailer"></div>',
    "</div>",
    "<script>window.onload = function() { window.print(); setTimeout(function() { window.close(); }, 500); }</script>",
    "</body></html>",
  );

  printWindow.document.write(lines.join("\n"));
  printWindow.document.close();
}

// ============================================================
// Checker — the pre-payment slip
// ============================================================

/**
 * The checker reads the order back against the counter before it is paid:
 * the menu, the quantities, and the add-ons, and nothing else. It carries no
 * money fields at all — not "hidden" — so there is nothing on this document
 * for a slip that leaves the counter to quote a price off.
 */
interface PrintCheckerParams {
  cartItems: CartItem[];
  branchName: string;
  /** Outlet address (branches.location) — printed under the brand name. */
  branchAddress?: string | null;
  /** Outlet phone (branches.phone) — printed under the address. */
  branchPhone?: string | null;
  /** Customer name. Omit to show "-". */
  customerName?: string;
  /** External order code (delivery platforms). Omit to show "-". */
  orderCode?: string;
}

/**
 * The pre-payment bill's own header, minus the price column, the totals and
 * the sign-off. `CHECKER` stands where `BELUM DIBAYAR / UNPAID` does on the
 * bill — both say "this is not a receipt", and the checker names its purpose.
 */
function checkerBlocks({
  cartItems,
  branchName,
  branchAddress,
  branchPhone,
  customerName,
  orderCode,
}: PrintCheckerParams): BridgeBlock[] {
  let width = THERMAL_58MM_CHARS;
  let blocks: BridgeBlock[] = [
    { type: "text", text: "CHECKER", align: "center", bold: true, size: "large" },
    { type: "text", text: "Omoiyari", align: "center", bold: true },
  ];
  blocks.push(
    ...thermalLines(branchAddress || branchName, { width, align: "center", size: "small" }),
  );
  if (branchAddress) {
    blocks.push(...thermalLines(branchName, { width, align: "center", size: "small" }));
  }
  blocks.push(
    ...thermalLines("Telp: " + (branchPhone || "-"), { width, align: "center", size: "small" }),
    ...thermalLines(new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }), {
      width,
      align: "center",
      size: "small",
    }),
    { type: "divider" },
    ...thermalRow("Kode Order", orderCode || "-", { width }),
    ...thermalRow("Pelanggan", customerName || "-", { width }),
    { type: "divider" },
    ...thermalLines("Jml  Nama Menu", { width, size: "small" }),
  );
  blocks.push(...thermalItemLines(cartItems, width, false));
  blocks.push({ type: "feed", lines: PULL_TRAILER_FEED_LINES });
  return blocks;
}

/** Falls back to the browser print dialog when no thermal printer is attached. */
export async function printChecker(params: PrintCheckerParams): Promise<void> {
  let result = await printViaBridge({
    content: checkerBlocks(params),
    paperWidth: 58,
    cut: true,
    reference: params.orderCode,
  });
  if (result.kind === "printed") return;
  if (result.kind === "unavailable") {
    printCheckerInBrowser(params);
    return;
  }
  reportPrintFailure(result.message);
}

function printCheckerInBrowser({
  cartItems,
  branchName,
  branchAddress,
  branchPhone,
  customerName,
  orderCode,
}: PrintCheckerParams) {
  let printWindow = window.open("", "_blank");
  if (!printWindow) return;

  let itemsHtml = buildReceiptItemsHtml(cartItems, false);

  const lines: string[] = [
    "<html><head>",
    "<title>Checker</title>",
    "<style>",
    "@page { margin: 0; size: " + RECEIPT_WIDTH_MM + "mm auto; }",
    "body { font-family: 'Courier New', monospace; width: " +
      RECEIPT_WIDTH_MM +
      "mm; margin: 0; padding: 2mm; font-size: 11px; position: relative; overflow-wrap: break-word; }",
    ".wm-wrap { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; z-index: 0; }",
    ".wm-wrap img { max-width: 45mm; opacity: 0.06; }",
    ".content { position: relative; z-index: 1; }",
    ".center { text-align: center; }",
    ".logo { max-width: 25mm; max-height: 15mm; margin-bottom: 1mm; }",
    ".header { font-size: 14px; font-weight: bold; margin-bottom: 1mm; }",
    ".subheader { font-size: 10px; color: #444; margin-bottom: 1mm; }",
    ".divider { border-top: 1px dashed #000; margin: 2mm 0; }",
    ".row { display: flex; justify-content: space-between; }",
    ".watermark { text-align: center; border: 2px dashed #999; padding: 2mm; margin: 3mm 0; color: #999; font-weight: bold; font-size: 13px; }",
    "</style></head><body>",
    '<div class="wm-wrap"><img src="/logo-for-light-mode.png" alt="" /></div>',
    '<div class="content">',
    '<div class="watermark">CHECKER</div>',
    '<div class="center"><img class="logo" src="/logo-for-light-mode.png" alt="Omoiyari" /></div>',
    '<div class="center header">Omoiyari</div>',
    '<div class="center subheader">' + (branchAddress || branchName) + "</div>",
    branchAddress ? '<div class="center subheader">' + branchName + "</div>" : "",
    '<div class="center subheader">Telp: ' + (branchPhone || "-") + "</div>",
    '<div class="center subheader">' +
      new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }) +
      "</div>",
    '<div class="divider"></div>',
    '<div class="row"><span>Kode Order:</span><span>' + (orderCode || "-") + "</span></div>",
    '<div class="row"><span>Pelanggan:</span><span>' + (customerName || "-") + "</span></div>",
    '<div class="divider"></div>',
    // Column header: Jumlah | Nama menu. No Harga — nothing here is priced.
    '<div class="colhead"><span class="qty">Jml</span><span>Nama Menu</span></div>',
    itemsHtml,
    "</div>",
    "<script>window.onload = function() { window.print(); setTimeout(function() { window.close(); }, 500); }</script>",
    "</body></html>",
  ];

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
    ".signatures { display: flex; flex-wrap: wrap; margin-top: 10mm; }",
    ".sig-block { width: 50%; box-sizing: border-box; padding: 3mm 5mm; font-size: 11px; }",
    ".sig-date { margin-bottom: 1mm; }",
    ".sig-space { height: 22mm; }",
    ".sig-name { border-top: 1px solid #000; padding-top: 1mm; }",
    ".footer { margin-top: 10mm; font-size: 10px; text-align: center; color: #666; }",
    "</style></head><body>",
    '<div style="text-align: center; margin-bottom: 3mm;"><img src="/logo.png" alt="Logo" style="max-height: 40px;"/></div>',
    '<div class="header">SURAT JALAN</div>',
    '<div class="subheader">' + dn.code + "</div>",
    '<div class="subheader">' +
      new Date(dn.createdAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }) +
      "</div>",
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
    '<div class="signatures">',
    '<div class="sig-block"><div class="sig-date">Tanggal: ....................</div><div>Pihak ' +
      dn.fromBranchName +
      " (Nama &amp; ttd)</div>" +
      '<div class="sig-space"></div><div class="sig-name">( ........................................ )</div></div>',
    '<div class="sig-block"><div class="sig-date">Tanggal: ....................</div><div>Pihak Penerima (Nama &amp; ttd)</div>' +
      '<div class="sig-space"></div><div class="sig-name">( ........................................ )</div></div>',
    '<div class="sig-block"><div class="sig-date">Tanggal: ....................</div><div>Diperiksa Oleh (Nama &amp; ttd)</div>' +
      '<div class="sig-space"></div><div class="sig-name">( ........................................ )</div></div>',
    '<div class="sig-block"><div class="sig-date">Tanggal: ....................</div><div>Diperiksa Oleh (Nama &amp; ttd)</div>' +
      '<div class="sig-space"></div><div class="sig-name">( ........................................ )</div></div>',
    "</div>",
    '<div class="footer">Dokumen ini dicetak dari Omoiyari POS</div>',
    "<script>window.onload = function() { window.print(); setTimeout(function() { window.close(); }, 500); }</script>",
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
  let width = THERMAL_80MM_CHARS;
  let blocks: BridgeBlock[] = [
    { type: "text", text: "INVOICE SCM", align: "center", bold: true, size: "large" },
    { type: "text", text: inv.code, align: "center" },
    {
      type: "text",
      text: new Date(inv.createdAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }),
      align: "center",
      size: "small",
    },
    { type: "divider" },
    ...thermalRow("Surat Jalan", inv.dnCode, { width }),
    { type: "divider" },
  ];
  for (let i = 0; i < inv.items.length; i++) {
    let item = inv.items[i];
    blocks.push(...thermalLines(item.ingredientName, { width, bold: true }));
    blocks.push(
      ...thermalRow(
        showUnitPrice
          ? item.quantity + " x " + thermalMoney(item.unitPrice)
          : "Qty " + item.quantity,
        thermalMoney(item.totalPrice),
        { width },
      ),
    );
  }
  blocks.push(
    { type: "divider" },
    ...thermalRow("TOTAL", thermalMoney(inv.totalAmount), { width, bold: true }),
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
    '<div class="subheader">' +
      new Date(inv.createdAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }) +
      "</div>",
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
