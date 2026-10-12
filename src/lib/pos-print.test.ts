// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import { printBill, printChecker, printReceipt, printSCMInvoice } from "#/lib/pos-print";
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

/**
 * Nothing may reach the print head wider than the roll: Cleanter clips an
 * overlong line with an ellipsis, and "Combo Hemat C (Crum..." tells the
 * kitchen nothing. So every block must already fit the paper, and must carry
 * no ellipsis of its own.
 */
function expectFitsPaper(blocks: PostedBlock[], width: number): void {
  let printed: string[] = [];
  for (const block of blocks) {
    if (block.type === "text") {
      printed.push(block.text);
      expect(block.text.length).toBeLessThanOrEqual(width);
    }
    if (block.type === "row") {
      printed.push(block.left, block.right);
      expect(block.left.length + block.right.length + 1).toBeLessThanOrEqual(width);
    }
  }
  expect(printed.join(" ")).not.toContain("...");
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
    expect(blocks).toContainEqual({ type: "text", text: "   Extra Telur", size: "small" });
    expect(blocks).toContainEqual({ type: "row", left: "TOTAL", right: "34.089", bold: true });
    expect(blocks[blocks.length - 1]).toEqual({ type: "feed", lines: 3 });
    // Bridged means never touching the browser print dialog.
    expect(window.open).not.toHaveBeenCalled();
  });

  it("prints add-on wording the way the Web UI cart does", async () => {
    await printReceipt({
      order: order,
      cartItems: [
        {
          ...cartItem,
          modifiers: [
            {
              groupId: "g1",
              modifierId: "m1",
              name: "Extra Telur",
              price: 5000,
              isExclusion: false,
            },
            { groupId: "g2", modifierId: "m2", name: "Saus Sambal", price: 0, isExclusion: true },
          ],
        },
      ],
      branchName: "Omoiyari Sudirman",
    });

    const blocks = postedBlocks();
    expect(blocks).toContainEqual({ type: "text", text: "   Extra Telur", size: "small" });
    expect(blocks).toContainEqual({ type: "text", text: "   Tanpa Saus Sambal", size: "small" });
    // The "+"/"X" markers the receipt used to carry are not wording the Web
    // UI cart ever showed, and not wording a kitchen reads.
    expect(blocks.some((block) => block.type === "text" && block.text.includes("+ "))).toBe(false);
    expect(blocks.some((block) => block.type === "text" && block.text.includes("X "))).toBe(false);
  });

  it("wraps long lines instead of letting the printer clip them", async () => {
    await printReceipt({
      order: { ...order, customerName: "Dine in / Dapur Uyung Surabaya Barat" },
      cartItems: [
        {
          ...cartItem,
          name: "Combo Hemat C (Caramel + Free Pork + Extra Teh) Extra Beef 40gr Pork",
        },
      ],
      branchName: "Omoiyari Sudirman",
      branchAddress: "Jl. Batacenter kilometer 9 No. 12,(Block F) Surabaya Barat",
    });

    // Cleanter prints 32 characters across a 58mm roll.
    const blocks = postedBlocks();
    expectFitsPaper(blocks, 32);

    // The menu name survives whole, spread over lines, price on the last.
    const label = blocks
      .filter((block) => block.type === "text" || block.type === "row")
      .map((block) => (block.type === "row" ? block.left : block.text))
      .join(" ")
      .replace(/\s+/g, " ");
    expect(label).toContain(
      "2x Combo Hemat C (Caramel + Free Pork + Extra Teh) Extra Beef 40gr Pork",
    );

    const priceRow = blocks.find(
      (block) => block.type === "row" && block.right === "30.000" && block.bold === true,
    );
    expect(priceRow).toBeDefined();
  });

  it("keeps the invoice on 80mm without clipping a long ingredient name", async () => {
    await printSCMInvoice(
      {
        ...invoice,
        items: [
          {
            ingredientName: "Bahan Olahan Daging Ayam Fillet Beku Kemasan 1kg",
            quantity: 2,
            unitPrice: 25000,
            totalPrice: 50000,
          },
        ],
      },
      { showUnitPrice: true },
    );

    // Cleanter prints 48 characters across an 80mm roll.
    expectFitsPaper(postedBlocks(), 48);
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

describe("thermal checker printing", () => {
  const checkerCart: CartItem = {
    ...cartItem,
    name: "Combo Hemat C (Caramel + Free Pork + Extra Teh)",
    modifiers: [
      { groupId: "g1", modifierId: "m1", name: "Saus Sambal", price: 3000, isExclusion: false },
      { groupId: "g2", modifierId: "m2", name: "Gula", price: 2000, isExclusion: true },
    ],
  };

  async function print() {
    await printChecker({
      cartItems: [checkerCart],
      branchName: "Omoiyari Sudirman",
      branchAddress: "Jl. Sudirman 123",
      branchPhone: "08123456789",
      customerName: "Dine in / Dapur Uyung",
      orderCode: "INV-02210",
    });
  }

  it("is titled CHECKER, not the bill's unpaid banner", async () => {
    await print();

    expect(postedRequest().paperWidth).toBe(58);
    expect(postedRequest().cut).toBe(true);
    expect(postedRequest().reference).toBe("INV-02210");
    const blocks = postedBlocks();
    expect(blocks[0]).toMatchObject({ type: "text", text: "CHECKER", size: "large" });
    expect(
      blocks.some((block) => block.type === "text" && block.text.includes("BELUM DIBAYAR")),
    ).toBe(false);
  });

  it("carries no price at all — not on the items, not in the totals", async () => {
    await print();

    const blocks = postedBlocks();
    const printed = blocks.map((block) =>
      block.type === "row" ? block.left + block.right : block.type === "text" ? block.text : "",
    );
    const paper = printed.join("\n");
    // No money anywhere: no totals block, no sign-off, no rupiah figure.
    expect(paper).not.toMatch(/Rp|\d{1,3}\.\d{3}|Subtotal|TOTAL|Diskon|PB1|KARAAGE|Terima kasih/);
    // The only two-column rows left are the ones identifying the order.
    const rows = blocks.filter((block) => block.type === "row");
    expect(rows.map((block) => (block.type === "row" ? block.left : ""))).toEqual([
      "Kode Order",
      "Pelanggan",
    ]);
  });

  it("still lists the order in full, wrapped and add-ons included", async () => {
    await print();

    const blocks = postedBlocks();
    expectFitsPaper(blocks, 32);

    const label = blocks
      .filter((block) => block.type === "text")
      .map((block) => (block.type === "text" ? block.text : ""))
      .join(" ")
      .replace(/\s+/g, " ");
    expect(label).toContain("2x Combo Hemat C (Caramel + Free Pork + Extra Teh)");
    // Add-on wording still matches the Web UI cart.
    expect(label).toContain("Saus Sambal");
    expect(label).toContain("Tanpa Gula");

    // The bill's opening rows survive so the checker can tie the slip to an order.
    expect(blocks).toContainEqual({ type: "row", left: "Kode Order", right: "INV-02210" });
    expect(blocks).toContainEqual({
      type: "row",
      left: "Pelanggan",
      right: "Dine in / Dapur Uyung",
    });
    expect(blocks[blocks.length - 1]).toEqual({ type: "feed", lines: 3 });
  });

  it("falls back to the browser dialog when no bridge answers", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await printChecker({ cartItems: [cartItem], branchName: "Omoiyari Sudirman" });

    expect(window.open).toHaveBeenCalledWith("", "_blank");
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
