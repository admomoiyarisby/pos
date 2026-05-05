# Dummy Data Setup Plan

## Goal

Port all dummy data from the prototype (`../omoiyari_pos/src/App.tsx`) into the current project's database via `src/routes/api/setup.ts`. The endpoint is idempotent — running it multiple times should not create duplicates.

## Source Data Overview

The prototype defines these in-memory datasets in `App.tsx`:

| Dataset                   | Count | Key IDs (prototype)                                                                  |
| ------------------------- | ----- | ------------------------------------------------------------------------------------ |
| `INITIAL_BRANCHES`        | 10    | `br-central`, `br-sub-01`..`br-bdg-01`                                               |
| `INITIAL_INGREDIENTS`     | 28    | `ing-01`..`ing-27`, `ing-sfg-01`..`ing-sfg-14`                                       |
| `INITIAL_MODIFIER_GROUPS` | 3     | `mg-01`..`mg-03`                                                                     |
| `INITIAL_RECIPES`         | 15    | `rec-01`..`rec-13`, `rec-bundle-01`, `rec-bogo-01`, `rec-shared-01`, `rec-shared-02` |
| `INITIAL_ORDERS`          | 35    | `ord-001`..`ord-035`                                                                 |
| `INITIAL_STOCK_LEDGER`    | 10    | `sl-1`..`sl-10`                                                                      |
| `INITIAL_TRANSFERS`       | 5     | `tr-001`..`tr-005`                                                                   |
| `INITIAL_DELIVERIES`      | 5     | `del-1`..`del-5`                                                                     |
| `INITIAL_PERIODS`         | 2     | `per-001`, `per-002`                                                                 |
| `INITIAL_WASTE_ENTRIES`   | 1     | `w-1`                                                                                |
| `INITIAL_LOGS`            | 10    | `l1`..`l10`                                                                          |
| `INITIAL_ADMIN_USERS`     | 5     | `sa-1`, `ap-1`, `am-1`, `ba-1`, `ck-1`                                               |

## Critical Schema Differences

The prototype uses flat in-memory objects with string IDs. The current schema uses **PostgreSQL UUIDs** with `defaultRandom()` and **normalized join tables**. Every insert must capture the generated UUID to use as foreign keys in subsequent inserts.

### 1. Required `code` fields (unique, notNull)

The prototype has no `code` fields. The current schema requires them on:

| Table                  | Code pattern                                            |
| ---------------------- | ------------------------------------------------------- |
| `branches`             | `CENTRAL`, `SBY-01`, `SBY-02`, `MLG-01`, `JKT-01`, etc. |
| `ingredients`          | `ING-001`, `ING-002`, etc.                              |
| `recipes`              | `REC-001`, `REC-002`, etc.                              |
| `modifierGroups`       | `MG-001`, `MG-002`, etc.                                |
| `modifiers`            | `MOD-001`, `MOD-002`, etc.                              |
| `suppliers`            | `SUP-001`, `SUP-002`, etc.                              |
| `purchaseRequisitions` | `PR-001`, etc.                                          |
| `purchaseOrders`       | `PO-001`, etc.                                          |
| `deliveryNotes`        | `DN-001`, etc.                                          |
| `scmInvoices`          | `INV-001`, etc.                                         |
| `stockTransfers`       | `TR-001`, etc.                                          |

### 2. Brands

The prototype has `brandIds: ['brand-1']` on recipes. The current schema has a `brands` table (code, name, logo) and a `recipe_brands` join table.

**Action**: Create one brand `{ code: "BRAND-1", name: "Omoiyari" }`, then link recipes to it via `recipe_brands`.

### 3. Modifier structure (3 tables vs nested objects)

Prototype:

```ts
modifierGroups: [
  { id, name, minSelection, maxSelection, modifiers: [{ id, name, price, ingredients }] },
];
```

Current schema (3 tables):

- `modifier_groups` — group header (code, name, minSelection, maxSelection)
- `modifiers` — individual modifiers (code, name, price, modifierGroupId, isExclusion)
- `modifier_ingredients` — links modifier → ingredient (for COGS tracking)
- `recipe_modifier_groups` — links recipe → modifierGroup
- `recipe_modifier_exclusions` — links recipe → modifier → ingredient (for "Tanpa X" exclusions)

**Action**: Flatten the nested structure. Insert modifier_groups first, capture UUIDs, then insert modifiers with the group UUID. For exclusions (modifiers with `ingredients: []` in prototype that are actually ingredient removals), use `recipe_modifier_exclusions`.

### 4. Recipe ingredients → `recipe_ingredients` join table

Prototype: `ingredients: [{ ingredientId, quantity }]` on the Recipe object.
Current schema: Separate `recipe_ingredients` table with `recipeId`, `ingredientId`, `quantity`.

### 5. Recipe child recipes → `recipe_child_recipes` join table

Prototype: `childRecipes: [{ recipeId, quantity }]` on Recipe.
Current schema: `recipe_child_recipes` with `parentRecipeId`, `childRecipeId`, `quantity`.

**Note**: Child recipes reference other recipes by UUID. Since recipes are inserted in a specific order, child recipe links can only be created after all recipes exist. Use `ON CONFLICT DO NOTHING` or two-pass insertion.

### 6. Orders

Prototype order item: `{ recipeId, quantity, price, cogsAtTransaction, selectedModifiers: [{ groupId, modifierId, cogsAtTransaction }], notes }`

Current schema:

- `orders` — header (no `brandId` directly)
- `order_items` — has `brandId` FK (not on order)
- `order_item_modifiers` — links orderItem → modifierGroup → modifier
- `order_item_exclusions` — for exclusions

**Note**: The prototype `brandId` is on the order. The current schema puts `brandId` on `order_items`. Since all prototype orders use `brand-1`, put that brand UUID on every `order_items` row.

### 7. Supplier deliveries

Prototype: `{ supplierName: "PT Beras Makmur", ingredientId, quantity, price, deliveryDate, receivedBy }`

Current schema:

- `supplierDeliveries` has both `supplierId` (FK) and `supplierName` (text)
- Must create `suppliers` rows first, capture UUIDs

### 8. Waste category mapping

| Prototype                | Current schema enum |
| ------------------------ | ------------------- |
| `'Rusak'`                | `'Spoiled'`         |
| `'Jatah Makan Karyawan'` | `'Beban Makan'`     |

### 9. Stock transfers

Prototype: `requestedBy: 'sa-1'` (user ID string).
Current schema: `requestedBy` is UUID FK to `users.id`.

**Action**: After creating users via better-auth, capture their UUIDs and use them for all `requestedBy`, `submittedBy`, `createdBy`, `receivedBy`, etc. FKs.

### 10. Period logs

Prototype: `openingBalances: [{ ingredientId, branchId, quantity }]` and `closingBalances: [...]`
Current schema: `period_balances` with `balanceType: 'opening' | 'closing'`.

### 11. Users

The prototype has 5 admin users. The current schema creates users via better-auth `signUpEmail`. The setup already handles 2 users. Add the remaining 3:

| Email                       | Name              | Role              | Branch                               |
| --------------------------- | ----------------- | ----------------- | ------------------------------------ |
| `pusat@omoiyari.net`        | Admin Pusat       | `admin_pusat`     | —                                    |
| `manager.east@omoiyari.net` | Area Manager East | `area_manager`    | — (assignedBranches: SBY-01..SBY-04) |
| `ck@omoiyari.net`           | Central Kitchen   | `central_kitchen` | CENTRAL                              |

After creating the area manager, insert into `area_manager_branches` for the 4 Surabaya branches.

## Insertion Order (Dependencies)

```
1.  branches          (no FKs)
2.  brands            (no FKs)
3.  suppliers         (no FKs)
4.  users             (via better-auth signUpEmail, depends on branches for branch admins)
    └─ areaManagerBranches (depends on users + branches)
5.  ingredients       (no FKs)
6.  modifierGroups    (no FKs)
7.  modifiers         (FK → modifierGroups)
    └─ modifierIngredients (FK → modifiers + ingredients)
8.  recipes           (no FKs, but needs codes)
    └─ recipeBrands       (FK → recipes + brands)
    └─ recipeIngredients  (FK → recipes + ingredients)
    └─ recipeModifierGroups (FK → recipes + modifierGroups)
    └─ recipeModifierExclusions (FK → recipes + modifiers + ingredients)
    └─ recipeChildRecipes (FK → recipes + recipes) — SECOND PASS
9.  platformFees      (no FKs)
10. vouchers          (FK → users)
11. inventory         (FK → branches + ingredients)
12. shifts            (FK → branches + users)
13. orders            (FK → branches + shifts optional)
    └─ orderItems       (FK → orders + recipes + brands)
    └─ orderItemModifiers (FK → orderItems + modifierGroups + modifiers)
    └─ orderItemExclusions (FK → orderItems + ingredients)
14. stockLedger       (FK → branches + ingredients)
15. purchaseRequisitions (FK → branches + users)
    └─ purchaseRequisitionItems (FK → purchaseRequisitions + ingredients)
16. purchaseOrders    (FK → purchaseRequisitions optional + suppliers + branches + users)
    └─ purchaseOrderItems (FK → purchaseOrders + ingredients)
17. deliveryNotes     (FK → purchaseRequisitions optional + purchaseOrders optional + branches + users)
    └─ deliveryNoteItems (FK → deliveryNotes + ingredients)
18. scmInvoices       (FK → deliveryNotes + branches)
    └─ scmInvoiceItems  (FK → scmInvoices + ingredients)
19. supplierDeliveries (FK → suppliers optional + ingredients + users)
20. stockTransfers    (FK → branches + ingredients + users)
21. wasteEntries      (FK → branches + ingredients + users)
    └─ operationalExpenses (FK → wasteEntries optional + branches + users)
22. stockOpnames      (FK → branches + users + users)
    └─ stockOpnameItems (FK → stockOpnames + ingredients)
23. manualRevenues    (FK → branches + users)
    └─ manualRevenueBrandBreakdowns (FK → manualRevenues + brands)
24. channelRevenues   (FK → branches + users)
25. periodLogs        (FK → users + users optional)
    └─ periodBalances   (FK → periodLogs + branches + ingredients)
26. yieldConversions  (FK → branches + ingredients + ingredients + users)
27. systemLogs        (FK → users optional)
28. appSettings       (FK → users optional)
```

## Implementation Strategy

### Pattern for UUID capture

Use a `Map<string, string>` to track prototype IDs → database UUIDs:

```ts
const branchIdMap = new Map<string, string>();
const ingredientIdMap = new Map<string, string>();
// ... etc

const insertedBranches = await db.insert(branches).values([...]).returning({ id: branches.id, code: branches.code });
for (const b of insertedBranches) branchIdMap.set(b.code, b.id);
```

For tables without a natural code key (e.g., recipes where we assign synthetic codes), use the prototype's `id` field as the map key:

```ts
const recipeIdMap = new Map<string, string>();
const insertedRecipes = await db.insert(recipes).values([...]).returning({ id: recipes.id });
// Need to align returning values with prototype IDs — use a temporary array
```

**Better approach**: Since `returning()` returns rows in insertion order, pair them with the prototype data:

```ts
const recipeData = [...]; // prototype recipes with their original ids
const inserted = await db.insert(recipes).values(recipeData.map(r => ({...}))).returning({ id: recipes.id });
for (let i = 0; i < recipeData.length; i++) {
  recipeIdMap.set(recipeData[i].id, inserted[i].id);
}
```

### Idempotency

For each entity, check if it already exists before inserting. Use `db.select().from(table).limit(1)` or check by unique code:

```ts
const existing = await db.select().from(branches).where(eq(branches.code, "CENTRAL"));
if (existing.length > 0) {
  branchIdMap.set("br-central", existing[0].id);
} else {
  // insert
}
```

### Two-pass recipe insertion

Recipes with `childRecipes` (bundle, BOGO) reference other recipes. Since all recipes need UUIDs first:

1. **Pass 1**: Insert all recipes (ignoring childRecipes field)
2. **Pass 2**: Insert `recipe_child_recipes` using the UUID map

### Data transformations

#### Branches

Prototype has 10 branches. The current setup already has 3. Add the remaining 7.

| Prototype ID | Code     | Name                     | Location            | Type   |
| ------------ | -------- | ------------------------ | ------------------- | ------ |
| `br-sub-03`  | `SBY-03` | Omoiyari Surabaya Timur  | Mulyorejo, Surabaya | Outlet |
| `br-sub-04`  | `SBY-04` | Omoiyari Sidoarjo        | Waru, Sidoarjo      | Outlet |
| `br-mlg-01`  | `MLG-01` | Omoiyari Malang          | Lowokwaru, Malang   | Outlet |
| `br-grs-01`  | `GRS-01` | Omoiyari Gresik          | Kebomas, Gresik     | Outlet |
| `br-jkt-01`  | `JKT-01` | Omoiyari Jakarta Selatan | Tebet, Jakarta      | Outlet |
| `br-jkt-02`  | `JKT-02` | Omoiyari Jakarta Barat   | Puri, Jakarta       | Outlet |
| `br-bdg-01`  | `BDG-01` | Omoiyari Bandung         | Dago, Bandung       | Outlet |

#### Ingredients

Assign codes like `ING-001`, `ING-002`, etc. Map `category` carefully:

- Prototype: `'Fresh' | 'Dry' | 'Packaging'` → Schema enum: `['Fresh', 'Dry', 'Packaging']` ✓ match
- Prototype `skuType`: `'RM' | 'SFG' | 'FG'` → Schema enum: `['RM', 'SFG', 'FG']` ✓ match
- `countable`: prototype has `countable: true` on all. Schema default is `true`. ✓

#### Modifier groups

Assign codes: `MG-001`, `MG-002`, `MG-003`.

#### Modifiers

Assign codes: `MOD-001`..`MOD-009`.

- `mod-08` and `mod-09` (Tanpa Bawang Bombay, Tanpa Wortel) are exclusions → `isExclusion: true`
- The prototype puts them inside modifier groups. In the schema, they are rows in `modifiers` with `modifierGroupId` FK.

#### Recipes

Assign codes: `REC-001`..`REC-015`.

- `isBOGO`: true for `rec-bogo-01`
- `isSubRecipe`: false for all (prototype doesn't have sub-recipes per se, the SFG items are ingredients, not recipes)
- `category`: map prototype category to schema enum (`'makanan' | 'minuman' | 'snack' | 'add_ons'`)
- `recipeModifierExclusions`: For `mod-08` (Tanpa Bawang Bombay) and `mod-09` (Tanpa Wortel), insert into `recipe_modifier_exclusions` with the appropriate ingredient (`ing-10` for Bawang Bombay, `ing-09` for Wortel) and quantity from the recipe ingredient list.

Wait, the prototype's `recipeModifierExclusions` concept is different. The prototype has modifiers that are exclusions (like "Tanpa Bawang Bombay"), and when selected, they remove an ingredient from the recipe. The current schema's `recipe_modifier_exclusions` table links recipe → modifier → ingredient → quantity to track what gets excluded.

Looking at the current schema:

```ts
export const recipeModifierExclusions = pgTable(
  "recipe_modifier_exclusions",
  {
    recipeId,
    modifierId,
    ingredientId,
    quantity,
  },
  (t) => [unique("recipe_mod_excl_unique").on(t.recipeId, t.modifierId, t.ingredientId)],
);
```

So for each recipe that uses `mg-03` (Pilihan Exclusion), and for each exclusion modifier:

- `mod-08` "Tanpa Bawang Bombay" → excludes `ing-10` (Bawang Bombay) from the recipe, quantity = whatever the recipe uses
- `mod-09` "Tanpa Wortel" → excludes `ing-09` (Wortel) from the recipe, quantity = whatever the recipe uses

But wait, looking at the prototype recipes, none of them actually use `ing-09` (Wortel) or `ing-10` (Bawang Bombay) directly in their ingredient lists. So the exclusions in the prototype might be more conceptual. Let me check...

Actually, looking at the prototype's `recipeModifierExclusions` — the prototype doesn't have this as a separate table. The exclusions are just modifiers with `ingredients: []`. In the current schema, `recipe_modifier_exclusions` is a separate concept.

For the dummy data, we should probably skip `recipe_modifier_exclusions` since the prototype doesn't have explicit exclusion mappings. Or we can create minimal ones for the demo.

Actually, looking more carefully at the current schema: `recipeModifierExclusions` requires a `quantity` for the excluded ingredient. Since the prototype doesn't have this data explicitly, we can either:

1. Skip `recipe_modifier_exclusions` entirely for dummy data
2. Create minimal entries with quantity 0 or 1

Let's skip it for simplicity, or add it only if the recipe actually contains the ingredient being excluded.

#### Orders

The prototype has 35 orders. For each order:

- Map `branchId` via branchIdMap
- `channel`: `'Gofood' | 'Grabfood' | 'ShopeeFood' | 'Dine-in'` → schema enum matches
- `status`: schema enum is `'New' | 'Processing' | 'In Delivery' | 'Completed' | 'Void' | 'Cancel Requested'` — the prototype uses `'Completed'` and `'New'`
- `createdAt`: prototype uses `subDays(new Date(), N)` — convert to JS Date
- `shiftId`: optional, can be null for dummy data
- `orderCode`: use the prototype's order code

For order items:

- `brandId`: all use `brand-1` → the single brand's UUID
- `recipeId`: map via recipeIdMap
- `price`: from prototype
- `cogsAtTransaction`: from prototype
- `notes`: optional

For order item modifiers:

- Only some prototype orders have `selectedModifiers`. Most don't.
- Skip order item modifiers for simplicity, or add a few representative ones.

Actually, looking at the prototype orders more carefully, NONE of them have `selectedModifiers` in the data shown. So we can skip `order_item_modifiers` and `order_item_exclusions`.

#### Stock ledger

10 entries. `type`: `'IN' | 'OUT'` matches schema enum. `reference`: use prototype reference.

#### Stock transfers

5 entries. Map `fromBranchId`, `toBranchId`, `ingredientId`, `requestedBy` (user UUID).

#### Supplier deliveries

5 entries. Need to create suppliers first:

- PT Beras Makmur
- CV Ayam Segar
- Importir Sapi Jaya
- PT Saus Nusantara

Then map `supplierId` via supplierIdMap. `receivedBy` maps to user UUID (Super Admin).

#### Period logs

2 entries. Insert `period_logs` first, then `period_balances` for opening/closing.

#### Waste entries

1 entry. Map `category`: `'Rusak'` → `'Spoiled'`.

#### System logs

10 entries. Simple inserts.

#### Platform fees

The prototype doesn't have explicit platform fee data, but there are 4 channels. Insert default platform fees for each channel.

#### Inventory

The prototype has `INITIAL_INVENTORY` implicitly (not shown in the excerpt but referenced). Actually, looking at the code, the prototype manages inventory through `InventoryItem` but I didn't see an explicit `INITIAL_INVENTORY` array. However, the `stockLedger` and `stockTransfers` imply inventory exists.

For dummy data, create inventory records for each branch + ingredient combination that appears in orders or stock ledger. Use reasonable initial quantities.

#### App settings

Insert a few default settings.

## File Structure

The setup endpoint should be split into logical sections within `src/routes/api/setup.ts`, or into helper files under `src/lib/seed/`:

```
src/lib/seed/
  branches.ts
  brands.ts
  suppliers.ts
  ingredients.ts
  modifier-groups.ts
  recipes.ts
  users.ts
  orders.ts
  inventory.ts
  stock-ledger.ts
  stock-transfers.ts
  purchase-requisitions.ts
  delivery-notes.ts
  supplier-deliveries.ts
  scm-invoices.ts
  waste-entries.ts
  stock-opnames.ts
  manual-revenues.ts
  channel-revenues.ts
  period-logs.ts
  yield-conversions.ts
  system-logs.ts
  vouchers.ts
  platform-fees.ts
  app-settings.ts
```

Each helper exports a function like `seedBranches(branchIdMap)` that populates the map and returns nothing.

## What was implemented

### Files created

| File                        | Purpose                                                                                  |
| --------------------------- | ---------------------------------------------------------------------------------------- |
| `src/lib/seed/seed-data.ts` | All prototype data adapted with codes, enum mappings, and proto ID tracking (1230 lines) |
| `src/lib/seed/seed.ts`      | Seed functions for all entity groups + orchestrator (1087 lines)                         |
| `src/lib/seed/index.ts`     | `IdMap` type and `createIdMap()` helper                                                  |

### What's seeded (18 groups)

- [x] **Branches** — 10 branches (respects existing 3, adds remaining 7)
- [x] **Brands** — 1 brand ("Omoiyari")
- [x] **Suppliers** — 4 suppliers
- [x] **Users** — 5 users via better-auth (all with role, 2 with branchId)
- [x] **Area manager branches** — 4 branch assignments for Area Manager East
- [x] **Ingredients** — 41 ingredients (27 RM + 4 FG + 14 SFG) with codes ING-001..ING-041
- [x] **Modifier groups + Modifiers + Modifier ingredients** — 3 groups, 9 modifiers, ingredient links for extra toppings
- [x] **Recipes** — 15 recipes with codes REC-001..REC-015
  - [x] Recipe → Brand links
  - [x] Recipe → Ingredient links
  - [x] Recipe → ModifierGroup links
  - [x] Recipe → ChildRecipe links (2-pass insertion for bundles/BOGO)
- [x] **Platform fees** — 4 channels (Gofood 20%, Grabfood 20%, ShopeeFood 20%, Dine-in 0%)
- [x] **Vouchers** — 2 vouchers (PROMO10, FREESHIP)
- [x] **Inventory** — 14 ingredients × 4 branches
- [x] **Shifts** — 1 shift for Hans at SBY-01
- [x] **Orders** — 35 orders with order items (30 completed + 5 new)
- [x] **Stock ledger** — 10 entries for SBY-01
- [x] **Stock transfers** — 5 transfers with various statuses
- [x] **Supplier deliveries** — 5 supplier delivery records
- [x] **Waste entries** — 1 waste entry (mapped `'Rusak'` → `'Spoiled'`)
- [x] **System logs** — 10 log entries
- [x] **App settings** — 4 settings (store_name, store_address, tax_rate, currency)

### Not yet seeded (complex FK chains, may need per-request IDs)

- [ ] Purchase Requisitions + items
- [ ] Purchase Orders + items
- [ ] Delivery Notes + items
- [ ] SCM Invoices + items
- [ ] Operational Expenses
- [ ] Stock Opnames + items
- [ ] Manual Revenues + brand breakdowns
- [ ] Channel Revenues
- [ ] Period Logs + balances
- [ ] Yield Conversions

### How to use

Send a `POST` to `/api/setup`. The endpoint is idempotent — running it multiple times skips already-inserted records.
