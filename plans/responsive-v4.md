# Responsive Fixes v4

## 1. Remove scroll hint from DataTable

**File**: `src/components/ui/DataTable.tsx`

The gradient overlay is `position: absolute` on the scroll wrapper. When the table scrolls right, the gradient stays fixed at the wrapper's right edge and appears "in the middle" of the visible table — looks broken.

**Fix**: Remove lines ~158-159:

```tsx
{
  /* Scroll hint — visible gradient on right edge */
}
<div className="pointer-events-none absolute right-0 top-0 bottom-0 w-6 bg-gradient-to-l from-black/[0.08] to-transparent z-20" />;
```

---

## 2. Dashboard tables not responsive

**Files**: `CogsAnalysisTable.tsx`, `DiscrepancyTable.tsx`, `OrderHistoryTable.tsx`, `RopRoqTable.tsx`, `WasteLossTable.tsx`

These tables have `overflow-x-auto` wrappers but `<table>` lacks `min-w-[...]`, so the wrapper never overflows. Tables shrink and text wraps into unreadable thin columns.

### 2a. Add `min-w-[640px]` to `<table>`

- `CogsAnalysisTable.tsx`, `DiscrepancyTable.tsx`, `OrderHistoryTable.tsx`: change `<table className="w-full border-collapse text-left">` → add `min-w-[640px]`
- `RopRoqTable.tsx`, `WasteLossTable.tsx`: change `min-w-[480px]` → `min-w-[640px]`

### 2b. Add `whitespace-nowrap` to ALL `<th>` and `<td>` cells

In each file, append `whitespace-nowrap` to every `<th>` and `<td>` className.

### 2c. Add sticky first column

On the FIRST `<th>` and FIRST `<td>` of each row, append:

```
sticky left-0 bg-background z-10 border-r border-border
```

This must be added IN ADDITION to existing classes.

### 2d. Verify `overflow-x-auto` wrapper exists

All 5 files should have `<div className="... overflow-x-auto">` around the table. Add if missing.

---

## 3. HPP Alert Cards — dark mode colors

**File**: `src/components/dashboard/HppAlertCards.tsx`

Cards use `border-emerald-100 bg-emerald-50` which is invisible/readable in dark mode.

**Fix**: Change line ~45 from:

```tsx
<div key={item.id} className="rounded-xl border border-emerald-100 bg-emerald-50 p-3">
```

To:

```tsx
<div key={item.id} className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3">
```

The opacity-based colors (`/10`, `/20`) adapt to both light and dark modes.

---

## 4. Notification popover off-screen on mobile

**File**: `src/components/NotificationBell.tsx`

Popover uses `absolute right-0 w-80`. On mobile the bell is near the right edge; the popover overflows off-screen.

**Fix**: Make the popover responsive:

- On mobile (`< sm`): full width with small margins, positioned below the bell
- On desktop (`sm:`): keep current `w-80 right-0`

Change the popover div (line ~65):

```tsx
// BEFORE
<div className="absolute right-0 top-10 z-50 w-80 rounded-lg border bg-card shadow-lg">

// AFTER
<div className="absolute right-0 top-10 z-50 w-[calc(100vw-2rem)] sm:w-80 rounded-lg border bg-card shadow-lg">
```

Also consider adding `left-auto right-0` on desktop and `left-4 right-4` on mobile for centered positioning. But the simpler `w-[calc(100vw-2rem)]` makes it fit the screen with 1rem margin on each side.

---

## 5. Modal too tall and unscrollable on mobile

**File**: `src/components/ui/Modal.tsx`

Modal body has no scroll. With `grid-cols-1` on mobile, forms with 8+ fields exceed viewport height. The overlay has `items-center` which tries to center the modal, but content gets cut off at top/bottom.

**Fix**: Add scroll and max-height constraints to the modal content.

### 5a. Make modal content scrollable

Change the inner content div (line ~38):

```tsx
// BEFORE
<div className={`w-full ${sizeClasses[size]} rounded-lg border bg-card p-6 shadow-lg`}>

// AFTER
<div className={`w-full ${sizeClasses[size]} rounded-lg border bg-card p-4 sm:p-6 shadow-lg max-h-[calc(100vh-2rem)] overflow-y-auto`}>
```

### 5b. Change overlay alignment for tall modals

Change overlay from `items-center` to `items-start` with top padding, so tall modals start from top with scroll rather than being centered and cut off:

```tsx
// BEFORE
className = "fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2 sm:p-4";

// AFTER
className =
  "fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-2 sm:p-4 pt-10 sm:pt-16";
```

This ensures:

- Modal starts below the top of the screen (not centered)
- If content is taller than viewport, it scrolls within the modal
- On mobile (`pt-10`), modal starts 2.5rem from top
- On desktop (`sm:pt-16`), modal starts 4rem from top

---

## Implementation Order

1. Issue 1 (DataTable scroll hint) — 1 file, 2 lines removed
2. Issue 3 (HPP colors) — 1 file, 1 line changed
3. Issue 4 (Notif popover) — 1 file, 1 line changed
4. Issue 5 (Modal scroll) — 1 file, 2 lines changed
5. Issue 2 (Dashboard tables) — 5 files, many repetitive changes

## Testing

- [ ] DataTable: no gradient visible when scrolling
- [ ] Dashboard tables: horizontal scroll works, first column sticks, text doesn't wrap
- [ ] HPP cards: readable in both light and dark mode
- [ ] Notification popover: fully visible on mobile, not cut off
- [ ] Ingredients modal on mobile: can scroll to see all form fields and submit button
