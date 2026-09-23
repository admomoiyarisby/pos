import { describe, expect, it } from "vite-plus/test";
import type { UnknownRecord } from "#/lib/unknown-record";
import {
  STOCK_LEDGER_PAGE_SIZE,
  stockLedgerInputFromSearch,
  stockLedgerQuery,
  stockLedgerSearchSchema,
} from "./stock-ledger-query";

/**
 * Kartu Stok query-key contract.
 *
 * The route loader and the page component both build their query through
 * `stockLedgerQuery`; these tests pin that *equivalent* inputs — the loader's
 * parsed URL vs. the component's hook-derived values, which arrive in
 * different shapes ("" vs undefined, false vs absent, 1-indexed vs 0-indexed
 * page) — always hash to the same cache key. That parity is what guarantees
 * the loader's pre-fetched slice is a cache hit on render: if the keys could
 * drift, a page could render without its rows (or, with `initialData`, with
 * another page's rows — the original duplicate-row bug).
 */
describe("stockLedgerQuery — loader/component key parity", () => {
  it("hashes equivalent inputs to the same key regardless of who built them", () => {
    const fromLoader = stockLedgerQuery(
      stockLedgerInputFromSearch(
        stockLedgerSearchSchema.parse({
          page: "3",
          search: "bowl",
          branchId: "b-1",
          sortKey: "createdAt",
          sortDir: "desc",
        }),
      ),
    );
    const fromComponent = stockLedgerQuery({
      page: 2,
      search: "bowl",
      branchId: "b-1",
      reference: "",
      bomOnly: false,
      bomRecipeId: "",
      dateFrom: "",
      dateTo: "",
      sort: { key: "createdAt", dir: "desc" },
    });

    expect(fromLoader.queryKey).toEqual(fromComponent.queryKey);
    expect(fromLoader.queryKey[1]).toMatchObject({
      page: 2,
      limit: STOCK_LEDGER_PAGE_SIZE,
      search: "bowl",
      branchId: "b-1",
      sortBy: "createdAt",
      sortDir: "desc",
    });
  });

  it("normalizes empty/unset values to the same absent fields on both sides", () => {
    const fromLoader = stockLedgerQuery(
      stockLedgerInputFromSearch(stockLedgerSearchSchema.parse({})),
    );
    const fromComponent = stockLedgerQuery({
      page: 0,
      search: "",
      branchId: "",
      reference: "",
      bomOnly: false,
      bomRecipeId: "",
      dateFrom: "",
      dateTo: "",
      sort: null,
    });

    expect(fromLoader.queryKey).toEqual(fromComponent.queryKey);
    const args = fromLoader.queryKey[1];
    expect(args.branchId).toBeUndefined();
    expect(args.reference).toBeUndefined();
    expect(args.search).toBeUndefined();
    expect(args.wasteBomOnly).toBeUndefined();
    expect(args.wasteBomRecipeId).toBeUndefined();
    expect(args.sortBy).toBeUndefined();
    expect(args.sortDir).toBeUndefined();
  });

  it("maps the 1-indexed URL page to the 0-indexed server page; junk → page 1", () => {
    expect(stockLedgerInputFromSearch(stockLedgerSearchSchema.parse({ page: "3" })).page).toBe(2);
    // Invalid URL values are caught by the schema (unset → page 1 → server 0),
    // matching useTableUrlState's `.catch(1)`.
    expect(stockLedgerInputFromSearch(stockLedgerSearchSchema.parse({ page: "0" })).page).toBe(0);
    expect(stockLedgerInputFromSearch(stockLedgerSearchSchema.parse({ page: "abc" })).page).toBe(0);
    expect(stockLedgerInputFromSearch(stockLedgerSearchSchema.parse({})).page).toBe(0);
  });

  it("treats only a non-empty key with a valid direction as a sort", () => {
    const parse = (search: UnknownRecord) =>
      stockLedgerInputFromSearch(stockLedgerSearchSchema.parse(search)).sort;

    // sortDir outside asc/desc is dropped by the schema → no sort, exactly
    // like useTableUrlState's `sortDirRaw === "asc" || sortDirRaw === "desc"` guard.
    expect(parse({ sortKey: "createdAt", sortDir: "sideways" })).toBeNull();
    expect(parse({ sortKey: "type" })).toBeNull();
    expect(parse({ sortDir: "asc" })).toBeNull();
    expect(parse({ sortKey: "type", sortDir: "asc" })).toEqual({ key: "type", dir: "asc" });
  });

  it("scopes the Waste BOM filter only when bom is on (stale bomRecipe ignored)", () => {
    const on = stockLedgerQuery(
      stockLedgerInputFromSearch(stockLedgerSearchSchema.parse({ bom: "true", bomRecipe: "r-1" })),
    );
    expect(on.queryKey[1]).toMatchObject({ wasteBomOnly: true, wasteBomRecipeId: "r-1" });

    const stale = stockLedgerQuery(
      stockLedgerInputFromSearch(stockLedgerSearchSchema.parse({ bomRecipe: "r-1" })),
    );
    expect(stale.queryKey[1].wasteBomOnly).toBeUndefined();
    expect(stale.queryKey[1].wasteBomRecipeId).toBeUndefined();
  });
});
