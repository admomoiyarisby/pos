---
target: src/routes/_layout/dashboard.tsx
total_score: 27
p0_count: 0
p1_count: 3
p2_count: 3
timestamp: 2026-06-07T16-21-41Z
slug: src-routes-layout-dashboard-tsx
---

# Critique: Dashboard Page

**Target**: `src/routes/_layout/dashboard.tsx` + 7 component files under `src/components/dashboard/`
**Slug**: `src-routes-layout-dashboard-tsx`
**Prior score**: 29/40 (2026-05-27)

## Your three notes, addressed first

You called out three concrete things. All three are real and ranked P1. I've woven them into the priority issues below; here is the short version so you can act on them in any order:

1. **Double header** — confirmed. `AppShell.tsx` renders the page title from `usePageTitle` (already fed `"Dashboard" / "Analitik & ikhtisar"`), and `dashboard.tsx` then renders the same h1 + subtitle again in JSX. The top one (in `AppShell`) is the one to keep, because the layout shell applies it to every routed page and it lives next to the mobile menu, theme toggle, and notification bell. The block in `dashboard.tsx` (lines 167–178) is the duplicate and should be removed. The "Terakhir diperbarui" timestamp can stay, but move it inline with the AppShell header on the right (e.g. position it just before the notification bell) so the breadcrumb-like summary isn't orphaned in the body.
2. **Bento layout is messy** — confirmed, and worse than just "messy." The super_admin path stacks eight sections with **six different column counts** (3, 2, 1, 2, 2, 3, 2, 1), and `WasteLossTable` sits alone in a 2-col grid with the second column rendering as dead space. The HPP+Discrepancy row uses a 3-col `1+2` split that reads as accidental, not designed. Stats are at the top, Order History (the thing the user most often wants) is at the bottom, and the anomaly alert block is wedged between Stats and COGS with no narrative thread. It looks like a stream-of-consciousness layout, not an information architecture.
3. **Stock alert → Top 10 unsafe ingredients table** — confirmed, and the data is already computed. `lowStockItems` in `dashboard.tsx` (lines 102–110) builds exactly the dataset you want (name, current quantity, ROP), but it gets flattened into a `detail: string[]` on the anomaly card and rendered as a truncated `<ul>`. The alert should stay, and a proper table — sortable, with status badges, ideally with a "Buat PR" action — should follow it. There's already a `RopRoqTable` component in this folder that does almost exactly this; the right answer is to compute and render a focused 10-row "Unsafe Stock" table from the same `lowStockItems` data, sitting right after the alert card.

## Design Health Score

| #         | Heuristic                       | Score     | Key Issue                                                                                                                      |
| --------- | ------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1         | Visibility of System Status     | 3         | "Terakhir diperbarui" exists in the duplicate header that should be removed; relocate it to the top bar                        |
| 2         | Match System / Real World       | 4         | Indonesian throughout, domain language accurate                                                                                |
| 3         | User Control and Freedom        | 2         | No way to clear filters, collapse sections, or pin a section; long page forces a linear top-to-bottom scan                     |
| 4         | Consistency and Standards       | 1         | **Double header (P1)**, mixed card padding (p-3 / p-4 / p-6), six different grid column counts, one dead-cell in WasteLoss row |
| 5         | Error Prevention                | 4         | Read-only surface, safe defaults, no destructive paths                                                                         |
| 6         | Recognition Rather Than Recall  | 4         | Every section is labeled, tables have clear headers, no icon-only controls                                                     |
| 7         | Flexibility and Efficiency      | 2         | Order History has search, but no date range, no channel filter, no export; no section collapse; no "jump to"                   |
| 8         | Aesthetic and Minimalist Design | 2         | Double header is visual noise; the bento inconsistency creates the "I am looking at someone's stream of cards" feeling         |
| 9         | Error Recovery                  | 3         | Skeleton states, empty states, no destructive actions to recover from                                                          |
| 10        | Help and Documentation          | 2         | No tooltips on COGS/ROP/Variance thresholds; ROP/ROQ has the only explainer card                                               |
| **Total** |                                 | **27/40** | **Acceptable — significant improvements needed before the dashboard feels intentional**                                        |

The score dropped from 29 to 27 because the layout inconsistencies (your #2) and the structural duplication (your #1) are exactly the things the design system was built to prevent, and they were already there in the prior run. The functional gap on stock alerts (your #3) prevents a score lift.

## Anti-Patterns Verdict

**Does this look AI-generated?**

The dashboard has the right ingredients (restrained palette, tables over cards, role-gated sections) but the layout is what gives it away. Six different grid configurations stacked down the page read as "I generated each section independently and dropped them into a `space-y-6` wrapper." The double header is the kind of duplication that happens when one feature (the AppShell page-title) is added on top of an existing manual header without removing the old one — the layered-history tell.

**Deterministic scan**: 1 finding.

```
{ antipattern: "side-tab", severity: "warning",
  file: "OrderHistoryTable.tsx", line: 161,
  snippet: "border-l-2 border-l-rose-500 / border-l-emerald-500 / border-l-orange-500 / border-l-blue-500" }
```

The channel pills use a `border-l-2` colored stripe to identify the channel (Gofood, Grabfood, ShopeeFood, Dine-in). This is the exact side-stripe-border pattern the design system bans: "border-left or border-right greater than 1px as a colored accent on cards, list items, callouts, or alerts. Never intentional." The same channel is also distinguishable by name, so the colored stripe is pure decoration. Replace with a normal `Badge` variant (e.g. use the channel name as the text, no left border) or move the color to a small dot beside the label.

## Overall Impression

The dashboard knows what data it wants to show. It just doesn't know what order to show it in, and it's doing the work twice on the header. The bones — tables, pagination, role-gated sections, anomaly detection, Indonesian throughout — are solid. The job is to make the page read as **one designed surface**, not eight independent widgets dropped into a column.

## What's Working

1. **Role-based content segmentation.** The super_admin branch correctly unlocks COGS, ROP/ROQ-style analysis, and brand/branch comparisons; non-super roles get a stripped-down view. Faithful to the "Role-based opacity" principle and saves vertical space for branch admins.
2. **Computed data lives next to its display.** `computeCogsData`, `computeDiscrepancies`, `computeWasteLoss` etc. are pure functions, easy to test and to reuse for the new unsafe-stock table you asked for.
3. **The skeleton + empty-state discipline is consistent.** Every table handles "no data" the same way. Loading and empty are first-class, not afterthoughts.

## Priority Issues

### P1: Remove the duplicate header in `dashboard.tsx`

**What**: `dashboard.tsx` lines 166–179 renders `<h1>Dashboard</h1>` + `<p>Analitik & ikhtisar</p>` + the "Terakhir diperbarui" timestamp. `AppShell.tsx` already renders the same title and subtitle from `usePageTitle` (the dashboard calls `usePageTitle("Dashboard", "Analitik & ikhtisar")` on line 32), positioned next to the mobile menu, theme toggle, and notification bell. Two h1s on the same page is an a11y failure and a visual tell.

**Why it matters**: WCAG 2.1 expects a single `<h1>` per page. Screen readers announce both. Visually the page reads as broken. The "Terakhir diperbarui" timestamp is also stranded — the user has to scan past it to find the real content.

**Fix**:

- Delete the `<div className="flex items-center justify-between">…</div>` block at `dashboard.tsx` lines 166–179.
- Promote the "Terakhir diperbarui" timestamp into the AppShell header bar (or a thin sub-header strip directly under it). Easiest: pass `dataUpdatedAt` through a small `useDataFreshness` context, or render the timestamp as a slot inside the AppShell alongside the theme/notification controls.
- Verify the resulting page still has exactly one `<h1>` ("Dashboard").

**Suggested command**: `/impeccable layout dashboard`

---

### P1: Redesign the section bento — pick a single column grammar and stick to it

**What**: The current `dashboard.tsx` body uses six different grid configurations stacked vertically:

- StatsCards: `md:grid-cols-3`
- Anomaly alerts: `md:grid-cols-2`
- COGS Analysis: full width
- Sales Trend + Channel Pie: `lg:grid-cols-2`
- Sales by Branch + Brand Performance: `lg:grid-cols-2`
- HPP + Discrepancy: `lg:grid-cols-3` with HPP spanning 1 and Discrepancy spanning 2 (off-balance)
- WasteLoss: `lg:grid-cols-2` with **one child** — second column is dead space
- Order History: full width

This isn't a bento — it's eight sections each with their own random column count.

**Why it matters**: Cognitive load test fails on "Visual hierarchy" and "Single focus" (the user can't predict where the next thing will land). The dead cell in the WasteLoss row is also an obvious "this isn't finished" signal. The split `1+2` in HPP+Discrepancy is harder to read than two equal columns.

**Fix**: Pick one of two grammars and use it everywhere.

**Option A (preferred — content-first)**: Single column for the main thread, occasional sidebars.

1. **Header** (from AppShell) + "Terakhir diperbarui" stamp
2. **Stats row**: 3 equal cards (`md:grid-cols-3`, `gap-6`)
3. **Anomaly alerts**: full-width stack of alert rows (not a 2-col grid; alerts read better full-width)
4. **Top 10 Unsafe Stock table** (new, see P1 below) — full width
5. **Sales Trend** (full width, taller chart) + **Channel Pie** as a 2-col row
6. **COGS Analysis** full width
7. **Sales by Branch** + **Brand Performance** as a 2-col row
8. **Discrepancy** + **Waste Loss** as a 2-col row (give Waste Loss a partner; drop HPP cards from the dashboard or fold them into COGS as a column)
9. **HPP** — keep as a small section or merge with COGS
10. **Order History** full width at the bottom

**Option B (true bento)**: An intentional 12-col grid where each section declares its span (`col-span-12`, `col-span-6`, `col-span-4`) and the proportions carry meaning. Harder to get right; only do this if you commit to it across the whole app, not just the dashboard.

Either way, the **HPP + Discrepancy 1+2 split is wrong** — go to 1+1 or 2+1, or merge HPP into COGS. And **delete the `<div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-2">` wrapper around `WasteLossTable`** — it's a 2-col grid holding one child, which is the visual you called "messy."

**Suggested command**: `/impeccable layout dashboard`

---

### P1: Add a "Top 10 Unsafe Stock" table after the Stock Alert

**What**: The Stock Alert currently shows up as a single rose-tinted card in the Anomaly Detection row, with the actual offending ingredients collapsed into a 1-line `truncate` list. The data is already there: `lowStockItems` in `dashboard.tsx` is an array of `{ ingredientName, quantity, rop, … }` sorted by `quantity` ascending and sliced to 10. Promote it to a proper table.

**Why it matters**: "X bahan baku di bawah batas aman" with a 10-line truncated list is un-actionable. The user has to mentally parse "Tepung: 50 (ROP: 80)" to know whether to reorder. A proper table with columns for ingredient, current qty, ROP, gap (`rop - quantity`), unit, and a status badge (KRITIS / PERHATIAN / AMAN) is the difference between a passive alert and a working tool. From this table the area manager can decide which items to put on a purchase requisition — the dashboard should make that one click away.

**Fix**:

- Create a new component `src/components/dashboard/UnsafeStockTable.tsx` that takes `lowStockItems` and renders the existing 10 rows in a table with: `Bahan Baku`, `Stok Saat Ini`, `ROP`, `Selisih (ROP − Stok)`, `Satuan`, `Status`, and an inline "Buat PR" button (link to `/purchase-requisitions/new?ingredientId=…`).
- Reuse the same `rounded-lg border bg-card p-6 shadow-sm` container pattern as the other tables for visual consistency.
- Wire it into `dashboard.tsx` so it renders **directly after** the Anomaly Detection block (the Stock Alert card), and only when `lowStock.length > 0`. If there are zero unsafe items, skip the section entirely (don't render an empty card).
- The current `anomalies[].detail` array becomes redundant — remove the `detail` rendering from the alert card, and let the table be the source of truth.

**Suggested command**: `/impeccable shape dashboard`

---

### P2: Channel pill stripes violate the design system ban

**What**: `OrderHistoryTable.tsx` line 161 maps each channel to a class with `border-l-2 border-l-rose-500` (or emerald/orange/blue). The design system explicitly bans side-stripe colored borders on list items, and the bundled detector flags it.

**Why it matters**: It's the only place in the dashboard with this pattern, so it draws the eye. And the channel is already identified by name in the cell — the stripe is decorative.

**Fix**: Replace the custom pill with a standard `Badge` (use the existing `variant` system: outline + colored text, or add a `channel` variant). Drop the `border-l-2`. If you want a small color cue, put a 6×6 dot to the left of the text.

**Suggested command**: `/impeccable quieter OrderHistoryTable`

---

### P2: Skeleton layout doesn't match the real layout

**What**: The loading skeleton (lines 47–72) shows 4 stat-card skeletons in a `md:grid-cols-3` grid, but the real `StatsCards` renders 3 cards. The skeleton is also missing skeletons for the new section flow (anomaly alerts, charts, tables).

**Why it matters**: Heuristic #1. Users see a 4-card layout for a moment, then it resolves to a 3-card layout. And the page jumps in size when content arrives.

**Fix**: Render the skeleton to mirror the real layout exactly. After you redesign the bento (P1), rewrite the skeleton in the same order with the same column counts. If the design changes the stat count to 4, do that; otherwise make the skeleton 3.

**Suggested command**: `/impeccable polish dashboard`

---

### P2: Section ordering puts the most actionable data last

**What**: Order History (the most operationally important table — the audit trail) is at the bottom of the page. Charts and analysis tables sit above it. A super admin opening the dashboard to "check what's happening" has to scroll past five sections to find it.

**Why it matters**: For a read-only operational dashboard, the most-frequently-consulted table should be reachable in one screen or near the top. The current ordering optimizes for "show off what we can compute" rather than "answer the user's first question."

**Fix**: Reorder after the bento redesign. Put Order History third (after stats + alerts/unsafe-stock), or add a "Jump to" set of anchor links at the top.

**Suggested command**: `/impeccable layout dashboard`

---

### P3: The "Terakhir diperbarui" timestamp uses a non-Indonesian field name style and arbitrary format

**What**: Once relocated (per P1), the timestamp string `"Terakhir diperbarui: 07 Jun, 14:23"` is fine, but the `toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })` call is repeated in `OrderHistoryTable.tsx`, `dashboard.tsx`, and probably elsewhere. Centralize the formatter.

**Why it matters**: Date formats drift across the app if every component formats locally. Heuristic #4.

**Fix**: A small `formatDashboardDate(date)` util in `src/lib/format.ts` (or wherever the app keeps its formatters).

**Suggested command**: `/impeccable clarify`

---

## Persona Red Flags

### Alex (Power User)

- **No keyboard shortcuts for section navigation.** With eight sections on one page, an "Alex" wants `g s` for stats, `g h` for history, `g a` for alerts. None exist.
- **No date range on Order History.** Search filters by text but not by date. A power user looking for "yesterday's voided orders" has to page-scroll and visually scan.
- **No export.** Can't pull Order History, COGS, or Discrepancy data into a spreadsheet. The dashboard is a view, not a working tool.
- **No "Pin section" or collapse.** Long page with no way to focus.

### Jordan (First-Timer)

- **HPP threshold (< 40%) is not explained.** A first-timer sees "Menu dengan HPP di bawah 40% (High Margin)" and doesn't know if 40% is a target, a warning, or what HPP stands for. Only the ROP/ROQ table has a help block.
- **Variance threshold (> 3%) in DiscrepancyTable is unexplained.** Same problem.
- **No "what is this page" anchor.** A first-timer doesn't know that the dashboard is the analytical view (vs. the operational pages they were sent from). The double header (P1) makes the entry moment even more confusing.

### Riley (Stress Tester)

- **Pagination shows "Page 1 of 1" for empty data.** All tables do this. Minor but worth a cleaner empty state.
- **Channel pie fallback** (`{ name: "Belum Ada Data", value: 1 }`) draws a full circle that says "Belum Ada Data" — works but feels like a debug rendering.
- **The `lowStockItems` truncation in the alert card** (the `truncate` class on each `<li>`) silently hides long ingredient names. A stress tester pasting a 200-char ingredient name will never see it.

## Minor Observations

- `OrderHistoryTable.tsx` truncates the order ID to 8 characters (`order.id.slice(0, 8)...`). Hard to correlate with a database row. Show the full ID, monospace, no truncation, or copy-to-clipboard on click.
- The COGS progress bar (`h-1.5 w-16`) is still tiny. Hard to read at a glance.
- The "HIGH COGS" and "HEALTHY" labels in `CogsAnalysisTable` are in English. Everything else is Indonesian. Should be "BIAYA TINGGI" / "SEHAT" — wait, they already are. Confirmed Indonesian, ignore.
- `RopRoqTable` is in the components folder but is never imported in the dashboard. Either dead code or a misplaced component.
- The `usePageTitle` hook feeds the AppShell header from a React context. Worth confirming that the context's `setState` is debounced or that rapid route changes don't flash stale titles.
- The role guard in `dashboard.tsx` allows `branch_admin` to reach the page, but `_layout/index.tsx` redirects branch admins to `/pos`. Dead code path; either remove `branch_admin` from `allowedRoles` or remove the redirect (depending on intent).

## Cognitive Load Assessment

| Check                  | Result                                                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Single focus           | ❌ Eight stacked sections, no jump-to, no collapse                                                                     |
| Chunking               | ✅ Each section is a self-contained card                                                                               |
| Grouping               | ❌ HPP+Discrepancy split is `1+2` (off-balance); WasteLoss row has a dead cell                                         |
| Visual hierarchy       | ❌ Stats, alerts, charts, COGS, HPP, discrepancies, waste, history — no narrative order                                |
| One thing at a time    | ❌ Everything is always visible                                                                                        |
| Minimal choices        | ✅ Read-only                                                                                                           |
| Working memory         | ⚠️ COGS table shows 4+ numbers per row (price, COGS, margin, food cost %); no working memory issue if labels are clear |
| Progressive disclosure | ❌ No section collapse, no "details" expansion                                                                         |

**3 failures** — moderate-to-high cognitive load. The redesign in P1 (P1 bento fix) should also resolve chunking and grouping.

---

## What's specifically different from the prior critique (29 → 27)

Improvements made since the May 27 run that **did not** show up in your feedback:

- Emerald hero card removed; StatsCards now uses standard cards.
- `animate-pulse` removed from COGS alerts.
- OrderHistoryTable got a search input.

New regressions / not-yet-addressed from the prior run:

- Card padding inconsistency (p-3 / p-4 / p-6) is still present in chart cards.
- Channel pill side-stripe (P3 in prior) still present, now also flagged by the detector.
- "Last updated" timestamp exists but is in the duplicate header that needs to go.

Score is honest: the things you flagged are real P1s, and the bento inconsistency in particular drags the consistency score down to 1.

---

## Recommended order of operations

1. **P1 — Remove the duplicate header.** 10-line edit, immediate visual win, fixes an a11y bug.
2. **P1 — Build the Unsafe Stock table.** Reuses computed data, gives the stock alert a follow-through, becomes a working tool instead of a passive alert.
3. **P1 — Redesign the bento.** Pick one column grammar (recommend Option A: content-first single column with 2-col chart pairs) and rewrite the body of `dashboard.tsx` accordingly. Resolves chunking, grouping, and section-order issues in one pass.
4. **P2 — Channel pill fix.** Detector-flagged, design-system violation, 5-minute change.
5. **P2 — Skeleton + section reorder polish.** Done in the same pass as the bento redesign.

## Questions to Consider

- Should the HPP+Discrepancy+WasteLoss trio merge into a single "Operational Alerts" section with one header, three sub-tables, and a tab/segmented control to switch between them? That would let each sub-table breathe full-width and the user to focus on one concern at a time.
- Is "Top 10" the right cap, or should the cap be configurable (a chip group: 10 / 25 / 50 / all)? Power users will want more than 10; first-timers will be fine with 10.
- Should the "Buat PR" action on the Unsafe Stock table deep-link into a pre-filled purchase requisition, or open a side panel with quantity suggestions? The former is faster; the latter is safer (the user reviews).
