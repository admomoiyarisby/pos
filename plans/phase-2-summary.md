# Phase 2 Implementation Summary — POS & Order Management

## What Was Built

### Server Functions (`src/lib/server/pos.ts`)

| Function         | Purpose                                                                                                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getPosMenu`     | Returns active recipes with brand links, modifier groups, modifiers, and inventory levels for a branch. Supports filtering by brand, category, and search.                       |
| `getShiftStatus` | Checks if a user has an open shift for a branch.                                                                                                                                 |
| `openShift`      | Creates a new open shift with cash float (modal awal laci).                                                                                                                      |
| `closeShift`     | Closes shift with actual cash, calculates variance.                                                                                                                              |
| `createOrder`    | Full order transaction: calculates subtotal/COGS/tax/MDR/net sales, creates order + order items + order item modifiers, deducts inventory via BOM, creates stock ledger entries. |
| `getOrders`      | Returns order list for history/audit.                                                                                                                                            |

### POS Terminal (`/pos`)

The POS page is a full-screen terminal interface with:

#### Top Bar

- **Channel selector**: Dine-in / Gofood / Grabfood / ShopeeFood
- **Customer input**: Name for Dine-in, order code for online channels
- **Shift button**: "Buka Shift" (if closed) / "Tutup Shift" (if open)

#### Brand Tabs

- Horizontal scrollable brand filter pills
- "Semua Brand" option + one pill per brand
- Active brand highlighted with primary color

#### Category Filters

- Pills: Semua / Makanan / Minuman / Snack / Add-on
- Quick filter for menu grid

#### Search Bar

- Real-time search by menu name/code
- Magnifying glass icon

#### Menu Grid

- Responsive grid (3–5 columns based on viewport)
- Each item shows: image placeholder (or actual image), name, price
- "+ Modifiers" badge if item has modifier groups
- Click → opens modifier modal (if modifiers) or adds directly to cart

#### Modifier Modal (Forced Pop-up)

- Shown automatically when item with modifiers is clicked
- Per modifier group:
  - Group name + "Pilih X-Y" indicator
  - Single-selection groups: clicking replaces previous selection
  - Multi-selection groups: up to maxSelection items
  - Price shown for paid modifiers
- Notes textarea per item (e.g. "Pisah sambal")
- Total price updates dynamically with modifier prices
- "Tambah" button adds to cart with all selections

#### Cart Panel (Right Sidebar)

- Item list with:
  - Name + modifier list indented below
  - Customer notes in italic
  - Qty +/- buttons
  - Trash delete button
  - Running line total
- Subtotal display
- Payment method selector (Cash / QRIS / Transfer)
- "Bayar" button (disabled if no shift open)
- Warning if shift not open

#### Last 3 Orders

- Shows below cart on successful checkout
- Time, items summary, total
- Auto-updates after each completed order

#### Shift Management Modals

- **Open Shift**: Input modal awal laci (cash float)
- **Close Shift**: Input uang fisik aktual (blind close — no expected amount shown)

### Order History (`/order-history`)

- Full order list in DataTable
- Columns: Waktu, Channel (badge), Kode/Nama Pelanggan, Total, Status
- Click row → detail modal with:
  - Order ID, Channel, Total, Status
  - Timestamp
- Filters by date range, channel, status (framework ready)

### Approval Queues

- **`/cancel-requests`** — Table of cancel request approvals
  - Columns: Waktu, Order ID, Alasan, Diajukan Oleh, Status
  - Pending requests show Approve/Reject buttons
  - Super Admin / Admin Pusat / Area Manager access

- **`/print-requests`** — Table of re-print invoice approvals
  - Same pattern as cancel requests
  - Type column (Re-print Invoice, etc.)

## Auth & RBAC

| Route              | Allowed Roles                          |
| ------------------ | -------------------------------------- |
| `/pos`             | super_admin, branch_admin              |
| `/order-history`   | super_admin                            |
| `/cancel-requests` | super_admin, admin_pusat, area_manager |
| `/print-requests`  | super_admin, admin_pusat, area_manager |

Server functions enforce role checks via `requireAuth()`.

## Key Features Implemented

1. **Cross-brand cart**: Items from different brands can coexist in cart (for offline/Dine-in)
2. **Modifier support**: Forced modal with single/multi selection, price additions, notes per item
3. **Inventory deduction**: On order completion, BOM ingredients deducted from branch inventory with stock ledger entries
4. **COGS snapshot**: Calculated per order based on current ingredient costs
5. **MDR calculation**: Platform fees applied based on channel configuration
6. **Shift workflow**: Open with cash float → operate POS → close with blind cash count
7. **Last orders**: Sidebar shows 3 most recent completed orders

## Known Limitations (for future phases)

- **Voucher application** — UI field exists but discount calculation not yet wired
- **Tax/PB1** — Toggle exists in settings but not applied to order total
- **Print Bill / Print Invoice** — Buttons not yet wired to actual printing
- **Cancel request flow** — POS can request cancel but backend queue processing needs Phase 3+ integration
- **Re-print approval** — Same as cancel, queue UI ready but full flow pending
- **Order edit** — Not yet implemented
- **Modifier exclusion logic** — "Tanpa X" modifiers not yet deducting from standard BOM
- **Child recipe / bundle** — Bundle items (Family Pack, BOGO) not yet expanding child recipes

## Files Created / Modified

| File                                     | Lines | Purpose                                            |
| ---------------------------------------- | ----- | -------------------------------------------------- |
| `src/lib/server/pos.ts`                  | ~320  | POS server functions (menu, shift, order, history) |
| `src/routes/_layout/pos.tsx`             | ~520  | Full POS terminal UI                               |
| `src/routes/_layout/order-history.tsx`   | ~130  | Order history with detail modal                    |
| `src/routes/_layout/cancel-requests.tsx` | ~80   | Cancel approval queue                              |
| `src/routes/_layout/print-requests.tsx`  | ~80   | Print approval queue                               |

## How to Test Phase 2

1. **Login as Branch Admin** (after seeding)
2. **Open Shift**: Click "Buka Shift", enter modal awal (e.g. 500000)
3. **Select channel**: Try Dine-in, enter customer name
4. **Browse menu**: Click brand tabs, category filters, search
5. **Add items**: Click menu item → modifier modal appears → select modifiers → add notes → "Tambah"
6. **Adjust cart**: Change qty, remove items
7. **Checkout**: Select payment method, click "Bayar"
8. **Verify**: Check last orders sidebar, check order history page
9. **Close Shift**: Click "Tutup Shift", enter actual cash

## Ready for Phase 3

Phase 2 provides a functional POS system:

- ✅ Full terminal UI with brand tabs, categories, search
- ✅ Modifier modal with single/multi selection
- ✅ Cart with qty management
- ✅ Order creation with inventory deduction
- ✅ Shift open/close
- ✅ Order history
- ✅ Cancel/print approval queues (UI)

Phase 3 (Deep Inventory & Audit) can now begin with inventory and stock opname modules.
