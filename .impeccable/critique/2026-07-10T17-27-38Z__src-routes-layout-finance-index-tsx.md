---
slug: src-routes-layout-finance-index-tsx
path: src/routes/_layout/finance/index.tsx
version: 1
title: Keuangan Ledger
issueCount: 6
p0Count: 0
p1Count: 3
heuristicScore: 20
antiPatternCount: 6
verdict: Acceptable — significant improvements needed
timestamp: 2026-07-10T17-27-38Z
---

# Impeccable Critique — Keuangan Page

**Target:** `src/routes/_layout/finance/index.tsx`  
**Date:** 2026-07-10  
**Mode:** Degraded — single-context (spawn_agent unavailable; no browser)  
**Browser evidence:** ❌ Page requires auth (500 for anon). No browser automation in this session.  
**Detector:** ✅ Clean — zero findings.

---

## Issue 1 (P1): Double Titles

**Severity:** P1 — visual defect  
**Category:** Redundancy  
**Map:** `$impeccable distill`  
**Ref:** `AppShell.tsx:47-52`, `finance/index.tsx:324-325`

`AppShell` already renders an `<h1>` from `usePageTitle("Keuangan", "Laporan P&L harian, mingguan, bulanan")`:

```tsx
// AppShell.tsx:47-52
{
  state.title && <h1 className="text-xl font-bold tracking-tight">{state.title}</h1>;
}
{
  state.description && <p className="text-sm text-muted-foreground">{state.description}</p>;
}
```

The finance page **also** hardcodes its own title block inside the top-bar div:

```tsx
// finance/index.tsx:324-325
<h1 className="text-xl font-semibold">Keuangan</h1>
<p className="text-sm text-muted-foreground">Laporan laba rugi per hari, minggu, bulan</p>
```

**Result:** Two visible `<h1>Keuangan</h1>` elements stacked — one from AppShell, one hardcoded. Two competing subtitles. This is the "double titles" the user sees.

**Why it matters (personas):**

- **Alex (power user):** Redundant heading wastes vertical space above the fold; the period filter ends up below the viewport.
- **David (owner):** Double title signals sloppiness — undermines trust in a financial tool.

**Fix direction:** Delete the hardcoded `<h1>` + `<p>` in the page. `usePageTitle` already populates the AppShell header. If the displayed description needs tweaking (e.g., different wording than "Laporan P&L..."), adjust the `usePageTitle` second argument — don't duplicate it.

---

## Issue 2 (P1): Messy HPP Breakdown

**Severity:** P1 — data integrity confusion  
**Category:** Layout + Truth  
**Map:** `$impeccable layout` + `$impeccable clarify`  
**Ref:** `finance/index.tsx:133-188`, `finance.ts:getDailyHppBreakdown`

`HppBreakdownRow` expands a sub-row spanning 5 columns, rendering every ingredient in a 3-column grid (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`). Each ingredient gets its own `border-b` row showing name + formatted cost.

**Three problems:**

1. **Data mismatch (the real bug):** The row's HPP (column value) is calculated from `cogsAtTransaction` (historical cost at order time). The breakdown's "Total HPP" sums `ingredient.avgCost / conversionFactor × quantity` (live current cost). These two numbers **will not match**. A user who expands HPP sees a "Total HPP" that disagrees with the column HPP → they think the numbers are wrong. This is a trust-destroying bug for a financial tool.

2. **Wall of ingredients:** A day with 40+ ingredients dumps 40+ small rows into the sub-row. No summarization, no grouping. Cognitive overload for anyone scanning.

3. **Quantity without unit:** The breakdown shows `ingredient.name: Rp1,500` but the `quantity` field has no unit label (grams? ml? pieces?). It's meaningless to the reader.

**Why it matters:**

- **David (owner):** If the numbers don't reconcile, he won't trust the page.
- **Alex (power user):** A wall of 40 ingredient rows is scanning-hostile.
- **Sam (accessibility):** A screen reader has to traverse 40+ unlabeled quantity rows.

**Fix direction:**

- (a) Make the breakdown total match the row HPP. Either (i) use `cogsAtTransaction`-based costs in the breakdown (requires per-order-item breakdown, more complex), or (ii) add a note "Rincian menggunakan harga bahan saat ini (bukan saat transaksi)" — a truth label, not a fix, but at least honest.
- (b) Cap the list: top 5 ingredients by cost, then "Lainnya (×N)" as a summary row.
- (c) Add unit from `ingredient.unit` (if available in schema) or omit quantity if it's ambiguous.

---

## Issue 3 (P1): Confusing Omzet Inline Edit

**Severity:** P1 — discoverability failure  
**Category:** Affordance  
**Map:** `$impeccable clarify`  
**Ref:** `finance/index.tsx:73-130` (`EditableOmzetCell`)

The Omzet cell renders as a `<button>` styled to look like plain table text. The only edit affordance is a `<Pencil>` icon with `opacity-0 group-hover:opacity-100` — invisible until hover. This creates four problems:

1. **Zero discoverability for first-timers.** Jordan (first-timer) has no idea the Omzet column is editable. A data cell that's secretly a button violates recognition-over-recall (Nielsen #6).

2. **Invisible disabled state.** When a channel is selected, the cell switches from `<button>` to `<span>` — visually identical text. A user who previously clicked to edit now clicks and nothing happens. No tooltip, no visual change, no explanation. The disable reason ("only day-level, not per-channel") is invisible.

3. **Override meaning unexplained.** A `bg-blue-50` background marks overridden cells, but there's no legend, no tooltip, no annotation explaining that blue = manual override vs. gray = calculated. A first-timer sees blue-tinted numbers and doesn't know why.

4. **Touch-unfriendly.** On tablet (where this POS runs), there's no hover state — the pencil icon never appears. The cell is a button but looks like text. 44px touch target helps, but the affordance is invisible.

**Why it matters:**

- **Jordan (first-timer):** Never discovers the edit. Thinks Omzet is read-only.
- **David (owner):** Doesn't know the blue cells are his manual overrides.
- **Sam (accessibility):** Screen reader announces "button" on what looks like text; no label explaining the action.

**Fix direction:**

- (a) Always show a small pencil icon (not hover-gated), or use a dedicated "Edit" icon button in the cell that's always visible.
- (b) When disabled (channel selected), show a muted lock icon + tooltip "Filter channel aktif — omzet hanya diedit per hari" or similar.
- (c) Add a one-line legend: " Biru = input manual" near the table or as a footnote.
- (d) Add `aria-label="Edit omzet harian: Rp X"` on the button for screen readers.

---

## Heuristic Scores

| #   | Heuristic                   | Score | Notes                                                                      |
| --- | --------------------------- | ----- | -------------------------------------------------------------------------- |
| 1   | Visibility of System Status | 2     | Edit state + override state both invisible                                 |
| 2   | Match System / Real World   | 3     | Indonesian accounting terms correct                                        |
| 3   | User Control and Freedom    | 2     | No undo for override; no "revert to calculated"                            |
| 4   | Consistency and Standards   | 2     | h1 pattern inconsistent with other pages; omzet edit is unique interaction |
| 5   | Error Prevention            | 2     | Omzet accepts any number; no confirm on override                           |
| 6   | Recognition Over Recall     | 2     | Pencil icon hidden; disabled state invisible                               |
| 7   | Flexibility / Efficiency    | 2     | Fast once discovered, but discoverability is the blocker                   |
| 8   | Aesthetic / Minimalist      | 3     | Ledger itself is clean; HPP wall + double title add noise                  |
| 9   | Error Recovery              | 2     | Can re-edit override, but no explicit "revert"                             |
| 10  | Help / Documentation        | 1     | No tooltips, no legend, no contextual help                                 |

**Total: 20/40 — Acceptable — significant improvements needed**

---

## Anti-Patterns

1. ✅ `redundant-title` — double h1 (AppShell + hardcoded)
2. ✅ `hover-only-gate` — edit affordance hidden until hover (touch-hostile)
3. ✅ `invisible-disabled` — disabled state visually identical to enabled
4. ✅ `data-mismatch` — HPP breakdown total ≠ row HPP (different cost basis)
5. ✅ `no-explanation-override` — blue override cells unexplained
6. ✅ `unlabeled-quantity` — ingredient quantities without units

---

## Persona Red Flags

- **Alex (power user):** Double title wastes vertical space. HPP wall is scan-hostile. Omzet edit is efficient once found — but the discovery cost is unacceptable.
- **Sam (accessibility):** Hover-only pencil invisible to screen readers and touch users. Disabled state has no accessible explanation. Two h1 elements confuse heading hierarchy.
- **David (owner):** Numbers that don't reconcile (HPP breakdown vs. column) undermine trust. Double title signals lack of polish.
- **Jordan (first-timer):** Never finds the Omzet edit. Thinks the page is read-only. Confused by blue cells.

---

## Minor Observations

1. **`AppShell` uses `tracking-tight` on h1** (`text-xl font-bold tracking-tight` = -0.025em). This is fine (≥ -0.04em floor). No violation.
2. **Filter row has 5 controls** (period segmented + contextual picker + branch + channel + search — though search is hidden). Working-memory limit is 4±1. Borderline. The filter row is clean but dense.
3. **"Gross Profit" and "Margin" are English** in an otherwise Indonesian UI. Consistent with Excel, but worth noting. The project's pattern is to mix English accounting terms (HPP, COGS, margin) with Indonesian labels — acceptable per domain convention.
4. **No reset-filters button.** Period switch resets contextual pickers, but there's no "Reset all filters" affordance. Minor.
5. **The "Total HPP" text in HppBreakdownRow uses `text-sm font-medium`** — visually competing with the ledger's own row-level HPP. Hierarchy unclear in the expansion.

---

## Questions for User

1. **Double title fix:** The AppShell already renders the title + description from `usePageTitle`. Should I delete the hardcoded h1+subtitle entirely (relying on AppShell), or did you intend the page to have its own heading style different from AppShell?
2. **HPP mismatch:** The breakdown currently uses _live_ ingredient costs (not historical). The row HPP uses _historical_ cogsAtTransaction. Should I (a) add a truth label ("harga bahan saat ini"), (b) refactor the breakdown to use historical costs (more complex, requires order-item-level traceability), or (c) collapse the breakdown entirely and just show the row HPP?
3. **Omzet edit:** What's your preferred affordance style? Options: (a) always-visible pencil icon (persistent, discoverable), (b) dedicated edit button (explicit action), or (c) keep the current hover pattern but add a visible legend explaining the blue cells?
4. **Scope:** All three fixes are P1. Should I fix all three in one pass, or prioritize (e.g., double title + omzet edit first, HPP second)?
