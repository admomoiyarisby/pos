import { z } from "zod";
import { getStockLedger } from "#/lib/server/inventory";

/**
 * Kartu Stok (`/inventory/ledger`) — one ledger page, its cache key, and the
 * URL mapping, in one place.
 *
 * Both entry points build their query through `stockLedgerQuery`:
 *  - the route loader pre-fetches the exact slice the URL asks for with
 *    `queryClient.ensureQueryData`, and
 *  - the page component observes the same key.
 *
 * Because the cache key is the *normalized server args themselves*, React
 * Query can never attach one page's rows to another page's key — a cache miss
 * can only mean "fetch the right rows", never "borrow page 1's rows".
 *
 * Before this existed, the loader ran `getStockLedger({ data: {} })` (page 0,
 * limit 50) and the page passed that payload as `initialData`. React Query
 * applies `initialData` to *every* not-yet-cached query key (verified in
 * query-core: `getDefaultState` runs per new Query instance), and with the
 * DataTable's pagination feature off it sliced those 50 rows down to the
 * first 15 — so "Halaman 5" first painted page 1's rows: the same item
 * appearing on page 5 *and* page 1, and the same for every filter/search/sort
 * change before its refetch landed.
 */
export const STOCK_LEDGER_PAGE_SIZE = 15;

export interface StockLedgerQueryInput {
  /** 0-indexed server page (the URL's `page` param is 1-indexed). */
  page: number;
  /** Free-text search over ingredient/recipe/reference/notes/order code. */
  search?: string;
  /**
   * Raw URL branchId. The server never trusts it — branch_admin is always
   * scoped to their own branch, area_manager's value is validated against
   * their assigned set — so passing the raw value behaves exactly like the
   * page's role-derived value while keeping loader and query keys identical.
   */
  branchId?: string;
  /**
   * Exact `stock_ledger.ingredient_id`. The page otherwise mixes every item, so
   * the Saldo column is not readable as a series until one item is picked.
   * Free-text `search` cannot stand in for this: it also matches `reference`,
   * `notes` and `orders.order_code`, so unrelated rows survive the filter.
   */
  ingredientId?: string;
  /** Exact `stock_ledger.reference` match (deep links, e.g. `?reference=YIELD-*`). */
  reference?: string;
  /** ADR 0013: only ledger rows written by Waste BOM entries. */
  bomOnly?: boolean;
  /** ADR 0013: Waste BOM rows scoped to one recipe (implies `bomOnly`). */
  bomRecipeId?: string;
  /** Jakarta-local `YYYY-MM-DD` lower bound (inclusive). */
  dateFrom?: string;
  /** Jakarta-local `YYYY-MM-DD` upper bound (inclusive). */
  dateTo?: string;
  /**
   * Jakarta-local `HH:MM` lower bound, inclusive. Narrows a movement to a
   * time-of-day window on top of `dateFrom`/`dateTo`.
   *
   * An outlet closes overnight, so a date range alone cannot isolate the hours
   * around a stock count — the Royal Plaza rice audit needed "22:10 on the 4th
   * to 13:00 on the 5th" to see where a balance walked from 6,737 to −103
   * across an ~12h closure. Only meaningful together with its matching date
   * bound; when either is missing the pair is ignored, since a bare clock time
   * with no date is ambiguous.
   */
  timeFrom?: string;
  /** Jakarta-local `HH:MM` upper bound, inclusive. */
  timeTo?: string;
  /** Server-side sort; `null` = newest first (server default). */
  sort?: { key: string; dir: "asc" | "desc" } | null;
}

/**
 * Normalized server args + the query key they hash under.
 *
 * All normalization (empty string → absent, `bomOnly: false` → absent, sort
 * guard) happens here so two callers feeding *equivalent* inputs — the loader
 * via `stockLedgerInputFromSearch`, the component via its hooks — always hash
 * to the same key. React Query hashes keys with sorted object keys, so field
 * order doesn't matter.
 */
export function stockLedgerQuery(input: StockLedgerQueryInput) {
  const args = {
    page: input.page,
    limit: STOCK_LEDGER_PAGE_SIZE,
    branchId: input.branchId || undefined,
    ingredientId: input.ingredientId || undefined,
    reference: input.reference || undefined,
    search: input.search || undefined,
    wasteBomOnly: input.bomOnly || undefined,
    wasteBomRecipeId: input.bomOnly && input.bomRecipeId ? input.bomRecipeId : undefined,
    dateFrom: input.dateFrom || undefined,
    dateTo: input.dateTo || undefined,
    // A clock time is only meaningful against a date, so both halves of each
    // end are required before one is sent — otherwise "10:00" alone would read
    // as a filter the user cannot see or clear.
    timeFrom: input.dateFrom && input.timeFrom ? input.timeFrom : undefined,
    timeTo: input.dateTo && input.timeTo ? input.timeTo : undefined,
    // Unsorted = server default (newest first).
    sortBy: input.sort?.key || undefined,
    sortDir: input.sort?.dir || undefined,
  };
  return {
    queryKey: ["stock-ledger", args] as const,
    queryFn: () => getStockLedger({ data: args }),
  };
}

/**
 * Route search schema for `/inventory/ledger`. Every param the page reads is
 * declared here (each individually `.catch`-guarded, so a junk URL value
 * degrades to "unset" instead of breaking navigation): the route loader's
 * `loaderDeps` and the component's `useTableUrlState` / `useTableSearch` hooks
 * then read the *same* validated values — one parse, no drift between what the
 * loader fetches and what the component keys.
 */
export const stockLedgerSearchSchema = z.object({
  search: z.string().optional().catch(undefined),
  // URL page is 1-indexed (useTableUrlState); invalid → unset → page 1.
  page: z.coerce.number().int().min(1).optional().catch(undefined),
  sortKey: z.string().optional().catch(undefined),
  sortDir: z.enum(["asc", "desc"]).optional().catch(undefined),
  branchId: z.string().optional().catch(undefined),
  ingredientId: z.string().optional().catch(undefined),
  reference: z.string().optional().catch(undefined),
  bom: z.string().optional().catch(undefined),
  bomRecipe: z.string().optional().catch(undefined),
  dateFrom: z.string().optional().catch(undefined),
  dateTo: z.string().optional().catch(undefined),
  // `HH:MM` 24h. A bare `HH:MM`/`:MM` value is rejected so a malformed URL
  // degrades to "no time filter" rather than an impossible range.
  timeFrom: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .optional()
    .catch(undefined),
  timeTo: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .optional()
    .catch(undefined),
});

export type StockLedgerSearch = z.infer<typeof stockLedgerSearchSchema>;

/** Validated route search → the shared query input (1-indexed URL → 0-indexed page). */
export function stockLedgerInputFromSearch(search: StockLedgerSearch): StockLedgerQueryInput {
  return {
    page: (search.page ?? 1) - 1,
    search: search.search,
    branchId: search.branchId,
    ingredientId: search.ingredientId,
    reference: search.reference,
    bomOnly: search.bom === "true",
    bomRecipeId: search.bomRecipe,
    dateFrom: search.dateFrom,
    dateTo: search.dateTo,
    timeFrom: search.timeFrom,
    timeTo: search.timeTo,
    // Mirrors useTableUrlState: only a non-empty key with a valid direction
    // pair is a real sort.
    sort: search.sortKey && search.sortDir ? { key: search.sortKey, dir: search.sortDir } : null,
  };
}
