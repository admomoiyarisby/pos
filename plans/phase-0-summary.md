# Phase 0 Implementation Summary

## What Was Built

### 1. Auth Layer

- **`src/lib/auth.ts`** — Extended better-auth with `additionalFields` for `role`, `branchId`, `pin`, `status`. Every user session now carries RBAC data.
- **`src/lib/server/auth.ts`** — Server-side auth helpers:
  - `getCurrentUser()` — Returns enriched user with role/branch/assignedBranches from session + DB lookup
  - `requireAuth()` — Throws if not authenticated
  - `requireRole(...)` — Throws if role not in allowed list
- **`src/lib/auth-context.tsx`** — React context for client-side auth state.
- **`src/lib/server/users.ts`** — `createAppUser` server function for Super Admin to create users (syncs both better-auth + our `users` table).

### 2. Login Page

- **`src/routes/login.tsx`** — Public route at `/login`.
  - Email/password form using `authClient.signIn.email()`
  - Demo credentials displayed for testing
  - Auto-redirects authenticated users to `/`

### 3. App Shell & Layout

- **`src/routes/_layout.tsx`** — Authenticated layout route with auth guard.
  - Unauthenticated → redirects to `/login`
  - Authenticated → renders `AppShell` with sidebar
- **`src/routes/__root.tsx`** — Root route updated:
  - Title changed to "Omoiyari POS"
  - `loader` fetches current user server-side and passes to `AuthProvider`
  - Removed resume-specific Header/Footer
- **`src/components/AppShell.tsx`** — Flex layout: fixed sidebar + scrollable main content with `<Outlet />`

### 4. Sidebar Navigation

- **`src/components/Sidebar.tsx`** — Categorized collapsible navigation:
  - **Utama** — Dashboard
  - **Operasional** — POS, Order History
  - **Inventaris** — Stock, Ledger, Stock Opname, Waste, Broken Stock
  - **Supply Chain** — PR, PO, Surat Jalan, Invoice SCM, Mutasi Stok
  - **Produksi** — Yield Tracking, Bahan Baku
  - **Master Data** — Recipes, Modifiers, Users, Branches, Brands, Vouchers, Platform Fees
  - **Keuangan & Analitik** — Finance, Analytics
  - **Sistem** — Period Control, Audit Logs, System Logs, Settings
  - Each item filtered by `roles` array — invisible to unauthorized roles (Hidden UI)
  - Collapsible groups with chevron indicators
  - Logout button at bottom

### 5. Role Guard Component

- **`src/components/RoleGuard.tsx`** — Wrapper component for route-level access control.
  - Shows loading spinner while auth loads
  - Redirects unauthenticated to `/login`
  - Redirects unauthorized to `/`

### 6. Placeholder Routes (All Modules)

Every route from `plans/routing.md` has a placeholder page with:

- Page title
- `RoleGuard` where appropriate
- Route params handled (e.g. `/stock-opname/$soId`)

Created routes:

- `/dashboard`
- `/pos`, `/order-history`
- `/inventory`, `/inventory/ledger`
- `/stock-opname`, `/stock-opname/$soId`
- `/waste`, `/waste/broken-stock`
- `/purchase-requisitions`, `/purchase-requisitions/$prId`
- `/purchase-orders`, `/purchase-orders/$poId`
- `/delivery-notes`, `/delivery-notes/$dnId`
- `/scm-invoices`, `/scm-invoices/$invId`
- `/stock-transfers`, `/stock-transfers/$trId`
- `/yield-tracking`
- `/ingredients`, `/ingredients/$ingId`
- `/recipes`, `/recipes/$recipeId`
- `/modifier-groups`, `/modifier-groups/$mgId`
- `/finance`, `/finance/reconciliation`
- `/analytics`, `/analytics/sales`, `/analytics/inventory`
- `/period-control`, `/period-control/$periodId`
- `/admin`, `/admin/users`, `/admin/branches`, `/admin/brands`, `/admin/vouchers`, `/admin/platform-fees`, `/admin/audit-logs`, `/admin/system-logs`

### 7. Setup / Seed API

- **`src/routes/api/setup.ts`** — `POST /api/setup` to seed initial demo data:
  - 3 branches (Central Warehouse, Surabaya Pusat, Surabaya Barat)
  - Super Admin user (`superadmin@omoiyari.net` / `password123`)
  - Branch Admin user (`branch@omoiyari.net` / `password123`)
- **`src/routes/api/seed.ts`** — `POST /api/seed` for general data seeding

### 8. Landing Redirect

- **`src/routes/_layout/index.tsx`** — Role-based auto-redirect on `/`:
  - `branch_admin` → `/pos`
  - `super_admin` → `/dashboard`
  - `admin_pusat` → `/purchase-requisitions`
  - `area_manager` → `/inventory`
  - `central_kitchen` → `/yield-tracking`

## Auth Flow

```
User visits /
  → __root.tsx loader fetches current user
    → Not authenticated? _layout.tsx redirects → /login
    → Authenticated? _layout/index.tsx redirects → role-based default page

User logs in at /login
  → authClient.signIn.email()
  → router.invalidate() re-fetches root loader
  → login.tsx sees user exists → <Navigate to="/">
  → lands on role-based default page
```

## How to Test Phase 0

1. **Start dev server:** `vp dev`
2. **Seed data:** `curl -X POST http://localhost:3000/api/setup`
3. **Login:** Visit `http://localhost:3000/login`
   - Super Admin: `superadmin@omoiyari.net` / `password123`
   - Branch Admin: `branch@omoiyari.net` / `password123`
4. **Verify navigation:** Sidebar shows only modules permitted by your role
5. **Verify guards:** Try visiting `/admin/users` as Branch Admin → redirect to `/`

## Files Created / Modified

| File                           | Action   | Purpose                                                        |
| ------------------------------ | -------- | -------------------------------------------------------------- |
| `src/lib/auth.ts`              | Modified | better-auth config with role/branchId/pin/status fields        |
| `src/lib/server/auth.ts`       | Created  | Server auth helpers (getCurrentUser, requireAuth, requireRole) |
| `src/lib/server/users.ts`      | Created  | User creation API with role/DB sync                            |
| `src/lib/auth-context.tsx`     | Created  | React auth context + useAuth hook                              |
| `src/routes/__root.tsx`        | Modified | Root shell with user loader, AuthProvider                      |
| `src/routes/login.tsx`         | Created  | Public login page                                              |
| `src/routes/_layout.tsx`       | Created  | Auth guard + AppShell wrapper                                  |
| `src/routes/_layout/index.tsx` | Created  | Role-based landing redirect                                    |
| `src/components/AppShell.tsx`  | Created  | Sidebar + main content layout                                  |
| `src/components/Sidebar.tsx`   | Created  | Categorized RBAC-filtered navigation                           |
| `src/components/RoleGuard.tsx` | Created  | Route-level access control wrapper                             |
| `src/routes/api/setup.ts`      | Created  | Demo data seeding endpoint                                     |
| `src/routes/_layout/**`        | Created  | 30+ placeholder module routes                                  |

## Ready for Phase 1

Phase 0 provides the complete foundation:

- ✅ Auth system with RBAC
- ✅ App shell with sidebar navigation
- ✅ All route files created (no 404s)
- ✅ Role-based access control on UI and routes
- ✅ Server function patterns established

Phase 1 (Master Data) can now begin by replacing placeholder routes with actual CRUD:

- `/admin/branches` — Branch CRUD
- `/admin/brands` — Brand CRUD
- `/admin/users` — User CRUD with PIN management
- `/ingredients` — Bahan Baku CRUD
- `/recipes` — Menu & BOM editor
- `/modifier-groups` — Modifier management
- `/admin/vouchers` — Voucher creation
- `/admin/platform-fees` — Platform fee config
