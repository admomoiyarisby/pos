# Phase 3 Implementation Summary — Deep Inventory & Audit

## What Was Built

### Server Functions

#### `src/lib/server/inventory.ts`

| Function               | Purpose                                                                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `getInventory`         | Returns current stock with ingredient details, filtered by branch (auto-scoped for branch_admin), category, SKU type, and search.                                  |
| `getStockLedger`       | Returns stock ledger entries with pagination, filtered by branch and ingredient. Includes running balance per entry.                                               |
| `triggerStockOpname`   | Creates a new SO session for a branch, auto-populating items from current inventory. Logs trigger user + timestamp. Super Admin / Admin Pusat / Area Manager only. |
| `getStockOpnames`      | Returns SO list with branch name joins.                                                                                                                            |
| `getStockOpnameDetail` | Returns SO with items. For blind roles (branch_admin, admin_pusat for non-central), strips `systemStock` and `variance` from response.                             |
| `submitStockOpname`    | Submits physical stock counts. Validates no blanks. Auto-calculates variance and variance %. If any variance > 0, marks status "Under Investigation".              |
| `approveStockOpname`   | Adjusts inventory to physical stock, creates ledger adjustment entries, marks SO "Approved". Super Admin / Area Manager only.                                      |

#### `src/lib/server/waste.ts`

| Function           | Purpose                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------ |
| `getWasteEntries`  | Returns waste records with ingredient and branch names. Auto-scoped to user's branch for branch_admin. |
| `createWasteEntry` | Creates waste record, deducts inventory, creates stock ledger entry. Validates branch access.          |
| `getBrokenStock`   | Returns only "Biaya Operasional" waste entries for the broken stock audit view.                        |

### Route Pages

#### `/inventory` — Stok Saat Ini

- DataTable with 15 rows per page
- **Category filter pills**: Semua / Fresh / Dry / Packaging
- **Search bar** by ingredient name/code
- Columns: Kode, Nama Bahan, SKU badge, Kategori badge, Stok (with unit)
- **Branch column** shown only for multi-branch roles (super_admin, area_manager, admin_pusat)
- Branch Admin sees only their branch data, no branch column

#### `/inventory/ledger` — Kartu Stok

- DataTable showing IN/OUT history
- Columns: Waktu, Bahan, Tipe (IN=green, OUT=red badge), Qty, Saldo, Referensi, Keterangan
- Server-side pagination (Previous / Next buttons)
- Most recent entries first

#### `/stock-opname` — Stock Opname List

- DataTable with all SO sessions
- Columns: Tanggal, Cabang, Status badge, Dibuat, Detail link
- **Trigger SO button** (Super Admin / Admin Pusat / Area Manager only)
- Trigger modal: select branch + date, creates SO with all current inventory items
- Status badges: Submitted, Approved (green), Under Investigation (amber)

#### `/stock-opname/$soId` — Stock Opname Detail Form

- **Blind SO** (Branch Admin, Admin Pusat for non-central):
  - Shows: No, Kode, Nama Item, Stok Fisik input only
  - System stock hidden
  - Variance hidden
  - Submit button validates all fields filled (no blanks)
- **See-through SO** (Super Admin, Area Manager):
  - Shows: No, Kode, Nama Item, Stok Sistem, Stok Fisik, Selisih
  - Variance highlighted in amber when non-zero
  - Can submit AND approve
- **Approve modal**: Confirmation with investigation notes textarea. On approval:
  - Adjusts inventory quantities to physical stock
  - Creates ledger IN/OUT adjustment entries
  - Marks SO as Approved

#### `/waste` — Waste Input

- DataTable showing all waste entries
- Columns: Waktu, Bahan, Kategori badge (Beban Makan / Biaya Operasional / Spoiled), Qty, Keterangan
- **Input Waste modal**:
  - Branch selector (locked for Branch Admin)
  - Ingredient dropdown
  - Category selector with 3 fixed options:
    - Beban Makan (Jatah karyawan)
    - Biaya Operasional
    - Spoiled (Basi/Hancur)
  - Quantity input
  - Notes textarea
- On save: creates waste record, deducts inventory, creates ledger entry

#### `/waste/broken-stock` — Broken Stock Audit

- **Side-by-side layout** (per FRD §5.1):
  - Left: Daftar Broken Stock — chronological list of Biaya Operasional entries
  - Right: Ringkasan Barang Keluar — aggregated totals per ingredient with "Stok Berkurang" badge
- Read-only audit view for Super Admin / Admin Pusat / Area Manager

## Auth & RBAC

| Route                 | Allowed Roles | Notes                                            |
| --------------------- | ------------- | ------------------------------------------------ |
| `/inventory`          | All roles     | Branch-scoped: Branch Admin sees own branch only |
| `/inventory/ledger`   | All roles     | Branch-scoped                                    |
| `/stock-opname`       | All roles     | Trigger limited to SA/AP/AM                      |
| `/stock-opname/$soId` | All roles     | Blind vs see-through based on role               |
| `/waste`              | All roles     | Branch-scoped for Branch Admin                   |
| `/waste/broken-stock` | SA, AP, AM    | Audit view only                                  |

## Key Features Implemented

1. **Logical Branch Masking**: Branch Admin sees no branch column; data auto-filtered server-side
2. **Blind Stock Opname**: Branch Admin cannot see expected/system stock; only empty input fields
3. **Blank Submit Prevention**: SO form rejects if any qty field is empty
4. **Auto Variance Calculation**: Variance and % computed server-side on submit
5. **Auto Investigation Flag**: SO auto-marked "Under Investigation" if any variance detected
6. **Inventory Adjustment on Approval**: Physical stock becomes new system stock; ledger entries created
7. **Waste Categories**: 3 fixed categories (Beban Makan, Biaya Operasional, Spoiled)
8. **Side-by-Side Broken Stock**: Operational waste entries shown alongside stock-out summary
9. **Server-Side Pagination**: Stock ledger uses server pagination (15 rows/page)

## Files Created / Modified

| File                                        | Lines | Purpose                                          |
| ------------------------------------------- | ----- | ------------------------------------------------ |
| `src/lib/server/inventory.ts`               | ~320  | Inventory, ledger, stock opname server functions |
| `src/lib/server/waste.ts`                   | ~150  | Waste & broken stock server functions            |
| `src/routes/_layout/inventory/index.tsx`    | ~130  | Current stock list with filters                  |
| `src/routes/_layout/inventory/ledger.tsx`   | ~100  | Stock ledger with pagination                     |
| `src/routes/_layout/stock-opname/index.tsx` | ~160  | SO list + trigger modal                          |
| `src/routes/_layout/stock-opname/$soId.tsx` | ~280  | SO detail form (blind/see-through)               |
| `src/routes/_layout/waste/index.tsx`        | ~180  | Waste list + input modal                         |
| `src/routes/_layout/waste/broken-stock.tsx` | ~120  | Side-by-side broken stock audit                  |

## How to Test Phase 3

1. **Inventory**: Visit `/inventory`, verify branch-scoped data, test category filters and search
2. **Ledger**: Visit `/inventory/ledger`, verify IN/OUT entries from POS transactions
3. **Stock Opname**:
   - Trigger SO as Super Admin (select branch + date)
   - Open SO detail as Branch Admin → verify system stock hidden
   - Enter physical quantities, submit → verify variance auto-calculated
   - Open same SO as Super Admin → verify system stock visible
   - Click Approve → verify inventory adjusted
4. **Waste**: Input waste entry, verify inventory deducted and appears in ledger
5. **Broken Stock**: Visit `/waste/broken-stock`, verify side-by-side layout

## Ready for Phase 4

Phase 3 provides complete inventory management:

- ✅ Real-time stock visibility with branch scoping
- ✅ Stock ledger (kartu stok) with pagination
- ✅ Blind & see-through stock opname workflows
- ✅ Waste tracking with 3 fixed categories
- ✅ Broken stock audit view
- ✅ Automatic inventory adjustment on SO approval

Phase 4 (Supply Chain — PR → PO → SJ → Invoice) can now begin.
