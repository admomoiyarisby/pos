# UI Fix Plan: Unified Top Bar

## Problem

1. The `AppShell` top bar only shows a `NotificationBell` on the right with empty space on the left.
2. Every page repeats its own `<PageHeader title="..." description="..." />` inline, wasting vertical space.
3. There is no dark/light mode toggle in the app layout — the `ThemeToggle` component exists but lives in the unused `Header.tsx` template file.

## Goals

1. **Move page title + description into the AppShell top bar** so it appears consistently above every page content, replacing the empty `<div />` on the left.
2. **Add `ThemeToggle` beside `NotificationBell`** in the same top bar.
3. **Remove inline `PageHeader` title/description** from all pages (keep the action button where needed).
4. **Support dynamic titles** — pages that switch title based on state (e.g. "Edit Cabang" vs "Tambah Cabang") must still work.

## Architecture

### PageTitleContext

A lightweight React context + hook that any component in the tree can use to publish its title/description.

```tsx
// src/components/PageTitleProvider.tsx
interface PageTitleState {
  title: string;
  description?: string;
}
const PageTitleContext = createContext<{
  state: PageTitleState;
  setState: (s: PageTitleState) => void;
}>(...);

// src/hooks/usePageTitle.ts
export function usePageTitle(title: string, description?: string) {
  const { setState } = useContext(PageTitleContext);
  useEffect(() => { setState({ title, description }); }, [title, description]);
}
```

### AppShell changes

```tsx
// In the top bar area:
<div className="flex items-center justify-between mb-4">
  <div>
    <h1 className="text-xl font-bold tracking-tight">{pageTitle}</h1>
    {pageDescription && <p className="text-sm text-muted-foreground">{pageDescription}</p>}
  </div>
  <div className="flex items-center gap-2">
    <ThemeToggle />
    <NotificationBell />
  </div>
</div>
```

### PageHeader refactor

`PageHeader` keeps the `action` prop but title/description are removed from its render. Pages that had `action` keep using `PageHeader` for the button; pages without `action` remove `PageHeader` entirely and just call `usePageTitle()`.

Actually simpler: rename `PageHeader` to just render the action button, or inline the action buttons directly. Since most pages have a single "+ Tambah" action, the cleanest approach is:

- Pages with `action`: keep `<PageHeader action={...} />` but it only renders the button (no title)
- Pages without `action`: remove `PageHeader` import entirely, add `usePageTitle(...)` at top of component

### Files to touch

| File                                   | Change                                                                                              |
| -------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `src/components/PageTitleProvider.tsx` | **NEW** — Context provider                                                                          |
| `src/hooks/usePageTitle.ts`            | **NEW** — Hook                                                                                      |
| `src/components/AppShell.tsx`          | Consume context, render title/desc + ThemeToggle + NotificationBell                                 |
| `src/components/ui/PageHeader.tsx`     | Remove title/description rendering, keep action button only                                         |
| `src/routes/_layout.tsx`               | Wrap `AppShell` with `PageTitleProvider`                                                            |
| `src/routes/_layout/*.tsx` (27 files)  | Replace `<PageHeader title=... description=...` with `usePageTitle(...)`; keep action where present |

### Pages with dynamic titles

These need `usePageTitle` called conditionally based on state:

- `admin/branches.tsx` — "Edit Cabang" / "Tambah Cabang"
- `admin/vouchers.tsx` — same pattern (modal title, not page title — keep static page title)
- `admin/brands.tsx` — "Edit Brand" / "Tambah Brand"
- `admin/users.tsx` — "Edit User" / "Tambah User"
- `yield-tracking.tsx` — "Input Produksi (Yield)" — this is a section title, not the page title. Keep "Yield Tracking" as page title.
- `stock-opname/index.tsx` — "Trigger Stock Opname" — section title, keep "Stock Opname" as page title
- `stock-opname/$soId.tsx` — "Approve Stock Opname" — page title changes based on route
- `stock-transfers/index.tsx` — "Ajukan Mutasi Stok" — section title
- `delivery-notes/index.tsx` — "Buat Surat Jalan" — section title
- `scm-invoices/index.tsx` — static
- `period-control/index.tsx` — static
- `order-history.tsx` — "Riwayat Pemesanan" / "Detail Pesanan"
- `pos.tsx` — no PageHeader, skip
- `cancel-requests.tsx` — static
- `finance/index.tsx` — static
- `recipes/index.tsx` — static
- `purchase-orders/index.tsx` — static
- `modifier-groups/index.tsx` — static
- `ingredients/index.tsx` — static
- `inventory/index.tsx` — static
- `inventory/ledger.tsx` — static
- `analytics/index.tsx` — static
- `purchase-requisitions/index.tsx` — static
- `waste/index.tsx` — static
- `waste/broken-stock.tsx` — static
- `admin/system-logs.tsx` — static
- `admin/platform-fees.tsx` — static
- `admin/audit-logs.tsx` — static

Wait, looking closer at the grep results, some `title=` appear inside Modal components (e.g. `<Modal title="Edit Cabang">`). Those are modal titles, not page titles — they stay as-is. Only the `<PageHeader title=... description=...>` instances need changing.

### Edge cases

- `order-history.tsx` has `PageHeader title="Riwayat Pemesanan"` and later a modal with `title="Detail Pesanan"`. The modal title is irrelevant; the page title is static.
- `yield-tracking.tsx` has a `PageHeader` for the main page and a second one for a section — actually let me re-read it:
  - Line 160: `<PageHeader title="Yield Tracking" description="..." />` — main page header
  - Line 219: `<h3 className="font-semibold text-lg">Input Produksi (Yield)</h3>` — this is just an `<h3>`, not a PageHeader. Good.
- `stock-opname/index.tsx` — line 121 `PageHeader title="Stock Opname"` is the page header; line 133 is a modal title.

## Implementation

All items completed.

### What changed

| File                                   | Change                                                                                                                                |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/PageTitleProvider.tsx` | **NEW** — React context that holds current page title + description                                                                   |
| `src/hooks/usePageTitle.ts`            | **NEW** — Hook that pages call to publish their title/description                                                                     |
| `src/components/AppShell.tsx`          | Top bar now shows title/description on the left, `ThemeToggle` + `NotificationBell` on the right                                      |
| `src/routes/_layout.tsx`               | Wrapped `AppShell` with `PageTitleProvider`                                                                                           |
| `src/components/ui/PageHeader.tsx`     | Stripped down to only render the `action` button (no title/description)                                                               |
| `src/routes/_layout/*.tsx` (27 files)  | All replaced `<PageHeader title=... description=...>` with `usePageTitle(...)`; pages with actions keep `<PageHeader action={...} />` |

### Result

- **Before**: Each page wasted vertical space with its own `<PageHeader title="..." description="..." />` block. The top bar had an empty left side and only a notification bell on the right.
- **After**: Title and description appear uniformly in the AppShell top bar. The `ThemeToggle` button sits right next to the `NotificationBell`. Pages only render their unique content. Action buttons ("+ Tambah") still appear inline where needed.
