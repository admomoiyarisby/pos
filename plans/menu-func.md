# Menu: Bundling (Menu Paket) & BOGO (Buy 1 Get 1)

## Overview

Add the ability to mark any menu item as a **Bundling (Menu Paket)** — a parent recipe composed of multiple child recipes — or as a **BOGO promotion** that doubles stock deduction for items with direct ingredients only. Both features already exist in the database schema and seed data; this plan focuses on adding the missing UI and wiring everything together.

---

## What Already Exists

### Database Schema (`src/db/schema.ts`)

| Feature                                                                                       | Status              |
| --------------------------------------------------------------------------------------------- | ------------------- |
| `recipes.isBOGO` — boolean field (line 234)                                                   | Already in schema   |
| `recipeChildRecipes` junction table (lines 266–279) — parentRecipeId, childRecipeId, quantity | Already in schema   |
| `recipeCategoryEnum` — includes existing categories but NOT `paket_bundle` yet                | Needs enum addition |

### Server Functions (`src/lib/server/recipes.ts`)

| Feature                                                              | Status          |
| -------------------------------------------------------------------- | --------------- |
| `recipeInput` Zod schema includes `childRecipes` and `isBOGO` fields | Already present |
| `getRecipes` — returns `isBOGO` field in select                      | Present         |

### UI Routes

| File                             | Status                                                          |
| -------------------------------- | --------------------------------------------------------------- |
| `/recipes` list page             | Exists — no column for BOGO badge, no Bundling indicator        |
| `/recipes/$recipeId` detail page | Exists — shows BOM + modifier groups, no child-recipies section |

---

## Requirements from FRD

From the FRD, Section 3 (Modul POS), requirement #9:

> **Bundling Parent-Child Logic**: Sistem harus mendukung pembuatan "Menu Paket" (Parent SKU) yang tidak memiliki stok mandiri, melainkan memotong stok dari "Menu Satuan" (Child SKU).
>
> Contoh: Menu "Paket Kenyang" terjual. Sistem memotong BOM dari 1 Porsi Nasi Goreng (Brand A) + 1 Es Teh (Brand B).

### Prototype Behaviors (from omoiyari_pos)

The prototype already implements these behaviors:

- **Bundling**: A recipe with `childRecipes[]` recursively deduces child recipe ingredients when a parent is sold. The parent price replaces the children's prices.
- **BOGO**: When `isBOGO = true` AND the recipe has no childRecipes, stock deduction for direct ingredients is doubled (`multiplier = 2`). The price remains as-is (customer pays for 1, gets 2).
- **BOGO with children**: If a BOGO recipe has children, the children quantities are already the doubled amounts in `childRecipes` (e.g., `{recipeId: 'rec-01', quantity: 2}`).
- The prototype prototype UI: AdminView modal has two panels in a 2-column grid: "Bundling (Menu Paket)" (blue panel with child recipe pickers) and "Promo BOGO" (amber panel with toggle switch).

---

## Implementation Tasks

### Task 1: Add `paket_bundle` to Category Enum and Update Recipes Table Type

**File**: `src/db/schema.ts`
**What**: Add "paket_bundle" to `recipeCategoryEnum` so users can categorize bundling packages.
**Why**: FRD Section 4.4.1 references "Paket Bundle" as a filter category.

1. In `recipeCategoryEnum` (line 38-43), append `"paket_bundle"` to the array.
2. Update the type inference throughout the codebase.

---

### Task 2: Add BOGO Badge and Bundling Indicator to Recipe List Page

**File**: `src/routes/_layout/recipes/index.tsx`

**A. Column Updates**:

1. Add a "Tipe" column between "Kategori" and "Harga Dasar" that shows:
   - `Zap` icon with amber badge for BOGO items
   - `Package` icon with blue badge for Bundling items (recipes with child recipes)
   - Normal recipe shows nothing or a dash
2. To get child recipe data for the list page, modify the DB query in `getRecipes` (server fn) to include a count/flag of child recipes, or add a new API field.

**B. Form Update (Modal)**:
Add to the create modal:

1. A dropdown/select for "Jenis Menu" with options: "Menu Biasa", "Menu Paket (Bundling)", "Promo BOGO".
2. When "Menu Paket" is selected, show child recipe picker (see Task 3).
3. When "Promo BOGO" is selected, show the BOGO toggle.

**C. Update the RecipeRow interface** to include `isBOGO` and `hasChildren` (or `childrenCount`).

---

### Task 3: Recipe Edit/Create Modal — Unified Checkbox Layout

**File**: `src/routes/_layout/recipes/index.tsx` (in the create/edit Modal)

Replace the previous Task 3 (separate Bundling + BOGO sections) and Task M4 (Grup Modifier) with a **single unified section** containing **three groups of checkboxes** — each checkbox has an optional addon that expands when checked:

#### Section Header: "Opsi Tambahan"

Render three groups vertically, each separated by `<Separator />`:

---

#### Group 1 — Bundling (Menu Paket)

```
[☐] Bundling (Menu Paket)
     [+ Anak Opsi]          ← only shown when checkbox is checked
     [Dropdown: Pilih Menu] [Qty input] [X]
     [Dropdown: Pilih Menu] [Qty input] [X]
```

- `Checkbox` + `Label`: "Bundling (Menu Paket)"
- When **checked**, expand an addon panel (`Card` with `ml-6` indent):
  - "Tambah Anak" button (`Button` size="sm" + Plus)
  - Each child recipe row: `<Select>` (non-sub-recipe items, excluding self) + `<Input>` qty + remove `Button` (ghost, X)
  - `<p className="text-sm text-muted-foreground">` when no children: "Pilih menu yang menjadi bagian paket."
- State: `isBundling: boolean`, `childRecipes: { recipeId, quantity }[]`

---

#### Group 2 — BOGO (Buy 1 Get 1)

```
[☐] BOGO (Beli 1 Gratis 1)
```

- `Checkbox` + `Label`: "BOGO (Beli 1 Gratis 1)"
- Description helper text under label: `<p className="text-xs text-muted-foreground">` — "Harga pelanggan tetap 1×, stok terpotong 2×."
- No addon — this is a pure toggle
- State: `isBOGO: boolean`

---

#### Group 3 — Modifier Groups (each group = one checkbox)

```
[☐] Level Pedas (wajib)
     [+ Jenis Pedas]              ← only shown when checkbox is checked
     [Nama: Original]    [Harga: 0]   [☐ Exclusion]   [X]
     [Nama: Level 1]     [Harga: 0]   [☐ Exclusion]   [X]
     [Nama: Level 2]     [Harga: 2000][☐ Exclusion]   [X]

[☐] Extra Topping (opsional)
     [+ Jenis Tambahan]            ← only shown when checkbox is checked
     [Nama: Extra Telur]  [Harga: 5000]  [Nama: Extra Keju] [Harga: 4000]

[☐] Pilihan (Exclusion)
```

- Fetch all modifier groups via `getModifierGroups({})`
- For **each modifier group**, render one `Checkbox` + `Label`:
  - Label text: `{group.name}`
  - Badge showing required vs optional: `<Badge variant={group.minSelection > 0 ? "default" : "secondary"}>` with text "wajib"/"opsional"
- When a group's checkbox is **checked**, expand an addon panel (`Card` with `ml-6` indent):
  - **Existing options** from the group are listed as read-only pills/badges — each option shows: name + price surcharge
  - This is because options belong to the modifier group (they're defined in the group), not to the recipe. The recipe just _uses_ the group.
  - **No editing of options here** — option management happens on `/modifier-groups/` pages (Task M2/M3).
  - The addon serves as a **preview** showing what options the cashier will see in POS for this recipe.
- State: `linkedModifierGroupIds: string[]` (array of checked group IDs)

**Data flow**: On submit, `handleSubmit` passes:

- `isBOGO` → from Group 2 checkbox
- `childRecipes[]` → from Group 1 addon (only if Group 1 is checked)
- `modifierGroupIds[]` → from Group 3 checkbox states

---

#### Modal Form Structure (full picture)

```
┌── Modal: Tambah Menu ───────────────────────────┐
│  Kode: [__________]  Nama: [______________]     │
│  Kategori: [Makanan ▼]  Harga Dasar: [______]   │
│  Brand: [☐ Omoiyari] [☐ Brand B]                │
│  ─── Separator ───                                │
│  Bahan Baku / BOM: [add/remove rows as before]   │
│  ─── Separator ───                                │
│  **Opsi Tambahan**                                │
│  [☐] Bundling (Menu Paket)                       │
│      └─ addon panel (child recipe pickers)       │
│  ─── Separator ───                                │
│  [☐] BOGO (Beli 1 Gratis 1)                      │
│  ─── Separator ───                                │
│  [☐] Level Pedas (wajib)                         │
│      └─ addon panel (option preview)             │
│  [☐] Extra Topping (opsional)                    │
│      └─ addon panel (option preview)             │
│  [☐] Pilihan (Exclusion)                         │
│      └─ addon panel (option preview)             │
│  ─── Footer ───                                   │
│  [Batal]                          [Simpan]       │
└──────────────────────────────────────────────────┘
```

---

**Validation rules**:

- Bundling checkbox ON requires at least 1 child recipe
- BOGO checkbox ON is standalone (no additional fields)
- A recipe can have bundling BOGO and/or modifier groups in any combination
- Child recipes cannot include themselves (`r.id !== editingId`)
- Only non-sub recipes appear in the child picker

### Task 4: Display Child Recipes on Recipe Detail Page

**File**: `src/routes/_layout/recipes/$recipeId.tsx`

This page currently shows the recipe name, code, stats cards, ingredients BOM, and modifier groups. Add a "Menu Paket (Bundling)" section between the BOM and Modifier Groups sections.

1. Update the server function `getRecipeDetail` to also fetch child recipes join.
2. Add conditional rendering in the detail page:

```tsx
{
  recipe.childRecipes && recipe.childRecipes.length > 0 && (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Komposisi Paket (Bundling)</h2>
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th>Menu</th>
            <th>Qty</th>
            <th>Harga</th>
          </tr>
        </thead>
        <tbody>
          {recipe.childRecipes.map((cr) => (
            <tr key={cr.childRecipeId}>
              <td>{cr.childRecipeName}</td>
              <td>{cr.quantity}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

3. Also show a BOGO badge if `recipe.isBOGO` is true in the header area.

---

### Task 5: Update Server Functions for Child Recipes

**File**: `src/lib/server/recipes.ts`

1. **`getRecipeDetail`**: Add a JOIN to `recipeChildRecipes` and `recipes` to include child recipe information in the response. The returned type needs a new field:

   ```ts
   childRecipes: {
     childRecipeId: string;
     childRecipeName: string;
     quantity: number;
   }
   [];
   ```

2. **`getRecipes`**: Add a subquery or separate fetch to determine if a recipe has children. Could use a boolean `hasChildren` or count.
3. **`createRecipe`**: The Zod schema already includes `childRecipes` and `isBOGO`. Ensure the INSERT handler correctly inserts into `recipeChildRecipes` table when `childRecipes` array is provided.

4. **`updateRecipe`** (if exists): If there's an update endpoint, ensure it handles upserts to `recipeChildRecipes` (delete old child links, insert new).

5. **`recalculateAllRecipeCosts`**: Ensure the cost-rollup logic includes child recipe COGS when calculating `totalCogs` for bundling packages. Check `src/lib/server/cost-rollup.ts` for this.

---

### Task 6: POS Integration for BOGO/Bundling Labels

**File**: POS page (likely `src/routes/_layout/pos.tsx`)

In the menu grid/tile display:

1. Show a `Zap` icon or "BOGO" badge on recipe cards when `isBOGO = true`
2. Show a `Package` icon or "Paket" badge on bundling items (items with children)
3. No additional behavior changes needed for ordering — the POS just displays these as visual indicators that the cashier can identify bundles and promotions.

---

## Detailed File Changes

### `src/db/schema.ts`

```diff
 export const recipeCategoryEnum = pgEnum("recipe_category", [
   "makanan",
   "minuman",
   "snack",
   "add_ons",
+  "paket_bundle",
 ]);
```

### `src/lib/server/recipes.ts`

- Update `getRecipeDetail` handler to JOIN `recipeChildRecipes` → `recipes` for child recipe name.
- Update `getRecipes` handler to fetch child recipe count/flag per recipe.
- Ensure `createRecipe` handler inserts into `recipeChildRecipes` when `childRecipes` is present.
- Update return types to include `isBOGO` and `childRecipes[]`.

### `src/routes/_layout/recipes/$recipeId.tsx`

- Update `getRecipeDetail` to JOIN `recipeChildRecipes` → `recipes` for child recipe name.

### `src/routes/_layout/recipes/index.tsx`

- Import `Zap`, `Package` from lucide-react
- Add `isBOGO` and `childRecipes`/`hasChildren` to RecipeRow interface.
- Update DataTable columns to show BOGO/Bundling badge.
- In Modal: add category option for "paket_bundle".
- In Modal: add child recipe picker section and BOGO toggle.
- Update `handleSubmit` to pass `isBOGO` and `childRecipes` to the server.

### `src/routes/_layout/recipes/$recipeId.tsx`

- Show BOGO icon/badge in header if `recipe.isBOGO`.
- Show "Komposisi Paket (Bundling)" table if child recipes exist.

### `src/routes/_layout/pos.tsx`

- Show small badge/icon overlays on menu item cards for BOGO and Bundling items.

---

## Edge Cases & Pitfalls

### 1. Circular Bundling

A recipe should not be able to bundle itself directly or indirectly. At minimum, prevent self-reference: a recipe cannot list itself as a child. Deep circular detection may be left out for MVP.

### 2. BOGO + Child Recipes

The prototype treats `isBOGO && !childRecipes` as the "no child recipes" condition: when BOGO is set AND the recipe has no children, the ingredient deduction multiplier is 2. If BOGO is set AND there are children, children quantities are assumed to already be doubled. This is a UI-level concern: if user sets both, they should be aware.

### 3. COGS Calculation for Bundles

The `totalCogs` of a bundling package should be the sum of `(childRecipe.totalCogs * quantity)` for all children, NOT the direct ingredients cost. This is the roll-up logic that may already exist in `cost-rollup.ts`. Verify and update if needed.

### 4. Child Recipes with Their Own Children

Bundling is recursive. A child recipe can itself be a bundling package. This works via recursive inventory deduction.

### 5. HPP Rollove for Bundles

When a child recipe's COGS changes (BOM update), the parent's `totalCogs` must be recalculated via `recalculateAllRecipeCosts` or a targeted recalc.

### 6. Delete Constraints

Deleting a recipe that is a child of a bundling package: `onDelete: "cascade"` on `recipeChildRecipes` should automatically remove the child link. Verify the cascade constraint works correctly.

### 7. Category Filter

The FRD mentions "Paket Bundle" as a filter category in POS and dashboard. After adding `"paket_bundle"` to the enum, ensure the POS filter/tab bar includes it.

### 8. Type Consistency

The `childRecipes` field in the Zod schema is optional: `z.array(recipeChildInput).optional()` — but the DB `recipeChildRecipes` table has separate `parentRecipeId`, `childRecipeId`, `quantity` columns. The server fn must correctly map the array to DB inserts.

---

## Verification Steps

1. Create a regular menu → verify `isBOGO: false`, no child recipes.
2. Create a bundling package with 2-3 child recipes → verify `recipeChildRecipes` table entries.
3. Create a BOGO item → verify `isBOGO: true` in DB.
4. Open a bundling package detail page → verify child recipe table renders.
5. Open a BOGO item detail page → verify BOGO badge shown.

---

# Modifier Groups Management & Recipe Linking

## Overview

Modifiers (Level Pedas, Extra Topping, Exclusion/Tanpa) are already partially implemented: the **DB schema** has all 5 tables, the **server functions** (`src/lib/server/modifier-groups.ts`) have `getModifierGroups` / `getModifierGroup` / `createModifierGroup` / `updateModifierGroup`, and the **POS page** (`pos.tsx`) already has a `ModifierModal` component with cart integration. What's missing is:

1. **No UI pages** at `/modifier-groups/` — the route files are empty (0 bytes) so you cannot create/edit modifier groups through the UI
2. **No linking UI** on `/recipes` pages — there's no way to attach modifier groups to recipes
3. **Recipe detail** (`$recipeId.tsx`) only shows badges — no modifier BOM or pricing details
4. **`getRecipeDetail`** returns bare `{ modifierGroupId, modifierGroupName }` — needs full modifier data

### Terminology Mapping (schema vs user mental model)

The user's mental model:

> "Level Pedas" is a **modifier**, and "Original / Level 1 / Level 2" are **options**

The schema uses:

> `modifierGroups` = "Level Pedas" (the group / parent)
> `modifiers` = "Original", "Level 1", "Level 2" (the individual options within the group)

The UI labels should match the **user's mental model**:

- The group list page header: "Daftar Modifier" (what user calls "modifier list")
- Each row: "Level Pedas" with a "Jumlah Opsi" column
- When editing a modifier group: "Opsi Modifier" section where user adds options like "Original (Rp 0)", "Level 1 (Rp 0)", "Level 2 (+Rp 2.000)"

---

## UI Design Convention: ShadCn Aesthetic

**All new modifier UI must use the existing ShadCn components from `src/components/ui/`:**

| Component    | File            | Use For                                 |
| ------------ | --------------- | --------------------------------------- |
| `Input`      | `input.tsx`     | Text fields (code, name), number fields |
| `Select`     | `select.tsx`    | Dropdowns (ingredient picker)           |
| `Checkbox`   | `checkbox.tsx`  | isExclusion toggle                      |
| `Badge`      | `badge.tsx`     | Exclusion badge, variant tags, counts   |
| `Button`     | `button.tsx`    | All action buttons                      |
| `Card`       | `card.tsx`      | Grouping sections, edit panels          |
| `Modal`      | `Modal.tsx`     | Create/edit modals                      |
| `DataTable`  | `DataTable.tsx` | List pages, nested tables               |
| `Separator`  | `separator.tsx` | Visual dividers between sections        |
| `Label`      | `label.tsx`     | Form field labels                       |
| `switch.tsx` | `switch.tsx`    | Boolean toggles (isExclusion)           |
| `Textarea`   | `textarea.tsx`  | Notes / descriptions                    |

**Styling rules**:

- Use `border-border` (CSS var), `bg-background`, `text-foreground`, `text-muted-foreground` for all base colors — NO hardcoded `bg-amber-50`, `text-blue-900`, `border-blue-100` style colors. The prototype uses custom pastel colors; the production codebase uses ShadCn's semantic tokens.
- Containers: `rounded-lg border bg-card` or `rounded-xl border bg-card/50`
- Section headers: `text-sm font-semibold text-card-foreground`
- Nested items: `ml-4 pl-4 border-l-2 border-border` for indentation
- Add buttons: `size="sm" variant="outline"` with `Plus` icon
- Delete buttons: `size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive"`
- Active/required badge: `<Badge variant="default">` or `<Badge variant="secondary">`
- Exclusion badge: `<Badge variant="destructive">Exclusion</Badge>`
- Required selection groups: `<Badge variant="default">Wajib</Badge>`
- Optional selection groups: `<Badge variant="secondary">Opsional</Badge>`

**Do NOT use the prototype's pastel color scheme** (blue-50/amber-50 with blue-600/amber-600 headers). Use ShadCn's neutral card-based aesthetic with semantic color variants via Badge.

---

## What Already Exists

### Database Schema (`src/db/schema.ts`)

| Table                      | Columns                                                          | Status        |
| -------------------------- | ---------------------------------------------------------------- | ------------- |
| `modifierGroups`           | id, code, name, minSelection, maxSelection, createdAt            | Schema exists |
| `modifiers`                | id, code, modifierGroupId, name, price, isExclusion, createdAt   | Schema exists |
| `modifierIngredients`      | id, modifierId, ingredientId, quantity                           | Schema exists |
| `recipeModifierGroups`     | id, recipeId, modifierGroupId (unique pair)                      | Schema exists |
| `recipeModifierExclusions` | id, recipeId, modifierId, ingredientId, quantity (unique triple) | Schema exists |

### Server Functions (`src/lib/server/modifier-groups.ts`)

| Function                         | Status                                                                                              |
| -------------------------------- | --------------------------------------------------------------------------------------------------- |
| `getModifierGroups({ search? })` | EXISTS — returns groups with nested modifiers (bug: only fetches for `groupIds[0]`, not all groups) |
| `getModifierGroup({ id })`       | EXISTS — returns group with modifiers + ingredients (bug: same `modIds[0]` issue)                   |
| `createModifierGroup(data)`      | EXISTS — creates group + modifiers + single ingredient per modifier                                 |
| `updateModifierGroup(data)`      | EXISTS — updates group, deletes/recreates modifiers                                                 |

### POS Page (`src/routes/_layout/pos.tsx`)

| Feature                                                                         | Status                                                                 |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `CartModifier`, `CartItem.modifiers`, `ModifierGroup`, `MenuItemModifier` types | EXISTS                                                                 |
| `modifierModal` state with `{ item, selectedModifiers, itemNotes }`             | EXISTS                                                                 |
| `ModifierModal` component (lines ~1517+)                                        | EXISTS — renders modal with modifier groups, handles required/optional |
| Cart add with modifier price surcharge                                          | EXISTS                                                                 |
| Order submission with `selectedModifiers` mapped to server                      | EXISTS                                                                 |
| Receipt printing with modifier lines                                            | EXISTS                                                                 |

### UI Routes

| File                     | Status                                                |
| ------------------------ | ----------------------------------------------------- |
| `/modifier-groups/`      | **Empty file** (0 bytes) — skeleton route             |
| `/modifier-groups/$mgId` | **Empty file** (0 bytes) — skeleton route             |
| `/recipes/` list page    | Exists — no modifier group picker in create modal     |
| `/recipes/$recipeId`     | Exists — shows `recipe.modifierGroups` as badges only |

---

## Requirements from FRD

- **FRD §3 (POS) #7**: Pop-up for mandatory modifiers (Level Pedas) and optional add-ons (Extra Telur +Rp 5.000)
- **FRD §3 (Deep Inventory) #1**: Modifiers must have their own BOM that cuts raw material inventory independently
- **FRD §3 (Deep Inventory) #2**: "Tanpa X" exclusion modifiers must return the ingredient to stock

---

## Implementation Tasks

### Task M1: Fix Bugs in `modifier-groups.ts` Server Functions

**File**: `src/lib/server/modifier-groups.ts`

Two bugs found by code review:

1. **`getModifierGroups`** (line 39): Uses `groupIds[0]` instead of iterating all groups. This means only modifiers for the first group are fetched. Fix: use `.in` clause or map properly.

2. **`getModifierGroup`** (line 66): Same bug — `modIds[0]` instead of all modifier IDs. Fix: query all modifier ingredients for the group's modifiers.

```ts
// Fix 1: getModifierGroups — fetch modifiers for ALL groups
const allModifiers =
  groupIds.length > 0
    ? await db.select().from(modifiers).where(inArray(modifiers.modifierGroupId, groupIds))
    : [];

// Fix 2: getModifierGroup — fetch ingredients for ALL modifiers in group
const modIds = mods.map((m) => m.id);
const modIngs =
  modIds.length > 0
    ? await db
        .select()
        .from(modifierIngredients)
        .where(inArray(modifierIngredients.modifierId, modIds))
    : [];
```

### Task M2: Create Modifier Groups List Page

**File**: `src/routes/_layout/modifier-groups/index.tsx`

**Layout** (all ShadCn aesthetic):

- `PageHeader` with "Tambah Grup Modifier" button
- `DataTable` with columns:

| Key             | Header      | Render                                                                                                    |
| --------------- | ----------- | --------------------------------------------------------------------------------------------------------- |
| `code`          | Kode        | plain text                                                                                                |
| `name`          | Nama Grup   | `font-medium`                                                                                             |
| `minSelection`  | Min         | plain                                                                                                     |
| `maxSelection`  | Max         | plain                                                                                                     |
| `modifierCount` | Jumlah Opsi | `<Badge variant="secondary">{count}</Badge>`                                                              |
| `id`            | Aksi        | `<Link to="/modifier-groups/$mgId">` arrow + `Button` with `Trash2` icon, `variant="ghost"` + `size="sm"` |

**Create Modal** (reusing `Modal.tsx`):

- Modal title: "Tambah Grup Modifier"
- Form fields in a grid (`grid grid-cols-2 gap-4`):
  - `Label` + `Input` for Code
  - `Label` + `Input` for Name
  - `Label` + `Input` (type=number) for Min Selection
  - `Label` + `Input` (type=number) for Max Selection
- `<Separator />`
- **"Opsi Modifier"** section:
  - Section header with "Tambah Opsi" button (`Button` + `Plus`)
  - Each option row in a `Card` (`border rounded-lg p-3 mb-2`):
    - Grid layout: Name (flex-1), Price (w-24), `Switch` for isExclusion
    - "Bahan Baku" collapsible sub-row (when option has BOM):
      - `Label` + `Select` (from `select.tsx`) for ingredientId
      - `Input` (type=number, w-20) for quantity
      - Remove ingredient button (`Button` variant ghost)
    - Remove option button at row end (`Button` variant ghost, `X` icon)
  - Each option row is deletable
- Modal footer: `Button` variant="outline" (Batal), `Button` variant="default" (Simpan)
- Form submit calls `createModifierGroup`

**Validation**:

- `maxSelection >= minSelection && maxSelection >= 1`
- At least one option per group (minSelection can be 0 but maxSelection must be > 0)
- Ingredient is optional per option (some options like "Original" have no BOM)

### Task M3: Create Modifier Group Detail/Edit Page

**File**: `src/routes/_layout/modifier-groups/$mgId.tsx`

**Read view** (ShadCn):

- Header row (`flex items-center justify-between`):
  - Left: Group name (`h1` text-xl font-bold) + code (`Badge` variant="outline")
  - Right: `Button` "Edit" + `Button` "Hapus" (variant="destructive")
- Stats cards row: `Grid` of 3 `Card`s — Min Selection, Max Selection, Jumlah Opsi
- `<Separator />`
- **Opsi Modifier** table:
  - Columns: Nama Opsi | Harga Pengantar | Exclusion | Bahan Baku | Aksi
  - Each option in a table row
  - Option's BOM ingredients shown in a nested list below the row: `ml-4 pl-4 border-l-2 border-border`
    - "Telur Ayam (Gram) × 1" or similar format
- No edit buttons in read mode

**Edit mode** (toggle with state):

- All group fields become `Input` fields with labels
- Opsi Modifier section becomes editable:
  - "Tambah Opsi" button adds a new option row with empty fields
  - Each option row has inline `Input` fields for name, price
  - `Switch` for isExclusion
  - "Bahan Baku" section with ingredient select + quantity input
  - Remove option button
- "Simpan" calls `updateModifierGroup`; "Batal" reverts to read view

**Delete flow**:

- Confirmation modal: `Modal` with title "Hapus Grup Modifier?", description text, `Button` destructive (Hapus) and outline (Batal)
- Calls `deleteModifierGroup` (needs to be added to server fns if not present)

### Task M4: Update Server Functions for Recipe Modifier Linking

**File**: `src/lib/server/recipes.ts`

_(Task M4 was previously "Link Modifier Groups to Recipes" as a standalone UI task. That is now handled inside Task 3's unified checkbox modal. This task covers only the server-side changes.)_

1. **`createRecipe`**: Currently does NOT insert into `recipeModifierGroups`. Add this step after recipe INSERT:

```ts
if (input.modifierGroupIds?.length) {
  await db
    .insert(recipeModifierGroups)
    .values(input.modifierGroupIds.map((mgId) => ({ recipeId: recipe.id, modifierGroupId: mgId })));
}
```

2. **`updateRecipe`** (new or existing): Delete existing `recipeModifierGroups` for the recipe, insert new set (upsert pattern).

---

### Task M5: Enrich Recipe Detail Page Modifier Display

**File**: `src/routes/_layout/recipes/$recipeId.tsx`

Currently this page receives `recipe.modifierGroups` as `[{ modifierGroupId, modifierGroupName }]` only. It needs full modifier data.

1. **Update `getRecipeDetail`** server fn to JOIN `modifiers` within each modifier group:

   ```ts
   // After fetching recipe:
   const modGroupLinks = await db
     .select({
       modifierGroupId: recipeModifierGroups.modifierGroupId,
       modifierGroupName: modifierGroups.name,
       minSelection: modifierGroups.minSelection,
       maxSelection: modifierGroups.maxSelection,
     })
     .from(recipeModifierGroups)
     .leftJoin(modifierGroups, eq(recipeModifierGroups.modifierGroupId, modifierGroups.id))
     .where(eq(recipeModifierGroups.recipeId, id));

   // For each group, fetch modifiers + ingredients
   for (const mg of modGroupLinks) {
     mg.modifiers = await db
       .select({
         id: modifiers.id,
         name: modifiers.name,
         price: modifiers.price,
         isExclusion: modifiers.isExclusion,
       })
       .from(modifiers)
       .where(eq(modifiers.modifierGroupId, mg.modifierGroupId));
   }
   ```

2. **Enhance the UI** — replace the current simple badge list with `Card`-based panels (ShadCn):
   ```tsx
   {
     recipe.modifierGroups.length > 0 && (
       <div className="space-y-4">
         <h2 className="text-lg font-semibold">Grup Modifier</h2>
         {recipe.modifierGroups.map((mg) => (
           <Card key={mg.modifierGroupId} className="p-0">
             <div className="px-4 py-3 border-b">
               <h3 className="font-medium">
                 {mg.modifierGroupName}
                 <Badge variant="outline" className="ml-2">
                   min: {mg.minSelection}, max: {mg.maxSelection}
                 </Badge>
               </h3>
             </div>
             <div className="divide-y">
               {mg.modifiers?.map((m) => (
                 <div key={m.id} className="flex items-center justify-between px-4 py-2 text-sm">
                   <span>
                     {m.name}
                     {m.isExclusion && (
                       <Badge variant="destructive" className="ml-2 text-[10px]">
                         Exclusion
                       </Badge>
                     )}
                   </span>
                   <span className="text-muted-foreground">
                     {m.price > 0 ? `+Rp ${m.price.toLocaleString("id-ID")}` : "—"}
                   </span>
                 </div>
               ))}
             </div>
           </Card>
         ))}
       </div>
     );
   }
   ```

### Task M6: POS Modifier Integration (already mostly done — verify & polish)

**File**: `src/routes/_layout/pos.tsx`

The POS page already has:

- `ModifierModal` component at lines ~1517+
- `modifierModal` state management
- Required/optional group handling (lines 699-714)
- Cart item with modifiers + price surcharge

**What to verify & potentially fix**:

1. The `getPosMenu` server function must return `modifierGroups` for each menu item. Check `src/lib/server/pos.ts` — if it doesn't JOIN through `recipeModifierGroups` → `modifiers`, add that.
2. The `MenuItemModifier` type has `excludedIngredientId: string | null` — ensure the POS modal records this for exclusion modifiers.
3. The cart-to-order mapping (line ~800) maps `c.modifiers` to `selectedModifiers` — verify the server-side `createOrder` handler in `pos.ts` correctly stores these in `orderItemModifiers`.

### Task M7: Verify Modifier BOM in Order Processing

**File**: `src/lib/server/pos.ts` — `createOrder` function

When an order is placed with modifiers:

1. **Verify** `orderItemModifiers` INSERT for each cart modifier
2. **Verify** `orderItemExclusions` INSERT for exclusion modifiers (if recipe has `recipeModifierExclusions` linked)
3. **Verify** modifier ingredient COGS is calculated and snapshotted in `cogsAtTransaction`

If any of these are missing, add them. The DB schema already supports all three tables (`orderItemModifiers`, `orderItemExclusions`, `orderItemModifiers.cogsAtTransaction`).

---

## Detailed File Changes

### `src/lib/server/modifier-groups.ts`

- Fix bugs: `groupIds[0]` → `inArray(groupIds)` pattern, `modIds[0]` → `inArray(modIds)`
- Add `deleteModifierGroup` server function if missing

### `src/lib/server/recipes.ts`

- `createRecipe`: Insert into `recipeModifierGroups` after recipe INSERT
- `updateRecipe` (new or existing): Upsert `recipeModifierGroups`
- `getRecipeDetail`: Enrich modifier groups with full modifier data (id, name, price, isExclusion, ingredients)

### `src/routes/_layout/modifier-groups/index.tsx` (NEW — currently empty)

- Full CRUD: list, create, delete modifier groups
- Create Modal with nested option editor (ShadCn aesthetic)
- All ShadCn: `Input`, `Select`, `Switch`, `Badge`, `Button`, `Card`, `Modal`, `Separator`

### `src/routes/_layout/modifier-groups/$mgId.tsx` (NEW — currently empty)

- Detail view + inline editing with `Card`-based panels
- Read/Edit toggle with confirmation modal for delete
- ShadCn `DataTable` for options within a group

### `src/routes/_layout/recipes/index.tsx`

- Add "Grup Modifier" picker section to create/edit Modal

### `src/routes/_layout/recipes/$recipeId.tsx`

- Enhance modifier groups section to show full details

### `src/lib/server/pos.ts`

- Verify `getPosMenu` returns modifier groups with modifiers
- Verify `createOrder` handles modifier BOM/COGS correctly

---

## Edge Cases & Pitfalls

### 1. Server Function Bugs (`modIds[0]` / `groupIds[0]`)

The existing code only fetches modifiers for the first group/first option. If you have 3 groups, only the first one shows options. This is a **critical fix**.

### 2. Empty Modifier Groups

`maxSelection >= minSelection && maxSelection >= 1` validation.

### 3. Option Price = Surcharge

Price is ADD-ON to base recipe price. "Extra Telur" +Rp 5.000 adds to line total.

### 4. Exclusion vs Regular Option BOM

`isExclusion: true` options return ingredient to stock. POS order handler must distinguish: regular = deduct, exclusion = add back.

### 5. Option COGS Snapshot

Historical orders must not change when option ingredient costs change. `cogsAtTransaction` in `orderItemModifiers` handles this (already in schema).

### 6. Route Regeneration

The `/modifier-groups/` route files are empty files. After implementation, run dev server to regenerate `routeTree.gen.ts`.

### 7. Single Ingredient per Option (current limitation)

The existing `modifierInput` schema uses `ingredientId` + `ingredientQty` (single pair), not an array of ingredients. If you want multi-ingredient BOM per option, update the schema to use `ingredients: [{ ingredientId, quantity }][]` instead. This requires changes to `createModifierGroup` / `updateModifierGroup` handlers and the UI modal.

### 8. `recipeModifierExclusions` table exists but has no UI

This table stores per-recipe exclusion mappings (which ingredient to return when an exclusion option is selected). There's no UI to configure this. For MVP, rely on the option's own ingredient to drive the return logic.

---

## Verification Steps (Modifiers)

1. Create modifier group "Level Pedas" with options (Original, Level 1, Level 2) → verify DB + list page renders with ShadCn styling
2. Edit a group to add/remove options → verify changes persist
3. Link the group to a recipe via `/recipes` modal → verify `recipeModifierGroups` entry
4. Open recipe detail → verify expanded modifier panel with prices renders in `Card` style
5. On POS, tap a recipe with linked modifiers → verify `ModifierModal` opens
6. Place order with modifiers → verify `orderItemModifiers` + `orderItemExclusions` entries in DB
