# Pengadaan Lifecycle UX

## Context

The new SCM procurement flow (ADR 0002) has shipped and been critiqued. Six
priority issues were identified in the 2026-06-15 critique:

- **P0**: state labels contradict state names (`InTransit` labelled
  "Disetujui", `Delivered` labelled "Dalam Pengiriman" — off by one).
- **P0**: hardcoded color leaks in `ScmItemTable.tsx` (`bg-green-100`,
  `text-green-700`, `bg-red-100`, `text-red-700`, `bg-red-50`) bypass the
  design system and break in dark mode.
- **P0**: the `rowsToItems` function in `views.tsx` silently rewrites
  `caDecision === "pending"` to `"approved"` so the CA can click
  **Setujui & Buat SJ** without touching any row. The audit log will not
  reflect explicit per-row decisions; the visual state implies the CA
  actively approved each item, but the system has decided for them.
- **P1**: a 7-step lifecycle is hidden behind a single status badge — no
  stepper, no progress visualization.
- **P1**: the CA's review queue lives inside a procurement detail page,
  reachable only by opening a `Pending` procurement. Primary work surface
  for Admin Pusat is 3 clicks + a scroll away.
- **P1**: the `Draft` state is unreachable from the create flow (the new
  form auto-submits) but the FSM has a `Draft` state, a `DraftForm` view,
  and a `withdraw` transition. The view renders read-only items — a BA
  who withdraws to `Draft` cannot edit, only re-submit unchanged.

The user (operator) confirmed **A / A / A** to the three open UX
decisions and the monochrome stepper during the shape interview. This ADR
records those decisions and the resulting design.

## Decision

### 1. Explicit per-row CA decision (replaces the silent override)

The `rowsToItems` function in `src/components/scm-procurements/views.tsx`
**stops** rewriting `caDecision === "pending"` to `"approved"`. The DB
column starts each item at `"pending"` and stays `"pending"` until the CA
clicks **Setujui** or **Tolak** on that row.

The primary **Setujui & Buat SJ** button is **disabled** until every row
is in `"approved"` or `"rejected"` state. The same gate applies to
**Tolak Semua**, which already requires a rejection reason (existing
behaviour, preserved).

The visual treatment of `pending` becomes a neutral `secondary` badge in
the `caDecision` column. The CA sees their outstanding work; clicking a
row's decision button transitions the badge to `success` or `destructive`.
The `ScmItemTable.tsx` `decisionColors` map is updated to include
`pending: "warning"` (amber) so the outstanding work reads as a warm
alert, not a muted neutral — the CA's eye lands on it.

**Why not a confirm-step modal (Model B)?** The silent override is a
truth-in-audit-log problem. A confirm modal that shows the _effective_
state before transition is a band-aid: the CA still didn't make the
decisions, the modal just makes the consequences visible. The audit log
would still lack a "CA explicitly approved row X" entry. The fix is
making the decision explicit at the row level, not papering over the
override at the moment of commitment.

### 2. CA queue moves to a status filter on the list page

The list page (`src/routes/_layout/scm-procurements/index.tsx`) gets a
status filter (tabs or a `<Select>` near the search box). Filter state
lives in the URL as `?status=Pending` so it's deep-linkable and
shareable. The detail page no longer renders the `PendingCaQueue` — that
branch of the `DispatchView` switch is removed.

A pending-count badge appears on the **Pengadaan** sidebar item for
admin_pusat and super_admin, so the queue is one click away from any
authenticated view. The badge is computed from the same
`listProcurements({ data: { status: "Pending" } })` query that powers
the filtered list, deduplicated via TanStack Query cache.

**Why not a dedicated `/scm-procurements/queue` route?** The list page is
already the entry point; the queue is a _filter_ of the list, not a
separate surface. Adding a route would mean two URLs for the same
dataset, two sets of permissions, and two places to keep the search and
pagination state in sync. A URL param is a smaller additive change.

### 3. `Draft` becomes a real, editable state

The auto-submit in `src/routes/_layout/scm-procurements/new.tsx` is
removed. `createProcurement` produces a `Draft`; the BA picks **Simpan
sebagai Draft** (stay on the form, items editable) or **Submit
Pengadaan** (transition to `Pending`, navigate to detail page).

The `DraftForm` view in `views.tsx` becomes editable. The `ScmItemTable`
gains a new mode `draft-edit` (read-write items, add/remove via a
button in a trailing column). The new mode reuses the ingredient
combobox from `new.tsx` (which itself is migrated to the design-system
`Select` component as part of this change — see the file table).

A BA can also reach `Draft` by withdrawing a `Pending` procurement. The
existing `withdraw` transition is preserved; the new behaviour is that
the resulting `DraftForm` is now meaningfully editable, not a read-only
shell.

**Why not delete `Draft` entirely?** The kasir's realistic flow is
interrupted mid-form (mid-rush, missing ingredient, called to the
counter). An auto-submit on save loses that work. The Draft state is
the right model; it just wasn't wired up. A `localStorage` autosave
would be a partial substitute but loses the "open another tab and
continue" cross-device property of a server-side draft.

### 4. Stepper: monochrome thin bar

A new `<Stepper>` component is added at the top of
`$procurementId.tsx`, below the page header. Seven canonical steps
(`Draft → Pending → Review → InTransit → Delivered → ReviewingSJ →
Payment → Finished`), with the current step highlighted using
`bg-primary` (structural dark from the design system) on the active dot
and label. Completed steps render with a muted check. Future steps
render with a `border-border` outline and `text-muted-foreground`. No
chart colors, no decoration, no gradient.

The stepper is **display-only** — clicking a step does not navigate.
It's an orientation affordance, not a control.

`Rejected` and `Cancelled` are rendered as labelled off-ramps: a
destructive-toned line from the step at which the procurement was
rejected/cancelled, with a small badge on that step. The off-ramp
replaces the step's normal label, so the user sees the divergence at a
glance.

The component is a single file
(`src/components/scm-procurements/Stepper.tsx`) and takes only
`currentStatus: ScmProcurementStatus` as its prop. The 7-step path and
the off-ramp labels live in a small const inside the file; they have
no other consumers.

## Resulting file changes

| File                                                     | Change                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/adr/0004-pengadaan-lifecycle-ux.md`                | This ADR.                                                                                                                                                                                                                                                                   |
| `src/components/scm-procurements/views.tsx`              | Remove the `pending → approved` override. Disable **Setujui & Buat SJ** until all rows resolved. Make `DraftForm` editable. Remove the `PendingCaQueue` branch from the route's `DispatchView` (it stays exported but unused in the dispatch — kept for testability).       |
| `src/components/scm-procurements/ScmItemTable.tsx`       | Add `draft-edit` mode. Convert `readyQuantity` from `defaultValue` (uncontrolled) to controlled `value` + `onChange` with `useEffect` reset on prop change. Add `pending: "warning"` to `decisionColors`. Fix the `max={picked}` enforce in onChange (currently HTML-only). |
| `src/components/scm-procurements/Stepper.tsx`            | **New.** 7-step monochrome bar with off-ramp support.                                                                                                                                                                                                                       |
| `src/routes/_layout/scm-procurements/index.tsx`          | Status filter (URL-driven, `?status=`). New query for status-filtered list. Sidebar count via TanStack Query.                                                                                                                                                               |
| `src/routes/_layout/scm-procurements/new.tsx`            | Remove auto-submit. Add **Simpan sebagai Draft** button. Migrate raw `<select>` to design-system `<Select>`. Migrate raw reason inputs to `<Input>`.                                                                                                                        |
| `src/routes/_layout/scm-procurements/$procurementId.tsx` | Add `<Stepper>` below header. Remove `PendingCaQueue` from `DispatchView`. Replace `Loading...` text with skeleton. Show items table in `CancelledView` and `RejectedView`.                                                                                                 |
| `src/components/scm-procurements/AuditLogTimeline.tsx`   | `stateLabel` helper updated to match the corrected labels.                                                                                                                                                                                                                  |
| `src/lib/auth-context.tsx`                               | No change.                                                                                                                                                                                                                                                                  |
| `src/lib/server/scm-fsm.ts`                              | No change. The FSM already supports all transitions.                                                                                                                                                                                                                        |

## Visual direction

- **Color strategy**: Restrained (project default).
- **Theme scene**: a warehouse supervisor at 8am, opening her laptop in
  a fluorescent-lit office with the morning's pending procurements on
  the screen, under time pressure to clear the queue before suppliers
  call. Light/neutral, cool grays, no decorative color.
- **Anchor references**: Stripe dashboard status badges, Linear's
  issue state stepper, GitHub PR status checks.

## Interaction model

- **List page**: clicking a status tab updates the URL (`?status=Pending`)
  and filters the table. The DataTable's `keyExtractor` re-mounts on
  status change. CA sees a pending-count badge on the **Pengadaan**
  sidebar item.
- **Detail page**: opens to `<Stepper>` + the current state's view.
  Stepper is non-interactive.
- **Create flow**: BA opens `/scm-procurements/new`, adds items, picks
  **Simpan sebagai Draft** or **Submit Pengadaan**. Drafts appear in
  the list with a `Draft` badge; click into a draft to continue editing.
- **CA review**: each row's **Setujui** / **Tolak** button toggles the
  state. The row's `pending` badge clears when the CA decides. The
  primary button enables when no row is `pending`.

## Key states (per surface)

### List page

- Default: status tab `Semua`, DataTable of procurements.
- Empty: "Belum ada pengadaan. Buat pengadaan pertama untuk branch ini."
  with a primary CTA.
- Loading: skeleton rows.
- Filtered empty: "Tidak ada pengadaan dengan status X."
- Error: sonner toast (wired in `__root.tsx`).

### Detail page (per state)

- `Draft`: editable item table (BA), Simpan / Submit / Cancel.
- `Pending`: read-only items, stepper prominent, Withdraw / Cancel.
- `UnderReview` (CA): items with per-row decision required, primary
  button disabled until resolved, Tolak Semua gated on reason.
- `InTransit` / `Delivered`: read-only with print buttons.
- `ReviewingSJ` (BA): receive form, primary button gated on all rows
  filled.
- `WaitingForPayment`: invoice preview with total, print button.
- `Finished` / `Cancelled` / `Rejected`: read-only summary with audit
  log prominent and items table visible.
- Loading: skeleton (not text).
- Error: inline red message + retry where safe.

### Stepper

- Default: 7 dots, current highlighted, completed muted, future
  light.
- Rejected / Cancelled: labelled off-ramp from the step at which the
  transition occurred.

## Content

- Status labels (corrected): `Draft` "Draft", `Pending` "Menunggu
  Review", `UnderReview` "Sedang Direview", `Rejected` "Ditolak",
  `InTransit` "Dalam Pengiriman", `Delivered` "Sudah Dikirim",
  `ReviewingSJ` "Sedang Direview Cabang", `WaitingForPayment`
  "Menunggu Pembayaran", `Finished` "Lunas", `Cancelled` "Dibatalkan".
- Buttons: "Simpan sebagai Draft", "Submit Pengadaan", "Setujui &
  Buat SJ", "Tolak Semua", "Batalkan", "Tarik Kembali", "Tandai
  Sudah Dikirim", "Lanjut ke Review", "Selesai Review", "Tandai Telah
  Dibayar".
- Stepper labels: each state name in Indonesian.
- Microcopy: "Selesaikan keputusan per item untuk melanjutkan" — the
  primary-disabled hint.

## Consequences

- **The CA review step gets slower for the common case.** Previously
  one click approved all 8 items; now it's 8 row clicks + 1 primary
  click. For a 30-item review this is a real cost. Mitigated by the
  `pending` badge being a warm amber (eye-catches the outstanding
  work) and the primary button being clearly disabled (visible
  affordance for "you must finish this first").
- **The audit log gains explicit per-row decision entries** (assuming
  the existing `item-update` audit event is used on each toggle — to
  be verified during implementation; if not, the FSM needs to emit
  one `item-update` per row at the moment of the `accept-and-ship`
  transition).
- **The list page query count increases** for CA (status filter
  changes the dataset, so the `?status=Pending` query is a separate
  TanStack Query key). Mitigated by cache dedup — the same query
  powers the sidebar badge.
- **Drafts accumulate.** If BAs save drafts and never return, the list
  page will have many `Draft` rows. Mitigated by a status filter
  hiding `Draft` for non-BA roles. The `withdraw` path also produces
  drafts, which is the intended behaviour.
- **The stepper adds ~40px of vertical chrome** to the detail page.
  Acceptable cost for orientation on a 7-step document.
- **The `cancel` reason input still uses a raw `<input>` in two
  views.** Phase 4 audit will catch the same hand-typed className
  block elsewhere; the stepper ADR is not the right place to fix that.

## Considered options

- **A. Confirm-step modal (Model B for the silent override).** Pro:
  fewer clicks for the CA. Con: the audit log still lacks explicit
  per-row decisions, the modal is a band-aid on a lie. Rejected.
- **B. Dedicated `/scm-procurements/queue` route.** Pro: clean
  separation. Con: two URLs for the same dataset, duplicated
  permissions, duplicated search state. Rejected — a URL filter is a
  smaller change with the same outcome.
- **C. Delete the `Draft` state entirely.** Pro: simpler model.
  Con: loses the interrupted-mid-form workflow, which is the realistic
  case for kasir. Rejected — the state exists for a reason; it just
  wasn't wired up.
- **D. Numbered stepper with brand color on the active step.** Pro:
  visually emphatic. Con: violates the Restrained palette discipline
  for a 7-step component that appears on every detail page. Rejected
  in favor of monochrome with structural dark.
- **E. Auto-save drafts to `localStorage`.** Pro: no server change.
  Con: loses cross-device continuity, loses the audit trail of
  "user saved a draft". Rejected in favor of server-side `Draft`.

## Implementation order

This ADR is the design record. Implementation is split across the
impeccable command phases per the critique action plan:

1. Phase 1 — shape (this ADR).
2. Phase 2 — `/impeccable layout`: stepper component, status filter,
   editable `DraftForm`, raw `<select>` → design-system `<Select>`,
   the four primary-button gates (CA review, BA receive, etc.),
   `max={picked}` enforcement.
3. Phase 3 — `/impeccable clarify`: status label renames, audit-log
   `stateLabel` updates, microcopy, "Batal" / "Batalkan"
   standardization.
4. Phase 4 — `/impeccable audit`: color system violations
   (`bg-green-100` etc.), dark-mode parity, raw input/select
   replacement where not already covered in phase 2.
5. Phase 5 — `/impeccable polish`: responsive table collapse, 44px
   tap targets, items table in `CancelledView` / `RejectedView`,
   variance highlight, audit log density, skeleton for detail loading.
