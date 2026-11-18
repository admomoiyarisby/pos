# 0034 — Dashboard Charts Aggregate on the Server Over One Page-Level Range

## Context

The dashboard charts were roll-ups of the 100 newest orders fetched into the
browser (`limit(100)`, no date bound). That had four consequences:

1. **Truncation.** A busy branch could pass 100 orders before lunch, so "today",
   the 7-day trend, the channel mix, and branch revenue all quietly understated
   the day.
2. **Wrong statuses.** Sales totals, the trend, and the channel pie included
   `Void` orders; only the branch and brand charts filtered `Completed`.
3. **Dead brand chart.** Brand revenue read `order.brandId`, but the column
   lives on `order_items` and was never selected or joined. Only manual-revenue
   breakdowns could populate it.
4. **No real range.** Only the Produksi & Waste tab had a period filter. The
   other tabs and charts had no range at all, and the page had no branch filter.

The analytics page had the same status problem and no shortcuts, while the
dashboard's read path also failed to scope area managers beyond production and
waste.

## Decision

### One range, applied everywhere

- The page-level filter is a resolved inclusive Jakarta day range
  (`from`/`to`) with presets: **Hari ini, 7 hari, 30 hari, 90 hari, Bulan ini,
  Bulan lalu, Semua waktu**, plus editable custom dates. Editing either date
  switches to `custom`; presets never leave stale custom ends in the URL.
- The filter lives in the URL via TanStack Router search params
  (`period`, `from`, `to`, `branch`) so a reload, back button, or shared link
  restores the same view.
- Every tab and every chart consumes this range. The production/waste tab no
  longer keeps its own competing date controls; all tabs follow the page range.
  The chart subtitles show the active date label.

### Server-side aggregates

`getDashboardOverview` computes the stats, trend, channel mix, branch sales,
brand sales, and current low stock in SQL over the `from`/`to` filter:

- `deleted_at IS NULL` and `status <> 'Void'` for sales. The void count is a
  separate query so the anomaly card still sees them.
- Days are bucketed in `Asia/Jakarta`, matching the POS, finance, and stock
  reports.
- Trend buckets are daily for spans ≤ 45 days, weekly for ≤ 180, monthly
  otherwise (all-time is monthly). Empty buckets are filled with zero so a
  quiet day is a zero, not a line that skips it.
- Brand revenue comes from `order_items.brand_id` joined to `brands`, plus the
  manual-revenue brand breakdowns for `super_admin`.
- Branch scope uses the shared `scopedBranchIds`: central roles see all or the
  requested branch, area managers see their assignments, branch admins their
  own branch. The same scope applies to inventory and detail rows.
- Table row sets come from `getDashboardDetails` with the same range, capped
  (500 orders/production/waste, 200 stock opnames). When a cap bites, the UI
  says so instead of implying completeness.

### TanStack Query keys

Both queries key on `(from, to, branch)` and use `keepPreviousData`, so changing
a shortcut refetches from the server without blanking the screen. Details load
only when a tab needs them. The overview polls every 60 seconds; the filter bar
has an explicit refresh.

### Analytics page

`/analytics` reuses the same range presets and URL state. `getSalesAnalytics`
now accepts optional dates (for "Semua waktu"), rejects half-specified ranges,
allows up to 366 days, and excludes void and soft-deleted orders from both the
channel mix and top sales.

## Consequences

- The charts describe the complete filtered set, not a fixed sample. Large
  ranges (especially all-time) cost a few SQL aggregates instead of shipping
  every order row to the browser.
- The range and branch are shareable; two supervisors looking at the same URL
  see the same numbers.
- The low-stock table remains a current-state read (it is a present health
  check, not history), while every dated chart/table follows the range.
- COGS and HPP tables remain snapshot calculations over current recipes and
  ingredient costs; the Keuangan tab labels them as such.
- Row caps are visible, so the Operations tab cannot silently hide older
  orders in a very wide range.

## References

- `src/lib/dashboard-range.ts` (presets, labels, trend buckets),
  `src/lib/server/dashboard.ts` (overview/details cores),
  `src/lib/server/branch-scope.ts`, `src/routes/_layout/dashboard.tsx`,
  `src/routes/_layout/analytics/index.tsx`,
  `src/components/dashboard/DashboardFilterBar.tsx`.
- ADR 0015 — user-parameterized cores used by the integration tests.
- ADR 0027 / 0033 — Jakarta-day stock reporting and configurable lead time.
