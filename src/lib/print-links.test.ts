import { describe, expect, it } from "vite-plus/test";
import { financePrintUrl, PRINT_FINANCE_PATH, stockOpnamePrintUrl } from "./print-links";

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
