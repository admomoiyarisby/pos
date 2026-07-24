# Fuzzy, URL-Persisted Table Search

Every free-text search on a `DataTable` list page must (1) persist its value in the URL query string so it survives reload and is shareable, and (2) be typo-tolerant ("fuzzy") on both the client and the server. This was designed by grilling the options one branch at a time; the locked decisions are D1–D6 below.

## Status

Accepted

## Considered Options

**D1 — Definition of "fuzzy"**

- _Token-AND + diacritic-insensitive_ — lowercases, NFKD-strips accents, requires every whitespace token to appear as a substring. No DB extension, but not typo-tolerant.
- **Trigram / typo-tolerant (CHOSEN)** — approximate matching via `pg_trgm` `similarity()` on the server and Fuse.js on the client, so `minuma` matches `minuman`.
- _Bare substring + case/accent fold_ — minimal "fuzzy", no token logic.

**D2 — Engine architecture**

- **Hybrid: keep each page on its current side (CHOSEN)** — server-backed searches use `pg_trgm`; client-filtered `DataTable` pages use Fuse.js. Both persist `?search=` in the URL.
- _Unified server-side (pg_trgm everywhere)_ — moves all client pages to the DB; needs debounce + loader rewrites on ~15 pages.
- _Unified client-side (Fuse everywhere)_ — regresses large/server-authoritative tables (`users`, `branches`); rejected.

**D3 — Server-side trigram behavior**

- **Filter + re-rank by similarity (CHOSEN)** — `GREATEST(similarity(col, $term) …) > 0.3`, `ORDER BY` that score `DESC` when a term is present (empty term → current default order). Multi-column searches (`branches`, `users`, `ingredients`, `vouchers`) combine via `GREATEST`. GIN `gin_trgm_ops` indexes added only on the large searched tables (`ingredients`, `recipes`, `users`, `branches`); small tables scan.
- _Filter only, keep existing order_ — no re-rank.

**D4 — URL mechanics**

- **Shared `useTableSearch()` hook + merge-update (CHOSEN)** — uniform `?search=` param; writes via `navigate({ search: (prev) => ({ ...prev, search: value || undefined }), replace: true })` so sibling URL params (`status`, `negative`, `noInvestigation`) are preserved; empty string normalised to `undefined`; debounce ~250ms on server-backed pages only; scope = search term only (sort/page NOT persisted).
- _Inline boilerplate per page_ — repeats code and risks dropping sibling filters.

**D5 — Client (Fuse.js) config**

- **Threshold `0.3`, `ignoreLocation: true`, keys = `searchKeys ??` all primitive row keys, re-rank by score when no column sort is active (CHOSEN)** — mirrors the server re-rank.
- _Filter-only (no re-rank)_, _loose threshold ~0.5_ (false positives on short labels) — rejected.

**D6 — Scope**

- **~22 `DataTable` list pages + the custom `inventory`/`waste` "Cari bahan" boxes (CHOSEN)**. `pos.tsx` MenuGrid, `data-penjualan.tsx`, and form item-pickers (`scm-transfers/new.tsx`, `modifier-groups/$mgId.tsx`) are out of scope — not table-page main searches.

## Consequences

- **No in-scope table page currently hits the server for search.** Every `DataTable` list page loads all rows and filters client-side, so the table-page work is entirely Fuse.js + `useTableSearch()`. The `pg_trgm` migration and server-fn upgrades apply to the _server search functions_ (consumed by POS and future callers), not to table pages.
- Pages that have a server search fn but filter client-side today (`recipes`, `ingredients`, `modifier-groups`) **stay client-side Fuse** per D2 — we do not flip them to server search.
- Server fuzzy predicate is `(col ILIKE '%term%' OR similarity(col, term) > 0.3)` combined via `GREATEST`, so short/exact queries (e.g. voucher code `VC…`) still match by substring while typos get trigram tolerance; results order by that score.
- New dependency: `fuse.js`. New migration: `CREATE EXTENSION IF NOT EXISTS pg_trgm` + `gin_trgm_ops` GIN indexes on the four large tables.
- `modifier-groups` (the original reference) is refactored onto the shared `useTableSearch()` hook so there is exactly one pattern.
