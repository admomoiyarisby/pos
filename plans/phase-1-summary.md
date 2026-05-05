# Phase 1 Implementation Summary — Master Data

## What Was Built

### Shared Components

- **`src/components/ui/DataTable.tsx`** — Reusable paginated table (15 rows/page) with:
  - Client-side search (configurable search keys)
  - Column sorting (asc/desc toggle)
  - Pagination controls (first/prev/next/last)
  - Row click handler
  - Custom cell renderers
- **`src/components/ui/PageHeader.tsx`** — Page title + description + action button
- **`src/components/ui/Modal.tsx`** — Accessible modal with Escape close, click-outside close, size variants

### Server Functions (All Modules)

| Module          | File                                | Functions                                                                             |
| --------------- | ----------------------------------- | ------------------------------------------------------------------------------------- |
| Branches        | `src/lib/server/branches.ts`        | `getBranches`, `getBranch`, `createBranch`, `updateBranch`                            |
| Brands          | `src/lib/server/brands.ts`          | `getBrands`, `createBrand`, `updateBrand`                                             |
| Users           | `src/lib/server/users.ts`           | `getUsers`, `createUser`, `updateUser`                                                |
| Ingredients     | `src/lib/server/ingredients.ts`     | `getIngredients`, `getIngredient`, `createIngredient`, `updateIngredient`             |
| Recipes         | `src/lib/server/recipes.ts`         | `getRecipes`, `getRecipeDetail`, `createRecipe`, `updateRecipe`                       |
| Modifier Groups | `src/lib/server/modifier-groups.ts` | `getModifierGroups`, `getModifierGroup`, `createModifierGroup`, `updateModifierGroup` |
| Vouchers        | `src/lib/server/vouchers.ts`        | `getVouchers`, `createVoucher`, `updateVoucher`                                       |
| Platform Fees   | `src/lib/server/platform-fees.ts`   | `getPlatformFees`, `updatePlatformFee`                                                |

All server functions include:

- Zod input validation
- Role-based access control via `requireAuth()` / `requireRole()`
- Proper Drizzle ORM queries with joins where needed

### Route Pages (CRUD UI)

#### `/admin/branches` — Branch Management

- List all branches in paginated table
- Create new branch (code, name, location, type)
- Edit existing branch inline via modal
- Badges for Central/Outlet type and Active/Inactive status

#### `/admin/brands` — Brand Management

- List brands with code and name
- Create/edit brand via modal

#### `/admin/users` — User Management

- List users with name, email, role badge, branch, status
- Create user with: name, email, password, role, branch assignment, 4-digit PIN, status
- Edit user (all fields except email)
- Role dropdown: Super Admin, Admin Pusat, Area Manager, Branch Admin, Central Kitchen
- Branch selector populated from branches table
- Unique PIN constraint enforced per branch

#### `/ingredients` — Bahan Baku List

- List ingredients with SKU type badge, category badge, units, HPP
- Create new ingredient with full fields:
  - Code, name, SKU type (RM/SFG/FG), category (Fresh/Dry/Packaging)
  - Purchase unit, stock unit, conversion factor
  - HPP/average cost, ROP, MOQ
- Link to detail page via arrow button

#### `/ingredients/$ingId` — Ingredient Detail

- Display all ingredient fields in info cards
- Toggle edit mode to modify any field
- Save updates via `updateIngredient` server function

#### `/recipes` — Menu / Resep List

- List recipes with category badge, base price, status
- Create new recipe with code, name, category, base price, brand multi-select
- Link to detail page for BOM editing

#### `/recipes/$recipeId` — Recipe Detail / BOM Editor

- Display recipe info cards (category, price, status, sub-recsep flag)
- Show BOM ingredients table
- Show assigned modifier groups as badges
- Edit mode toggle (foundation for full BOM editing)

#### `/modifier-groups` — Modifier Group Management

- List modifier groups with min/max selection counts
- Create group with code, name, min/max, and first modifier
- Displays modifier count per group

#### `/admin/vouchers` — Voucher Management

- List vouchers with code, description, discount type badge, value, min order, status
- Create voucher with:
  - Code (auto-uppercase), description
  - Discount type (percentage/fixed), value
  - Minimum order amount, validity date-time
- Active/Inactive status badge

#### `/admin/platform-fees` — Platform Fee Configuration

- List all channels (Gofood, Grabfood, ShopeeFood, Dine-in) with MDR % and fixed fee
- Inline edit via modal: adjust MDR percentage and fixed fee per channel
- Channel name labels mapped for readability

#### `/admin` — System Settings Hub

- PB1/Tax toggle placeholder
- Smart reordering formula parameter (days multiplier)
- Receipt header/footer text inputs
- Active period status display

## Auth & RBAC Integration

Every master data route:

- Wrapped in `<RoleGuard>` with appropriate allowed roles
- Server functions validate role server-side via `requireRole()`
- Sidebar navigation hides inaccessible modules completely

## Data Flow Pattern

```
Route loader → fetches initial data server-side
  ↓
React Query → caches data, provides refetch
  ↓
User action → mutation via createServerFn
  ↓
On success → invalidateQueries → UI refreshes
```

## Files Created / Modified

| File                                           | Lines | Purpose                        |
| ---------------------------------------------- | ----- | ------------------------------ |
| `src/components/ui/DataTable.tsx`              | ~200  | Reusable paginated table       |
| `src/components/ui/PageHeader.tsx`             | ~30   | Page header with action button |
| `src/components/ui/Modal.tsx`                  | ~60   | Accessible modal dialog        |
| `src/lib/server/branches.ts`                   | ~90   | Branch CRUD server functions   |
| `src/lib/server/brands.ts`                     | ~60   | Brand CRUD server functions    |
| `src/lib/server/users.ts`                      | ~160  | User CRUD + better-auth sync   |
| `src/lib/server/ingredients.ts`                | ~100  | Ingredient CRUD                |
| `src/lib/server/recipes.ts`                    | ~220  | Recipe + BOM CRUD              |
| `src/lib/server/modifier-groups.ts`            | ~140  | Modifier group CRUD            |
| `src/lib/server/vouchers.ts`                   | ~80   | Voucher CRUD                   |
| `src/lib/server/platform-fees.ts`              | ~50   | Platform fee update            |
| `src/routes/_layout/admin/branches.tsx`        | ~150  | Branch list + form             |
| `src/routes/_layout/admin/brands.tsx`          | ~110  | Brand list + form              |
| `src/routes/_layout/admin/users.tsx`           | ~200  | User list + form               |
| `src/routes/_layout/ingredients/index.tsx`     | ~170  | Ingredient list + form         |
| `src/routes/_layout/ingredients/$ingId.tsx`    | ~170  | Ingredient detail + edit       |
| `src/routes/_layout/recipes/index.tsx`         | ~150  | Recipe list + form             |
| `src/routes/_layout/recipes/$recipeId.tsx`     | ~120  | Recipe detail + BOM view       |
| `src/routes/_layout/modifier-groups/index.tsx` | ~150  | Modifier group list + form     |
| `src/routes/_layout/admin/vouchers.tsx`        | ~160  | Voucher list + form            |
| `src/routes/_layout/admin/platform-fees.tsx`   | ~120  | Platform fee list + edit       |
| `src/routes/_layout/admin/index.tsx`           | ~80   | Settings hub                   |

## How to Test Phase 1

1. **Seed data:** `curl -X POST http://localhost:3000/api/setup`
2. **Login as Super Admin:** `superadmin@omoiyari.net` / `password123`
3. **Navigate to:**
   - `/admin/branches` — Create a new branch
   - `/admin/brands` — Create a brand
   - `/admin/users` — Create a user with PIN
   - `/ingredients` — Add a new ingredient
   - `/ingredients/:id` — View/edit ingredient detail
   - `/recipes` — Add a menu item
   - `/recipes/:id` — View recipe BOM
   - `/modifier-groups` — Create modifier group
   - `/admin/vouchers` — Create a voucher
   - `/admin/platform-fees` — Adjust MDR rates

## Known Limitations (for future phases)

- **BOM Cost Roll-Up** — Not yet auto-triggered on ingredient price change. Recipe detail page shows BOM but full editor with ingredient picker needs enhancement.
- **Recipe Image Upload** — `imageUrl` field exists but no upload mechanism yet.
- **User Creation** — `createUser` syncs better-auth + our table, but email uniqueness is handled by better-auth.
- **Area Manager Branch Assignment** — UI form doesn't yet show multi-branch selector for area managers.
- **Modifier Group Detail** — `/modifier-groups/$mgId` exists as placeholder; full modifier editing not yet implemented.

## Ready for Phase 2

Phase 1 provides complete master data management:

- ✅ Branches, Brands, Users with RBAC
- ✅ Ingredients (Bahan Baku) with full CRUD
- ✅ Recipes with BOM structure
- ✅ Modifier Groups
- ✅ Vouchers & Platform Fees
- ✅ Reusable DataTable, Modal, PageHeader components

Phase 2 (POS & Order Management) can now begin with all master data in place.
