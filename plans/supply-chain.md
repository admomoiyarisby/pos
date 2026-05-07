# Supply Chain — Supplier Delivery (Barang Masuk) Implementation Plan

## Context

The old prototype (`../omoiyari_pos`) had a **"Supply Chain (SCM)"** feature for recording incoming raw materials from external suppliers into the **central warehouse** (`br-central`). This feature is **partially present** in the current codebase but **incomplete** — the database schema and seed data exist, but there are **no server functions and no UI** for it.

### What Already Exists (Don't Rebuild)

- `suppliers` table — `src/db/schema.ts` line 190
- `supplierDeliveries` table — `src/db/schema.ts` line 865
- Seed data for suppliers and deliveries — `src/lib/seed/seed-data.ts` and `src/lib/seed/seed.ts`
- Related tables: `inventory`, `stockLedger`, `ingredients`, `branches`, `users`

### What's Missing (Must Build)

- Server functions for CRUD supplier deliveries
- UI page for listing, creating, editing, deleting, and printing supplier deliveries
- Sidebar navigation entry

---

## Step-by-Step Plan

### Step 1: Server Functions — `src/lib/server/supplier-deliveries.ts`

Create a new server module (following the pattern of `src/lib/server/scm.ts`).

**Functions to implement:**

1. **`getSupplierDeliveries`** (`GET`)
   - Select from `supplierDeliveries` joined with `suppliers`, `ingredients`, `users`
   - Return: id, supplierName, ingredientName, quantity, price, deliveryDate, receivedByName, status
   - Order by `deliveryDate DESC`
   - Auth: `requireAuth()` — any authenticated user can view

2. **`getSupplierDelivery`** (`GET`)
   - Select single delivery by id with full joins
   - Auth: `requireAuth()`

3. **`createSupplierDelivery`** (`POST`)
   - Input: `{ supplierName: string, ingredientId: string, quantity: number, price: number }`
   - Auth: `requireRole("super_admin", "admin_pusat")`
   - Logic:
     1. Insert into `supplierDeliveries` with:
        - `supplierId`: lookup from `suppliers` table by name (or null if not found)
        - `supplierName`: free-text (backward compat with prototype)
        - `deliveryDate`: `new Date()`
        - `receivedBy`: current user id
        - `status`: `"Pending Invoice"`
     2. Add to `inventory` for branch `"br-central"`:
        - If record exists → `UPDATE` quantity
        - If not → `INSERT` new record
     3. Create `stockLedger` entry (type `"IN"`) with balance after addition
   - Return the created delivery record

4. **`updateSupplierDelivery`** (`POST`)
   - Input: `{ id: string, supplierName?: string, ingredientId?: string, quantity?: number, price?: number }`
   - Auth: `requireRole("super_admin", "admin_pusat")`
   - Logic:
     1. Fetch existing delivery
     2. **Revert old inventory**: deduct old `quantity` from `br-central` inventory for old `ingredientId`
     3. Create `stockLedger` OUT entry for the revert
     4. Update `supplierDeliveries` row
     5. **Apply new inventory**: add new `quantity` to `br-central` inventory for new `ingredientId`
     6. Create `stockLedger` IN entry for the new quantity
   - Return updated record

5. **`deleteSupplierDelivery`** (`POST`)
   - Input: `{ id: string }`
   - Auth: `requireRole("super_admin", "admin_pusat")`
   - Logic:
     1. Fetch delivery before deleting
     2. Deduct quantity from `br-central` inventory
     3. Create `stockLedger` OUT entry for the deletion
     4. Delete from `supplierDeliveries`
   - Return `{ success: true }`

6. **`getSuppliers`** (`GET`)
   - Simple select all from `suppliers` table
   - Used for the ingredient form dropdown
   - Auth: `requireAuth()`

**Important pattern notes:**

- Follow the exact inventory update pattern from `scm.ts` `shipDeliveryNote` / `receiveDeliveryNote`
- Use `and(eq(inventory.branchId, ...), eq(inventory.ingredientId, ...))` for inventory lookups
- Stock ledger `balance` must be the quantity **after** the operation
- Use `new Date()` for timestamps, not `Date.now()`

---

### Step 2: Route & Page — `src/routes/_layout/supplier-deliveries/index.tsx`

Create the TanStack Router page.

**Page structure (follow `src/routes/_layout/purchase-requisitions/index.tsx` pattern):**

1. **Loader**: call `getSupplierDeliveries()`
2. **State**: `useState` for modal open/close, form fields, editing id
3. **Form fields** (in a Modal):
   - **Supplier Name**: `<input type="text">` (free text, with datalist of existing suppliers for convenience)
   - **Bahan Baku**: `<select>` populated from `getIngredients()` (reuse existing server fn or create if missing)
   - **Jumlah**: `<input type="number">`
   - **Total Harga**: `<input type="number">` (in Rupiah)
4. **Data table** columns:
   - Tanggal (formatted `dd MMM yyyy HH:mm`)
   - Supplier
   - Bahan Baku
   - Jumlah (with stock unit suffix)
   - Total Harga (`Rp {price.toLocaleString()}`)
   - Penerima
   - Aksi (Print, Edit, Delete)

5. **Print Invoice** action:
   - Opens `window.open('', '_blank')`
   - Writes HTML invoice (copy the print layout from the old prototype `SupplierView.handlePrintInvoice`)
   - Auto-calls `window.print()` and closes after 500ms
   - Invoice fields: No. Invoice, Tanggal, Supplier, Penerima, item table with Grand Total, signature lines

6. **Auth checks**:
   - Use `useAuth()` hook to get user role
   - Only show "Catat Barang Masuk" button for `super_admin` and `admin_pusat`
   - Only show Edit/Delete actions for those roles

**Reuse existing components:**

- `PageHeader` from `src/components/ui/PageHeader.tsx`
- `DataTable` from `src/components/ui/DataTable.tsx`
- `Modal` from `src/components/ui/Modal.tsx`
- Icons from `lucide-react` (Truck, Printer, Pencil, Trash2, Plus)

---

### Step 3: Sidebar Navigation — `src/components/Sidebar.tsx`

In the **"Supply Chain"** nav group (around line 111), add a new item:

```ts
{
  label: "Barang Masuk",
  to: "/supplier-deliveries",
  icon: Truck,    // or PackagePlus / Import
  roles: ["super_admin", "admin_pusat"],
}
```

Add the import for the new icon if needed.

---

### Step 4: Route Registration

TanStack Router is file-based. Creating `src/routes/_layout/supplier-deliveries/index.tsx` automatically registers the route at `/supplier-deliveries`. No manual route registration needed.

Run `vp check` after creating the file to regenerate `routeTree.gen.ts` if needed.

---

### Step 5: Edge Cases & Validation

1. **Inventory negative guard**: When updating/deleting, ensure inventory doesn't go below zero. Use `Math.max(0, current - deducted)`.
2. **Ingredient change on update**: If `ingredientId` changes during edit, revert old ingredient's inventory and apply to new ingredient's inventory.
3. **Supplier lookup**: When creating, try to find `supplierId` by matching `supplierName` against the `suppliers` table. If not found, store `null` for `supplierId` but still store the free-text `supplierName`.
4. **Branch hardcoding**: All supplier deliveries go to `br-central`. Use a hardcoded branch ID lookup or join to find the central warehouse branch.
5. **Date formatting**: Use `date-fns` `format()` for display (already a dependency).

---

### Step 6: Verification Checklist

- [ ] `vp check --fix` passes with zero errors
- [ ] `vp build` succeeds
- [ ] Page loads at `/supplier-deliveries`
- [ ] Can create a new supplier delivery → inventory increases → stock ledger entry created
- [ ] Can edit a supplier delivery → old inventory reverted → new inventory applied → 2 ledger entries
- [ ] Can delete a supplier delivery → inventory decreases → ledger OUT entry created
- [ ] Can print invoice (popup opens, print dialog triggers)
- [ ] Only `super_admin` and `admin_pusat` see the create/edit/delete buttons
- [ ] Table shows all deliveries sorted by date descending
- [ ] Seed data loads correctly (check after `vp run seed`)

---

## Files to Create

| File                                               | Purpose                           |
| -------------------------------------------------- | --------------------------------- |
| `src/lib/server/supplier-deliveries.ts`            | Server functions (createServerFn) |
| `src/routes/_layout/supplier-deliveries/index.tsx` | Page component                    |

## Files to Modify

| File                         | Change                                            |
| ---------------------------- | ------------------------------------------------- |
| `src/components/Sidebar.tsx` | Add "Barang Masuk" nav item in Supply Chain group |

## Files to NOT Touch

- `src/db/schema.ts` — tables already exist
- `src/lib/seed/seed-data.ts` — seed data already exists
- `src/lib/seed/seed.ts` — seed logic already exists
- `src/lib/server/scm.ts` — keep existing SCM features untouched
