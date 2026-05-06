# Responsive Table Fix Plan v3 — Root Cause Analysis

## Root Cause 1: Page-level horizontal overflow (CRITICAL)

**DOM chain**:

```
<body>
  <div class="flex min-h-screen">     ← flex container
    <aside>...</aside>                   ← sidebar
    <main class="flex-1 p-4">           ← flex item, min-width: auto (default!)
      <DataTable>
        <div class="overflow-x-auto">   ← scroll wrapper (NEVER activates)
          <table class="min-w-[640px]"> ← forces <main> to expand
```

**Problem**: `<main>` is a flex item. Flex items have `min-width: auto` by default. They refuse to shrink below their content size. The table's `min-w-[640px]` makes `<main>` at least 640px wide. The flex container grows to fit it. The viewport scrolls horizontally. The `overflow-x-auto` wrapper never overflows because its parent (`<main>`) has already expanded to fit.

**Fix**: Add `min-w-0` to `<main>` in AppShell.tsx. This tells the flex item: "You CAN shrink below content size. Let the child handle overflow."

## Root Cause 2: Sticky first column appears broken

**Problem**: `position: sticky` only works relative to the nearest scrolling ancestor. Because the page itself scrolls (Root Cause 1), the sticky cells' scroll context is `<body>`, not the table wrapper. Even after fixing Root Cause 1, the `boxShadow` inline style on sticky cells causes rendering artifacts in some browsers (shadow gets cut off by table borders).

**Fix**:

1. Fix Root Cause 1 first (so the scroll context becomes the table wrapper)
2. Replace `boxShadow` inline style with Tailwind `border-r` on sticky cells for a clean visual divider
3. Ensure sticky cells have `bg-background` so they cover the scrolling content underneath

## Root Cause 3: Text wraps to thin unreadable columns

**Problem**: Table cells have no `white-space` control. When the table width is constrained by `min-w-[640px]` but some columns have very little content, long-text columns get squished and wrap to 1-2 words per line.

**Fix**: Add `whitespace-nowrap` to ALL `<th>` and `<td>` cells. This prevents text wrapping entirely. The table width is already controlled by `min-w-[640px]`, so cells will be sized by their content. On mobile, the table scrolls horizontally. On desktop, cells have enough room.

**Concern**: Some columns intentionally have multi-line content (e.g., order items list, notes). If those columns exist, they can use a `render` function that wraps content in a `<div className="max-w-[200px] whitespace-normal">`.

## Root Cause 4: Scroll hint gradient doesn't show

**Problem**: The gradient overlay (`from-black/[0.03]`) is nearly invisible on both light and dark backgrounds. It's supposed to hint that more columns exist, but `0.03` opacity is imperceptible.

**Fix**: Increase opacity to `0.08` and add a visible right border to the sticky column as the primary visual cue.

---

## Implementation

### Fix 1: AppShell — Add `min-w-0` to `<main>`

**File**: `src/components/AppShell.tsx`
**Change**: `<main className="flex-1 p-4 md:ml-64 md:p-6">` → `<main className="flex-1 min-w-0 p-4 md:ml-64 md:p-6">`

### Fix 2: DataTable — Simplify sticky styles

**File**: `src/components/ui/DataTable.tsx`
**Changes**:

1. Remove `boxShadow` inline style from sticky cells
2. Add `border-r` class to sticky cells for clean visual divider
3. Add `whitespace-nowrap` to all `<th>` and `<td>` cells
4. Add `min-w-[80px]` safety to `<th>` and `<td>` cells
5. Increase scroll hint gradient opacity from `0.03` to `0.08`

### Fix 3: Dashboard tables — Verify overflow works after AppShell fix

**Files**: `src/components/dashboard/CogsAnalysisTable.tsx`, `DiscrepancyTable.tsx`, `OrderHistoryTable.tsx`, `RopRoqTable.tsx`, `WasteLossTable.tsx`
**Check**: All already have `overflow-x-auto` wrappers. After the AppShell fix, they should work correctly. No changes needed unless verified broken.

---

## Testing

1. Open any DataTable page on mobile viewport (375px)
2. Verify: page does NOT scroll horizontally (only the table wrapper scrolls)
3. Verify: first column stays visible while scrolling the table right
4. Verify: text in cells does NOT wrap to multiple lines
5. Verify: scroll hint gradient is visible on the right edge
