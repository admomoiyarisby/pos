# Responsive Design Fix Plan

## Problem Statement

All views in the app are desktop-only. The sidebar is always visible, tables overflow horizontally, the POS cart sidebar breaks the layout, and grid layouts don't adapt gracefully to mobile screens. The goal is to make the app usable on tablets and phones.

---

## 1. AppShell — Mobile Layout Architecture

**File**: `src/components/AppShell.tsx`

### Current Issues

- Fixed `ml-64` margin-left on `<main>` assumes sidebar is always visible
- No mobile breakpoint handling at all
- Title bar in main content has no wrapping for small screens

### Changes Required

1. **Make sidebar collapsible on mobile**:
   - Add a mobile breakpoint state using `useState` + `useEffect` with `window.innerWidth`
   - Or use Tailwind's `hidden`/`flex` classes with `md:` breakpoints
   - On screens `< md` (768px), hide sidebar by default; show a hamburger menu button in the top bar

2. **Add mobile header bar**:
   - Add a `md:hidden` hamburger button (Menu icon from lucide-react) to toggle the sidebar
   - The button sits in the top-left of the main content area
   - When sidebar is open on mobile, it should overlay the content (fixed, z-50, bg-black/50 backdrop)

3. **Adjust main content padding for mobile**:
   - Change `<main className="ml-64 flex-1 p-6">` to:
     ```tsx
     <main className="flex-1 p-4 md:ml-64 md:p-6">
     ```
   - On mobile (`< md`), no `ml-64`; content fills the screen with `p-4`
   - On desktop (`md:` and up), restore `ml-64 p-6`

4. **Top bar title wrapping**:
   - Current: `flex items-center justify-between` can cause overflow
   - Change to: `flex flex-col gap-2 md:flex-row md:items-center md:justify-between`
   - Title/description on top, action buttons below on mobile

### Mobile Sidebar Behavior

- `md:` and up: sidebar is always visible (`flex`), main has `ml-64`
- `< md`: sidebar is hidden by default, hamburger button visible
- Clicking hamburger: sidebar slides in as an overlay with a dark backdrop
- Clicking backdrop or a nav item closes the sidebar
- Use `transform -translate-x-full` / `translate-x-0` for slide animation

---

## 2. Sidebar — Mobile Drawer Mode

**File**: `src/components/Sidebar.tsx`

### Current Issues

- `fixed left-0 top-0 z-40 h-screen w-64` — always visible, no mobile variant
- No close button for mobile overlay

### Changes Required

1. **Accept `mobileOpen` and `onClose` props**:

   ```tsx
   interface SidebarProps {
     userRole: UserRole;
     mobileOpen: boolean;
     onClose: () => void;
   }
   ```

2. **Desktop vs mobile rendering**:
   - Wrap the entire `<aside>` in a fragment
   - Desktop: `<aside className="hidden md:flex fixed left-0 top-0 z-40 h-screen w-64 ...">`
   - Mobile: render an overlay + slide-in drawer when `mobileOpen` is true

3. **Mobile overlay structure**:

   ```tsx
   {/* Mobile overlay backdrop */}
   {mobileOpen && (
     <div
       className="fixed inset-0 z-50 bg-black/50 md:hidden"
       onClick={onClose}
     />
   )}
   {/* Mobile slide-in drawer */}
   <aside
     className={
       "fixed left-0 top-0 z-50 flex h-screen w-64 flex-col border-r bg-sidebar transition-transform md:hidden " +
       (mobileOpen ? "translate-x-0" : "-translate-x-full")
     }
   >
     {/* Same content as desktop, but add a close button */}
     <div className="flex h-14 items-center justify-between border-b px-4">
       <Link ...>Omoiyari POS</Link>
       <button onClick={onClose} className="rounded-md p-1 hover:bg-sidebar-accent">
         <X className="h-5 w-5" />
       </button>
     </div>
     ...
   </aside>
   ```

4. **Import `X` from lucide-react** if not already imported

5. **Update `AppShell` to pass `mobileOpen` and `onClose`** to Sidebar

---

## 3. DataTable — Horizontal Scroll + Mobile Cards

**File**: `src/components/ui/DataTable.tsx`

### Current Issues

- Raw `<table>` without horizontal scroll wrapper
- On mobile, wide tables overflow the viewport
- Column widths (`w-24`, `w-28`) are fixed and don't adapt
- Pagination controls are in a flex row that might wrap poorly
- No card/mobile view fallback

### Changes Required

1. **Add horizontal scroll wrapper around the table**:

   ```tsx
   <div className="rounded-md border overflow-x-auto">
     <table className="w-full caption-bottom text-sm min-w-[640px]">
   ```

   - The `overflow-x-auto` on the wrapper ensures horizontal scrolling
   - `min-w-[640px]` on the table ensures columns don't get squished

2. **Make search bar responsive**:
   - Current: `flex items-center gap-2` with search input + count
   - On mobile, the "X item" count might push the search bar too narrow
   - Change to: `flex flex-col gap-2 sm:flex-row sm:items-center`
   - Move the count below the search on mobile, or hide it with `hidden sm:inline`

3. **Pagination responsive**:
   - Current: `flex items-center justify-between` — on mobile the page info and buttons might clash
   - Change to: `flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between`
   - Add `flex-wrap` to the button container: `flex items-center gap-1 flex-wrap`

4. **Optional: Add a card view toggle for very small screens** (future enhancement, not required now):
   - For now, horizontal scroll is sufficient

5. **Column widths on mobile**:
   - Remove explicit `width` classes that force columns to be wide
   - Instead, let the table naturally size columns, or use `min-w-[...]` on the wrapper
   - The `width` prop on columns can remain; the `min-w-[640px]` on the table handles the rest

---

## 4. Dashboard — Chart & Grid Responsiveness

**File**: `src/routes/_layout/dashboard.tsx`

### Current Issues

- Chart containers have fixed 320px/256px height — acceptable but might feel large on small screens
- Anomaly cards use `md:grid-cols-2` — ok
- OrderHistoryTable uses DataTable — will need the DataTable fix
- Grid layouts: `lg:grid-cols-2`, `lg:grid-cols-3` — these are ok, but `gap-6` might be too large on mobile

### Changes Required

1. **Reduce gap on mobile**:
   - Change all `gap-6` in dashboard grid containers to `gap-4 md:gap-6`

2. **StatsCards already responsive** — `grid-cols-1 md:grid-cols-3` is correct

3. **Chart card padding**:
   - Current: `rounded-lg border bg-card p-4 shadow-sm`
   - On mobile, `p-4` might be too much for small screens
   - Change to: `rounded-lg border bg-card p-3 md:p-4 shadow-sm`
   - Do this in each chart component in `src/components/dashboard/Charts.tsx`

4. **Chart height on mobile**:
   - Current: 320px and 256px — these are fine, but on very small screens could be reduced
   - Optional: reduce to 240px/200px on mobile with a media query or conditional class
   - For simplicity, keep current heights; horizontal scroll on tables is the bigger issue

5. **HPP alert cards** — check `HppAlertCards.tsx` for mobile overflow

6. **DiscrepancyTable** — uses DataTable, will be fixed by DataTable changes

---

## 5. POS Page — Mobile Cart Drawer

**File**: `src/routes/_layout/pos.tsx`

### Current Issues

- `flex` layout with cart sidebar `w-80` — creates horizontal overflow on mobile
- `-m-6` negative margin hack to extend full width
- Menu grid: `grid-cols-3 lg:grid-cols-4 xl:grid-cols-5` — on very small screens, 3 columns with `gap-3` might be too tight
- Category buttons + search bar in one row might overflow
- No mobile-specific cart interaction

### Changes Required

1. **Restructure layout for mobile**:
   - Desktop (`md:` and up): current 2-column flex layout with cart sidebar
   - Mobile (`< md`): single column — menu takes full width, cart becomes a floating action button (FAB) or bottom sheet

2. **Mobile layout**:

   ```tsx
   <div className="flex flex-col md:flex-row h-[calc(100vh-3rem)] -m-4 md:-m-6">
     {/* Main Content — full width on mobile */}
     <div className="flex-1 flex flex-col p-4 md:p-6 overflow-hidden">
       ...existing content...
     </div>
   ```

3. **Cart sidebar — hidden on mobile, shown as overlay/bottom sheet**:
   - On mobile, hide the `w-80` sidebar completely (`hidden md:flex`)
   - Add a floating cart button (FAB) at bottom-right with item count badge
   - Clicking FAB opens a slide-up drawer (Sheet) with the cart
   - On desktop, keep the current fixed sidebar

4. **Menu grid on mobile**:
   - Change `grid-cols-3` to `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5`
   - 2 columns on mobile is much more usable than 3

5. **Category + search bar**:
   - Current: `flex items-center gap-3 mb-4 shrink-0`
   - Change to: `flex flex-col gap-2 mb-4 sm:flex-row sm:items-center`
   - Categories wrap naturally; search takes full width on mobile

6. **Top bar (branch/channel/customer)**:
   - Current: `flex items-center gap-3 mb-4 shrink-0 flex-wrap`
   - `flex-wrap` is already there — verify it works well
   - On mobile, these might need to stack: `flex flex-wrap gap-2`
   - The `max-w-xs` on inputs might be too wide on mobile; change to `max-w-full sm:max-w-xs`

7. **Brand tabs**:
   - Already has `overflow-x-auto` — this is correct for mobile
   - But the container might need `pb-1` to show scrollbar

8. **Cart drawer for mobile**:
   - Create a new `Sheet` component (or reuse Modal) for the mobile cart
   - Triggered by FAB button
   - Contains the same cart content as the desktop sidebar
   - Or simpler: just use a `fixed inset-0 z-50 bg-background` overlay on mobile

---

## 6. Modal — Mobile Width Constraints

**File**: `src/components/ui/Modal.tsx`

### Current Issues

- `max-w-sm` through `max-w-xl` might exceed mobile viewport width
- But `w-full p-4` on the overlay should handle it
- Verify: the modal has `p-4` on the overlay and `w-full` on the inner div, so it should be ok

### Changes Required

- Add responsive margin/padding:
  ```tsx
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2 sm:p-4">
  ```
- Change size classes to be responsive:
  ```tsx
  const sizeClasses = {
    sm: "max-w-[calc(100vw-1rem)] sm:max-w-sm",
    md: "max-w-[calc(100vw-1rem)] sm:max-w-md",
    lg: "max-w-[calc(100vw-1rem)] sm:max-w-lg",
    xl: "max-w-[calc(100vw-1rem)] sm:max-w-xl",
  };
  ```

---

## 7. List/Index Pages — Table Overflow

**Files**: `src/routes/_layout/*/*.tsx` and `src/routes/_layout/*.tsx`

### Current Issues

- All 44 layout pages use DataTable which will overflow on mobile
- Some pages have `PageHeader` action buttons + filters in one row

### Changes Required

1. **All pages that use DataTable** will be fixed automatically by the DataTable changes (horizontal scroll wrapper)

2. **Pages with filter bars above tables** — check and fix individual pages:
   - `src/routes/_layout/inventory/index.tsx` — has no filters, just DataTable
   - `src/routes/_layout/order-history.tsx` — check for date/channel filters
   - `src/routes/_layout/admin/users.tsx` — check for filter row
   - `src/routes/_layout/admin/branches.tsx` — check for filter row
   - Make filter rows use `flex flex-col gap-2 sm:flex-row` pattern

3. **Quick audit of pages with inline filter bars**:
   Scan these files for `flex items-center gap-` patterns above DataTable:
   ```bash
   grep -rl "flex items-center gap" src/routes/_layout/ --include="*.tsx"
   ```
   For each file found, if the row contains multiple inputs/buttons, wrap it responsively:
   ```tsx
   <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
   ```

---

## 8. Login Page

**File**: `src/routes/login.tsx`

### Current Issues

- Likely has a fixed-width card centered on screen
- Should be verified for mobile padding

### Changes Required

- Ensure the login form card has responsive padding and max-width
- `max-w-sm` or `max-w-md` with `w-full mx-auto` is usually fine
- Add `px-4` to the container if not present

---

## Implementation Order (Priority)

1. **AppShell + Sidebar** — Core layout; everything else depends on this
2. **DataTable** — Fixes all 44+ table views at once
3. **Modal** — Quick fix, affects all modal dialogs
4. **POS Page** — High-traffic page, complex layout
5. **Dashboard** — Polish chart padding and gaps
6. **Login page** — Quick check/fix
7. **Audit remaining list pages** — Fix any custom filter rows

---

## Testing Checklist

After implementation, test these views on a 375px width viewport (iPhone SE):

- [ ] Sidebar opens/closes with hamburger menu
- [ ] Dashboard: stats cards stack, charts are readable, tables scroll horizontally
- [ ] POS: menu grid is 2 columns, cart opens via FAB, checkout works
- [ ] Ingredients list: table scrolls horizontally
- [ ] Users list: table scrolls horizontally
- [ ] Inventory: table scrolls horizontally
- [ ] Order history: table scrolls horizontally
- [ ] Modals: fit within viewport, no overflow
- [ ] Login: form is centered and usable

Also test on 768px (iPad) and 1024px+ (desktop) to verify desktop layout is unchanged.
