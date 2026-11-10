import { describe, expect, it } from "vite-plus/test";
import { buildSuratJalanHtml } from "./scm-print";

/**
 * Two prints come out of the same document: the shipped surat jalan (what
 * actually left the warehouse) and the preparation sheet the reviewer prints at
 * the review stage, whose Qty column is deliberately empty so the team packing
 * the goods writes the quantity by hand.
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
    pickedQuantity: 3,
    caDecision: "approved" as const,
  },
  {
    id: "2",
    ingredientName: "Tutup Bowl 650 ml",
    stockUnit: "pcs",
    pickedQuantity: null,
    caDecision: "pending" as const,
  },
  {
    id: "3",
    ingredientName: "Paper Bowl 650 ml",
    stockUnit: "pcs",
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
  it("prints the shipped document with picked quantities only", () => {
    const html = buildSuratJalanHtml({ ...base, items });

    expect(html).toContain("<body>");
    expect(html).toContain("</html>");
    expect(html).toContain(">Qty<");
    // Rejected and un-picked lines never reach the shipped sheet.
    expect(bodyRows(html)).toEqual(["1 Plastik Kresek 20 3 pack"]);
  });

  it("prints every line still in play on the blank-qty preparation sheet", () => {
    const html = buildSuratJalanHtml({ ...base, items, blankQuantity: true });

    expect(html).toContain(">Qty Kirim<");
    expect(html).toContain("Kolom Qty Kirim diisi tangan");
    // Pending and approved lines are listed; the rejected one is not. The qty
    // cell is empty on purpose: that blank is what gets written on by hand.
    expect(bodyRows(html)).toEqual(["1 Plastik Kresek 20 pack", "2 Tutup Bowl 650 ml pcs"]);
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
