# Implementation Plan: Waste (Pemborosan) Module — Missing Features

> **Status:** Analysis complete — ready for implementation  
> **Scope:** Only features explicitly required by the FRD that are missing from the current codebase. Do **not** refactor existing working features unless necessary for integration.

---

## 1. Executive Summary

The current Waste module (`src/routes/_layout/waste/`, `src/lib/server/waste.ts`) implements basic CRUD for waste entries with three categories and a separate Broken Stock page. However, compared against the **FRD** (`".plans/Functional Requirement Document.md"`) and the **prototype** (`../omoiyari_pos/src/App.tsx`), several FRD-mandated features are absent:

| #   | Missing Feature                                                                 | FRD Reference                                  | Current State                                                                                               |
| --- | ------------------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 1   | **Investigation workflow** (add/update investigation notes on waste entries)    | §2 (Area Manager), §4.1 (Period Closing), §4.3 | `investigationNote` column exists in DB but no UI or server mutation                                        |
| 2   | **Automated Waste Valuation** (HPP Master Terbaru × Qty)                        | §4.4                                           | Not calculated or stored                                                                                    |
| 3   | **Auto-link Biaya Operasional → Operational Expenses**                          | §3.5, §4.4                                     | `operationalExpenses` table exists with `wasteEntryId`, but `createWasteEntry` never inserts into it        |
| 4   | **Anomaly detection & UI highlighting** (>5% waste triggers investigation need) | §4.1                                           | Period closing checks for it; Waste UI has no visual indicator                                              |
| 5   | **Area Manager branch filtering**                                               | §2                                             | `getWasteEntries` only filters for `branch_admin`; `area_manager` sees all branches                         |
| 6   | **Broken Stock "Stok Habis" indicator**                                         | §3.5                                           | Current page shows generic "Stok Berkurang" badge; no zero-stock / exhausted indicator                      |
| 7   | **Category filter & search bar in Waste list UI**                               | General UI requirements (§6.5, §3.1)           | Server supports `category` and `search` params; UI does not expose them                                     |
| 8   | **Waste Financial Categorization mapping**                                      | §6.3                                           | No mapping from waste categories to financial report categories (Operational Loss vs Staff Benefit Expense) |

The prototype (`../omoiyari_pos`) provided an **Investigation** button for waste entries with >5% anomaly, which the FRD also requires (§4.1, §2). The current codebase lacks this entirely despite the DB column being present.

---

## 2. Detailed Implementation Tasks

### Task 1 — Investigation Workflow for Waste Entries

**FRD Basis:**

- §2: _"Area Manager … Berwenang melakukan persetujuan (Approve) untuk Mutasi Stok, Waste, dan permintaan Re-print Invoice dari kasir. Melakukan investigasi status selisih stok."_
- §4.1: _"Waste: Apakah semua laporan selisih > 5% sudah memiliki komentar investigasi?"_
- §4.3: Area Manager investigates and approves.

**What to build:**

1. **Server function** `addInvestigationNote` (`src/lib/server/waste.ts`):
   - Input: `{ wasteEntryId: string, investigationNote: string }`
   - Authorization: Only `super_admin` and `area_manager` (match Stock Opname approval pattern).
   - Update `wasteEntries.investigationNote` where `id = wasteEntryId`.
   - Log system action + audit trail.

2. **Server function** `updateWasteEntry` (optional but useful):
   - Allow updating `notes` and `investigationNote` for authorized roles.
   - `branch_admin` should only edit their own entries within a short time window (or not at all — align with SO logic).

3. **UI in** `src/routes/_layout/waste/index.tsx`:
   - Add an "Investigasi" column to the DataTable (or action column).
   - For each row, calculate **waste percentage** = `wasteQty / (currentInventoryQty + wasteQty) * 100`.
   - If `wastePercentage > 5%` **and** `investigationNote` is null/empty:
     - Highlight the row (e.g., `bg-rose-50`).
     - Show a **"Investigasi"** button for `super_admin` / `area_manager`.
     - For other roles, show a read-only badge: _"Butuh Investigasi"_.
   - If investigated, display the note text with a _"Diinvestigasi"_ badge.
   - Clicking the button opens a modal (or inline edit) to input the investigation note, calling `addInvestigationNote`.

4. **UI considerations:**
   - The existing `investigationNote` field is already fetched by `getWasteEntries`; just ensure it renders.
   - Follow the same modal pattern used in `stock-opname/$soId.tsx` for consistency.

---

### Task 2 — Automated Waste Valuation (HPP Master Terbaru)

**FRD Basis:**

- §4.4: _"Automated Waste Valuation: Setiap input Waste otomatis dikalikan dengan HPP Master Terbaru."_

**What to build:**

1. **Database migration:**
   - Add `valuation` (or `totalCost`) column to `waste_entries` table: `integer("valuation").notNull().default(0)`.
   - Alternatively, compute on read if you prefer no migration, but the FRD says _"otomatis dikalikan"_ — storing it is safer for historical accuracy (like `cogsAtTransaction` in orders).

2. **Server function** `createWasteEntry` (`src/lib/server/waste.ts`):
   - After fetching the ingredient (already done for `ing?.name`), read `ingredients.averageCost`.
   - Calculate: `valuation = data.quantity * ing.averageCost`.
   - Store `valuation` in the insert.
   - Update audit log to include the calculated valuation.

3. **UI in** `src/routes/_layout/waste/index.tsx`:
   - Add a **"Nilai Kerugian"** column to the DataTable showing `valuation` formatted as Rupiah.
   - Show a summary card at the top of the page: _"Total Kerugian Waste (periode aktif)"_.

4. **Broken Stock page** (`src/routes/_layout/waste/broken-stock.tsx`):
   - Also display the valuation per entry and a total summary.

---

### Task 3 — Auto-Link Biaya Operasional → Operational Expenses

**FRD Basis:**

- §3.5: _"Link Integrasi Khusus: Data yang di-input dengan kategori 'Biaya Operasional' wajib memiliki relasi tautan (Link) langsung yang masuk ke dalam pencatatan laporan Broken Stock."_
- §4.4: _"Link ke Broken Stock: Setiap item yang di-input cabang dengan kategori 'Biaya Operasional' wajib terhubung (auto-link) ke daftar Broken Stock yang tampilan antarmukanya disandingkan dengan barang keluar/habis."_

**What to build:**

1. **Server function** `createWasteEntry` (`src/lib/server/waste.ts`):
   - After inserting the `wasteEntries` row, **if `data.category === "Biaya Operasional"`**:
     - Insert a row into `operationalExpenses` with:
       - `branchId`: same
       - `wasteEntryId`: the newly created waste entry ID
       - `category`: "Biaya Operasional" (or a sub-category if needed)
       - `amount`: the `valuation` calculated in Task 2
       - `date`: current date (ISO string, e.g., `new Date().toISOString().split("T")[0]`)
       - `notes`: `data.notes` or auto-generated string like `"Auto-generated from Waste Entry ${entry.id}"`
       - `submittedBy`: `user.id`
   - Wrap both inserts in a transaction (Drizzle `db.transaction`) for atomicity.

2. **Server function** `getBrokenStock` (`src/lib/server/waste.ts`):
   - Currently only queries `wasteEntries`. Enhance it to **also** return the linked `operationalExpenses` data (e.g., expense ID, amount, date) via a left join.
   - This ensures the Broken Stock page can show the full financial link.

3. **UI in** `src/routes/_layout/waste/broken-stock.tsx`:
   - Add columns showing the linked operational expense amount and date.
   - Ensure the side-by-side layout clearly communicates the auto-link relationship.

---

### Task 4 — Anomaly Detection & UI Highlighting (>5% Threshold)

**FRD Basis:**

- §4.1 Period Closing check: _"Waste: Apakah semua laporan selisih > 5% sudah memiliki komentar investigasi?"_

**What to build:**

1. **Server function** `getWasteEntries`:
   - The data is already fetched. To calculate percentage accurately, the server may optionally compute `currentInventoryQty` per entry and return it.
   - Add `currentInventoryQty` to the select by joining/subquerying `inventory` table: `SELECT …, inventory.quantity as currentInventoryQty …`.
   - If inventory row doesn't exist, return `0`.

2. **UI in** `src/routes/_layout/waste/index.tsx`:
   - Compute `wastePercentage = quantity / (currentInventoryQty + quantity) * 100`.
   - If `wastePercentage > 5`:
     - Apply row-level styling (e.g., `bg-rose-50/30` or red left border).
     - Render a small red text below the quantity: `({wastePercentage.toFixed(1)}%)`.
   - Integrate with Task 1: the same `>5%` condition controls whether the **Investigasi** button appears.

3. **Period Closing integration** (`src/lib/server/finance.ts`):
   - The existing check already looks for `investigationNote IS NULL`. However, it checks **all** waste entries in the period, not just those with >5% anomaly.
   - **Fix the period closing check** to only flag entries where the quantity represents >5% of the relevant stock. This requires joining `inventory` or using a subquery to calculate the threshold dynamically.
   - If keeping it simple is preferred, at minimum ensure the current behavior is documented; but ideally align the check with the FRD's >5% rule.

---

### Task 5 — Area Manager Branch Filtering

**FRD Basis:**

- §2: _"Area Manager (Supervisor): Dapat di-mapping ke beberapa (Multiple/Array) cabang …"_
- §2: Area Manager has partial access to Waste for their assigned branches.

**What to build:**

1. **Server function** `getWasteEntries` (`src/lib/server/waste.ts`):
   - After `requireAuth()`, check `user.role`:
     - `branch_admin`: filter by `user.branchId` (already done).
     - `area_manager`: filter by `user.assignedBranches` using `inArray(wasteEntries.branchId, user.assignedBranches)`.
     - `super_admin`, `admin_pusat`, `central_kitchen`: no branch filter (or respect explicit `data.branchId`).

2. **UI in** `src/routes/_layout/waste/index.tsx`:
   - The branch `<select>` is already disabled for `branch_admin`.
   - For `area_manager`, the branch select should:
     - Show only branches in `user.assignedBranches`.
     - Default to the first assigned branch (or allow "All Assigned Branches").
   - Ensure the DataTable respects the filtered results.

3. **Same filtering** must be applied to `getBrokenStock` server function.

---

### Task 6 — Broken Stock "Stok Habis" Indicator

**FRD Basis:**

- §3.5: _"Side-by-Side Broken Stock UI: … menyandingkan 'Daftar Broken Stock' secara visual berdampingan (side-by-side) dengan indikator 'Barang Keluar / Stok Habis' …"_

**What to build:**

1. **Server function** `getBrokenStock` (`src/lib/server/waste.ts`):
   - Enhance the query to also return `inventory.quantity` for the corresponding `branchId + ingredientId`.
   - If `inventory.quantity === 0`, mark as `"Stok Habis"`.
   - If `inventory.quantity > 0`, mark as `"Stok Berkurang"`.

2. **UI in** `src/routes/_layout/waste/broken-stock.tsx`:
   - In the right-side "Ringkasan Barang Keluar" table, replace the static `"Stok Berkurang"` badge.
   - Use conditional badges:
     - `inventory.quantity === 0` → `<Badge variant="destructive">Stok Habis</Badge>`
     - `inventory.quantity > 0` → `<Badge variant="warning">Stok Berkurang</Badge>`
   - Consider adding the actual remaining stock quantity in a new column for clarity.

---

### Task 7 — Category Filter & Search Bar in Waste List UI

**FRD Basis:**

- General table requirements (§6.5, §3.1): pagination, filtering, search.
- The server already supports `category` and `search` params.

**What to build:**

1. **UI in** `src/routes/_layout/waste/index.tsx`:
   - Add a `<select>` dropdown for **Kategori** above the DataTable:
     - Options: "Semua", "Beban Makan", "Biaya Operasional", "Spoiled".
     - On change, pass the selected category to `getWasteEntries`.
   - Add a **search `<input>`** for ingredient name:
     - Debounce the input (e.g., 300ms) before calling `getWasteEntries`.
   - Wire both into the existing `useQuery` for `waste-entries`.

2. **State management:**
   - Use `useState` for `selectedCategory` and `searchQuery`.
   - Update the `queryKey` to include these filters so React Query caches correctly: `queryKey: ["waste-entries", selectedCategory, searchQuery]`.

---

### Task 8 — Waste Financial Categorization Mapping

**FRD Basis:**

- §6.3: _"Waste Financial Categorization: Waste kategori 'Spoiled' & 'Biaya Operasional' = Dicatat di laporan keuangan sebagai Operational Loss (Kerugian). Waste kategori 'Beban Makan' = Dicatat sebagai Staff Benefit Expense (Biaya Karyawan)."_

**What to build:**

1. **Helper / constant** (e.g., `src/lib/waste-categories.ts`):

   ```ts
   export const WASTE_FINANCIAL_MAP = {
     Spoiled: "Operational Loss",
     "Biaya Operasional": "Operational Loss",
     "Beban Makan": "Staff Benefit Expense",
   } as const;
   ```

2. **UI in** `src/routes/_layout/waste/index.tsx`:
   - Add a **"Klasifikasi Keuangan"** column (or show it as a sub-label in the Kategori column):
     - "Spoiled" → `"Kerugian Operasional"`
     - "Biaya Operasional" → `"Kerugian Operasional"`
     - "Beban Makan" → `"Biaya Karyawan"`

3. **Finance / Reporting integration** (future-facing):
   - Ensure `operationalExpenses` rows created in Task 3 carry the correct financial classification.
   - If a finance report module exists or is being built, expose a server function that groups waste entries by this financial classification for the current period.

---

## 3. Files to Modify / Create

| File                                        | Action     | Reason                                                                                                                                                                                                                              |
| ------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/server/waste.ts`                   | **Modify** | Add `addInvestigationNote`, update `createWasteEntry` (valuation + operational expense link), update `getWasteEntries` (area_manager filtering, inventory join), update `getBrokenStock` (inventory join, operational expense join) |
| `src/routes/_layout/waste/index.tsx`        | **Modify** | Add investigation UI, anomaly highlighting, valuation column, financial categorization label, category filter, search bar, area_manager branch filtering                                                                            |
| `src/routes/_layout/waste/broken-stock.tsx` | **Modify** | Add "Stok Habis" indicator, show linked operational expense data, show valuation                                                                                                                                                    |
| `src/db/schema.ts`                          | **Modify** | Add `valuation` column to `wasteEntries` (or create a migration file)                                                                                                                                                               |
| `src/lib/server/finance.ts`                 | **Modify** | Fix period-closing waste check to only flag >5% anomalies                                                                                                                                                                           |
| `src/lib/waste-categories.ts`               | **Create** | Financial categorization mapping constant                                                                                                                                                                                           |

---

## 4. Database Migration (if needed)

If adding the `valuation` column (recommended):

```sql
ALTER TABLE waste_entries ADD COLUMN valuation INTEGER NOT NULL DEFAULT 0;
```

Or use Drizzle Kit (`npx drizzle-kit generate`) after updating `src/db/schema.ts`.

> **Note:** Do not run migrations in this plan. Just prepare the schema change and migration file; the worker agent should run `npx drizzle-kit generate` and then `npx drizzle-kit migrate` (or equivalent) after updating the schema.

---

## 5. Acceptance Criteria (for verification)

- [ ] An `area_manager` can only see waste entries for branches in their `assignedBranches` array.
- [ ] A `branch_admin` can submit a waste entry; if category is "Biaya Operasional", a linked `operationalExpenses` row is auto-created with the correct `wasteEntryId`.
- [ ] Creating a waste entry stores `valuation = quantity × ingredients.averageCost` in `waste_entries.valuation`.
- [ ] The Waste list page shows a **"Nilai Kerugian"** column formatted as Rupiah.
- [ ] Waste entries with `quantity / (inventory + quantity) > 5%` are highlighted in the UI and show an **"Investigasi"** button for `super_admin` / `area_manager`.
- [ ] Clicking **"Investigasi"** opens a modal, saves the note via server function, and refreshes the row state.
- [ ] The Broken Stock page shows `"Stok Habis"` badge when `inventory.quantity === 0`, otherwise `"Stok Berkurang"`.
- [ ] The Broken Stock page displays the linked operational expense amount for each entry.
- [ ] Category filter and search bar on the Waste index page correctly filter the DataTable.
- [ ] Period closing check (`finance.ts`) only flags waste entries **without** investigation notes **and** with >5% anomaly (not all empty notes).
- [ ] `vp check` and `vp test` pass after all changes.

---

## 6. Out of Scope (do not implement)

- **Shrinkage module** — FRD Note §8.1 says _"Shrinkage module delete aja"_ and _"need further discussion"_.
- **Waste entry edit/delete** — Not explicitly required by FRD; focus on the missing mandated features first.
- **Approval status workflow** (e.g., `Submitted` → `Approved`) — FRD mentions Area Manager can "Approve" Waste but does not define a status schema like Stock Opname. The investigation note feature satisfies the primary audit requirement.
- **Changing the 3 waste categories** — FRD mandates exactly these three; do not add or remove.
