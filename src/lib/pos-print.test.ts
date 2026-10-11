// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import { printBill, printReceipt, printSCMInvoice } from "#/lib/pos-print";
import type { CartItem, OrderResult } from "#/lib/pos-types";

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();

// The payload the bridge receives, read back through the same contract the
// layout code writes — so a malformed receipt is a test failure, not noise.
const blockSchema = z.union([
  z.object({
    type: z.literal("text"),
    text: z.string(),
    align: z.string().optional(),
    bold: z.boolean().optional(),
    underline: z.boolean().optional(),
    size: z.string().optional(),
  }),
  z.object({
    type: z.literal("row"),
    left: z.string(),
    right: z.string(),
    bold: z.boolean().optional(),
  }),
  z.object({ type: z.literal("divider"), char: z.string().optional() }),
  z.object({ type: z.literal("feed"), lines: z.number().optional() }),
]);

const printRequestSchema = z.object({
  content: z.array(blockSchema),
  paperWidth: z.number().optional(),
  cut: z.boolean().optional(),
  reference: z.string().optional(),
});

type PostedBlock = z.infer<typeof blockSchema>;

const cartItem: CartItem = {
  recipeId: "recipe-1",
  name: "Nasi Goreng",
  price: 15000,
  quantity: 2,
  modifiers: [
    { groupId: "g1", modifierId: "m1", name: "Extra Telur", price: 5000, isExclusion: false },
  ],
  notes: "",
};

const order: OrderResult = {
  id: "abcdef12-3456-7890-abcd-ef1234567890",
  branchId: "branch-1",
  channel: "Dine In",
  subtotal: 30990,
  taxAmount: 3099,
  totalAmount: 34089,
  totalCogs: 0,
  orderCode: "GF-123",
  customerName: "Budi",
  paymentMethod: "Cash",
  voucherCode: null,
  voucherDiscount: null,
  status: "Completed",
  voidReason: null,
  notes: null,
  shiftId: null,
  createdAt: new Date("2026-10-10T10:00:00.000Z"),
  completedAt: null,
};

const invoice = {
  code: "INV-SCM-001",
  dnCode: "DN-0001",
  totalAmount: 50000,
  status: "Unpaid",
  items: [{ ingredientName: "Ayam Fillet", quantity: 2, unitPrice: 25000, totalPrice: 50000 }],
  createdAt: new Date("2026-10-10T10:00:00.000Z"),
};

function bridgeResponse(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const printedBody = JSON.stringify({ status: "printed", jobId: "job-1" });

/** What Cleanter was handed, parsed. */
function postedRequest(): z.infer<typeof printRequestSchema> {
  const call = fetchMock.mock.calls[0];
  const parsed = printRequestSchema.safeParse(JSON.parse(String(call[1]?.body)));
  if (!parsed.success) {
    throw new Error(`Cleanter received an unreadable print request: ${parsed.error.message}`);
  }
  return parsed.data;
}

/** The blocks Cleanter received, in order. */
function postedBlocks(): PostedBlock[] {
  return postedRequest().content;
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(bridgeResponse(200, printedBody));
  // jsdom cannot open a print window; reaching the fallback is the assertion.
  vi.spyOn(window, "open").mockReturnValue(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("thermal receipt printing", () => {
  it("posts the receipt to the local bridge on a 58mm roll", async () => {
    await printReceipt({
      order: order,
      cartItems: [cartItem],
      branchName: "Omoiyari Sudirman",
      branchAddress: "Jl. Sudirman 123",
      branchPhone: "08123456789",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:9100/print");
    const posted = postedRequest();
    expect(posted.paperWidth).toBe(58);
    expect(posted.cut).toBe(true);
    expect(posted.reference).toBe("GF-123");
    // Cleanter draws the columns; we only supply the content.
    const blocks = postedBlocks();
    expect(blocks[0]).toMatchObject({ type: "text", text: "Omoiyari" });
    expect(blocks).toContainEqual({
      type: "row",
      left: "2x Nasi Goreng",
      right: "30.000",
      bold: true,
    });
    expect(blocks).toContainEqual({ type: "text", text: "+ Extra Telur", size: "small" });
    expect(blocks).toContainEqual({ type: "row", left: "TOTAL", right: "34.089", bold: true });
    expect(blocks[blocks.length - 1]).toEqual({ type: "feed", lines: 3 });
    // Bridged means never touching the browser print dialog.
    expect(window.open).not.toHaveBeenCalled();
  });

  it("keeps the bill's unpaid marking on the thermal print", async () => {
    await printBill({
      cartItems: [cartItem],
      branchName: "Omoiyari Sudirman",
      subtotal: 30000,
      voucherDiscount: 0,
      taxAmount: 3000,
      finalTotal: 33000,
      orderCode: "B-1",
    });

    const blocks = postedBlocks();
    expect(blocks[0]).toMatchObject({ type: "text", text: "BELUM DIBAYAR / UNPAID" });
    expect(blocks[blocks.length - 2]).toMatchObject({ type: "text", text: "BELUM DIBAYAR" });
  });
});

describe("thermal invoice printing", () => {
  it("uses an 80mm roll so item names and prices fit on one line each", async () => {
    await printSCMInvoice(invoice, { showUnitPrice: true });

    expect(postedRequest().paperWidth).toBe(80);
    const blocks = postedBlocks();
    expect(blocks).toContainEqual({ type: "row", left: "2 x Rp 25.000", right: "Rp 50.000" });
    expect(blocks).toContainEqual({
      type: "text",
      text: "Status: BELUM DIBAYAR",
      align: "center",
      size: "small",
    });
  });

  it("drops the HPP unit price when the caller hides it", async () => {
    await printSCMInvoice(invoice, { showUnitPrice: false });

    const blocks = postedBlocks();
    expect(blocks).toContainEqual({ type: "row", left: "Qty 2", right: "Rp 50.000" });
    expect(blocks.some((block) => block.type === "row" && block.left === "2 x Rp 25.000")).toBe(
      false,
    );
  });
});

describe("fallback behaviour", () => {
  it("uses the browser print dialog when no bridge answers", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await printReceipt({ order: order, cartItems: [cartItem], branchName: "Omoiyari Sudirman" });

    expect(window.open).toHaveBeenCalledWith("", "_blank");
  });

  it("stays on the bridge when the printer itself failed, so nothing prints twice", async () => {
    fetchMock.mockResolvedValue(
      bridgeResponse(
        503,
        JSON.stringify({
          error: "printer_unreachable",
          detail: "The printer did not respond.",
          fix: "Check the printer is on, in range, and has paper.",
        }),
      ),
    );

    await printReceipt({ order: order, cartItems: [cartItem], branchName: "Omoiyari Sudirman" });

    expect(window.open).not.toHaveBeenCalled();
  });
});
