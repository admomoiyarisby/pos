---
target: src/routes/_layout/stock-opname/$soId.tsx
total_score: 28
p0_count: 0
p1_count: 1
timestamp: 2026-07-10T19-26-09Z
slug: src-routes-layout-stock-opname-soid-tsx
---

# Critique: Stock Opname Detail Page

## Design Health Score

| #         | Heuristic                       | Score     | Key Issue                                                                     |
| --------- | ------------------------------- | --------- | ----------------------------------------------------------------------------- |
| 1         | Visibility of System Status     | 3         | Good feedback on mutations, but no progress indicator for table loading       |
| 2         | Match System / Real World       | 4         | Indonesian terminology matches domain; "Stok Sistem" vs "Stok Fisik" is clear |
| 3         | User Control and Freedom        | 3         | Modals have cancel, but no undo for submitted counts                          |
| 4         | Consistency and Standards       | 3         | Consistent with other admin pages; button styles match                        |
| 5         | Error Prevention                | 2         | Missing: no confirmation before submit, numeric validation is basic           |
| 6         | Recognition Rather Than Recall  | 3         | Yellow highlighting for untainted items helps recognition                     |
| 7         | Flexibility and Efficiency      | 2         | No keyboard navigation between inputs; no tab-to-next behavior                |
| 8         | Aesthetic and Minimalist Design | 3         | Clean table, but action bar is cluttered with too many buttons                |
| 9         | Error Recovery                  | 3         | Error messages are clear and actionable                                       |
| 10        | Help and Documentation          | 2         | No contextual help for "Blind SO" or "Realize" concepts                       |
| **Total** |                                 | **28/40** | **Good**                                                                      |

## Anti-Patterns Verdict

**LLM assessment**: The page does NOT look AI-generated. It follows established patterns from the rest of the app. The table-based layout is appropriate for data-heavy stock opname. No gradient text, no hero metrics, no decorative grids.

**Deterministic scan**: Clean — 0 findings.

## Overall Impression

This is a functional, well-structured stock opname detail page. The core flow (count → submit → approve → realize) is clear. The yellow highlighting for untouched items is a nice touch for recognition. The Nasi conversion box is informative.

The biggest opportunity: the action bar is overloaded with buttons that appear conditionally. On a typical screen, 3-4 buttons compete for attention. A more structured action flow (primary action prominent, secondary actions grouped) would reduce cognitive load.

## What's Working

1. **Untouched item highlighting** — The yellow background for items not yet counted (`!touchedItems.has(item.id)`) is excellent. It gives immediate visual feedback on completion status without any extra UI.

2. **localStorage caching** — Edit state persists across page reloads. Branch admins can count items, leave, and come back without losing progress. This is a real-world necessity for a process that might take 30+ minutes.

3. **Role-based visibility** — The conditional rendering of buttons based on role and status is clean. Each role sees exactly what they can do.

## Priority Issues

**[P1] Action bar cognitive overload**

- **What**: When status is "Submitted" and user is area_manager, up to 5 buttons appear: "Simpan Opname", "Tandai Investigasi", "Setujui & Sesuaikan", "Cetak PDF", and potentially "Realize SO"
- **Why it matters**: Users must scan and decide which button applies. The "Setujui & Sesuaikan" button (approval) is the primary action but sits among equally-styled secondary actions.
- **Fix**: Group secondary actions (Cetak PDF, Tandai Investigasi) into a dropdown or icon menu. Make the primary action (Submit/Approve) visually prominent with `bg-primary`. Keep only 1-2 buttons visible at a time.

**[P2] No keyboard navigation between inputs**

- **What**: The stock counting table has many numeric inputs. Users must click each one individually.
- **Why it matters**: Branch admins count 20-50 items. Clicking each input is slow. Pressing Enter/Tab to move to the next input would be much faster.
- **Fix**: Add `onKeyDown` handler to move focus to the next input on Enter key. This is a standard table editing pattern.

**[P2] "Realize SO" uses browser `confirm()`**

- **What**: The realize button uses `window.confirm()` for a destructive, irreversible action.
- **Why it matters**: `confirm()` is ugly, non-customizable, and breaks the design system. For an action that adjusts live inventory, a proper modal with explanation would be more appropriate.
- **Fix**: Replace with a Modal that explains what will happen (e.g., "This will subtract X Beras, Y Air from inventory. This action cannot be undone.").

**[P3] No empty state guidance**

- **What**: When `detail.items.length === 0`, the table shows "Tidak ada item" with no guidance.
- **Why it matters**: An empty SO could mean the branch has no inventory yet. Users need to know what to do next.
- **Fix**: Add a message like "Cabang ini belum memiliki stok. Silakan lakukan transfer stok terlebih dahulu."

**[P3] Debug button visible in production builds**

- **What**: The "🐛 Debug Fill" button uses `import.meta.env.DEV` which works, but the button appears for branch_admin who can submit.
- **Why it matters**: Minor security concern — the button is technically hidden in production, but the check could be more robust.
- **Fix**: Already handled correctly with `isDev`. No action needed.

## Persona Red Flags

**Alex (Power User)**

- No keyboard shortcuts for navigating the table
- Must click each input individually — 50 items = 50 clicks

**Jordan (First-Timer)**

- "Blind SO" badge has no explanation — what does it mean?
- "Realize SO" is jargon — what does it actually do?
- No tooltip or help explaining the workflow

**Sam (Accessibility)**

- Table inputs have no `aria-label` — screen readers announce "edit text" without context
- Color-only variance indication (red/green) — no icon or text supplement for colorblind users

## Minor Observations

1. The "Cetak PDF" button is small (`h-8 px-3 text-xs`) compared to other action buttons (`h-10 px-6`). Consider making it consistent.

2. The Nasi conversion box uses `bg-blue-50/50` which is very subtle. In dark mode this might be invisible.

3. The variance column shows "+" for positive variance but no icon. A small arrow (↑/↓) would improve scannability.

## Questions to Consider

1. Should the action flow be more wizard-like? (Step 1: Count → Step 2: Submit → Step 3: Approve → Step 4: Realize) instead of all buttons visible at once?

2. Should the table support bulk entry (paste from spreadsheet) for branches with many items?

3. Is the "Blind SO" feature well-understood by users? Should there be a brief explanation when the badge appears?

---

**Run Notes**:

- Target slug: `src-routes-layout-stock-opname-soid-tsx`
- Ignore list: none
- Assessment independence: degraded (single-context, no sub-agent tool)
- CLI detector: clean (0 findings)
- Browser visibility: not available
- Overlay injection: not available
- Live server cleanup: not applicable
- Temp file cleanup: not applicable
