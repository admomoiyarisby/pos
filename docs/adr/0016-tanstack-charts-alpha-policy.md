# TanStack Charts (alpha) replaces Recharts

## Context

The dashboard (`src/components/dashboard/Charts.tsx`) and analytics page (`src/routes/_layout/analytics/index.tsx`) rendered all charts with **Recharts 3.10.1** — the project's only charting library. Recharts came with a known, in-app-unfixable defect: **F21** (`docs/report/report.md`) — 6+ identical `width(-1) and height(-1) of chart should be greater than 0` warnings on dashboard load, caused by the chart container measuring 0×0 before the chart renders.

The charts are standard compositions — one area, two donuts, three bar charts — painted from the app's design tokens (`--color-chart-1..5` from `DESIGN.md`/`styles.css`). The user chose to replace Recharts with **TanStack Charts**, a framework-agnostic TypeScript visualization grammar (marks + channels + scales) that keeps application data as-is, renders responsive SSR-safe SVG, measures its container natively (which resolves F21), and fits the TanStack stack already used across the app (Router, Query, Form, Table, Store).

The decisive constraint: **TanStack Charts is alpha** (regular `0.x` versions on the `latest` tag). Its stability policy promises that patch releases only fix defects, but **minor releases may contain breaking API changes** until `1.0`, and there is no minimum deprecation window. It explicitly instructs production applications to pin an exact version and test an upgrade before changing that pin.

## Decision

1. **`@tanstack/charts@0.16.0` is the charting library**, installed **exact-pinned** (`--save-exact`), replacing Recharts (removed from `package.json`). The pin is deliberate: a bare `^0.x` range would let a breaking minor arrive silently.
2. **Upgrades follow the alpha policy.** Bumping `@tanstack/charts` is a reviewed change, not a routine dependency update: read the changeset/migration notes for the target version, re-run `pnpm check` + `pnpm build`, and visually verify the dashboard and analytics pages in light and dark mode before committing the new exact pin. No `latest` ranges for this package.
3. **Use subpath imports, not the root.** Marks/scales/adapters come from exact entries (`@tanstack/charts/scales/*`, `@tanstack/charts/tooltip`, `@tanstack/charts/polar`, `@tanstack/charts/react`, …) so each chart pulls only the grammar it uses, per the package's bundle guidance.
4. **The app's design tokens stay the source of truth for chart styling.** Mark paint and the chart `theme` reference the existing `--color-*` variables; no new palette was introduced.
5. **`d3-shape@3.2.0` (+ `@types/d3-shape`) are direct dependencies** for exactly one reason: the sales-trend area chart uses a monotone curve, and TanStack Charts injects curve factories through `@tanstack/charts/d3/shape` (`d3Curve(factory)`) rather than re-exporting them. Keep these only while that curve is needed.
6. **No second charting library without re-opening this ADR.** Future chart families (heatmaps, networks, maps, …) are checked against TanStack Charts first (including its opt-in polar/canvas entries) before any alternative is introduced.

## Considered Options

- **Stay on Recharts 3.10.1** (rejected). Stable API, but F21 is a library-level container-measurement defect the app cannot fix around, and the user explicitly chose TanStack Charts after researching current versions.
- **Another stable library (nivo / Chart.js / ECharts)** (rejected). The user's choice was TanStack Charts; the alpha risk is accepted and managed by exact-pinning and the upgrade gate in Decision 2.
- **`@tanstack/charts@latest` / `^0.16.0` range** (rejected). A floating range on an alpha violates the package's own stability policy and risks a silent breaking minor.

## Consequences

- **Recharts is gone** — charts render through `@tanstack/charts` only; the migration is confined to `Charts.tsx` and `analytics/index.tsx` (definitions memoized via `useMemo`, since definition identity is the update boundary).
- **F21 is resolved** — TanStack Charts measures its container natively, so the `width(-1)/height(-1)` console warnings disappear.
- **Each `0.x` bump has a real cost** — minor releases may break the API, so upgrades are a task, not a chore; the two chart files are the surface to rework and re-verify.
- **Bundle size grew.** The current build reports a `@tanstack/charts` server chunk of ~295 kB raw / ~67 kB gzip. The package's tree-shaking is subpath-based; future changes should re-measure (per Decision 3) and prune anything unused.
- **Minor visual-parity deviations were accepted** (recorded here so they aren't re-litigated): TanStack Charts rounds all bar corners where Recharts rounded per-corner, and grid lines are solid where Recharts used a dash pattern. Both are subtle and consistent with the design system; revisit only if a designer objects.
- **Alpha risk is consciously carried**: the package pins the API surface via TypeScript; a breaking upgrade fails loudly at `tsc`, not at runtime.

## References

- TanStack Charts stability policy — `node_modules/@tanstack/charts/docs/stability.md` (and https://tanstack.com/charts/latest/docs/stability).
- Migration surface: `src/components/dashboard/Charts.tsx`, `src/routes/_layout/analytics/index.tsx`.
- Dependency pins: `package.json`, `pnpm-lock.yaml` (`@tanstack/charts@0.16.0`, `d3-shape@3.2.0`).
- `docs/report/report.md` **F21** — the Recharts sizing defect this migration resolves.
- `DESIGN.md` (chart palette), `src/styles.css` (`--chart-1..5` tokens) — the styling contract Decision 4 preserves.
