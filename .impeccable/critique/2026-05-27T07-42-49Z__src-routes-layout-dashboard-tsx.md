---
target: _layout/dashboard.tsx
total_score: 29
p0_count: 0
p1_count: 3
p2_count: 3
timestamp: 2026-05-27T07-42-49Z
slug: src-routes-layout-dashboard-tsx
---

# Critique: Dashboard Page

**Target**: `src/routes/_layout/dashboard.tsx` + 8 component files under `src/components/dashboard/`

## Design Health Score

| #         | Heuristic                       | Score     | Key Issue                                                                                                            |
| --------- | ------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------- |
| 1         | Visibility of System Status     | 3         | No "last updated" timestamp; auto-refresh is silent                                                                  |
| 2         | Match System / Real World       | 4         | All Indonesian labels, domain-appropriate terminology                                                                |
| 3         | User Control and Freedom        | 3         | Read-only dashboard so less critical, but no filter clearing or hiding sections                                      |
| 4         | Consistency and Standards       | 3         | Card padding mismatch (p-4 vs design system's 24px); hardcoded channel colors vs system colors                       |
| 5         | Error Prevention                | 4         | No destructive actions, empty states everywhere, safe defaults                                                       |
| 6         | Recognition Rather Than Recall  | 4         | All tables have clear headers, charts are labeled, no icon-only controls                                             |
| 7         | Flexibility and Efficiency      | 1         | No search on Order History, no keyboard shortcuts, no export, no date-range controls, no widget customization        |
| 8         | Aesthetic and Minimalist Design | 2         | Emerald background card in StatsCards destroys the restrained palette; animate-pulse on COGS alert; hardcoded colors |
| 9         | Error Recovery                  | 3         | No errors to recover from in a read-only view, loading states are adequate                                           |
| 10        | Help and Documentation          | 2         | No contextual help, tooltips, or documentation; HPP and COGS thresholds unexplained; only ROP table has an info note |
| **Total** |                                 | **29/40** | **Good**                                                                                                             |

## Anti-Patterns Verdict

### Does this look AI-generated?

**Partially.** The overall architecture (stacked cards, tables, charts) follows the standard dashboard template. Most components are restrained and neutral — which aligns with the design system. But two things break the illusion:

1. **The emerald-green hero card** for "Penjualan Hari Ini" in `StatsCards.tsx` is a textbook SaaS dashboard cliché. It's the first thing the user sees and it screams "generic admin template." The design system explicitly bans decorative color and hero-metric patterns.

2. **The `animate-pulse` on "HIGH COGS"** in `CogsAnalysisTable.tsx` is the kind of decorative animation that signals "AI-generated UI patterns" — pulsing red elements are the go-to for status alerts in generic templates.

Everything else is genuinely well-considered for the domain.

### Deterministic scan

Unavailable — the bundled detector (`detect.mjs`) is not present in this environment. Assessment B could not run as a separate automated scan. Manual inspection covers all files.

## Overall Impression

The dashboard has solid bones. The role-based view segmentation (super_admin gets COGS, charts, HPP, discrepancies, waste; branch_admin gets ROP/ROQ and Order History) is well thought out. Loading states are present. Empty states are handled. The data content is operationally relevant.

But the design integrity is undermined by a single dominant violation (the emerald hero card) and several smaller ones (hardcoded colors, wrong card padding, decorative animation). The biggest missed opportunity is the lack of any **interactivity** — no search, no filtering, no date range controls, no export — which makes this feel like a screenshot of a dashboard rather than a usable tool.

## What's Working

1. **Role-based content segmentation.** The dashboard correctly shows different data for super_admin vs branch_admin. The COGS analysis table, ROP/ROQ table, and anomaly detection are all gated by role. The Order History table hides the branch column for branch_admin. This is faithful to the "Role-based opacity" principle.

2. **Consistent table patterns.** All four data tables (COGS, Discrepancy, Waste Loss, ROP/ROQ, Order History) follow the same structure: sticky first column, pagination, clear headers, hover states, empty state handling. This builds reliable muscle memory.

3. **Operationally relevant data.** The COGS/variance/waste/ROP content is genuinely useful for a ghost kitchen operator. The anomaly detection (void rate > 10%, low stock alerts) is a smart touch. The data is grounded in real operational concerns, not vanity metrics.

## Priority Issues

### P1: Emerald hero card violates the entire design system

**What**: `StatsCards.tsx` renders the "Penjualan Hari Ini" stat with `bg-emerald-600`, white text, emerald-100 icons. This is the first and most visually dominant element on the page.

**Why it matters**: The design system is explicitly _restrained, neutral-first_. It says: "Don't use decorative color. No colored headers, tinted backgrounds, accent borders." It also says: "Don't create hero-metric dashboards (big number, small label, gradient). Dashboard content should be actionable data — tables, alerts, and ledger summaries." This single card violates both rules simultaneously. It sets the wrong visual tone and makes the dashboard look like every other SaaS template.

**Fix**: Replace with a standard card matching the design system: `bg-card border shadow-sm p-6`. The number should be `text-foreground`, not `text-white`. Remove the decorative `DollarSign` and `TrendingUp` icons, or use them at muted opacity. The three cards should be visually equal, not one hero and two sidekicks.

**Suggested command**: `polish StatsCards`

---

### P1: Hardcoded chart colors instead of design system palette

**What**: `Charts.tsx` defines `CHANNEL_COLORS = ["#10b981", "#3b82f6", "#f59e0b", "#ef4444"]` — hex values that don't match any of the defined chart palette colors. The SalesTrendChart uses `#10b981` (emerald) as the area fill. The SalesByBranchChart uses `#059669`. The BrandPerformanceChart uses `#3b82f6`.

**Why it matters**: The design system defines a specific chart palette with precise OKLCH values for orange, teal, blue, yellow, and amber. These are the _only_ saturated colors in the system — they exist for data discrimination. Using arbitrary hex values undermines color consistency, and using emerald green for charts creates confusion with "success" semantics (green = good). The chart colors need no semantic meaning — they are purely for visual separation of series.

**Fix**: Import or reference the chart palette tokens. Use teal (`oklch(0.6 0.118 184.704)`) for the primary sales trend, orange (`oklch(0.646 0.222 41.116)`) for the bar chart, and the full palette for the channel pie/donut.

**Suggested command**: `colorize Charts`

---

### P1: Decorative pulse animation on COGS alerts

**What**: In `CogsAnalysisTable.tsx`, the "HIGH COGS" status cell renders with `animate-pulse`. This is a CSS layout animation that pulses opacity — but `animate-pulse` in Tailwind actually animates `opacity`, not layout properties, so it's partially acceptable. However, it's decorative (not functional), and there's no `prefers-reduced-motion` respect.

**Why it matters**: The design system says: "Reduced motion respected — no layout animations, only purposeful opacity/transform transitions" and "Don't animate CSS layout properties." While `animate-pulse` is opacity-based, it's decorative motion that adds no information — the alert triangle and "HIGH COGS" text already convey the urgency. Pulsing just makes it feel like an alarm.

**Fix**: Remove `animate-pulse`. The `AlertTriangle` icon + red text + red badge are sufficient. If motion is desired, use a subtle non-repeating transition (e.g., fade in on mount) that respects `prefers-reduced-motion`.

**Suggested command**: `polish CogsAnalysisTable`

---

### P2: No search or filter on Order History

**What**: `OrderHistoryTable.tsx` displays all orders with pagination (15/page) but no search bar, no column filters, and no date range picker. For a super_admin with 100+ orders, finding a specific transaction requires paging through up to 7 pages.

**Why it matters**: The design system says "Speed on the POS screen is paramount" — and while this isn't the POS screen, the same principle applies to operational tools. A kasir or area manager investigating a specific order shouldn't have to manually scan pages. This is a direct hit to heuristic #7 (Flexibility and Efficiency).

**Fix**: Add a search input (by order code, channel, or date) above the table. Alternatively, add a date range filter and a channel dropdown. The data is already client-side; a simple `filter` over the sorted array is trivial.

**Suggested command**: `harden OrderHistoryTable`

---

### P2: No "last updated" indicator

**What**: The dashboard auto-refetches every 60 seconds (`refetchInterval: 60000`), but there's no visual indicator of when the data was last refreshed. A user looking at the screen has no way to know if the data is from 5 seconds ago or 55 seconds ago.

**Why it matters**: Heuristic #1 (Visibility of System Status). In an operational tool where stock counts and order statuses change minute to minute, users need to know they're looking at current data. Without a timestamp, they either trust blindly or refresh obsessively.

**Fix**: Add a small "Terakhir diperbarui: 14:23" text somewhere near the page title or RefetchButton. Use the query's `dataUpdatedAt` timestamp.

**Suggested command**: `polish dashboard`

---

### P2: Card padding mismatch with design system

**What**: The design system specifies card internal padding as 24px (`p-6` in Tailwind's 4px scale). All dashboard cards use `p-4` (16px). This is a subtle but systemic inconsistency.

**Why it matters**: Heuristic #4 (Consistency and Standards). Every card in the dashboard and across the app should share the same internal spacing. A 8px gap across 8+ cards creates a visible inconsistency.

**Fix**: Change `p-4` to `p-6` on all card containers in all dashboard component files. The grid gaps (`gap-4`, `gap-6`) may also need adjustment.

**Suggested command**: `polish dashboard`

---

### P3: Stale role guard in dashboard

**What**: `RoleGuard` allows `branch_admin` to access the dashboard, but `_layout/index.tsx` redirects `branch_admin` to `/pos`. So `branch_admin` should never reach this page. The `isBranchAdmin` code paths inside `DashboardPage` are dead code.

**Why it matters**: Not a user-facing bug, but it adds unnecessary code complexity. If the redirect is intentional, `branch_admin` should be removed from the `allowedRoles` array and the branch_admin-specific sections (ROP/ROQ table) should be removed.

**Fix**: Remove `branch_admin` from `allowedRoles` in the `RoleGuard`. Remove the `isBranchAdmin` branching and the `RopRoqTable` import.

**Suggested command**: `distill dashboard`

---

### P3: Channel badges use hardcoded colors

**What**: `OrderHistoryTable.tsx` defines a `channelColors` record mapping channel names to Tailwind classes (`bg-rose-100 text-rose-600`, etc.). These are styled as rounded-full pill badges, which is different from the system's `Badge` component used elsewhere in the same table.

**Why it matters**: Inconsistency in how status/channel indicators are rendered. The system Badge component has `rounded-md` (6px), but channel badges use `rounded-full`. Two different visual languages for similar concepts in the same table.

**Fix**: Use the system `Badge` component with variant mapping, or standardize on one style. Apply the channel color as a text color on a standard badge, not a custom pill.

**Suggested command**: `polish OrderHistoryTable`

---

## Persona Red Flags

### Alex (Power User)

- **No search on Order History.** If Alex needs to find a specific order from 3 days ago, they must page through at least 20 orders. A search bar is the first thing a power user looks for.
- **No keyboard shortcuts.** Can't press `s` to search, can't use arrow keys in tables. Standard dashboard table interaction is click-only.
- **No export.** If Alex wants to analyze the COGS data in a spreadsheet, there's no CSV export. They'd copy-paste from the browser.
- **Forced scrolling through all sections.** Alex can't hide the charts to focus on the Order History. Every page load shows all sections.

### Jordan (First-Timer)

- **HPP and COGS thresholds unexplained.** The HPP alert says "Menu dengan HPP di bawah 40% (High Margin)" — but a first-time user doesn't know why 40% is the threshold, what HPP stands for, or whether "di bawah 40%" is good or bad. The "High Margin" label helps, but it's one small parenthetical.
- **COGS analysis progress bar is tiny.** At `h-1.5 w-16`, the progress bar in the COGS table is difficult to read. A user unfamiliar with the metric has to rely on the percentage number.
- **No help icon anywhere.** There's no `?` button, tooltip, or "learn more" link on any card header. A first-timer has no way to discover what each section means beyond the title.

### Riley (Stress Tester)

- **Empty states are handled** — every table shows "Tidak ada data." or equivalent. ✓
- **But pagination breaks at 0 items.** The `totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))` ensures 1 page even with 0 items. The empty state row spans all columns. Functional, but the pagination shows "Page 1 of 1" for empty data which is unnecessary.
- **The channel pie chart fallback** (`{ name: "Belum Ada Data", value: 1 }`) creates a full-circle chart that says "Belum Ada Data" — functional but visually odd.

---

## Minor Observations

- The COGS analysis table's progress bar (`h-1.5 w-16`) is very small. At 6px tall and 64px wide, it's hard to distinguish a 50% fill from a 55% fill. Consider making it slightly wider or taller.
- "HIGH COGS" and "HEALTHY" labels in the COGS table use English. All other labels are Indonesian. Should be "BIAYA TINGGI" / "SEHAT" or similar.
- The ROP/ROQ info card uses `bg-blue-50` with blue text — outside the design system's restrained palette. Should use `bg-muted` to stay neutral.
- The order ID display (`order.id.slice(0, 8)...`) truncates to 8 characters. For debugging, this might not be enough to correlate with a database record.
- The anomaly detection threshold (`voidCount > todayOrders.length * 0.1`) is arbitrary and unexplained. A comment or config would help maintainers.
- Loading skeletons show 4 stats cards but the actual UI shows only 3 stats cards (the emerald one + 2 standard cards). The skeleton layout doesn't match the real layout.

---

## Cognitive Load Assessment

| Check                  | Pass/Fail                                                                   |
| ---------------------- | --------------------------------------------------------------------------- |
| Single focus           | ❌ — Super_admin sees 7 stacked sections, must scroll significantly         |
| Chunking               | ✅ — Each section is a self-contained card                                  |
| Grouping               | ✅ — Charts are paired, HPP+Discrepancy+Waste share a row                   |
| Visual hierarchy       | ✅ — Stats first, then analysis, then charts, then history                  |
| One thing at a time    | ❌ — All sections visible simultaneously                                    |
| Minimal choices        | ✅ — Read-only dashboard, no decisions required                             |
| Working memory         | ⚠️ — COGS table rows show 4+ data points (price, COGS, margin, food cost %) |
| Progressive disclosure | ❌ — No expand/collapse on sections; everything is always shown             |

**Result**: 3 failures — **moderate cognitive load**. The biggest issue is the lack of progressive disclosure: a super_admin can't collapse the COGS analysis to focus on Order History, or hide the charts to focus on discrepancies.
