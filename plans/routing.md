# Omoiyari POS — TanStack Start Routing Plan

> **Goal:** Map every feature from the `~/Rice/omoiyari_pos` prototype into a file-based TanStack Start route tree, with phased implementation order, RBAC rules, schema mappings, and server-function patterns.

---

## 1. Routing Conventions & Project Structure

This project uses **TanStack Start file-based routing** (`@tanstack/react-router`).

| Convention                 | Meaning                                                                                                        |
| -------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `src/routes/__root.tsx`    | Root layout (HTML shell, providers, devtools). Already exists.                                                 |
| `src/routes/_layout.tsx`   | Layout route that **does not** add a URL segment. Used for the authenticated app shell (sidebar + auth guard). |
| `src/routes/_layout/*.tsx` | All routes nested under `_layout` automatically get the app shell.                                             |
| `src/routes/login.tsx`     | Public route, no sidebar.                                                                                      |
| `src/routes/api/**/*.ts`   | API / server-function catch-all routes (e.g. `api/auth/$.ts`).                                                 |
| `$param.tsx`               | Dynamic segment, e.g. `orders/$orderId.tsx` → `/orders/:orderId`.                                              |
| `index.tsx`                | Directory index, e.g. `orders/index.tsx` → `/orders`.                                                          |

### Proposed Top-Level Folder Layout

```
src/routes/
  __root.tsx                          # Root shell (keep existing)
  login.tsx                           # Public login (password + PIN modes)
  _layout.tsx                         # App shell: Sidebar + Auth guard + Notifications
  _layout/
    index.tsx                         # /         (redirects based on role)
    dashboard.tsx                     # /dashboard
    pos.tsx                           # /pos
    order-history.tsx                 # /order-history
    cancel-requests.tsx               # /cancel-requests
    print-requests.tsx                # /print-requests
    inventory/
      index.tsx                       # /inventory
      ledger.tsx                      # /inventory/ledger
    stock-opname/
      index.tsx                       # /stock-opname
      $soId.tsx                       # /stock-opname/:soId (detail/investigate)
    purchase-requisitions/
      index.tsx                       # /purchase-requisitions
      $prId.tsx                       # /purchase-requisitions/:prId
    purchase-orders/
      index.tsx                       # /purchase-orders
      $poId.tsx                       # /purchase-orders/:poId
    delivery-notes/
      index.tsx                       # /delivery-notes  (Surat Jalan)
      $dnId.tsx                       # /delivery-notes/:dnId
    scm-invoices/
      index.tsx                       # /scm-invoices
      $invId.tsx                      # /scm-invoices/:invId
    stock-transfers/
      index.tsx                       # /stock-transfers (Mutasi Stok)
      $trId.tsx                       # /stock-transfers/:trId
    waste/
      index.tsx                       # /waste
      broken-stock.tsx                # /waste/broken-stock
    yield-tracking.tsx                # /yield-tracking
    ingredients/
      index.tsx                       # /ingredients (Bahan Baku)
      $ingId.tsx                      # /ingredients/:ingId
    recipes/
      index.tsx                       # /recipes (Master Menu)
      $recipeId.tsx                   # /recipes/:recipeId
    modifier-groups/
      index.tsx                       # /modifier-groups
      $mgId.tsx                       # /modifier-groups/:mgId
    finance/
      index.tsx                       # /finance
      reconciliation.tsx              # /finance/reconciliation
    analytics/
      index.tsx                       # /analytics
      sales.tsx                       # /analytics/sales
      inventory.tsx                   # /analytics/inventory
    period-control/
      index.tsx                       # /period-control
      $periodId.tsx                   # /period-control/:periodId
    admin/
      index.tsx                       # /admin (landing/settings)
      users.tsx                       # /admin/users
      branches.tsx                    # /admin/branches
      brands.tsx                      # /admin/brands
      vouchers.tsx                    # /admin/vouchers
      platform-fees.tsx               # /admin/platform-fees
      audit-logs.tsx                  # /admin/audit-logs
      system-logs.tsx                 # /admin/system-logs
  api/
    auth/
      $.ts                             # Keep existing better-auth handler
    # Server-only functions are defined via createServerFn inside route files
    # or in dedicated `src/server/` modules. No extra HTTP routes required.
```

---

## 2. Phase 0 — Foundation (Do First)

**Objective:** Auth layer, app shell, and navigation scaffolding so every later phase has a place to live.

| #   | File                           | URL             | RBAC              | Purpose                                                                                                                                                                                                                                                        |
| --- | ------------------------------ | --------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1 | `src/routes/login.tsx`         | `/login`        | **Public**        | Dual-mode login: email/password (all roles) and 4-digit PIN (Branch Admin). Integrates with `better-auth`. On success, redirect based on role.                                                                                                                 |
| 0.2 | `src/routes/_layout.tsx`       | _(layout only)_ | **Authenticated** | App shell: sidebar with categorized dropdowns, top bar (branch selector for multi-branch roles), notification bell, user dropdown. Contains **route guard**: unauthenticated → `/login`. Role-based **hidden UI** (remove links entirely rather than disable). |
| 0.3 | `src/routes/_layout/index.tsx` | `/`             | **Authenticated** | Role-based redirect landing page. E.g. Branch Admin → `/pos`, Super Admin → `/dashboard`, Admin Pusat → `/purchase-requisitions`.                                                                                                                              |
| 0.4 | `src/routes/api/auth/$.ts`     | `/api/auth/*`   | **Public**        | Keep existing better-auth catch-all. Extend later for PIN-login custom handler if needed.                                                                                                                                                                      |

### Sidebar Categories (Nested Dropdowns)

Based on FRD §8.1 notes, group navigation items so the sidebar is not flat:

1. **Dashboard** — `/dashboard` _(Super Admin only)_
2. **Operasional**
   - Order Entry (POS) — `/pos`
   - Riwayat Pemesanan — `/order-history`
3. **Inventaris**
   - Stok Saat Ini — `/inventory`
   - Kartu Stok — `/inventory/ledger`
   - Stock Opname — `/stock-opname`
   - Waste — `/waste`
   - Broken Stock — `/waste/broken-stock`
4. **Supply Chain**
   - Purchase Requisition — `/purchase-requisitions`
   - Purchase Order — `/purchase-orders`
   - Surat Jalan — `/delivery-notes`
   - Invoice SCM — `/scm-invoices`
   - Mutasi Stok — `/stock-transfers`
5. **Produksi**
   - Yield Tracking — `/yield-tracking`
   - Bahan Baku — `/ingredients`
6. **Master Data**
   - Menu / Resep — `/recipes`
   - Modifier Groups — `/modifier-groups`
   - Users — `/admin/users`
   - Cabang — `/admin/branches`
   - Brand — `/admin/brands`
   - Voucher — `/admin/vouchers`
   - Platform Fees — `/admin/platform-fees`
7. **Keuangan & Analitik**
   - Finance & Recon — `/finance`
   - Dashboard Analytics — `/analytics`
8. **Sistem**
   - Period Control — `/period-control`
   - Audit Logs — `/admin/audit-logs`
   - System Logs — `/admin/system-logs`

### Shared Components to Build in Phase 0

- `src/components/AppShell.tsx` — Sidebar + main content area (imported by `_layout.tsx`).
- `src/components/Sidebar.tsx` — Recursive nav with dropdown groups.
- `src/components/BranchSelector.tsx` — Global branch filter (visible only to roles with multi-branch access).
- `src/components/RoleGuard.tsx` — Wrapper that returns `<Navigate>` or `null` for unauthorized roles.
- `src/components/DataTable.tsx` — Reusable server-side paginated table (10–15 rows) with search + sort.
- `src/components/DetailModal.tsx` — Reusable slide-over/modal for PR/SJ/Invoice detail views (per FRD §8.1).

---

## 3. Phase 1 — Master Data & Configuration

**Objective:** All CRUD screens that feed downstream modules. Super Admin + Admin Pusat + Central Kitchen heavy.

| #    | File                                           | URL                    | RBAC                                      | Schema Tables                                                                | Key Features                                                                                                                                                                     |
| ---- | ---------------------------------------------- | ---------------------- | ----------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1  | `src/routes/_layout/admin/branches.tsx`        | `/admin/branches`      | Super Admin, Admin Pusat (view)           | `branches`                                                                   | CRUD cabang. Flag `type: Central \| Outlet`. Toggle active/online.                                                                                                               |
| 1.2  | `src/routes/_layout/admin/brands.tsx`          | `/admin/brands`        | Super Admin, Admin Pusat                  | `brands`                                                                     | CRUD brand. Upload logo.                                                                                                                                                         |
| 1.3  | `src/routes/_layout/admin/users.tsx`           | `/admin/users`         | Super Admin                               | `users`, `areaManagerBranches`                                               | CRUD users. Assign role + branch. **Unique PIN per branch** constraint. Reset PIN. Show/hide modules per role.                                                                   |
| 1.4  | `src/routes/_layout/ingredients/index.tsx`     | `/ingredients`         | Super Admin, Admin Pusat, Central Kitchen | `ingredients`                                                                | CRUD bahan baku. Fields: SKU Type (RM/SFG/FG), category (Fresh/Dry/Packaging), UoM conversion, COGS, ROP, ROQ, MOQ, countable toggle.                                            |
| 1.5  | `src/routes/_layout/ingredients/$ingId.tsx`    | `/ingredients/:ingId`  | Super Admin, Admin Pusat, Central Kitchen | `ingredients`                                                                | Detail + edit form. Show linked recipes (BOM usage).                                                                                                                             |
| 1.6  | `src/routes/_layout/recipes/index.tsx`         | `/recipes`             | Super Admin, Admin Pusat                  | `recipes`, `recipeBrands`, `recipeIngredients`, `recipeChildRecipes`         | Master Menu list. Many-to-many brand tagging (dedicated vs shared menu). Toggle active/inactive.                                                                                 |
| 1.7  | `src/routes/_layout/recipes/$recipeId.tsx`     | `/recipes/:recipeId`   | Super Admin, Admin Pusat                  | `recipes`, `recipeIngredients`, `recipeChildRecipes`, `recipeModifierGroups` | BOM editor: add/remove ingredients & quantities. Child recipe bundling (Paket). Modifier group assignment. **BOM Cost Roll-Up**: on save, recalculate all dependent recipe COGS. |
| 1.8  | `src/routes/_layout/modifier-groups/index.tsx` | `/modifier-groups`     | Super Admin, Admin Pusat                  | `modifierGroups`, `modifiers`, `modifierIngredients`                         | CRUD modifier groups (min/max selection). Modifiers with optional price and optional BOM (`modifierIngredients`). Support exclusion modifiers (`isExclusion`).                   |
| 1.9  | `src/routes/_layout/admin/vouchers.tsx`        | `/admin/vouchers`      | Super Admin                               | `vouchers`                                                                   | Centralized promo/voucher creation. Code, discount type (%/fixed), min order, validity, active toggle. Auto-distributed to all POS terminals.                                    |
| 1.10 | `src/routes/_layout/admin/platform-fees.tsx`   | `/admin/platform-fees` | Super Admin                               | `platformFees`                                                               | Configure MDR & fixed fee per channel (Gofood, Grabfood, ShopeeFood, Dine-in).                                                                                                   |
| 1.11 | `src/routes/_layout/admin/index.tsx`           | `/admin`               | Super Admin, Admin Pusat                  | `appSettings`                                                                | System settings: PB1/Tax toggle, smart reordering formula parameters (days multiplier), receipt header/footer text.                                                              |

### Server Functions (Phase 1)

Create in `src/server/master-data.ts` or co-located in route files using `createServerFn`:

- `getIngredients({ page, limit, search, category, skuType })` — paginated, server-side.
- `createIngredient / updateIngredient / deleteIngredient`
- `getRecipes({ page, limit, brandId, category, search })`
- `createRecipe / updateRecipe / deleteRecipe`
- `getRecipeDetail(recipeId)` — with ingredients, child recipes, modifier groups.
- `recalculateRecipeCogs(ingredientId)` — triggered on ingredient cost change; updates all dependent recipes.
- `getUsers({ page, limit, role, branchId })`
- `createUser / updateUser / resetPin` — enforce unique PIN per branch.
- `getBranches`, `getBrands`, `getVouchers`, `getPlatformFees`

---

## 4. Phase 2 — POS & Order Management

**Objective:** The cash register interface, order tracking, and shift workflows. Heavily used by Branch Admin; Super Admin can also access.

| #   | File                                     | URL                | RBAC                                        | Schema Tables                                                                                                               | Key Features                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | ---------------------------------------- | ------------------ | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1 | `src/routes/_layout/pos.tsx`             | `/pos`             | Branch Admin, Super Admin                   | `orders`, `orderItems`, `orderItemModifiers`, `orderItemExclusions`, `shifts`, `inventory`, `recipes`, `brands`, `vouchers` | **Main POS terminal.** Brand tabs (McD style tile UI). Category filters (Makanan, Minuman, Snack, Add-on). Search bar. Modifier modal (ShopeeFood-style forced pop-up). Cross-brand cart for offline. Voucher input. **Negative stock tolerance** (soft block, allow minus). Standby UI with last 3 orders. Print Bill button. Print Invoice (thermal) on complete. Shift open/close UI embedded or modal. |
| 2.2 | `src/routes/_layout/order-history.tsx`   | `/order-history`   | Super Admin _(dedicated page per FRD §8.1)_ | `orders`, `orderItems`, `cancelRequests`, `printRequests`                                                                   | Full order history with details modal. Filters: date range, branch, channel, brand, status. Search by order ID / code. **Re-print action** (requires approval flow). **Edit order** (limited fields, with audit).                                                                                                                                                                                          |
| 2.3 | `src/routes/_layout/cancel-requests.tsx` | `/cancel-requests` | Super Admin, Admin Pusat, Area Manager      | `cancelRequests`, `orders`                                                                                                  | Approval queue for order cancellations. 3 fixed reasons: Stok Habis, Salah Input, Customer Cancel. Approve/Reject with audit trail.                                                                                                                                                                                                                                                                        |
| 2.4 | `src/routes/_layout/print-requests.tsx`  | `/print-requests`  | Super Admin, Admin Pusat, Area Manager      | `printRequests`, `orders`                                                                                                   | Approval queue for re-print invoice requests. Approve/Reject.                                                                                                                                                                                                                                                                                                                                              |

### POS Sub-Components (co-located or in `src/components/pos/`)

- `PosTerminal.tsx` — Main layout: left=menu grid, right=cart + actions.
- `BrandTabs.tsx` — Horizontal brand filter with visual tiles.
- `CategoryFilter.tsx` — Makanan / Minuman / Snack / Add-on pills.
- `MenuGrid.tsx` — Recipe cards with image, price, quick-add.
- `ModifierModal.tsx` — Forced modal on item click. Handles required/optional modifiers, exclusions, notes per item.
- `CartPanel.tsx` — Live cart with item list, modifiers shown indented, notes, qty adjust, remove.
- `CheckoutBar.tsx` — Subtotal, voucher field, total, payment method, submit.
- `LastOrdersSidebar.tsx` — Last 3 completed orders with dropdown detail + re-print request button.
- `ShiftModal.tsx` — Open shift (input modal awal) / Close shift (blind input uang fisik, variance calc).

### Server Functions (Phase 2)

- `getPosMenu({ branchId, brandId, category, search })` — recipes + inventory stock level for the branch.
- `createOrder({ branchId, channel, customerName/orderCode, items, voucherCode, paymentMethod })` — full transaction: validate voucher, deduct inventory via BOM (including modifier BOM + exclusion returns), snapshot COGS, calculate tax, MDR, net sales, create ledger entries. **Must respect period lock**.
- `getShiftStatus({ branchId, userId })` — is there an open shift?
- `openShift({ branchId, cashFloat })`
- `closeShift({ shiftId, actualCash, notes })` — calculate variance, log discrepancy.
- `requestCancelOrder({ orderId, reason })` — create cancel request, flag order.
- `approveCancelRequest({ requestId })` — on approve, reverse inventory (add back), void order.
- `requestReprint({ orderId })` — create print request.
- `approvePrintRequest({ requestId })` — allow reprint.

---

## 5. Phase 3 — Deep Inventory & Audit

**Objective:** Real-time stock visibility, stock opname workflows, and waste tracking. Used by all roles with branch-scoped visibility.

| #   | File                                        | URL                   | RBAC                                                                  | Schema Tables                                     | Key Features                                                                                                                                                                                                                                                                                                                                        |
| --- | ------------------------------------------- | --------------------- | --------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.1 | `src/routes/_layout/inventory/index.tsx`    | `/inventory`          | All roles (branch-scoped)                                             | `inventory`, `ingredients`, `branches`            | Current stock table. **Pagination** (10–15 rows). Search bar. Filter: category (Dry, Fresh, Packaging, Bahan Baku). Sort. **Logical Branch Masking**: Branch Admin sees no branch column; data auto-filtered to their branch. Admin Pusat sees only Central Warehouse by default (no branch filter).                                                |
| 3.2 | `src/routes/_layout/inventory/ledger.tsx`   | `/inventory/ledger`   | All roles (branch-scoped)                                             | `stockLedger`, `ingredients`, `branches`          | Stock ledger (kartu stok). Same pagination/search/filter rules. Shows IN/OUT history with balance.                                                                                                                                                                                                                                                  |
| 3.3 | `src/routes/_layout/stock-opname/index.tsx` | `/stock-opname`       | All roles (with visibility differences)                               | `stockOpnames`, `stockOpnameItems`, `ingredients` | List of SO sessions. Trigger button (Area Manager / Admin Pusat only). Status badges: Submitted / Approved / Under Investigation.                                                                                                                                                                                                                   |
| 3.4 | `src/routes/_layout/stock-opname/$soId.tsx` | `/stock-opname/:soId` | All roles (with visibility differences)                               | `stockOpnames`, `stockOpnameItems`                | **SO Input Form**. Branch Admin & Admin Pusat = **Blind SO**: only item name + empty qty input. Cannot see expected stock. Submit button locked if blank. Super Admin & Area Manager = **See-through SO**: can see expected stock, can submit, and can mark Approved / Under Investigation. They can also edit submission details after discussion. |
| 3.5 | `src/routes/_layout/waste/index.tsx`        | `/waste`              | Branch Admin, Area Manager, Super Admin, Admin Pusat, Central Kitchen | `wasteEntries`, `ingredients`                     | Input waste: 3 fixed categories — **Beban Makan**, **Biaya Operasional**, **Spoiled**. Auto-link Biaya Operasional to Broken Stock. Automated waste valuation = qty × latest HPP. Pagination, search, branch filter (for multi-branch roles).                                                                                                       |
| 3.6 | `src/routes/_layout/waste/broken-stock.tsx` | `/waste/broken-stock` | Area Manager, Super Admin, Admin Pusat                                | `wasteEntries`, `operationalExpenses`             | Side-by-side Broken Stock UI (per FRD §5.1). Visual audit board linking operational waste to broken stock records.                                                                                                                                                                                                                                  |

### Server Functions (Phase 3)

- `getInventory({ branchId, page, limit, search, category })`
- `getStockLedger({ branchId, ingredientId, page, limit, dateFrom, dateTo })`
- `triggerStockOpname({ branchId })` — Area Manager / Admin Pusat / Super Admin only. Log trigger user + timestamp.
- `getStockOpnameDetail(soId)` — returns items. For blind roles, **strip `systemStock` field** server-side.
- `submitStockOpname({ soId, items })` — calculate variance server-side. If variance > threshold, auto-set status "Under Investigation". Reject blank submits.
- `approveStockOpname({ soId, investigationNote })` — adjust inventory to physical qty, create ledger entry for adjustment.
- `createWasteEntry({ branchId, ingredientId, quantity, category, notes })` — deduct inventory, create ledger OUT entry, auto-create operationalExpense link if category = Biaya Operasional.
- `getBrokenStockReport({ branchId, dateFrom, dateTo })`

---

## 6. Phase 4 — Supply Chain (SCM)

**Objective:** Full document chain: PR → PO → Surat Jalan → Invoice. Branch-to-branch transfers. Used by Branch Admin, Admin Pusat, Area Manager (read-only), Super Admin.

| #   | File                                                 | URL                            | RBAC                                                                          | Schema Tables                                              | Key Features                                                                                                                                                                                                                                     |
| --- | ---------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 4.1 | `src/routes/_layout/purchase-requisitions/index.tsx` | `/purchase-requisitions`       | Branch Admin (own branch), Admin Pusat, Area Manager (read-only), Super Admin | `purchaseRequisitions`, `purchaseRequisitionItems`         | List PRs. Branch Admin can create/edit while status = Draft/Pending. Smart reordering recommendation shown alongside current stock. **Edit limit**: once Admin Pusat clicks "Proses", branch edit locks forever.                                 |
| 4.2 | `src/routes/_layout/purchase-requisitions/$prId.tsx` | `/purchase-requisitions/:prId` | As above                                                                      | `purchaseRequisitions`, `purchaseRequisitionItems`         | **Detail modal/page**. Clickable item list modal (prevent table overflow). Show item details with current stock reference. Action buttons per role.                                                                                              |
| 4.3 | `src/routes/_layout/purchase-orders/index.tsx`       | `/purchase-orders`             | Admin Pusat, Super Admin                                                      | `purchaseOrders`, `purchaseOrderItems`                     | Convert PR to PO. Supplier assignment. Status tracking.                                                                                                                                                                                          |
| 4.4 | `src/routes/_layout/delivery-notes/index.tsx`        | `/delivery-notes`              | Admin Pusat, Branch Admin, Super Admin, Area Manager (read-only)              | `deliveryNotes`, `deliveryNoteItems`, `inTransitInventory` | Surat Jalan list. Admin Pusat creates from PO/PR with 3-pilar input: Diorder \| Ready \| Dikirim. Print SJ (A4, 2 rangkap). On confirm shipment → status In Transit, stock moves to `inTransitInventory`. Branch Admin sees incoming deliveries. |
| 4.5 | `src/routes/_layout/delivery-notes/$dnId.tsx`        | `/delivery-notes/:dnId`        | Admin Pusat, Branch Admin, Super Admin                                        | `deliveryNotes`, `deliveryNoteItems`                       | **Penerimaan form** (Branch Admin). Input actual received qty per item. Reject/Retur column with discrepancy note. On submit: move stock from in-transit to branch inventory, create ledger IN. Admin Pusat can still edit SJ before shipment.   |
| 4.6 | `src/routes/_layout/scm-invoices/index.tsx`          | `/scm-invoices`                | Admin Pusat, Super Admin, Branch Admin (view)                                 | `scmInvoices`, `scmInvoiceItems`                           | Auto-generated from received DN. Base amount = actual received qty × unit price. Status: Unpaid / Paid / Cancelled.                                                                                                                              |
| 4.7 | `src/routes/_layout/scm-invoices/$invId.tsx`         | `/scm-invoices/:invId`         | Admin Pusat, Super Admin                                                      | `scmInvoices`, `scmInvoiceItems`                           | Invoice detail. Edit allowed only for Super Admin / Admin Pusat on special discrepancy. Mark as Paid.                                                                                                                                            |
| 4.8 | `src/routes/_layout/stock-transfers/index.tsx`       | `/stock-transfers`             | Branch Admin (create), Area Manager (approve), Super Admin                    | `stockTransfers`                                           | Mutasi stok antar-cabang or cabang→pusat. Branch Admin submits request. Area Manager / Super Admin approves. Similar flow to PR/SJ but no invoice/PR needed.                                                                                     |
| 4.9 | `src/routes/_layout/stock-transfers/$trId.tsx`       | `/stock-transfers/:trId`       | As above                                                                      | `stockTransfers`                                           | Detail & approval. On approval → create DN-like transit record or direct ledger OUT/IN.                                                                                                                                                          |

### Server Functions (Phase 4)

- `getPurchaseRequisitions({ branchId, status, page, limit })` — branch-scoped for Branch Admin.
- `createPurchaseRequisition({ branchId, items })` — items = [{ingredientId, qty}]. Auto-generate code.
- `updatePurchaseRequisition({ prId, items })` — allowed only if status ∈ [Draft, Pending].
- `processPurchaseRequisition({ prId })` — Admin Pusat. Lock branch edits, create PO optionally.
- `createPurchaseOrder({ prId, supplierId, items, fromBranchId, toBranchId })`
- `getDeliveryNotes({ branchId, status, page, limit })`
- `createDeliveryNote({ prId/poId, fromBranchId, toBranchId, items, driverName, vehicleNumber })` — items with readyQuantity & pickedQuantity.
- `shipDeliveryNote({ dnId })` — status → In Transit. Deduct from source branch inventory. Create `inTransitInventory` records. Create ledger OUT.
- `receiveDeliveryNote({ dnId, items })` — items = [{itemId, receivedQuantity, rejectedQuantity, discrepancyNote}]. Move from in-transit to destination inventory. Create ledger IN. Update DN status → Received.
- `generateSCMInvoice({ dnId })` — based on received quantities. Sum total amount.
- `updateSCMInvoice({ invId, items })` — Super Admin / Admin Pusat only.
- `paySCMInvoice({ invId })`
- `createStockTransfer({ fromBranchId, toBranchId, ingredientId, quantity })`
- `approveStockTransfer({ trId })` — on approval, execute transfer (ledger OUT from source, ledger IN to target).

---

## 7. Phase 5 — Yield Tracking & Production

**Objective:** Central Kitchen operations: raw material → finished/semi-finished goods with cost recalculation.

| #   | File                                    | URL               | RBAC                         | Schema Tables                                    | Key Features                                                                                                                                                                                                                                                                                      |
| --- | --------------------------------------- | ----------------- | ---------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5.1 | `src/routes/_layout/yield-tracking.tsx` | `/yield-tracking` | Central Kitchen, Super Admin | `yieldConversions`, `ingredients`, `stockLedger` | Input: source RM (e.g. 10kg Ayam Mentah), target FG/SFG (e.g. 8kg Ayam Matang). System calculates yield % and **new base COGS** = total source cost / target quantity. Auto-update target ingredient's `averageCost`. Ledger OUT for source, Ledger IN for target with same production reference. |

### Server Functions (Phase 5)

- `getYieldConversions({ branchId, page, limit })`
- `createYieldConversion({ branchId, sourceIngredientId, sourceQuantity, targetIngredientId, targetQuantity, notes })` — deduct source, add target, recalculate `averageCost` of target ingredient, update all dependent recipe COGS (roll-up). Log in `stockLedger` with matching reference.

---

## 8. Phase 6 — Finance, Analytics & Period Control

**Objective:** Money tracking, profit calculation, dashboards, and fiscal period locks.

| #   | File                                              | URL                         | RBAC        | Schema Tables                                                                 | Key Features                                                                                                                                                                                                                                                      |
| --- | ------------------------------------------------- | --------------------------- | ----------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6.1 | `src/routes/_layout/finance/index.tsx`            | `/finance`                  | Super Admin | `manualRevenues`, `manualRevenueBrandBreakdowns`, `channelRevenues`, `orders` | Input uang cair per channel per branch per day. Gross profit calculator: (Revenue − Total HPP from orders). View historical margin. Alert if HPP > 40% of selling price.                                                                                          |
| 6.2 | `src/routes/_layout/finance/reconciliation.tsx`   | `/finance/reconciliation`   | Super Admin | `channelRevenues`, `orders`, `scmInvoices`                                    | Net revenue tracking after MDR deduction. Branch debt status (unpaid SCM invoices).                                                                                                                                                                               |
| 6.3 | `src/routes/_layout/analytics/index.tsx`          | `/analytics`                | Super Admin | `orders`, `orderItems`, `brands`                                              | Dashboard: Pie chart channel distribution. Top Sales bar chart (5–10 items). Filters: Branch, Category (All/Makanan/Minuman/Snack/Add-on). **Date-range max 31 days**.                                                                                            |
| 6.4 | `src/routes/_layout/analytics/sales.tsx`          | `/analytics/sales`          | Super Admin | `orders`                                                                      | Sales summary, hourly heatmap (optional), channel & brand performance. Export to .xlsx.                                                                                                                                                                           |
| 6.5 | `src/routes/_layout/analytics/inventory.tsx`      | `/analytics/inventory`      | Super Admin | `stockLedger`, `wasteEntries`, `stockOpnameItems`                             | Discrepancy report (>3%). Comprehensive waste report. Audit trail logs view.                                                                                                                                                                                      |
| 6.6 | `src/routes/_layout/period-control/index.tsx`     | `/period-control`           | Super Admin | `periodLogs`, `periodBalances`                                                | List periods. Open new period (copies closing balances to opening). Close period with exhaustive checklist: all SO approved? waste >5% investigated? no pending invoices? no pending cancel requests? no negative inventory? **Negative inventory blocks close**. |
| 6.7 | `src/routes/_layout/period-control/$periodId.tsx` | `/period-control/:periodId` | Super Admin | `periodLogs`, `periodBalances`                                                | Period detail. Closing preview report. Finalize & lock. Super Admin retains write access even when closed.                                                                                                                                                        |

### Server Functions (Phase 6)

- `getDashboardAnalytics({ branchId, category, dateFrom, dateTo })` — enforce max 31-day range.
- `exportSalesReport({ dateFrom, dateTo, format })` — `.xlsx` generation with fixed columns per FRD §6.5.
- `getFinanceSummary({ branchId, date })`
- `createManualRevenue({ branchId, date, amount, brandBreakdown })`
- `createChannelRevenue({ branchId, date, channel, amount })`
- `getPeriods()`
- `openPeriod({ periodName })` — copy previous closing balances → new opening balances.
- `closePeriod({ periodId })` — run validation checklist. If pass, set status Closed, snapshot closing balances.

---

## 9. Phase 7 — System Utilities & Audit

**Objective:** Logging, notifications, print templates, and admin housekeeping.

| #   | File                                       | URL                  | RBAC                | Schema Tables         | Key Features                                                                                                                  |
| --- | ------------------------------------------ | -------------------- | ------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 7.1 | `src/routes/_layout/admin/audit-logs.tsx`  | `/admin/audit-logs`  | Super Admin         | `auditLogs`           | Database-level audit trail: table, recordId, action, oldValues, newValues, user, timestamp. Filter by table/action/user/date. |
| 7.2 | `src/routes/_layout/admin/system-logs.tsx` | `/admin/system-logs` | Super Admin         | `systemLogs`          | Operational system logs (login, resets, updates).                                                                             |
| 7.3 | _(component only)_                         | —                    | All (notifications) | `systemNotifications` | Global notification bell in `_layout.tsx`. Shows negative stock alerts, SO investigation flags, cancel request alerts, etc.   |

---

## 10. API & Server-Function Patterns

### Auth-Protected Server Functions

Every server function that mutates or reads sensitive data should verify the session:

```ts
import { getAuthSession } from "~/lib/auth-session"; // to be built
import { createServerFn } from "@tanstack/react-start";

const createOrder = createServerFn({ method: "POST" }).handler(async ({ request, data }) => {
  const session = await getAuthSession(request);
  if (!session) throw new Error("Unauthorized");
  // Role & branch scoping...
});
```

### Branch Scoping Helper

Implement a `getEffectiveBranchId(user, requestedBranchId?)` utility:

- **Branch Admin** → forced to their `user.branchId`. Ignore any request param.
- **Area Manager** → allowed only from their `assignedBranches` array.
- **Admin Pusat** → defaults to `br-central`. Can view others if needed but not edit outlet inventory.
- **Super Admin / Central Kitchen** → unrestricted (or default to all).

### Period Lock Enforcement

All mutation server functions (createOrder, createWaste, submitSO, receiveDN, etc.) must:

1. Check if a period is open for the target branch.
2. If closed, reject unless `user.role === 'super_admin'`.

---

## 11. RBAC Quick Reference Matrix

| Route / Module           |   Super Admin   |    Admin Pusat     |       Area Manager       |         Branch Admin          |  Central Kitchen   |
| ------------------------ | :-------------: | :----------------: | :----------------------: | :---------------------------: | :----------------: |
| `/dashboard`             |       ✅        |         ❌         |            ❌            |              ❌               |         ❌         |
| `/pos`                   |       ✅        |         ❌         |            ❌            |              ✅               |         ❌         |
| `/order-history`         |       ✅        |         ❌         |            ❌            |              ❌               |         ❌         |
| `/cancel-requests`       |   ✅ Approve    |     ✅ Approve     |        ✅ Approve        |        ❌ Request only        |         ❌         |
| `/inventory`             | ✅ All branches |  ✅ Central only   |   ✅ Assigned branches   |      ✅ Own branch only       |  ✅ Central only   |
| `/inventory/ledger`      | ✅ All branches |  ✅ Central only   |   ✅ Assigned branches   |      ✅ Own branch only       |  ✅ Central only   |
| `/stock-opname`          | ✅ See-through  | ✅ Blind (Central) | ✅ See-through + Trigger |           ✅ Blind            | ✅ Blind (Central) |
| `/purchase-requisitions` |     ✅ CRUD     |  ✅ Process/CRUD   |       👁️ Read-only       | ✅ Create/Edit (pending only) |         ❌         |
| `/delivery-notes`        |     ✅ CRUD     |      ✅ CRUD       |       👁️ Read-only       |   ✅ Receive/Edit received    |         ❌         |
| `/scm-invoices`          |     ✅ CRUD     |      ✅ CRUD       |       👁️ Read-only       |         👁️ Read-only          |         ❌         |
| `/stock-transfers`       |   ✅ Approve    |         ❌         |        ✅ Approve        |           ✅ Create           |         ❌         |
| `/waste`                 | ✅ All branches |     ✅ Central     |       ✅ Assigned        |         ✅ Own branch         |     ✅ Central     |
| `/yield-tracking`        |       ✅        |         ❌         |            ❌            |              ❌               |         ✅         |
| `/ingredients`           |     ✅ CRUD     |      👁️ View       |            ❌            |              ❌               |      ✅ CRUD       |
| `/recipes`               |     ✅ CRUD     |      ✅ CRUD       |            ❌            |              ❌               |         ❌         |
| `/modifier-groups`       |     ✅ CRUD     |      ✅ CRUD       |            ❌            |              ❌               |         ❌         |
| `/finance`               |       ✅        |         ❌         |            ❌            |              ❌               |         ❌         |
| `/analytics/*`           |       ✅        |         ❌         |            ❌            |              ❌               |         ❌         |
| `/period-control`        |       ✅        |         ❌         |            ❌            |              ❌               |         ❌         |
| `/admin/users`           |       ✅        |         ❌         |            ❌            |              ❌               |         ❌         |
| `/admin/branches`        |       ✅        |      👁️ View       |            ❌            |              ❌               |         ❌         |
| `/admin/audit-logs`      |       ✅        |         ❌         |            ❌            |              ❌               |         ❌         |

_Legend: ✅ = Full/Write access, 👁️ = Read-only, ❌ = Hidden/No access_

---

## 12. Data Fetching & State Management Strategy

1. **Server Functions** (`createServerFn`) are the primary data layer. Use them for:
   - All list queries (paginated).
   - All mutations (create, update, delete).
   - Print / export generation.

2. **TanStack Query** integration (already set up via `TanstackQueryProvider`):
   - Wrap server functions in `useQuery` / `useMutation` inside route components.
   - Use `router.invalidate()` after mutations to refresh loader data.

3. **Route Loaders** (`loader` in `createFileRoute`):
   - Use for initial critical data (e.g. user profile, branch list, open shift status).
   - Keep loaders lightweight; defer heavy tables to client-side queries.

4. **Optimistic UI**:
   - POS cart is local React state (no server roundtrip until submit).
   - Inventory adjustments use optimistic updates with rollback on error.

---

## 13. Print & Export Routes (Future / Optional)

These can be implemented as server functions returning PDF streams or as hidden React components that trigger `window.print()` with `@media print` styles.

| Output                  | Method                | Notes                                                                  |
| ----------------------- | --------------------- | ---------------------------------------------------------------------- |
| Struk POS Thermal 58mm  | React print component | Use `react-to-print` or native `@media print` with 58mm width styling. |
| Surat Jalan A4          | Server function → PDF | Generate via `pdfmake` or similar in a server function, return blob.   |
| Dashboard / Reports PDF | Browser print         | Styled print media query for PDF export.                               |
| .xlsx Export            | Server function       | Use `xlsx` library in server function, return buffer for download.     |

---

## 14. Implementation Checklist for Worker Agents

### Phase 0 — Foundation

- [ ] Replace `src/routes/index.tsx` resume page with role-based redirect or login gate.
- [ ] Build `login.tsx` with email/password + PIN modes.
- [ ] Build `_layout.tsx` with sidebar, auth guard, and branch selector.
- [ ] Create shared component library: `DataTable`, `DetailModal`, `BranchSelector`, `RoleGuard`.
- [ ] Wire `better-auth` session into route context (`MyRouterContext`).

### Phase 1 — Master Data

- [ ] Build all admin CRUD routes: branches, brands, users, ingredients, recipes, modifiers, vouchers, platform-fees.
- [ ] Implement BOM Cost Roll-Up on recipe save.
- [ ] Implement unique PIN validation per branch.

### Phase 2 — POS

- [ ] Build `/pos` with full terminal UI: brand tabs, category filter, modifier modal, cart, checkout.
- [ ] Implement order creation with full inventory deduction, COGS snapshot, tax/MDR calc.
- [ ] Build shift open/close with blind close and variance log.
- [ ] Build `/order-history`, `/cancel-requests`, `/print-requests`.

### Phase 3 — Inventory & Audit

- [ ] Build `/inventory` and `/inventory/ledger` with server-side pagination.
- [ ] Build blind vs see-through Stock Opname flow.
- [ ] Build waste input with auto-link to broken stock.

### Phase 4 — SCM

- [ ] Build PR → PO → SJ → Invoice chain with status transitions.
- [ ] Implement in-transit inventory tracking.
- [ ] Build branch receiving form with reject/retur.
- [ ] Build stock transfer with approval workflow.

### Phase 5 — Yield

- [ ] Build yield tracking form with automatic COGS recalculation.

### Phase 6 — Finance & Analytics

- [ ] Build revenue input and gross profit dashboard.
- [ ] Build analytics charts (pie, bar) with 31-day limit.
- [ ] Build period control with exhaustive close checklist.

### Phase 7 — System

- [ ] Build audit logs and system logs viewers.
- [ ] Add notification bell with real-time alerts.

---

## 15. Open Questions to Resolve During Build

1. **Shrinkage Module** — FRD §8.1 says "Shrinkage module delete aja" but also "Waste & Shrinkage — Pisahkan jadi 2 module". Decision: **Deleted for now**. If needed later, add `/shrinkage` route. Broken stock is handled under `/waste/broken-stock`.
2. **Shift History** — FRD §8.1 says "Shift History - Delete module". Decision: **Do not build a dedicated route**. Shift data is viewable inside `/pos` (last shift summary) and `/admin/audit-logs`.
3. **Administrasi** — FRD says "Need further discussion". Decision: Map to `/admin/index.tsx` as a settings hub (app settings, tax toggle, receipt config).
4. **Mutasi Stok Approval** — Needs clarification on whether it creates a DN automatically or uses a separate transit table. Decision: Reuse `stockTransfers` table with `Pending Approval → Approved → Completed` flow. On approval, auto-create paired ledger entries (OUT source, IN target).
5. **Online/Offline POS** — The prototype has offline capability notes. Decision: **Defer true offline sync to Phase 8**. Phase 2 POS is online-only but robust.
