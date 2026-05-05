# Omoiyari POS — Drizzle Schema Migration Plan

> **Target:** PostgreSQL via `drizzle-orm` v0.45.2 + `drizzle-kit` v0.31.10  
> **Driver:** `node-postgres` (`pg`)  
> **Source of truth:** Prototype in `../omoiyari_pos/src/App.tsx`, `../omoiyari_pos/src/types.ts`, `../omoiyari_pos/src/constants.ts`  
> **Output file:** `src/db/schema.ts` (replaces the current `todos` placeholder)  
> **Migration output:** `./drizzle`

---

## 1. Conventions

| Convention   | Value                                                                                                | Rationale                                                                                                                                         |
| ------------ | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Primary keys | `uuid('id').defaultRandom().primaryKey()`                                                            | Prototype used semantic string IDs (`br-sub-01`, `rec-01`). In the DB we use UUIDs and add a human-readable `code` or `slug` column where needed. |
| Foreign keys | `uuid('xxx_id').references(() => table.id)`                                                          | Standard relational shape.                                                                                                                        |
| Timestamps   | `timestamp('created_at', { mode: 'date' }).defaultNow().notNull()`                                   | Consistent audit trail.                                                                                                                           |
| Soft deletes | **No** — use `status` enum fields (e.g., `Void`, `Cancelled`, `Inactive`).                           | Matches prototype behaviour.                                                                                                                      |
| Currency     | `integer` (store rupiah in **whole rupiah**, not cents). The prototype stores `35000` for Rp 35,000. | Avoid floating-point math.                                                                                                                        |
| Quantities   | `integer` (grams, ml, pcs, etc.)                                                                     | Prototype tracks stock in smallest discrete unit.                                                                                                 |
| Enums        | `pgEnum(...)` from `drizzle-orm/pg-core`                                                             | Native PostgreSQL enums.                                                                                                                          |

---

## 2. Enums

Create these **before** the tables that use them.

```ts
// src/db/schema.ts
import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  pgEnum,
  numeric,
  index,
  unique,
} from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", [
  "super_admin",
  "admin_pusat",
  "area_manager",
  "branch_admin",
  "central_kitchen",
]);

export const branchTypeEnum = pgEnum("branch_type", ["Central", "Outlet"]);

export const ingredientCategoryEnum = pgEnum("ingredient_category", ["Fresh", "Dry", "Packaging"]);

export const skuTypeEnum = pgEnum("sku_type", ["RM", "SFG", "FG"]);

export const recipeCategoryEnum = pgEnum("recipe_category", [
  "makanan",
  "minuman",
  "snack",
  "add_ons",
]);

export const orderChannelEnum = pgEnum("order_channel", [
  "Gofood",
  "Grabfood",
  "ShopeeFood",
  "Dine-in",
]);

export const orderStatusEnum = pgEnum("order_status", [
  "New",
  "Processing",
  "In Delivery",
  "Completed",
  "Void",
  "Cancel Requested",
]);

export const shiftStatusEnum = pgEnum("shift_status", ["Open", "Closed"]);

export const stockLedgerTypeEnum = pgEnum("stock_ledger_type", ["IN", "OUT"]);

export const wasteCategoryEnum = pgEnum("waste_category", ["Rusak", "Jatah Makan Karyawan"]);

export const stockOpnameStatusEnum = pgEnum("stock_opname_status", [
  "Submitted",
  "Approved",
  "Under Investigation",
]);

export const stockTransferStatusEnum = pgEnum("stock_transfer_status", [
  "Pending",
  "Pending Approval",
  "Approved",
  "Rejected",
  "In Transit",
  "Completed",
  "Cancelled",
]);

export const prStatusEnum = pgEnum("pr_status", [
  "Draft",
  "Pending",
  "Approved",
  "Processed",
  "Rejected",
  "Fulfilled",
]);

export const deliveryNoteStatusEnum = pgEnum("delivery_note_status", [
  "Draft",
  "Picking",
  "In Transit",
  "Received",
  "Cancelled",
]);

export const scmInvoiceStatusEnum = pgEnum("scm_invoice_status", ["Unpaid", "Paid", "Cancelled"]);

export const supplierDeliveryStatusEnum = pgEnum("supplier_delivery_status", [
  "Pending Invoice",
  "Completed",
]);

export const periodStatusEnum = pgEnum("period_status", ["Open", "Closed"]);

export const voucherDiscountTypeEnum = pgEnum("voucher_discount_type", ["percentage", "fixed"]);

export const ingredientStatusEnum = pgEnum("ingredient_status", ["Active", "Inactive"]);

export const logStatusEnum = pgEnum("log_status", ["Success", "Warning", "Error"]);
```

---

## 3. Core Master Data Tables

### 3.1 `users`

Replaces the prototype `User` / `UserProfile` types.

```ts
export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  role: userRoleEnum("role").notNull(),
  passwordHash: text("password_hash"), // for email login
  pin: text("pin"), // 4-digit PIN login
  status: text("status").notNull().default("Active"), // 'Active' | 'Inactive'
  branchId: uuid("branch_id").references(() => branches.id),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});
```

**Relations notes:**

- `branchId` is optional. Used for `branch_admin` and `central_kitchen`.
- Area managers do NOT use `branchId`; their branch assignments go in `areaManagerBranches` (see §3.10).

### 3.2 `branches`

```ts
export const branches = pgTable("branches", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: text("code").notNull().unique(), // e.g. 'br-sub-01', 'br-central'
  name: text("name").notNull(),
  location: text("location").notNull(),
  active: boolean("active").notNull().default(true),
  isOnline: boolean("is_online").notNull().default(true),
  type: branchTypeEnum("type").notNull().default("Outlet"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});
```

### 3.3 `brands`

```ts
export const brands = pgTable("brands", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: text("code").notNull().unique(), // e.g. 'brand-1'
  name: text("name").notNull(),
  logo: text("logo"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});
```

### 3.4 `platform_fees`

Reference table for MDR / commission rates per channel.

```ts
export const platformFees = pgTable("platform_fees", {
  id: uuid("id").defaultRandom().primaryKey(),
  channel: orderChannelEnum("channel").notNull().unique(), // Gofood, Grabfood, etc.
  feePercentage: integer("fee_percentage").notNull(), // e.g. 20 means 20%
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});
```

### 3.5 `ingredients`

Replaces the prototype `Ingredient` type.

```ts
export const ingredients = pgTable("ingredients", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: text("code").notNull().unique(), // e.g. 'ing-01', 'ing-sfg-01'
  name: text("name").notNull(),
  category: ingredientCategoryEnum("category").notNull(), // Fresh | Dry | Packaging
  skuType: skuTypeEnum("sku_type").notNull(), // RM | SFG | FG
  purchaseUnit: text("purchase_unit").notNull(), // e.g. 'Karung 25kg'
  stockUnit: text("stock_unit").notNull(), // e.g. 'Gram'
  conversionFactor: integer("conversion_factor").notNull(), // e.g. 25000
  averageCost: integer("average_cost").notNull(), // in rupiah
  plannedCost: integer("planned_cost"), // in rupiah
  rop: integer("rop").notNull().default(0), // Reorder Point
  moq: integer("moq").notNull().default(1), // Minimum Order Qty
  status: ingredientStatusEnum("status").notNull().default("Active"),
  countable: boolean("countable").notNull().default(true), // SO eligibility
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});
```

### 3.6 `recipes`

Replaces the prototype `Recipe` type. A recipe = a menu item or sub-recipe.

```ts
export const recipes = pgTable("recipes", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: text("code").notNull().unique(), // e.g. 'rec-01'
  name: text("name").notNull(),
  category: recipeCategoryEnum("category").notNull().default("makanan"),
  isSubRecipe: boolean("is_sub_recipe").notNull().default(false),
  basePrice: integer("base_price").notNull(), // in rupiah
  isBOGO: boolean("is_bogo").notNull().default(false),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});
```

**Why no brandId here?** A recipe can belong to **multiple** brands (`brandIds` in prototype). Use `recipeBrands` junction table (§3.7).

### 3.7 `recipe_brands`

Many-to-many junction.

```ts
export const recipeBrands = pgTable(
  "recipe_brands",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    recipeId: uuid("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
  },
  (t) => [unique("recipe_brand_unique").on(t.recipeId, t.brandId)],
);
```

### 3.8 `recipe_ingredients`

BOM (Bill of Materials) for a recipe.

```ts
export const recipeIngredients = pgTable("recipe_ingredients", {
  id: uuid("id").defaultRandom().primaryKey(),
  recipeId: uuid("recipe_id")
    .notNull()
    .references(() => recipes.id, { onDelete: "cascade" }),
  ingredientId: uuid("ingredient_id")
    .notNull()
    .references(() => ingredients.id),
  quantity: integer("quantity").notNull(), // in ingredient.stockUnit
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});
```

### 3.9 `recipe_child_recipes`

For bundles and BOGO: a recipe can contain other recipes (e.g. Family Pack).

```ts
export const recipeChildRecipes = pgTable(
  "recipe_child_recipes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    parentRecipeId: uuid("parent_recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    childRecipeId: uuid("child_recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    quantity: integer("quantity").notNull(),
  },
  (t) => [unique("recipe_child_unique").on(t.parentRecipeId, t.childRecipeId)],
);
```

### 3.10 `area_manager_branches`

Area managers are assigned to many branches.

```ts
export const areaManagerBranches = pgTable(
  "area_manager_branches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
  },
  (t) => [unique("area_manager_branch_unique").on(t.userId, t.branchId)],
);
```

---

## 4. Modifier System

### 4.1 `modifier_groups`

```ts
export const modifierGroups = pgTable("modifier_groups", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: text("code").notNull().unique(), // e.g. 'mg-01'
  name: text("name").notNull(),
  minSelection: integer("min_selection").notNull().default(0),
  maxSelection: integer("max_selection").notNull().default(1),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});
```

### 4.2 `recipe_modifier_groups`

Which modifier groups are attached to which recipe.

```ts
export const recipeModifierGroups = pgTable(
  "recipe_modifier_groups",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    recipeId: uuid("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    modifierGroupId: uuid("modifier_group_id")
      .notNull()
      .references(() => modifierGroups.id, { onDelete: "cascade" }),
  },
  (t) => [unique("recipe_modifier_group_unique").on(t.recipeId, t.modifierGroupId)],
);
```

### 4.3 `modifiers`

Individual choices inside a modifier group.

```ts
export const modifiers = pgTable("modifiers", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: text("code").notNull().unique(), // e.g. 'mod-01'
  modifierGroupId: uuid("modifier_group_id")
    .notNull()
    .references(() => modifierGroups.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  price: integer("price").notNull().default(0), // in rupiah
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});
```

### 4.4 `modifier_ingredients`

Some modifiers consume ingredients (e.g. "Extra Telur Mata Sapi"). The empty-array case in the prototype means "no stock impact".

```ts
export const modifierIngredients = pgTable(
  "modifier_ingredients",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    modifierId: uuid("modifier_id")
      .notNull()
      .references(() => modifiers.id, { onDelete: "cascade" }),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => ingredients.id),
    quantity: integer("quantity").notNull(),
  },
  (t) => [unique("modifier_ingredient_unique").on(t.modifierId, t.ingredientId)],
);
```

---

## 5. Orders & POS

### 5.1 `orders`

```ts
export const orders = pgTable(
  "orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id),
    channel: orderChannelEnum("channel").notNull(),
    subtotal: integer("subtotal").notNull(),
    merchantDiscount: integer("merchant_discount").notNull().default(0),
    platformDiscount: integer("platform_discount").notNull().default(0),
    taxAmount: integer("tax_amount").notNull().default(0),
    totalAmount: integer("total_amount").notNull(),
    totalCogs: integer("total_cogs").notNull().default(0),
    mdrFee: integer("mdr_fee").notNull().default(0),
    netSales: integer("net_sales").notNull().default(0),
    orderCode: text("order_code"), // kode ojol / customer name for Dine-in
    voucherCode: text("voucher_code"),
    voucherDiscount: integer("voucher_discount"),
    status: orderStatusEnum("status").notNull().default("New"),
    voidReason: text("void_reason"),
    shiftId: uuid("shift_id").references(() => shifts.id),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { mode: "date" }),
  },
  (t) => [
    index("order_branch_idx").on(t.branchId),
    index("order_status_idx").on(t.status),
    index("order_created_idx").on(t.createdAt),
    index("order_shift_idx").on(t.shiftId),
  ],
);
```

### 5.2 `order_items`

```ts
export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    recipeId: uuid("recipe_id")
      .notNull()
      .references(() => recipes.id),
    quantity: integer("quantity").notNull(),
    price: integer("price").notNull(), // unit price at transaction time
    cogsAtTransaction: integer("cogs_at_transaction").notNull().default(0),
    notes: text("notes"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [index("order_item_order_idx").on(t.orderId)],
);
```

### 5.3 `order_item_modifiers`

Modifiers selected for a specific order item.

```ts
export const orderItemModifiers = pgTable(
  "order_item_modifiers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderItemId: uuid("order_item_id")
      .notNull()
      .references(() => orderItems.id, { onDelete: "cascade" }),
    modifierGroupId: uuid("modifier_group_id")
      .notNull()
      .references(() => modifierGroups.id),
    modifierId: uuid("modifier_id")
      .notNull()
      .references(() => modifiers.id),
    cogsAtTransaction: integer("cogs_at_transaction").notNull().default(0),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [index("oim_item_idx").on(t.orderItemId)],
);
```

---

## 6. Shifts

```ts
export const shifts = pgTable(
  "shifts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    startTime: timestamp("start_time", { mode: "date" }).notNull(),
    endTime: timestamp("end_time", { mode: "date" }),
    cashFloat: integer("cash_float").notNull(), // Modal awal
    actualCash: integer("actual_cash"), // Uang fisik aktual
    expectedCash: integer("expected_cash"), // Expected from sales
    status: shiftStatusEnum("status").notNull().default("Open"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [
    index("shift_branch_idx").on(t.branchId),
    index("shift_user_idx").on(t.userId),
    index("shift_status_idx").on(t.status),
  ],
);
```

---

## 7. Inventory & Stock Movement

### 7.1 `inventory`

Current stock snapshot per branch × ingredient. No batch/expiry tracking (removed per prototype v2).

```ts
export const inventory = pgTable(
  "inventory",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => ingredients.id),
    quantity: integer("quantity").notNull().default(0),
    lastUpdated: timestamp("last_updated", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [
    unique("inventory_branch_ingredient_unique").on(t.branchId, t.ingredientId),
    index("inventory_branch_idx").on(t.branchId),
    index("inventory_ingredient_idx").on(t.ingredientId),
  ],
);
```

### 7.2 `stock_ledger`

Audit trail of every IN/OUT movement.

```ts
export const stockLedger = pgTable(
  "stock_ledger",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => ingredients.id),
    type: stockLedgerTypeEnum("type").notNull(), // IN | OUT
    quantity: integer("quantity").notNull(),
    balance: integer("balance").notNull(), // running balance after this entry
    reference: text("reference").notNull(), // Order ID, PR ID, SJ ID, Waste ID, etc.
    notes: text("notes"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [
    index("ledger_branch_idx").on(t.branchId),
    index("ledger_ingredient_idx").on(t.ingredientId),
    index("ledger_reference_idx").on(t.reference),
    index("ledger_created_idx").on(t.createdAt),
  ],
);
```

### 7.3 `waste_entries`

```ts
export const wasteEntries = pgTable(
  "waste_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => ingredients.id),
    quantity: integer("quantity").notNull(),
    category: wasteCategoryEnum("category").notNull(),
    notes: text("notes"),
    investigationNote: text("investigation_note"),
    submittedBy: uuid("submitted_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [index("waste_branch_idx").on(t.branchId), index("waste_created_idx").on(t.createdAt)],
);
```

---

## 8. Stock Opname

### 8.1 `stock_opnames`

```ts
export const stockOpnames = pgTable(
  "stock_opnames",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    date: text("date").notNull(), // 'yyyy-MM-dd'
    status: stockOpnameStatusEnum("status").notNull().default("Submitted"),
    submittedBy: uuid("submitted_by")
      .notNull()
      .references(() => users.id),
    approvedBy: uuid("approved_by").references(() => users.id),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [
    index("so_branch_idx").on(t.branchId),
    index("so_date_idx").on(t.date),
    index("so_status_idx").on(t.status),
  ],
);
```

### 8.2 `stock_opname_items`

```ts
export const stockOpnameItems = pgTable(
  "stock_opname_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    stockOpnameId: uuid("stock_opname_id")
      .notNull()
      .references(() => stockOpnames.id, { onDelete: "cascade" }),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => ingredients.id),
    systemStock: integer("system_stock").notNull(),
    physicalStock: integer("physical_stock").notNull(),
    variance: integer("variance").notNull(),
    variancePercentage: numeric("variance_percentage"), // use numeric for decimals
    investigationNote: text("investigation_note"),
  },
  (t) => [index("soi_opname_idx").on(t.stockOpnameId)],
);
```

---

## 9. Inter-Branch Stock Transfer

```ts
export const stockTransfers = pgTable(
  "stock_transfers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    fromBranchId: uuid("from_branch_id")
      .notNull()
      .references(() => branches.id),
    toBranchId: uuid("to_branch_id")
      .notNull()
      .references(() => branches.id),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => ingredients.id),
    quantity: integer("quantity").notNull(),
    status: stockTransferStatusEnum("status").notNull().default("Pending"),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id),
    approvedBy: uuid("approved_by").references(() => users.id),
    rejectionReason: text("rejection_reason"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [
    index("st_from_branch_idx").on(t.fromBranchId),
    index("st_to_branch_idx").on(t.toBranchId),
    index("st_status_idx").on(t.status),
  ],
);
```

---

## 10. Purchase Requisition → Surat Jalan → Invoice Pipeline

### 10.1 `purchase_requisitions`

```ts
export const purchaseRequisitions = pgTable(
  "purchase_requisitions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: text("code").notNull().unique(), // e.g. 'PR-001'
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    status: prStatusEnum("status").notNull().default("Draft"),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id),
    approvedBy: uuid("approved_by").references(() => users.id),
    notes: text("notes"),
    rejectionReason: text("rejection_reason"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [index("pr_branch_idx").on(t.branchId), index("pr_status_idx").on(t.status)],
);
```

### 10.2 `purchase_requisition_items`

```ts
export const purchaseRequisitionItems = pgTable(
  "purchase_requisition_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    purchaseRequisitionId: uuid("purchase_requisition_id")
      .notNull()
      .references(() => purchaseRequisitions.id, { onDelete: "cascade" }),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => ingredients.id),
    quantity: integer("quantity").notNull(),
  },
  (t) => [index("pri_pr_idx").on(t.purchaseRequisitionId)],
);
```

### 10.3 `delivery_notes` (Surat Jalan)

```ts
export const deliveryNotes = pgTable(
  "delivery_notes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: text("code").notNull().unique(), // e.g. 'SJ-001'
    purchaseRequisitionId: uuid("purchase_requisition_id").references(
      () => purchaseRequisitions.id,
    ),
    fromBranchId: uuid("from_branch_id")
      .notNull()
      .references(() => branches.id),
    toBranchId: uuid("to_branch_id")
      .notNull()
      .references(() => branches.id),
    status: deliveryNoteStatusEnum("status").notNull().default("Draft"),
    driverName: text("driver_name"),
    vehicleNumber: text("vehicle_number"),
    pickedBy: uuid("picked_by").references(() => users.id),
    deliveredBy: uuid("delivered_by").references(() => users.id),
    receivedBy: uuid("received_by").references(() => users.id),
    reviewedByAdminPusat: boolean("reviewed_by_admin_pusat").notNull().default(false),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
    receivedAt: timestamp("received_at", { mode: "date" }),
  },
  (t) => [
    index("dn_from_branch_idx").on(t.fromBranchId),
    index("dn_to_branch_idx").on(t.toBranchId),
    index("dn_pr_idx").on(t.purchaseRequisitionId),
    index("dn_status_idx").on(t.status),
  ],
);
```

### 10.4 `delivery_note_items`

```ts
export const deliveryNoteItems = pgTable(
  "delivery_note_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    deliveryNoteId: uuid("delivery_note_id")
      .notNull()
      .references(() => deliveryNotes.id, { onDelete: "cascade" }),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => ingredients.id),
    quantity: integer("quantity").notNull(),
    pickedQuantity: integer("picked_quantity"),
    receivedQuantity: integer("received_quantity"),
    discrepancyNote: text("discrepancy_note"),
  },
  (t) => [index("dni_dn_idx").on(t.deliveryNoteId)],
);
```

### 10.5 `scm_invoices`

```ts
export const scmInvoices = pgTable(
  "scm_invoices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: text("code").notNull().unique(), // e.g. 'INV-001'
    deliveryNoteId: uuid("delivery_note_id")
      .notNull()
      .references(() => deliveryNotes.id),
    fromBranchId: uuid("from_branch_id")
      .notNull()
      .references(() => branches.id),
    toBranchId: uuid("to_branch_id")
      .notNull()
      .references(() => branches.id),
    totalAmount: integer("total_amount").notNull(),
    status: scmInvoiceStatusEnum("status").notNull().default("Unpaid"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    dueDate: timestamp("due_date", { mode: "date" }).notNull(),
    paidAt: timestamp("paid_at", { mode: "date" }),
  },
  (t) => [index("inv_dn_idx").on(t.deliveryNoteId), index("inv_status_idx").on(t.status)],
);
```

### 10.6 `scm_invoice_items`

```ts
export const scmInvoiceItems = pgTable(
  "scm_invoice_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scmInvoiceId: uuid("scm_invoice_id")
      .notNull()
      .references(() => scmInvoices.id, { onDelete: "cascade" }),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => ingredients.id),
    quantity: integer("quantity").notNull(),
    unitPrice: integer("unit_price").notNull(),
    totalPrice: integer("total_price").notNull(),
  },
  (t) => [index("sii_invoice_idx").on(t.scmInvoiceId)],
);
```

---

## 11. Supplier Deliveries (External Supplier Receipts)

```ts
export const supplierDeliveries = pgTable(
  "supplier_deliveries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    supplierName: text("supplier_name").notNull(),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => ingredients.id),
    quantity: integer("quantity").notNull(),
    price: integer("price").notNull(), // total price in rupiah
    deliveryDate: timestamp("delivery_date", { mode: "date" }).notNull(),
    receivedBy: uuid("received_by")
      .notNull()
      .references(() => users.id),
    status: supplierDeliveryStatusEnum("status").notNull().default("Pending Invoice"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [index("sd_ingredient_idx").on(t.ingredientId), index("sd_date_idx").on(t.deliveryDate)],
);
```

---

## 12. Accounting Periods

### 12.1 `period_logs`

```ts
export const periodLogs = pgTable(
  "period_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    periodName: text("period_name").notNull(), // e.g. "April 2026"
    status: periodStatusEnum("status").notNull(),
    openedAt: timestamp("opened_at", { mode: "date" }).notNull(),
    closedAt: timestamp("closed_at", { mode: "date" }),
    openedBy: uuid("opened_by")
      .notNull()
      .references(() => users.id),
    closedBy: uuid("closed_by").references(() => users.id),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [unique("period_name_unique").on(t.periodName), index("period_status_idx").on(t.status)],
);
```

### 12.2 `period_balances`

Opening and closing balances per period × branch × ingredient.

```ts
export const periodBalances = pgTable(
  "period_balances",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    periodLogId: uuid("period_log_id")
      .notNull()
      .references(() => periodLogs.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => ingredients.id),
    balanceType: text("balance_type").notNull(), // 'opening' | 'closing'
    quantity: integer("quantity").notNull(),
  },
  (t) => [
    unique("period_balance_unique").on(t.periodLogId, t.branchId, t.ingredientId, t.balanceType),
    index("pb_period_idx").on(t.periodLogId),
  ],
);
```

---

## 13. Yield Tracking (Central Kitchen)

```ts
export const yieldConversions = pgTable(
  "yield_conversions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    sourceIngredientId: uuid("source_ingredient_id")
      .notNull()
      .references(() => ingredients.id),
    sourceQuantity: integer("source_quantity").notNull(),
    targetIngredientId: uuid("target_ingredient_id")
      .notNull()
      .references(() => ingredients.id),
    targetQuantity: integer("target_quantity").notNull(),
    yieldPercentage: numeric("yield_percentage").notNull(),
    shrinkageQuantity: integer("shrinkage_quantity").notNull().default(0),
    notes: text("notes"),
    processedBy: uuid("processed_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [
    index("yc_branch_idx").on(t.branchId),
    index("yc_source_idx").on(t.sourceIngredientId),
    index("yc_target_idx").on(t.targetIngredientId),
  ],
);
```

---

## 14. Vouchers

```ts
export const vouchers = pgTable(
  "vouchers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: text("code").notNull().unique(),
    description: text("description").notNull(),
    discountType: voucherDiscountTypeEnum("discount_type").notNull(),
    discountValue: integer("discount_value").notNull(), // % or fixed rupiah
    minOrder: integer("min_order").notNull().default(0),
    validUntil: timestamp("valid_until", { mode: "date" }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [index("voucher_code_idx").on(t.code), index("voucher_active_idx").on(t.isActive)],
);
```

---

## 15. Manual Revenue Entry

### 15.1 `manual_revenues`

For branches to report offline/Dine-in revenue that did not flow through the POS order system.

```ts
export const manualRevenues = pgTable(
  "manual_revenues",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    date: text("date").notNull(), // 'yyyy-MM-dd'
    amount: integer("amount").notNull(), // total rupiah
    notes: text("notes"),
    submittedBy: uuid("submitted_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [index("mr_branch_idx").on(t.branchId), index("mr_date_idx").on(t.date)],
);
```

### 15.2 `manual_revenue_brand_breakdowns`

Because a manual revenue entry can be split across brands.

```ts
export const manualRevenueBrandBreakdowns = pgTable(
  "manual_revenue_brand_breakdowns",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    manualRevenueId: uuid("manual_revenue_id")
      .notNull()
      .references(() => manualRevenues.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id),
    amount: integer("amount").notNull(),
  },
  (t) => [unique("mr_brand_unique").on(t.manualRevenueId, t.brandId)],
);
```

---

## 16. System Logs / Audit Trail

```ts
export const systemLogs = pgTable(
  "system_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    action: text("action").notNull(),
    detail: text("detail").notNull(),
    userId: uuid("user_id").references(() => users.id),
    userName: text("user_name"), // denormalized for traceability
    status: logStatusEnum("status").notNull().default("Success"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [
    index("log_action_idx").on(t.action),
    index("log_user_idx").on(t.userId),
    index("log_created_idx").on(t.createdAt),
  ],
);
```

---

## 17. Drizzle Relations (Type-safe helpers)

Add a `relations` block at the bottom of `schema.ts` so Drizzle's query builder works.

```ts
import { relations } from "drizzle-orm";

export const usersRelations = relations(users, ({ many, one }) => ({
  branch: one(branches, { fields: [users.branchId], references: [branches.id] }),
  areaManagerBranches: many(areaManagerBranches),
  shifts: many(shifts),
  stockOpnamesSubmitted: many(stockOpnames, { relationName: "submittedBy" }),
  stockOpnamesApproved: many(stockOpnames, { relationName: "approvedBy" }),
  wasteEntries: many(wasteEntries),
  manualRevenues: many(manualRevenues),
  systemLogs: many(systemLogs),
}));

export const branchesRelations = relations(branches, ({ many }) => ({
  users: many(users),
  orders: many(orders),
  inventory: many(inventory),
  stockLedger: many(stockLedger),
  wasteEntries: many(wasteEntries),
  stockOpnames: many(stockOpnames),
  stockTransfersFrom: many(stockTransfers, { relationName: "fromBranch" }),
  stockTransfersTo: many(stockTransfers, { relationName: "toBranch" }),
  purchaseRequisitions: many(purchaseRequisitions),
  deliveryNotesFrom: many(deliveryNotes, { relationName: "fromBranch" }),
  deliveryNotesTo: many(deliveryNotes, { relationName: "toBranch" }),
  scmInvoicesFrom: many(scmInvoices, { relationName: "fromBranch" }),
  scmInvoicesTo: many(scmInvoices, { relationName: "toBranch" }),
  yieldConversions: many(yieldConversions),
  manualRevenues: many(manualRevenues),
  shifts: many(shifts),
}));

export const brandsRelations = relations(brands, ({ many }) => ({
  recipeBrands: many(recipeBrands),
  orders: many(orders),
  manualRevenueBreakdowns: many(manualRevenueBrandBreakdowns),
}));

export const ingredientsRelations = relations(ingredients, ({ many }) => ({
  recipeIngredients: many(recipeIngredients),
  modifierIngredients: many(modifierIngredients),
  inventory: many(inventory),
  stockLedger: many(stockLedger),
  wasteEntries: many(wasteEntries),
  stockOpnameItems: many(stockOpnameItems),
  stockTransfers: many(stockTransfers),
  purchaseRequisitionItems: many(purchaseRequisitionItems),
  deliveryNoteItems: many(deliveryNoteItems),
  scmInvoiceItems: many(scmInvoiceItems),
  yieldConversionsSource: many(yieldConversions, { relationName: "source" }),
  yieldConversionsTarget: many(yieldConversions, { relationName: "target" }),
  supplierDeliveries: many(supplierDeliveries),
}));

export const recipesRelations = relations(recipes, ({ many }) => ({
  recipeBrands: many(recipeBrands),
  recipeIngredients: many(recipeIngredients),
  recipeChildRecipesParent: many(recipeChildRecipes, { relationName: "parent" }),
  recipeChildRecipesChild: many(recipeChildRecipes, { relationName: "child" }),
  recipeModifierGroups: many(recipeModifierGroups),
  orderItems: many(orderItems),
}));

export const modifierGroupsRelations = relations(modifierGroups, ({ many }) => ({
  modifiers: many(modifiers),
  recipeModifierGroups: many(recipeModifierGroups),
  orderItemModifiers: many(orderItemModifiers),
}));

export const modifiersRelations = relations(modifiers, ({ one, many }) => ({
  modifierGroup: one(modifierGroups, {
    fields: [modifiers.modifierGroupId],
    references: [modifierGroups.id],
  }),
  modifierIngredients: many(modifierIngredients),
  orderItemModifiers: many(orderItemModifiers),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  branch: one(branches, { fields: [orders.branchId], references: [branches.id] }),
  brand: one(brands, { fields: [orders.brandId], references: [brands.id] }),
  shift: one(shifts, { fields: [orders.shiftId], references: [shifts.id] }),
  orderItems: many(orderItems),
}));

export const orderItemsRelations = relations(orderItems, ({ one, many }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  recipe: one(recipes, { fields: [orderItems.recipeId], references: [recipes.id] }),
  orderItemModifiers: many(orderItemModifiers),
}));

export const orderItemModifiersRelations = relations(orderItemModifiers, ({ one }) => ({
  orderItem: one(orderItems, {
    fields: [orderItemModifiers.orderItemId],
    references: [orderItems.id],
  }),
  modifierGroup: one(modifierGroups, {
    fields: [orderItemModifiers.modifierGroupId],
    references: [modifierGroups.id],
  }),
  modifier: one(modifiers, { fields: [orderItemModifiers.modifierId], references: [modifiers.id] }),
}));

export const shiftsRelations = relations(shifts, ({ one, many }) => ({
  branch: one(branches, { fields: [shifts.branchId], references: [branches.id] }),
  user: one(users, { fields: [shifts.userId], references: [users.id] }),
  orders: many(orders),
}));

export const inventoryRelations = relations(inventory, ({ one }) => ({
  branch: one(branches, { fields: [inventory.branchId], references: [branches.id] }),
  ingredient: one(ingredients, { fields: [inventory.ingredientId], references: [ingredients.id] }),
}));

export const stockLedgerRelations = relations(stockLedger, ({ one }) => ({
  branch: one(branches, { fields: [stockLedger.branchId], references: [branches.id] }),
  ingredient: one(ingredients, {
    fields: [stockLedger.ingredientId],
    references: [ingredients.id],
  }),
}));

export const stockOpnamesRelations = relations(stockOpnames, ({ one, many }) => ({
  branch: one(branches, { fields: [stockOpnames.branchId], references: [branches.id] }),
  submittedByUser: one(users, { fields: [stockOpnames.submittedBy], references: [users.id] }),
  approvedByUser: one(users, { fields: [stockOpnames.approvedBy], references: [users.id] }),
  items: many(stockOpnameItems),
}));

export const stockOpnameItemsRelations = relations(stockOpnameItems, ({ one }) => ({
  stockOpname: one(stockOpnames, {
    fields: [stockOpnameItems.stockOpnameId],
    references: [stockOpnames.id],
  }),
  ingredient: one(ingredients, {
    fields: [stockOpnameItems.ingredientId],
    references: [ingredients.id],
  }),
}));

export const stockTransfersRelations = relations(stockTransfers, ({ one }) => ({
  fromBranch: one(branches, { fields: [stockTransfers.fromBranchId], references: [branches.id] }),
  toBranch: one(branches, { fields: [stockTransfers.toBranchId], references: [branches.id] }),
  ingredient: one(ingredients, {
    fields: [stockTransfers.ingredientId],
    references: [ingredients.id],
  }),
  requestedByUser: one(users, { fields: [stockTransfers.requestedBy], references: [users.id] }),
  approvedByUser: one(users, { fields: [stockTransfers.approvedBy], references: [users.id] }),
}));

export const purchaseRequisitionsRelations = relations(purchaseRequisitions, ({ one, many }) => ({
  branch: one(branches, { fields: [purchaseRequisitions.branchId], references: [branches.id] }),
  requestedByUser: one(users, {
    fields: [purchaseRequisitions.requestedBy],
    references: [users.id],
  }),
  approvedByUser: one(users, { fields: [purchaseRequisitions.approvedBy], references: [users.id] }),
  items: many(purchaseRequisitionItems),
  deliveryNotes: many(deliveryNotes),
}));

export const purchaseRequisitionItemsRelations = relations(purchaseRequisitionItems, ({ one }) => ({
  purchaseRequisition: one(purchaseRequisitions, {
    fields: [purchaseRequisitionItems.purchaseRequisitionId],
    references: [purchaseRequisitions.id],
  }),
  ingredient: one(ingredients, {
    fields: [purchaseRequisitionItems.ingredientId],
    references: [ingredients.id],
  }),
}));

export const deliveryNotesRelations = relations(deliveryNotes, ({ one, many }) => ({
  purchaseRequisition: one(purchaseRequisitions, {
    fields: [deliveryNotes.purchaseRequisitionId],
    references: [purchaseRequisitions.id],
  }),
  fromBranch: one(branches, { fields: [deliveryNotes.fromBranchId], references: [branches.id] }),
  toBranch: one(branches, { fields: [deliveryNotes.toBranchId], references: [branches.id] }),
  items: many(deliveryNoteItems),
  scmInvoices: many(scmInvoices),
}));

export const deliveryNoteItemsRelations = relations(deliveryNoteItems, ({ one }) => ({
  deliveryNote: one(deliveryNotes, {
    fields: [deliveryNoteItems.deliveryNoteId],
    references: [deliveryNotes.id],
  }),
  ingredient: one(ingredients, {
    fields: [deliveryNoteItems.ingredientId],
    references: [ingredients.id],
  }),
}));

export const scmInvoicesRelations = relations(scmInvoices, ({ one, many }) => ({
  deliveryNote: one(deliveryNotes, {
    fields: [scmInvoices.deliveryNoteId],
    references: [deliveryNotes.id],
  }),
  fromBranch: one(branches, { fields: [scmInvoices.fromBranchId], references: [branches.id] }),
  toBranch: one(branches, { fields: [scmInvoices.toBranchId], references: [branches.id] }),
  items: many(scmInvoiceItems),
}));

export const scmInvoiceItemsRelations = relations(scmInvoiceItems, ({ one }) => ({
  scmInvoice: one(scmInvoices, {
    fields: [scmInvoiceItems.scmInvoiceId],
    references: [scmInvoices.id],
  }),
  ingredient: one(ingredients, {
    fields: [scmInvoiceItems.ingredientId],
    references: [ingredients.id],
  }),
}));

export const yieldConversionsRelations = relations(yieldConversions, ({ one }) => ({
  branch: one(branches, { fields: [yieldConversions.branchId], references: [branches.id] }),
  sourceIngredient: one(ingredients, {
    fields: [yieldConversions.sourceIngredientId],
    references: [ingredients.id],
  }),
  targetIngredient: one(ingredients, {
    fields: [yieldConversions.targetIngredientId],
    references: [ingredients.id],
  }),
  processedByUser: one(users, { fields: [yieldConversions.processedBy], references: [users.id] }),
}));

export const manualRevenuesRelations = relations(manualRevenues, ({ one, many }) => ({
  branch: one(branches, { fields: [manualRevenues.branchId], references: [branches.id] }),
  submittedByUser: one(users, { fields: [manualRevenues.submittedBy], references: [users.id] }),
  brandBreakdowns: many(manualRevenueBrandBreakdowns),
}));

export const manualRevenueBrandBreakdownsRelations = relations(
  manualRevenueBrandBreakdowns,
  ({ one }) => ({
    manualRevenue: one(manualRevenues, {
      fields: [manualRevenueBrandBreakdowns.manualRevenueId],
      references: [manualRevenues.id],
    }),
    brand: one(brands, { fields: [manualRevenueBrandBreakdowns.brandId], references: [brands.id] }),
  }),
);

export const supplierDeliveriesRelations = relations(supplierDeliveries, ({ one }) => ({
  ingredient: one(ingredients, {
    fields: [supplierDeliveries.ingredientId],
    references: [ingredients.id],
  }),
  receivedByUser: one(users, { fields: [supplierDeliveries.receivedBy], references: [users.id] }),
}));

export const periodLogsRelations = relations(periodLogs, ({ one, many }) => ({
  openedByUser: one(users, { fields: [periodLogs.openedBy], references: [users.id] }),
  closedByUser: one(users, { fields: [periodLogs.closedBy], references: [users.id] }),
  balances: many(periodBalances),
}));

export const periodBalancesRelations = relations(periodBalances, ({ one }) => ({
  periodLog: one(periodLogs, { fields: [periodBalances.periodLogId], references: [periodLogs.id] }),
  branch: one(branches, { fields: [periodBalances.branchId], references: [branches.id] }),
  ingredient: one(ingredients, {
    fields: [periodBalances.ingredientId],
    references: [ingredients.id],
  }),
}));

export const vouchersRelations = relations(vouchers, ({ one }) => ({
  createdByUser: one(users, { fields: [vouchers.createdBy], references: [users.id] }),
}));

export const systemLogsRelations = relations(systemLogs, ({ one }) => ({
  user: one(users, { fields: [systemLogs.userId], references: [users.id] }),
}));
```

---

## 18. Execution Steps for the Implementing Agent

1. **Backup** the existing `src/db/schema.ts` (it only contains a `todos` placeholder).
2. **Replace** `src/db/schema.ts` with the complete schema above.
3. **Ensure `DATABASE_URL`** is set in `.env.local`.
4. **Install dependencies** if missing: `vp install` (should already have `drizzle-orm`, `drizzle-kit`, `pg`).
5. **Generate the migration:**
   ```bash
   vp run db:generate
   ```
   Or if forwarding to drizzle-kit directly:
   ```bash
   npx drizzle-kit generate
   ```
6. **Review the generated SQL** in `./drizzle/` to confirm:
   - All enums are created before tables.
   - Foreign keys have appropriate `ON DELETE` rules.
   - Indexes are present.
7. **Apply the migration:**
   ```bash
   vp run db:migrate
   ```
8. **Verify in Drizzle Studio:**
   ```bash
   vp run db:studio
   ```

---

## 19. Data Migration Notes (Prototype → PostgreSQL)

The prototype stores everything in `localStorage`. If you need to seed the new DB with existing prototype data:

- **IDs:** The prototype uses semantic string IDs (`br-sub-01`, `ing-01`, `rec-01`, etc.). When migrating, map these to the new UUIDs and store the old value in the `code` column.
- **Dates:** Prototype uses JS `Date` objects serialized to ISO strings. Drizzle with `{ mode: 'date' }` handles this natively.
- **Inventory:** The prototype computes inventory IDs as `${branchId}_${ingredientId}`. In the DB this is a proper table with a `unique('inventory_branch_ingredient_unique')` constraint.
- **Stock Ledger `balance`:** This is a **denormalized running total**. When seeding, ensure each ledger row's `balance` field correctly reflects the cumulative quantity after that movement.
- **Orders:** Preserve `cogsAtTransaction` and `cogsAtTransaction` on modifiers — these are snapshots at the time of sale and must not be recalculated from current ingredient costs.
- **Recipe channel-specific prices** (`goFoodPrice`, `grabFoodPrice`, `shopeeFoodPrice`) were **removed** in the newer prototype version. Do not add columns for them. All channels now use `basePrice`.
- **Waste categories** were normalized to only two values: `'Rusak'` and `'Jatah Makan Karyawan'`. The enum reflects this.
- **Stock Opname status** was normalized to `'Submitted' | 'Approved' | 'Under Investigation'` (rejected/draft removed).

---

## 20. Feature → Table Coverage Checklist

| Feature                                    | Table(s)                                                                         |
| ------------------------------------------ | -------------------------------------------------------------------------------- |
| Multi-role auth & branch assignment        | `users`, `area_manager_branches`                                                 |
| Branch / Outlet / Central Warehouse mgmt   | `branches`                                                                       |
| Brand mgmt                                 | `brands`, `recipe_brands`                                                        |
| Platform fee / MDR config                  | `platform_fees`                                                                  |
| Ingredient / Bahan Baku master             | `ingredients`                                                                    |
| Recipe / Menu master & BOM                 | `recipes`, `recipe_ingredients`, `recipe_child_recipes`                          |
| Modifier groups & options                  | `modifier_groups`, `modifiers`, `modifier_ingredients`, `recipe_modifier_groups` |
| POS Order entry                            | `orders`, `order_items`, `order_item_modifiers`                                  |
| Vouchers / Promo codes                     | `vouchers`                                                                       |
| Shift management (modal awal & cash recon) | `shifts`                                                                         |
| Real-time inventory (no batch/expiry)      | `inventory`                                                                      |
| Stock movement audit trail                 | `stock_ledger`                                                                   |
| Waste & shrinkage tracking                 | `waste_entries`                                                                  |
| Stock Opname (blind & see-through)         | `stock_opnames`, `stock_opname_items`                                            |
| Inter-branch stock transfer                | `stock_transfers`                                                                |
| Purchase Requisition (PR)                  | `purchase_requisitions`, `purchase_requisition_items`                            |
| Surat Jalan (Delivery Note)                | `delivery_notes`, `delivery_note_items`                                          |
| SCM Invoice                                | `scm_invoices`, `scm_invoice_items`                                              |
| Supplier delivery receipts                 | `supplier_deliveries`                                                            |
| Accounting period control                  | `period_logs`, `period_balances`                                                 |
| Yield conversion (central kitchen)         | `yield_conversions`                                                              |
| Manual revenue entry (offline sales)       | `manual_revenues`, `manual_revenue_brand_breakdowns`                             |
| Audit trail / system logs                  | `system_logs`                                                                    |

---

_End of plan._
