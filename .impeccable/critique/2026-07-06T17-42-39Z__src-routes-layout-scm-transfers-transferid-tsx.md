---
target: Mutasi Stok detail page
total_score: 26
p0_count: 0
p1_count: 2
timestamp: 2026-07-06T17-42-39Z
slug: src-routes-layout-scm-transfers-transferid-tsx
---

## Design Health Score

| #         | Heuristic                       | Score     | Key Issue                                                                                    |
| --------- | ------------------------------- | --------- | -------------------------------------------------------------------------------------------- |
| 1         | Visibility of System Status     | 3         | Stepper, status badges, toasts all work well. Minor gap: no loading state on action buttons. |
| 2         | Match System / Real World       | 4         | Indonesian labels, domain terminology match users' mental model.                             |
| 3         | User Control and Freedom        | 3         | Cancel/withdraw at most states. Back button placement unconventional.                        |
| 4         | Consistency and Standards       | 3         | Consistent pattern across views.                                                             |
| 5         | Error Prevention                | 3         | Validation in ReviewingReceiverInteractive is solid.                                         |
| 6         | Recognition Rather Than Recall  | 4         | Ingredient names shown, not IDs. Status labels clear.                                        |
| 7         | Flexibility and Efficiency      | 2         | No keyboard shortcuts, no bulk actions.                                                      |
| 8         | Aesthetic and Minimalist Design | 2         | Repetitive Card pattern (pre-fix).                                                           |
| 9         | Error Recovery                  | 3         | Error banners with dismiss. Toast notifications.                                             |
| 10        | Help and Documentation          | 1         | No contextual help, no tooltips.                                                             |
| **Total** |                                 | **26/40** | **Acceptable**                                                                               |

## Anti-Patterns Verdict

**LLM assessment**: The design was functional but read as "admin dashboard built with a component library." The Card("Aksi") pattern repeated 8 times was the biggest tell. After layout fix, the design uses Section/SectionDivider/ActionBar primitives for better hierarchy.

**Deterministic scan**: Clean. No issues detected.

## Priority Issues (pre-fix)

1. **[P1] Card("Aksi) repeated 8 times** — Fixed: replaced with Section/ActionBar primitives
2. **[P1] No contextual guidance** — Pending: add pre-transition explanations
3. **[P2] Back button orphaned** — Pending: move to conventional position
4. **[P2] No summary row in ReviewingReceiverInteractive** — Pending
5. **[P3] Audit log shows raw state names** — Pending

## Layout Changes Made

- Replaced `Card > CardHeader > CardTitle > CardContent` pattern with `Section > SectionHeading > ActionBar`
- Added `SectionDivider` between major sections for visual rhythm
- Made `ReadOnlyItems` border-only (no Card wrapper)
- Made `AuditLog` border-only (no Card wrapper)
- Made `InvoiceCard` border-only (no Card wrapper)
- Added contextual descriptions above action buttons
- Only show AuditLog when there are entries
