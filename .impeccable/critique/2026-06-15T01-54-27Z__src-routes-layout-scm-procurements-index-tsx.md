---
target: src/routes/_layout/scm-procurements/ (Pengadaan)
total_score: 22
p0_count: 3
p1_count: 3
timestamp: 2026-06-15T01-54-27Z
slug: src-routes-layout-scm-procurements-index-tsx
---

# Design Critique: Pengadaan (SCM Procurements)

**Target**: `src/routes/_layout/scm-procurements/` (index, new, $procurementId) + `src/components/scm-procurements/`
**Slug**: `src-routes-layout-scm-procurements-index-tsx`
**Date**: 2026-06-15

---

## Design Health Score

| #         | Heuristic                       | Score     | Key Issue                                                                                                                                                                                                                                                                    |
| --------- | ------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1         | Visibility of System Status     | 2         | Single status badge for a 7-step lifecycle; no progress/stepper. Audit log present but loaded in every view (over-fetch).                                                                                                                                                    |
| 2         | Match System / Real World       | 2         | **State labels contradict state names**: `InTransit` shows "Disetujui" (Approved), `Delivered` shows "Dalam Pengiriman" (In Transit). Labels are off by one — domain mismatch.                                                                                               |
| 3         | User Control and Freedom        | 3         | Cancel/withdraw/back available on most states. One-way transitions (no un-reject) match domain reality.                                                                                                                                                                      |
| 4         | Consistency and Standards       | 2         | Custom-styled `<select>` in `new.tsx` bypasses the design system. Hardcoded `bg-green-100`/`text-green-700`/`bg-red-100`/`bg-red-50` in `ScmItemTable` break the palette. `bg-muted` + `bg-green-50` hover mixes. Detail page uses `Loading...` text; layout uses skeletons. |
| 5         | Error Prevention                | 3         | Required rejection reason, `min=1` quantity, `max={picked}` on received input. The `max` is HTML-only — the onChange path can produce negative `rejectedQuantity`.                                                                                                           |
| 6         | Recognition Rather Than Recall  | 2         | All actions are labeled, audit log shows history. But: a user opening a procurement sees only one badge; they must remember the 7-step lifecycle to know what comes next. No stepper.                                                                                        |
| 7         | Flexibility and Efficiency      | 1         | No keyboard shortcuts anywhere on this surface. No status filter on the list page (only full-text search on `code`). No bulk actions. The CA queue lives inside a procurement detail page; the only way to see all pending procurements is to navigate into one.             |
| 8         | Aesthetic and Minimalist Design | 2         | Clean structural layout, but hardcoded `bg-green-100`/`bg-red-100` on ca-review buttons and `bg-red-50` on invoice rejected rows inject color outside the design system. These will fail in dark mode and read as a different product.                                       |
| 9         | Error Recovery                  | 3         | Errors render in red below the action; form state preserved (items stay in `useState`). No "what to do next" — error text is the raw server message.                                                                                                                         |
| 10        | Help and Documentation          | 2         | Each state has a 1–2 sentence description ("Pengadaan sudah disubmit. Admin Pusat akan membuka review…"). No tooltips, no role onboarding, no glossary for status terms.                                                                                                     |
| **Total** |                                 | **22/40** | **Acceptable — significant improvements needed before polish**                                                                                                                                                                                                               |

---

## Anti-Patterns Verdict

**Does this look AI-generated?** **No.** The page has the hallmarks of a real, domain-specific operational tool. It correctly avoids the saturated AI tells — no warm-neutral cream background (uses cool gray), no gradient text, no glassmorphism, no section eyebrows, no numbered 01/02/03 scaffolding, no hero-metric dashboard. The state machine, role-based dispatch, and audit log are evidence of a real domain model.

**Deterministic scan**: Detector returned no findings (`[]`) for the markup in this directory. The detector's blind spots show up here: it doesn't see the custom-styled `<select>` element in `new.tsx` as a problem, and it doesn't see the `bg-green-100`/`bg-red-100`/`bg-red-50` color leaks. Visual review catches what the scanner misses.

**Visual overlays**: No browser automation available in this session; skipping live overlay injection. (Dev server is running on `localhost:3000`, but the page is CSR and would require auth to render meaningfully.)

---

## Overall Impression

This is a serious 7-step document-lifecycle UI with 12 view components, role-based dispatching, and an audit trail. The architecture is correct — the FSM, the audit log, the role gating are all real. What hurts it is the **surface-level polish**: state labels contradict state names, a "default pending to approved" pattern silently overrides user decisions, the design system has hardcoded color leaks in the most-used component, and a 7-step lifecycle is shown as a single badge. Fix the data, the colors, and the lifecycle visualization, and this becomes a very strong operational surface.

---

## What's Working

1. **State machine, not a wizard.** The 10 states × multiple roles × `transitionProcurement` event model is a clean separation of concerns. Each view is small, focused, and the FSM is the source of truth. A new state would be one transition table entry plus one view — the right architecture.
2. **Audit log on every state.** Every transition lands in `scm-procurement-audit-log` and is fetchable per-procurement. The pagination pattern (PAGE_SIZE 10, "Tampilkan lebih lama") is a sensible default for a long-lived document. This is exactly the kind of "no silent mutation" the brand promises.
3. **Role-based view dispatch is explicit.** The `DispatchView` function in `$procurementId.tsx` makes the role × status → view matrix readable at a glance. It's a switch statement in a route file, but it documents the model in code.

---

## Priority Issues

### [P0] State labels contradict state names (and each other)

**What**: In both `index.tsx` and `$procurementId.tsx`:

- `InTransit` (the state) → badge label: **"Disetujui"** (Approved).
- `Delivered` (the state) → badge label: **"Dalam Pengiriman"** (In Transit).
- `ReviewingSJ` (the state) → badge label: **"Sampai di Cabang"** (Arrived at Branch).

The state names in the FSM and the visible labels are off by one. `InTransit` literally means "in transit" in the FSM (see `InTransitBaTracking`, `InTransitCaDetail`, `SuratJalanButton`) — that's the "sedang dikirim" moment. The label says "Disetujui", which is the _action_ that caused the state. The user sees a procurement "Disetujui" and reasonably asks: "Approved for what? Where is it?"

**Why it matters**: Status is the only orientation the user has. A wrong label destroys the user's mental model of the document's journey. Two people reading the same procurement at different times will disagree on what "Disetujui" means. Audit log entries (which use state names verbatim) will read differently from the badge.

**Fix**: Either rename the labels to match the state semantics, or rename the states:

- `InTransit` → "Dalam Pengiriman" or "Sedang Dikirim"
- `Delivered` → "Sudah Dikirim" or "Sampai di Cabang"
- `ReviewingSJ` → "Sedang Direview Cabang" or "Review Penerimaan"
  Pick one axis (state-name or label) and make them line up. Update `views.tsx` CardTitle text, the audit-log `stateLabel` function, and the badge map together.

**Suggested command**: `/impeccable clarify` (rewrites the labels and the CardTitle copy in one pass).

---

### [P0] Hardcoded color leaks bypass the design system

**What**: `ScmItemTable.tsx` uses Tailwind utility classes that aren't in the design system:

- ca-review mode Setujui button: `bg-green-100 text-green-700` (active), `bg-muted hover:bg-green-50` (inactive).
- ca-review mode Tolak button: `bg-red-100 text-red-700` (active), `bg-muted hover:bg-red-50` (inactive).
- invoice-preview mode rejected rows: `bg-red-50`.

The DESIGN.md design system defines a `success` badge variant and a `destructive` badge variant specifically for these signals. The `<Badge>` component is already imported in the same file. The hardcoded colors:

- Don't exist in dark mode (will render as bright pastels on dark surface).
- Don't match the green-amber-red semantic vocabulary used by the rest of the badges.
- Are a different visual language from the `bg-muted` button rest state, so the Setujui/Tolak pair reads as "two different buttons in two different products".

**Why it matters**: This is the most-clicked component on the page (CA's review form, the BA's receive form). Visual inconsistency here is the loudest inconsistency in the app. A user who sees `bg-green-100` on the Setujui button will not trust the `bg-emerald-500` (or whatever) the analytics page uses.

**Fix**: Replace the inline buttons with the design-system Badge (or a small button group using `variant="outline"` with active state). Replace `bg-red-50` with the destructive-tone surface from the design tokens. Verify in dark mode.

**Suggested command**: `/impeccable audit` (will catch these and the other token violations across the surface).

---

### [P0] "Default pending to approved" silently overrides CA decisions

**What**: In `views.tsx`, the `rowsToItems` function does this for every item:

```
caDecision: it.caDecision === "pending" ? "approved" : it.caDecision,
```

The comment explains: _"default 'pending' to 'approved' so accepting-as-is just clicks the primary button"_. The DB starts every item as `caDecision = "pending"`. The UI rewrites that to `"approved"` in local state. When the CA clicks **Setujui & Buat SJ** without touching any row, every item is sent as `approved`.

The visual state implies the CA actively approved each item (the Setujui button looks selected by default). But the system has _decided for them_. The "pending" state is never visible to the CA.

This is a workaround, not a fix. It exists because the original UX forced the CA to click Setujui on every row before the primary button would do anything. The fix made the click possible but destroyed the truth.

**Why it matters**: This is the kind of "silent mutation" the brand's "Data integrity is absolute" principle explicitly forbids. A CA who opens a 30-item review, skims it, and clicks Setujui & Buat SJ has _not_ approved 30 items — the system has. If the CA intended to reject three items but missed them, those three go through. There is no audit entry that says "the CA explicitly approved each row"; the audit log will only show "accept-and-ship".

**Fix**: Pick a model and make it real:

- Option A: Treat `pending` as the default explicit state. Show a third button or a checkbox per row. The primary "Setujui & Buat SJ" requires all rows to be `approved` or `rejected` before it activates. CA's intent is encoded.
- Option B: Move the decision to a confirm step (modal or summary page) where the CA reviews the _effective_ state of all rows before committing. Audit the explicit confirmation.

Either way, the in-place override in `rowsToItems` is a load-bearing lie and should not ship.

**Suggested command**: `/impeccable shape` (this is a UX decision, not a polish task).

---

### [P1] The 7-step lifecycle is hidden behind a single badge

**What**: A procurement moves through Draft → Pending → UnderReview → (Rejected | InTransit → Delivered → ReviewingSJ → WaitingForPayment → Finished) | Cancelled. That's 7–10 steps. The detail page shows the current state as a single badge in the top-right corner. There is no stepper, no progress bar, no timeline of where the document is in its journey.

`$procurementId.tsx` already has the audit log at the bottom of every view. The audit log is a chronological list of state transitions. That's the closest the page gets to a lifecycle view, but it lives at the bottom of a long card and shows history, not progress.

**Why it matters**: A procurement can sit in `Pending` for days. A BA who opens one in the morning has no way to know "this has been waiting 2 days" or "I am the third person in the workflow, the next step is X". The audit log is post-hoc; the user needs at-a-glance "you are here" with the steps behind and ahead.

**Fix**: Add a horizontal stepper at the top of `$procurementId.tsx`, below the header. Show the canonical path (Draft → Pending → Review → InTransit → Delivered → ReviewingSJ → Payment → Finished), with the current step highlighted, completed steps in a muted/checkmark state, and the rejected/cancelled path as an off-ramp. The audit log stays for history; the stepper stays for orientation.

**Suggested command**: `/impeccable layout` (or `/impeccable shape` if you want to argue through the visualization choice first).

---

### [P1] The CA queue lives inside a procurement detail page

**What**: `PendingCaQueue` is rendered as the body of a procurement detail page when the procurement is in `Pending` state and the viewer is CA. So the only way for an admin_pusat to see _all_ pending procurements is to:

1. Navigate to `/scm-procurements`.
2. Click any procurement that happens to be in `Pending`.
3. Scroll to the queue card.
4. Click "Buka Review" on a _different_ pending procurement.

The list page (`index.tsx`) shows all procurements with no status filter. The queue is a side-effect of opening one procurement.

**Why it matters**: Admin Pusat's primary job on this surface is processing the pending queue. The current flow makes that primary job 3 clicks and a scroll away, with a confusing intermediate "you opened one to see the others" detour. A power user with 30 pending procurements cannot batch-process them.

**Fix**: Lift the queue out of the detail page. Add either a tab on the list page (`/scm-procurements?status=Pending`) or a dedicated route (`/scm-procurements/queue`). The detail page should always show the _current_ procurement, not a list of others. The CA opens one procurement to work on it — they shouldn't see the queue embedded in the work surface.

**Suggested command**: `/impeccable shape` (UX decision) followed by `/impeccable layout` (when implementing).

---

### [P1] The Draft state is unreachable from the create flow but has a view

**What**: `new.tsx` calls `createProcurement` and _immediately_ calls `transitionProcurement` with `event: "submit"`. There is no "save as draft" path. The only way to reach `Draft` is from `Pending` via the BA's "Tarik Kembali" (withdraw) action.

The `DraftForm` view in `views.tsx` is the view for the `Draft` state. It renders the items read-only and offers Submit / Cancel. There is no edit affordance. So a BA can withdraw a procurement back to Draft and then… submit it again, with no changes. Or cancel it.

**Why it matters**: This is dead code with a side effect: the audit log shows "Dibuat → Disubmit" with no Draft entry, which is technically correct, but the FSM has a Draft state, a view, and a transition that are all unreachable in the normal user journey. The audit log will never show a "withdraw" because there's nothing to withdraw from. The view will never render.

**Fix**: Pick one of two directions:

- Remove the auto-submit in `new.tsx`. The BA creates a Draft, can edit (add/remove items) until ready, then submits. This requires an actual edit view (`DraftForm` becomes editable, not read-only).
- Remove the Draft state and the DraftForm view. The create flow is always submit-on-create. The withdraw transition becomes a no-op or is removed.

Right now both exist, neither works.

**Suggested command**: `/impeccable shape` to decide, then `/impeccable clarify` to update the copy and remove the dead view.

---

## Persona Red Flags

### Bu Siti (Admin Pusat, warehouse): processing the queue

Bu Siti opens her laptop, opens `/scm-procurements`, and needs to clear the morning's pending procurements. Her journey:

- **Land on list page**: 50 rows, all statuses, no filter. She has to scroll. [P2 — status filter missing on the list]
- **Pick the first row to see the queue**: 3 clicks deep to see the actual work queue. [P1 — see "queue lives inside a procurement"]
- **Click "Buka Review" on a different procurement**: The page navigates. The new procurement is now in `UnderReview` state. [P1 — see "default pending to approved"]
- **She scans 8 items, doesn't click anything, clicks "Setujui & Buat SJ"**: 8 items silently flipped to approved. [P0]
- **She clicks "Tolak Semua" with no reason typed**: Button is disabled. OK, that's good. [P3 — no issue]
- **She opens the next one**: Repeat. No keyboard shortcut (e.g., `J/K` to step through the queue, `A` to approve-and-next). [P2 — no accelerators]

**Verdict**: Admin Pusat's primary workflow is broken twice (queue location, silent override). Fixing the queue and the override should be the top two priorities for this role.

### Pak Hadi (Kasir / branch_admin): creating a procurement

Pak Hadi runs out of cooking oil mid-rush. He needs to request more.

- **Opens `/scm-procurements`**: Sees his branch's existing procurements. The list is helpful, but the "Buat Pengadaan" button is in the top-right, two scroll-heights away on mobile. [P2]
- **Clicks "Buat Pengadaan"**: A form with one dropdown and one number input. The dropdown lists every ingredient the system knows about, alphabetically, with no search and no filter. With 200+ ingredients, finding "Minyak Goreng" means scrolling. [P1 — no combobox/search on the ingredient picker]
- **No stock context**: He can see the unit price (the `averageCost`) but not "you have 2 kg in stock" or "you ordered 5 kg last week". He has to leave the page to check inventory. [P1 — missing context]
- **Picks 5, clicks Tambah**: The item appears in the table. He picks the next ingredient. Clicks Tambah. Adds a note. Clicks "Submit Pengadaan". Procurement is created and submitted. [P3 — auto-submit, see Draft issue]
- **No "save as draft"**: If he gets interrupted mid-form, he loses everything. [P1 — no draft, no persistence]
- **Clicks "Detail" on the new row**: He sees the procurement in Pending state, with the audit log showing "Dibuat" and "Disubmit" within the same second. [P3 — irrelevant detail in the log]

**Verdict**: The create flow works for the happy path of "I know what to order and I'm not interrupted". It fails for the realistic case of "I'm mid-rush, partial order, need to come back".

### Bu Wati (Area Manager, supervisor)

Bu Wati audits branches. She opens a procurement to see what happened.

- **She sees the full audit log, the items table, the rejection reason (if any)**. [OK — visibility is good]
- **She sees the actorRole column in the audit log**: "branch admin", "admin pusat" — useful, no security concern. [OK]
- **She has no way to compare expected vs actual received quantities** at a glance beyond the items table. The variance is not surfaced as a "this was off by 8%" indicator. [P2 — variance is a row, not a highlight]

---

## Minor Observations

- **Inconsistent loading affordances**: `$procurementId.tsx` shows `<div className="p-6">Loading...</div>` and `<div className="p-6">Procurement tidak ditemukan</div>`. The layout's auth-loading path uses Skeleton components. The `new.tsx` mutation "Menyimpan..." is in the button text, which is good. Three different patterns on the same surface.
- **Hardcoded raw `<select>` in `new.tsx`**: The Item picker has a hand-typed `className="border-input bg-background ring-offset-background …"` block that's a copy of the `Select.Trigger` styling. The codebase has a `Select` component (`#/components/ui/select.tsx`). Use it.
- **Custom raw `<input>` in two places**: `UnderReviewCaReview` and `ReviewingSjBaInteractive` for the rejection/cancellation reason input have the same hand-typed className block. Should be a single `<Input>` component or a small `<ReasonInput>`.
- **"Batal" / "Batalkan" / "Batal Pengadaan" inconsistency**: `Batalkan` (DraftForm), `Batal` (new.tsx form footer), `Batal` (PendingBaView, but actually `Batalkan`). Pick one.
- **Search is `code`-only** on the list page. The table has a `status` column and a `createdAt` column — both could be searchable. The list will get long and the search will feel thin.
- **`pendingQ` query is enabled in every view**, not just the views that show the queue. Wasted bandwidth on most detail-page loads.
- **`max={picked}` on the receive input is HTML-only**: The onChange handler doesn't enforce it. A user typing a number larger than `picked` will produce a negative `rejectedQuantity`.
- **The `uncontrolled` `defaultValue` on `readyQuantity` input in ca-review mode**: The comment in `ScmItemTable.tsx` admits this is fragile. If the items prop re-renders (e.g., after a save), the input value resets to the new default and the user's typed value is lost.
- **`CancelledView` and `RejectedView` show only the reason, not the items table**: The user can't see _what_ was cancelled or rejected from the detail page. For audit purposes, this is incomplete.
- **Audit log entries that are immediately superseded** (e.g., "Submit" then "Withdraw" then "Submit" in 5 seconds) clutter the timeline. No grouping or filtering of "rapid edit" bursts.
- **The first-column sticky behavior in DataTable works on horizontal scroll, but the second column's `min-w-[80px]` combined with 8 columns in `ScmItemTable` means the table overflows on every viewport < 1200px**. No responsive collapse.
- **Mobile tap targets on the `Setujui`/`Tolak` pair**: `px-2 py-1 text-xs` is below 44px height on any device. Tapping these on a tablet is a precision test.

---

## Questions to Consider

1. **The 7-step lifecycle is the product. Is it visible anywhere else?** If the audit log is the only place where a procurement's journey is shown, the user is reading history to find their current step. Should the stepper be on the list page (showing the step each row is on) as well as the detail page?
2. **What's the canonical happy path through the queue?** Is it "BA submits → CA reviews → CA ships → BA receives → BA reviews → CA marks paid"? Or is there a faster path for trusted branches? The current model treats every step as identical.
3. **Should the audit log be a tab, not a card at the bottom?** It's competing for attention with the items table. Right now the items are the primary surface; the log is a footnote. Is that intentional, or is the log equally important?
4. **Is the "default pending to approved" pattern saving clicks for the right user?** The CA in a rush is helped. The CA who got distracted is hurt. Which one is more common?
5. **What's the longest a procurement stays in `Pending`?** If it's hours, the BA needs "still waiting" feedback. If it's days, the BA needs a notification. Right now there's neither — a BA who submitted yesterday and opens the procurement today sees the same view as one who submitted 5 minutes ago.
6. **Are the status labels a translation problem or a model problem?** If you translate "InTransit" to Indonesian, you get "Dalam Pengiriman". If you translate "Delivered", you get "Terkirim" or "Sudah Dikirim". The current labels use neither the English state name nor a clean Indonesian translation. Pick one.

---

## Persist & Trend

**Trend for `src-routes-layout-scm-procurements-index-tsx`**: First run for this target, no trend yet.
Wrote `.impeccable/critique/<filename>`.
