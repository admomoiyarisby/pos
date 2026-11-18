# 0033 — The Recommendation Lead Time Is Configurable

> Amends ADR 0027. The 3-day usage window, the source rows, the status
> thresholds' shape, and every other rule in ADR 0027 still stand. Only the
> 5-day lead time moves from a constant to a setting.

## Context

ADR 0027 fixed the reference at `avgDailyUsage × 5`, and the Settings page at
`/admin` showed that formula as a card with a number input. The input was a
mock: uncontrolled, no save button, and no reader. The recommendation engine
kept using the `LEAD_TIME_DAYS = 5` constant, so the screen and the numbers it
claimed to configure could never agree.

The business now wants to change the horizon (e.g. a longer supplier lead time)
without a deploy.

## Decision

- Store the horizon in `app_settings` under `stock_lead_time_days`. Default
  **5** when the row is missing or unreadable; valid whole days are **1–90**.
  Anything else falls back to 5 rather than producing a nonsensical target.
- `getStockRecommendationCore` reads the setting once per call and passes it to
  the pure `stockRecommendationFor`. The usage window stays the fixed 3 complete
  Jakarta days from ADR 0027 — the page does not expose it.
- The status bands move with the horizon: `low` below `L`, `watch` from `L` to
  `L + 2`, `ok` above. With `L = 5` this is exactly ADR 0027's 5/7 bands.
- `/admin` loads the stored value, validates and saves it through
  `updateStockRecommendationSettings`, and invalidates the
  `stock-recommendations` query family so Inventori and Pengadaan show the new
  target immediately.
- The legacy `reorder_rop_days` / `reorder_roq_days` settings and the "Smart
  Reordering" button are untouched: they answer a different formula over a
  30-day window.

## Consequences

- The number in the settings card is now the number the engine uses; the
  "Acuan N hari" labels on Inventori and Pengadaan read it from each
  recommendation instead of hardcoding 5.
- Changing the setting changes every branch's target at once. It is a global
  planning horizon, not a per-ingredient lead time; per-ingredient lead times
  would need their own column and migration (ADR 0027's open door remains).
- Status markers and their hints are relative to the configured horizon, so a
  10-day horizon no longer labels 6 days of cover "watch".
- Stored values outside 1–90 are ignored at read time, so a bad manual edit
  degrades to the default instead of breaking recommendations.

## References

- ADR 0027 — the safety-stock rule this amends.
- `src/lib/stock-recommendation.ts` (pure thresholds and normalizer),
  `src/lib/server/stock-recommendation.ts` (settings read/write and engine),
  `src/routes/_layout/admin/index.tsx` (settings card).
- ADR 0015 — the user-parameterized core seam used by the engine tests.
