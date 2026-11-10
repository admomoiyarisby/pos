import { describe, expect, it } from "vite-plus/test";
import {
  financePrintUrl,
  PRINT_FINANCE_PATH,
  procurementInvoicePrintUrl,
  procurementSuratJalanPrintUrl,
  stockOpnamePrintUrl,
  transferInvoicePrintUrl,
  transferSuratJalanPrintUrl,
  wantsBlankQtySheet,
} from "./print-links";

describe("financePrintUrl", () => {
  it("drops empty filters instead of writing `undefined` into the query", () => {
    expect(financePrintUrl({})).toBe(PRINT_FINANCE_PATH);
    expect(financePrintUrl({ dateFrom: "", branchId: undefined })).toBe(PRINT_FINANCE_PATH);
  });

  it("carries every filter the report understands", () => {
    const url = financePrintUrl({
      dateFrom: "2026-10-01",
      dateTo: "2026-10-31",
      branchId: "f134c899-53f2-468d-80bf-87b0c4157d25",
      channel: "Gofood",
    });

    // Parsed rather than string-compared: the order of the parameters is not
    // part of the contract, the names are.
    expect(url.startsWith(`${PRINT_FINANCE_PATH}?`)).toBe(true);
    const params = new URL(url, "https://pos.test").searchParams;
    expect(Object.fromEntries(params)).toEqual({
      dateFrom: "2026-10-01",
      dateTo: "2026-10-31",
      branchId: "f134c899-53f2-468d-80bf-87b0c4157d25",
      channel: "Gofood",
    });
  });

  it("stays a same-origin path so the session cookie rides along", () => {
    // A navigation, not an RPC: it must never become an absolute URL pointing
    // at another host, or the print window would arrive signed out.
    expect(financePrintUrl({ branchId: "abc" }).startsWith("/")).toBe(true);
  });
});

describe("stockOpnamePrintUrl", () => {
  it("carries the stock opname the detail page is showing", () => {
    const url = stockOpnamePrintUrl("33333333-3333-3333-3333-333333333333");
    const parsed = new URL(url, "https://pos.test");
    expect(parsed.pathname).toBe("/api/print/stock-opname");
    expect(parsed.searchParams.get("soId")).toBe("33333333-3333-3333-3333-333333333333");
  });
});

describe("SCM document URLs", () => {
  // One table: the point is that every button/route pair agrees on the path and
  // on the query key, and a typo in either is what this catches.
  const cases = [
    [procurementSuratJalanPrintUrl, "/api/print/procurement/surat-jalan", "procurementId"],
    [procurementInvoicePrintUrl, "/api/print/procurement/invoice", "procurementId"],
    [transferSuratJalanPrintUrl, "/api/print/transfer/surat-jalan", "transferId"],
    [transferInvoicePrintUrl, "/api/print/transfer/invoice", "transferId"],
  ] as const;

  for (const [buildUrl, path, param] of cases) {
    it(`${path} takes ${param}`, () => {
      const parsed = new URL(buildUrl("abc-123"), "https://pos.test");
      expect(parsed.pathname).toBe(path);
      expect(parsed.searchParams.get(param)).toBe("abc-123");
    });
  }
});

describe("procurementSuratJalanPrintUrl variants", () => {
  it("asks for the shipped document by default", () => {
    const parsed = new URL(procurementSuratJalanPrintUrl("abc-123"), "https://pos.test");
    expect(parsed.searchParams.get("blankQty")).toBeNull();
    expect(wantsBlankQtySheet(parsed.searchParams)).toBe(false);
  });

  it("carries the blank-qty flag the print route reads back", () => {
    // Button and route must agree on both the flag name and the value the route
    // treats as "on" — a mismatch prints the wrong document silently.
    const parsed = new URL(
      procurementSuratJalanPrintUrl("abc-123", { blankQty: true }),
      "https://pos.test",
    );
    expect(parsed.pathname).toBe("/api/print/procurement/surat-jalan");
    expect(parsed.searchParams.get("procurementId")).toBe("abc-123");
    expect(wantsBlankQtySheet(parsed.searchParams)).toBe(true);
  });

  it("does not treat any other value as the blank-qty sheet", () => {
    expect(wantsBlankQtySheet(new URLSearchParams("blankQty=true"))).toBe(false);
    expect(wantsBlankQtySheet(new URLSearchParams("blankQty=0"))).toBe(false);
  });
});
