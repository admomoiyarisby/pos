# DataTable Sort — Comprehensive Implementation Plan

## Current State

The `DataTable` component (`src/components/ui/DataTable.tsx`) already has sorting **infrastructure** built in:

- `sort` state: `{ key: string; dir: "asc" | "desc" } | null`
- `handleSort(key)` function: cycles through asc → desc → none
- `sortable?: boolean` property on `Column<T>`
- Sort direction indicator (↑/↓) rendered in column header
- `localeCompare` with `{ numeric: true }` for sorting

**However, no column in any page has `sortable: true` set.** The feature is fully implemented in the component but completely unused across all 24 pages.

Additionally, the dashboard has 5 custom table components that use raw `<table>` elements without any sorting at all.

---

## What Needs to Change

### Part 1 — Enable Sorting on All Existing DataTable Columns (24 pages)

For every page, add `sortable: true` to columns where sorting makes sense. The rule is:

**Sortable:** string names, codes, dates, numbers, statuses, categories, quantities, prices, amounts
**Not sortable:** action/navigation columns (buttons, links), notes/free-text, composite render columns that combine multiple fields in a way that wouldn't sort meaningfully

Below is the complete column-by-column breakdown:

---

#### 1. Inventory — `src/routes/_layout/inventory/index.tsx`

| Column     | Key                  | Sortable? | Reason                                      |
| ---------- | -------------------- | --------- | ------------------------------------------- |
| Kode       | `ingredientCode`     | ✅        | String code, natural sort order             |
| Nama Bahan | `ingredientName`     | ✅        | String name                                 |
| SKU        | `ingredientSkuType`  | ✅        | Categorical (RM/SFG/FG)                     |
| Kategori   | `ingredientCategory` | ✅        | Categorical (Fresh/Dry/Packaging)           |
| Stok       | `quantity`           | ✅        | Numeric, very useful to sort by stock level |
| Cabang     | `branchName`         | ✅        | String name (conditionally inserted)        |

#### 2. Inventory Ledger — `src/routes/_layout/inventory/ledger.tsx`

| Column    | Key              | Sortable? | Reason                         |
| --------- | ---------------- | --------- | ------------------------------ |
| Waktu     | `createdAt`      | ✅        | Date, most useful default sort |
| Bahan     | `ingredientName` | ✅        | String name                    |
| Tipe      | `type`           | ✅        | Categorical (IN/OUT)           |
| Qty       | `quantity`       | ✅        | Numeric                        |
| Saldo     | `balance`        | ✅        | Numeric                        |
| Referensi | `reference`      | ❌        | Mixed format reference IDs     |

#### 3. Order History — `src/routes/_layout/order-history.tsx`

| Column  | Key           | Sortable? | Reason                                           |
| ------- | ------------- | --------- | ------------------------------------------------ |
| Waktu   | `createdAt`   | ✅        | Date                                             |
| Channel | `channel`     | ✅        | Categorical                                      |
| Kode    | `orderCode`   | ✅        | String (but uses `??` fallback — see note below) |
| Total   | `totalAmount` | ✅        | Numeric, very useful                             |
| Status  | `status`      | ✅        | Categorical                                      |

**Note:** The `orderCode` column renders `r.orderCode ?? r.customerName ?? "-"`. Sorting by `orderCode` key will only sort by the `orderCode` field, not the fallback. This is acceptable — it sorts by the underlying data key.

#### 4. Stock Opname — `src/routes/_layout/stock-opname/index.tsx`

| Column   | Key          | Sortable? | Reason                 |
| -------- | ------------ | --------- | ---------------------- |
| Tanggal  | `date`       | ✅        | Date string            |
| Cabang   | `branchName` | ✅        | String                 |
| Status   | `status`     | ✅        | Categorical            |
| Dibuat   | `createdAt`  | ✅        | Date                   |
| (action) | `id`         | ❌        | Navigation link column |

#### 5. Waste — `src/routes/_layout/waste/index.tsx`

| Column     | Key              | Sortable? | Reason                                  |
| ---------- | ---------------- | --------- | --------------------------------------- |
| Waktu      | `createdAt`      | ✅        | Date                                    |
| Bahan      | `ingredientName` | ✅        | String                                  |
| Kategori   | `category`       | ✅        | Categorical                             |
| Qty        | `quantity`       | ✅        | Numeric                                 |
| Keterangan | `notes`          | ❌        | Free-text notes, not meaningful to sort |

#### 6. Purchase Requisitions — `src/routes/_layout/purchase-requisitions/index.tsx`

| Column    | Key          | Sortable? | Reason                |
| --------- | ------------ | --------- | --------------------- |
| Kode PR   | `code`       | ✅        | String code           |
| Cabang    | `branchName` | ✅        | String                |
| Status    | `status`     | ✅        | Categorical           |
| Dibuat    | `createdAt`  | ✅        | Date                  |
| (actions) | `id`         | ❌        | Action buttons column |

#### 7. Purchase Orders — `src/routes/_layout/purchase-orders/index.tsx`

| Column  | Key            | Sortable? | Reason                                     |
| ------- | -------------- | --------- | ------------------------------------------ |
| Kode PO | `code`         | ✅        | String code                                |
| Dari    | `fromBranchId` | ✅        | String (renders as branch name via lookup) |
| Ke      | `toBranchId`   | ✅        | String (renders as branch name via lookup) |
| Status  | `status`       | ✅        | Categorical                                |
| Dibuat  | `createdAt`    | ✅        | Date                                       |
| (link)  | `id`           | ❌        | Navigation link column                     |

#### 8. Delivery Notes — `src/routes/_layout/delivery-notes/index.tsx`

| Column    | Key            | Sortable? | Reason                          |
| --------- | -------------- | --------- | ------------------------------- |
| Kode SJ   | `code`         | ✅        | String code                     |
| Dari      | `fromBranchId` | ✅        | String (renders as branch name) |
| Ke        | `toBranchId`   | ✅        | String (renders as branch name) |
| Driver    | `driverName`   | ✅        | String                          |
| Status    | `status`       | ✅        | Categorical                     |
| (actions) | `id`           | ❌        | Action buttons column           |

#### 9. SCM Invoices — `src/routes/_layout/scm-invoices/index.tsx`

| Column       | Key           | Sortable? | Reason                |
| ------------ | ------------- | --------- | --------------------- |
| Kode Invoice | `code`        | ✅        | String code           |
| Total        | `totalAmount` | ✅        | Numeric, very useful  |
| Status       | `status`      | ✅        | Categorical           |
| Dibuat       | `createdAt`   | ✅        | Date                  |
| (actions)    | `id`          | ❌        | Action buttons column |

#### 10. Ingredients — `src/routes/_layout/ingredients/index.tsx`

| Column      | Key            | Sortable? | Reason                 |
| ----------- | -------------- | --------- | ---------------------- |
| Kode        | `code`         | ✅        | String code            |
| Nama Bahan  | `name`         | ✅        | String                 |
| Tipe SKU    | `skuType`      | ✅        | Categorical            |
| Kategori    | `category`     | ✅        | Categorical            |
| Satuan Beli | `purchaseUnit` | ✅        | Categorical            |
| Satuan Stok | `stockUnit`    | ✅        | Categorical            |
| HPP         | `averageCost`  | ✅        | Numeric                |
| (link)      | `id`           | ❌        | Navigation link column |

#### 11. Recipes — `src/routes/_layout/recipes/index.tsx`

| Column      | Key         | Sortable? | Reason                        |
| ----------- | ----------- | --------- | ----------------------------- |
| Kode        | `code`      | ✅        | String code                   |
| Nama Menu   | `name`      | ✅        | String                        |
| Kategori    | `category`  | ✅        | Categorical                   |
| Harga Dasar | `basePrice` | ✅        | Numeric                       |
| Status      | `status`    | ✅        | Categorical (Active/Inactive) |
| (link)      | `id`        | ❌        | Navigation link column        |

#### 12. Modifier Groups — `src/routes/_layout/modifier-groups/index.tsx`

| Column          | Key            | Sortable? | Reason                      |
| --------------- | -------------- | --------- | --------------------------- |
| Kode            | `code`         | ✅        | String code                 |
| Nama Group      | `name`         | ✅        | String                      |
| Min             | `minSelection` | ✅        | Numeric                     |
| Max             | `maxSelection` | ✅        | Numeric                     |
| Jumlah Modifier | `modifiers`    | ✅        | Numeric (renders `.length`) |

#### 13. Stock Transfers — `src/routes/_layout/stock-transfers/index.tsx`

| Column    | Key            | Sortable? | Reason                              |
| --------- | -------------- | --------- | ----------------------------------- |
| Kode      | `code`         | ✅        | String code                         |
| Dari      | `fromBranchId` | ✅        | String (renders as branch name)     |
| Ke        | `toBranchId`   | ✅        | String (renders as branch name)     |
| Bahan     | `ingredientId` | ✅        | String (renders as ingredient name) |
| Qty       | `quantity`     | ✅        | Numeric                             |
| Status    | `status`       | ✅        | Categorical                         |
| (actions) | `id`           | ❌        | Action buttons column               |

#### 14. Yield Tracking — `src/routes/_layout/yield-tracking.tsx`

| Column         | Key               | Sortable? | Reason                                   |
| -------------- | ----------------- | --------- | ---------------------------------------- |
| Waktu          | `createdAt`       | ✅        | Date                                     |
| Bahan Mentah   | `sourceName`      | ✅        | String (composite render — sorts by key) |
| Hasil Produksi | `targetName`      | ✅        | String (composite render — sorts by key) |
| Yield          | `yieldPercentage` | ✅        | Numeric, very useful                     |
| Catatan        | `notes`           | ❌        | Free-text                                |

#### 15. Period Control — `src/routes/_layout/period-control/index.tsx`

| Column       | Key          | Sortable? | Reason                                 |
| ------------ | ------------ | --------- | -------------------------------------- |
| Nama Periode | `periodName` | ✅        | String                                 |
| Status       | `status`     | ✅        | Categorical (Open/Closed)              |
| Dibuka       | `openedAt`   | ✅        | Date                                   |
| Ditutup      | `closedAt`   | ✅        | Date (handles `null` with "-" display) |
| (link)       | `id`         | ❌        | Navigation link column                 |

#### 16. Supplier Deliveries — `src/routes/_layout/supplier-deliveries/index.tsx`

| Column      | Key              | Sortable? | Reason                |
| ----------- | ---------------- | --------- | --------------------- |
| Tanggal     | `deliveryDate`   | ✅        | Date                  |
| Supplier    | `supplierName`   | ✅        | String                |
| Bahan Baku  | `ingredientName` | ✅        | String                |
| Jumlah      | `quantity`       | ✅        | Numeric               |
| Total Harga | `price`          | ✅        | Numeric               |
| Penerima    | `receivedByName` | ✅        | String                |
| Status      | `status`         | ✅        | Categorical           |
| Aksi        | `id`             | ❌        | Action buttons column |

#### 17. Admin — Users — `src/routes/_layout/admin/users.tsx`

| Column | Key          | Sortable? | Reason                                      |
| ------ | ------------ | --------- | ------------------------------------------- |
| Nama   | `name`       | ✅        | String                                      |
| Email  | `email`      | ✅        | String                                      |
| Role   | `role`       | ✅        | Categorical                                 |
| Cabang | `branchName` | ✅        | String                                      |
| PIN    | `pin`        | ❌        | Conditional display, not meaningful to sort |
| Status | `status`     | ✅        | Categorical                                 |

#### 18. Admin — Branches — `src/routes/_layout/admin/branches.tsx`

| Column      | Key        | Sortable? | Reason                                  |
| ----------- | ---------- | --------- | --------------------------------------- |
| Kode        | `code`     | ✅        | String                                  |
| Nama Cabang | `name`     | ✅        | String                                  |
| Lokasi      | `location` | ✅        | String                                  |
| Tipe        | `type`     | ✅        | Categorical (Central/Outlet)            |
| Status      | `active`   | ✅        | Categorical (boolean rendered as badge) |

#### 19. Admin — Brands — `src/routes/_layout/admin/brands.tsx`

| Column     | Key    | Sortable? | Reason |
| ---------- | ------ | --------- | ------ |
| Kode       | `code` | ✅        | String |
| Nama Brand | `name` | ✅        | String |

#### 20. Admin — Vouchers — `src/routes/_layout/admin/vouchers.tsx`

| Column     | Key             | Sortable? | Reason                                  |
| ---------- | --------------- | --------- | --------------------------------------- |
| Kode       | `code`          | ✅        | String                                  |
| Deskripsi  | `description`   | ✅        | String                                  |
| Tipe       | `discountType`  | ✅        | Categorical (percentage/fixed)          |
| Nilai      | `discountValue` | ✅        | Numeric                                 |
| Min. Order | `minOrder`      | ✅        | Numeric                                 |
| Status     | `isActive`      | ✅        | Categorical (boolean rendered as badge) |

#### 21. Admin — Audit Logs — `src/routes/_layout/admin/audit-logs.tsx`

| Column    | Key         | Sortable? | Reason                                   |
| --------- | ----------- | --------- | ---------------------------------------- |
| Waktu     | `createdAt` | ✅        | Date                                     |
| Tabel     | `tableName` | ✅        | Categorical                              |
| Aksi      | `action`    | ✅        | Categorical                              |
| Record ID | `recordId`  | ❌        | Opaque ID prefix, not meaningful to sort |
| User      | `userName`  | ✅        | String                                   |
| (detail)  | `id`        | ❌        | Detail button column                     |

#### 22. Admin — System Logs — `src/routes/_layout/admin/system-logs.tsx`

| Column | Key         | Sortable? | Reason                                     |
| ------ | ----------- | --------- | ------------------------------------------ |
| Waktu  | `createdAt` | ✅        | Date                                       |
| (icon) | `status`    | ❌        | Icon indicator, not meaningful as sort key |
| Aksi   | `action`    | ✅        | String                                     |
| Detail | `detail`    | ❌        | Free-text detail                           |
| User   | `userName`  | ✅        | String                                     |

#### 23. Admin — Platform Fees — `src/routes/_layout/admin/platform-fees.tsx`

| Column           | Key             | Sortable? | Reason      |
| ---------------- | --------------- | --------- | ----------- |
| Channel          | `channel`       | ✅        | Categorical |
| MDR (%)          | `feePercentage` | ✅        | Numeric     |
| Biaya Tetap (Rp) | `fixedFee`      | ✅        | Numeric     |

#### 24. Demo — Table — `src/routes/demo/table.tsx`

This is a demo/playground page. Add `sortable: true` to all columns for demonstration purposes.

---

### Part 2 — Improve the DataTable Component

Before enabling sorting on all pages, fix these issues in the component itself:

#### Issue A: Sort indicator is too subtle

Currently: a tiny `↑` or `↓` text character. This is hard to see.

**Fix:** Replace with proper `ArrowUp` / `ArrowDown` icons from lucide-react, and add a visual style to the active sort column header (e.g., `text-foreground` instead of `text-muted-foreground`). Also show a sort indicator on all sortable columns (not just the active one) — e.g., a faded `↕` icon that becomes solid + directional on the active sort.

#### Issue B: Sort doesn't reset when search changes

When a user searches/filtered data changes, the sort state persists but the data underneath changes. This is actually fine — the sort still applies correctly to the new filtered data. **No change needed.**

#### Issue C: Sort cycles: asc → desc → none

The current 3-state cycle (asc → desc → none) is good. **No change needed.**

#### Issue D: `safeStr` doesn't handle Date objects

The `safeStr` helper converts values for sorting. It handles `string`, `number`, `boolean`, but not `Date` objects. Some columns render dates via `new Date(r.createdAt).toLocaleString(...)` but the underlying data key is a `Date` object.

**Fix:** Add Date handling to `safeStr`:

```ts
const safeStr = (v: unknown) => {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
};
```

#### Issue E: Sorting by rendered values vs. raw keys

Currently, sorting always uses the raw data key (`sort.key`), not the rendered value. This means:

- A column with `render: (r) => <Badge>{r.status}</Badge>` sorts by `r.status` (the raw value), not the badge text. This is correct behavior.
- A column like `fromBranchId` that renders as a branch name via lookup will sort by the raw ID, not the display name. This is **acceptable** — sorting by ID is deterministic and consistent.

**No change needed** — document this as expected behavior.

#### Issue F: Default sort order

Currently, no default sort is set. Data appears in whatever order the server returns it. Consider adding an optional `defaultSort` prop:

```ts
interface DataTableProps<T> {
  // ...existing props...
  defaultSort?: { key: string; dir: "asc" | "desc" };
}
```

This would allow pages to set a meaningful default (e.g., Inventory sorted by stock ascending to see low-stock items first, Orders sorted by date descending).

**Recommendation:** Add this prop but don't set defaults on every page yet. Let pages opt in later.

---

### Part 3 — Dashboard Custom Tables (separate from DataTable)

The dashboard has 5 custom table components that use raw `<table>` elements. These are NOT using the `DataTable` component and need separate sorting implementation:

| Component           | File                                             | Columns                                       |
| ------------------- | ------------------------------------------------ | --------------------------------------------- |
| `CogsAnalysisTable` | `src/components/dashboard/CogsAnalysisTable.tsx` | Menu, COGS, Margin, COGS%, Alert              |
| `DiscrepancyTable`  | `src/components/dashboard/DiscrepancyTable.tsx`  | Ingredient, Branch, Date, Variance%           |
| `OrderHistoryTable` | `src/components/dashboard/OrderHistoryTable.tsx` | Order ID, Channel, Items, Total, Status, Date |
| `WasteLossTable`    | `src/components/dashboard/WasteLossTable.tsx`    | Ingredient, Qty Waste, Estimasi Rugi          |
| `RopRoqTable`       | `src/components/dashboard/RopRoqTable.tsx`       | Bahan, Stok, Avg Usage, ROP, ROQ, Status      |

These components are simpler (no pagination, no search) and their data is computed client-side. Adding sort to each one individually would be repetitive.

**Recommendation:** Refactor these 5 components to use the shared `DataTable` component instead of raw `<table>` elements. This gives them sorting, pagination, and search for free. The `DataTable` component already supports all the needed features (custom render, row click, etc.).

If refactoring to `DataTable` is too risky for the initial pass, add a lightweight `useSortableData` hook:

```ts
// src/hooks/useSortableData.ts
export function useSortableData<T>(data: T[], defaultSortKey?: string) {
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(
    defaultSortKey ? { key: defaultSortKey, dir: "desc" } : null,
  );
  const sorted = /* same logic as DataTable */;
  const handleSort = /* same logic as DataTable */;
  return { sorted, sort, handleSort };
}
```

Then each dashboard table can use this hook and add click handlers to its `<th>` elements.

**For the initial implementation, skip the dashboard tables** and focus on the 24 pages using the `DataTable` component. The dashboard tables can be refactored in a follow-up.

---

## Implementation Order

### Phase 1 — Fix DataTable component (1 file)

1. Add Date handling to `safeStr`
2. Improve sort indicator (lucide icons, active column highlight)
3. Add optional `defaultSort` prop

### Phase 2 — Enable sorting on all 24 pages (24 files)

Process pages in this order (grouped by module for efficiency):

1. **Inventory** (2 files): `inventory/index.tsx`, `inventory/ledger.tsx`
2. **Orders** (1 file): `order-history.tsx`
3. **Stock Opname** (1 file): `stock-opname/index.tsx`
4. **Waste** (1 file): `waste/index.tsx`
5. **SCM** (4 files): `purchase-requisitions/index.tsx`, `purchase-orders/index.tsx`, `delivery-notes/index.tsx`, `scm-invoices/index.tsx`
6. **Master Data** (4 files): `ingredients/index.tsx`, `recipes/index.tsx`, `modifier-groups/index.tsx`, `stock-transfers/index.tsx`
7. **Production** (1 file): `yield-tracking.tsx`
8. **Period Control** (1 file): `period-control/index.tsx`
9. **Supplier Deliveries** (1 file): `supplier-deliveries/index.tsx`
10. **Admin** (6 files): `admin/users.tsx`, `admin/branches.tsx`, `admin/brands.tsx`, `admin/vouchers.tsx`, `admin/audit-logs.tsx`, `admin/system-logs.tsx`, `admin/platform-fees.tsx`
11. **Demo** (1 file): `demo/table.tsx`

### Phase 3 — Dashboard tables (follow-up, out of scope for initial pass)

Refactor 5 dashboard table components to use `DataTable` or add `useSortableData` hook.

---

## Verification

After implementing Phases 1 + 2:

1. Run `vp check` and `vp test` to validate.
2. For each of the 24 pages:
   - Click a sortable column header → data sorts ascending (↑ icon visible)
   - Click again → data sorts descending (↓ icon visible)
   - Click again → sort removed (back to original order)
   - Only the active sort column shows the direction indicator
   - Non-sortable columns (action links, notes) do not show sort indicators or cursor change
3. Verify that search + sort interact correctly (sort persists when filtering).
4. Verify that pagination + sort interact correctly (sort applies before pagination).
