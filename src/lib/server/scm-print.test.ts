import { describe, expect, it } from "vite-plus/test";
import { buildSuratJalanHtml } from "./scm-print";

/**
 * Two prints come out of the same document: the shipped surat jalan (what
 * actually left the warehouse) and the preparation sheet the reviewer prints at
 * the review stage, whose Qty Kirim and Keterangan columns are deliberately
 * empty so the team packing the goods writes them by hand.
 *
 * Both prints carry the same columns — the paper form the client's team already
 * writes on: Qty Order next to Qty Kirim, plus Keterangan.
 */
const base = {
  code: "PRWYG/091126/01",
  shippedAt: null,
  createdAt: new Date("2026-09-11T03:00:00.000Z"),
  sourceBranchName: "Central Kitchen (Food Prep)",
  destBranchName: "Omoiyari Wiyung",
};

const items = [
  {
    id: "1",
    ingredientName: "Plastik Kresek 20",
    stockUnit: "pack",
    quantity: 5,
    pickedQuantity: 3,
    caDecision: "approved" as const,
  },
  {
    id: "2",
    ingredientName: "Tutup Bowl 650 ml",
    stockUnit: "pcs",
    quantity: 1500,
    pickedQuantity: null,
    caDecision: "pending" as const,
  },
  {
    id: "3",
    ingredientName: "Paper Bowl 650 ml",
    stockUnit: "pcs",
    quantity: 200,
    pickedQuantity: null,
    caDecision: "rejected" as const,
  },
];

/** Rows only, so an assertion cannot accidentally match the signature block. */
function bodyRows(html: string) {
  return html
    .split("<tbody>")[1]!
    .split("</tbody>")[0]!
    .split("<tr>")
    .slice(1)
    .map((row) =>
      row
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    );
}

describe("buildSuratJalanHtml", () => {
  it("keeps the columns the client's team writes on", () => {
    const html = buildSuratJalanHtml({ ...base, items });

    expect(html).toContain(">Qty Order<");
    expect(html).toContain(">Qty Kirim<");
    expect(html).toContain(">Satuan<");
    expect(html).toContain(">Keterangan<");
  });

  it("prints the shipped document with ordered and picked quantities only", () => {
    const html = buildSuratJalanHtml({ ...base, items });

    expect(html).toContain("<body>");
    expect(html).toContain("</html>");
    // Rejected and un-picked lines never reach the shipped sheet.
    expect(bodyRows(html)).toEqual(["1 Plastik Kresek 20 5 pack 3"]);
  });

  it("prints every line still in play on the blank-qty preparation sheet", () => {
    const html = buildSuratJalanHtml({ ...base, items, blankQuantity: true });

    expect(html).toContain("Kolom Qty Kirim dan Keterangan diisi tangan");
    // Pending and approved lines are listed — with the ordered quantity, so the
    // packer knows how much to prepare — but the rejected one is not. Qty Kirim
    // and Keterangan are empty on purpose: those blanks are what gets written
    // on by hand.
    expect(bodyRows(html)).toEqual(["1 Plastik Kresek 20 5 pack", "2 Tutup Bowl 650 ml 1.500 pcs"]);
  });

  it("says so instead of printing an empty table", () => {
    expect(buildSuratJalanHtml({ ...base, items: [] })).toContain("Tidak ada item yang dikirim.");
    expect(buildSuratJalanHtml({ ...base, items: [], blankQuantity: true })).toContain(
      "Tidak ada item untuk disiapkan.",
    );
  });

  it("escapes ingredient names so a stray < cannot break the sheet", () => {
    const html = buildSuratJalanHtml({
      ...base,
      items: [{ ...items[0]!, ingredientName: "Gelas <b>16oz</b> & lid" }],
      blankQuantity: true,
    });

    expect(html).toContain("Gelas &lt;b&gt;16oz&lt;/b&gt; &amp; lid");
    expect(html).not.toContain("<b>16oz</b>");
  });
});
