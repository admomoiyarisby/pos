# Omoiyari POS — Drizzle Schema Migration Plan (FRD-Aligned v1.4)

> **Target:** PostgreSQL via `drizzle-orm` v0.45.2 + `drizzle-kit` v0.31.10  
> **Driver:** `node-postgres` (`pg`)  
> **Source of truth:** `plans/Functional Requirement Document.md` (FRD v1.4) + Prototype at `../omoiyari_pos`  
> **Output file:** `src/db/schema.ts` (replaces the current `todos` placeholder)  
> **Migration output:** `./drizzle`

---

## 1. Executive Summary & Conventions

This plan replaces the earlier `plans/drizzle-schema.md`. It is rebuilt from the ground up to align with the FRD v1.4, closing ~40 gaps discovered during the gap-analysis.

### 1.1 Naming Conventions

| Convention   | Value                                                              | Rationale                                                                                                                 |
| ------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Primary keys | `uuid('id').defaultRandom().primaryKey()`                          | Prototype used semantic string IDs (`br-sub-01`). DB uses UUIDs; human-readable codes stored in dedicated `code` columns. |
| Foreign keys | `uuid('xxx_id').references(() => table.id)`                        | Standard relational shape. Use `{ onDelete: 'cascade' }` only on junction/child tables, never on master tables.           |
| Timestamps   | `timestamp('created_at', { mode: 'date' }).defaultNow().notNull()` | Drizzle returns native JS `Date` objects.                                                                                 |
| Currency     | `integer` (whole rupiah)                                           | Prototype stores `35000` for Rp 35,000. Avoids floating-point math.                                                       |
| Quantities   | `integer` (grams, ml, pcs, etc.)                                   | Tracks stock in smallest discrete unit.                                                                                   |
| Percentages  | `integer` (e.g. `20` means 20%)                                    | Stored as whole numbers, divided by 100 in app logic.                                                                     |
| Decimals     | `numeric('col_name')`                                              | Used only for variance % and yield % where precision matters.                                                             |
| Enums        | `pgEnum(...)` from `drizzle-orm/pg-core`                           | Native PostgreSQL enums. Define **before** tables that use them.                                                          |
| Soft deletes | **No**                                                             | Use `status` enum fields (`Inactive`, `Void`, `Cancelled`).                                                               |
| JSONB        | `jsonb('col_name')`                                                | Used for audit old/new values and notification metadata.                                                                  |

### 1.2 Required Imports

```ts
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
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
```

---

## 2. General Structure Analysis

The FRD defines **9 modules**. The schema is organized module-by-module below. Some tables (e.g. `users`, `branches`) are shared across modules and live in **Module 1**.

### Cross-Cutting Changes from Old Plan

| Change                           | Old Plan                                            | New Plan (FRD-aligned)                                                                                   |
| -------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **PO table**                     | Missing entirely                                    | Added `purchase_orders` + `purchase_order_items` between PR and SJ (§4.2)                                |
| **Suppliers master**             | `supplier_deliveries` used free-text `supplierName` | Added `suppliers` master table; `supplier_deliveries` now FKs to it                                      |
| **Brand tracking on orders**     | `orders.brandId` (single brand per order)           | **Removed** `orders.brandId`; **Added** `order_items.brandId` to support Cross-Brand Cart (§3.1.3, §2.6) |
| **Exclusion / minus modifier**   | Not supported                                       | Added `recipe_modifier_exclusions` table so "Tanpa Telur" returns stock (§3.2)                           |
| **Waste categories**             | 2 categories (`Rusak`, `Jatah Makan Karyawan`)      | 3 categories: `Beban Makan`, `Biaya Operasional`, `Spoiled` (§5.2)                                       |
| **Cancel request workflow**      | `voidReason` text on `orders`                       | Formal `cancel_requests` table with 3 reason enums + approval hierarchy (§4.5)                           |
| **Re-print approval**            | Not tracked                                         | `print_requests` table with approval flow (§2.11)                                                        |
| **Session restriction**          | Not tracked                                         | `user_sessions` table to enforce 1 active session per Branch Admin (§2)                                  |
| **Structured audit logs**        | `system_logs` (simple text)                         | Added `audit_logs` with `jsonb` old/new values per FRD §6.2                                              |
| **In-transit virtual warehouse** | Not explicitly modeled                              | `in_transit_inventory` table to track stock between ship and receive (§4.2)                              |
| **Channel revenue input**        | Only `manual_revenues` (offline total)              | Added `channel_revenues` for daily per-channel cash input (§7.1)                                         |
| **Operational expenses**         | Missing                                             | `operational_expenses` table, auto-linked from `Biaya Operasional` waste (§5.2)                          |
| **Shift edit tracking**          | Missing                                             | `shift_edits` table to log who changed what (§4.2)                                                       |
| **Smart reordering**             | Only `rop` and `moq` on ingredients                 | Added `roq` (reorder quantity) field (§5.3)                                                              |
| **Platform fee fixed amount**    | Only percentage                                     | Added `fixedFee` to `platform_fees` for "20% + Rp1,000" (§4.6)                                           |
| **Menu images**                  | Missing                                             | `imageUrl` on `recipes` (§3.1.8)                                                                         |
| **SO trigger audit**             | Missing                                             | `triggeredBy` + `triggeredAt` on `stock_opnames` (§6.1)                                                  |
| **Tax config**                   | Hard-coded                                          | `app_settings` key-value table for dynamic PB1 rate (§2.3)                                               |
| **PIN uniqueness**               | No constraint                                       | Application-enforced + partial unique index note (§3.1.11)                                               |

---

## 3. Module 1 — Master Data

### 3.1 Enums

Define these **before** any table that references them.

```ts
export const userRoleEnum = pgEnum("user_role", [
  "super_admin",
  "admin_pusat",
  "area_manager",
  "branch_admin",
  "central_kitchen",
]);

export const userStatusEnum = pgEnum("user_status", ["Active", "Inactive"]);

export const branchTypeEnum = pgEnum("branch_type", ["Central", "Outlet"]);

export const ingredientCategoryEnum = pgEnum("ingredient_category", ["Fresh", "Dry", "Packaging"]);

export const skuTypeEnum = pgEnum("sku_type", ["RM", "SFG", "FG"]);

export const ingredientStatusEnum = pgEnum("ingredient_status", ["Active", "Inactive"]);

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

export const wasteCategoryEnum = pgEnum("waste_category", [
  "Beban Makan",
  "Biaya Operasional",
  "Spoiled",
]);

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

export const poStatusEnum = pgEnum("po_status", [
  "Draft",
  "Sent",
  "Partial",
  "Completed",
  "Cancelled",
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

export const cancelRequestReasonEnum = pgEnum("cancel_request_reason", [
  "Stok Habis",
  "Salah Input",
  "Customer Cancel",
]);

export const cancelRequestStatusEnum = pgEnum("cancel_request_status", [
  "Pending",
  "Approved",
  "Rejected",
]);

export const printRequestStatusEnum = pgEnum("print_request_status", [
  "Pending",
  "Approved",
  "Rejected",
]);

export const logStatusEnum = pgEnum("log_status", ["Success", "Warning", "Error"]);

export const notificationTypeEnum = pgEnum("notification_type", ["info", "warning", "alert"]);
```

### 3.2 `users`

FRD §2, §3.1.10, §3.1.11.

```ts
export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").notNull().unique(),
    name: text("name").notNull(),
    role: userRoleEnum("role").notNull(),
    passwordHash: text("password_hash"),
    pin: text("pin"), // 4-digit PIN
    status: userStatusEnum("status").notNull().default("Active"),
    branchId: uuid("branch_id").references(() => branches.id),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [
    // PIN must be unique per branch for branch admins.
    // Since branchId is nullable, enforce this at application level for non-null pairs.
    unique("user_pin_branch_unique").on(t.pin, t.branchId),
  ],
);
```

**Notes:**

- `branchId` is nullable. Populated for `branch_admin` and `central_kitchen`.
- Area managers use `area_manager_branches` for multi-branch assignment.
- Super Admin / Admin Pusat have `branchId = null` (global access).

### 3.3 `branches`

FRD §2, §3.

```ts
export const branches = pgTable("branches", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: text("code").notNull().unique(), // e.g. 'br-sub-01'
  name: text("name").notNull(),
  location: text("location").notNull(),
  active: boolean("active").notNull().default(true),
  isOnline: boolean("is_online").notNull().default(true),
  type: branchTypeEnum("type").notNull().default("Outlet"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});
```

### 3.4 `brands`

FRD §3.1.2, §3.1.3.

```ts
export const brands = pgTable("brands", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: text("code").notNull().unique(), // e.g. 'brand-1'
  name: text("name").notNull(),
  logo: text("logo"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});
```

### 3.5 `suppliers`

**New table** — FRD §4.2 (SCM) references suppliers but old plan had no master table.

```ts
export const suppliers = pgTable("suppliers", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  contactPerson: text("contact_person"),
  phone: text("phone"),
  email: text("email"),
  address: text("address"),
  status: text("status").notNull().default("Active"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});
```

### 3.6 `ingredients`

FRD §3.1.4, §3.1.5, §3.1.12, §5.3.

```ts
export const ingredients = pgTable("ingredients", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: text("code").notNull().unique(), // e.g. 'ing-01'
  name: text("name").notNull(),
  category: ingredientCategoryEnum("category").notNull(),
  skuType: skuTypeEnum("sku_type").notNull(),
  purchaseUnit: text("purchase_unit").notNull(),
  stockUnit: text("stock_unit").notNull(),
  conversionFactor: integer("conversion_factor").notNull(),
  averageCost: integer("average_cost").notNull(),
  plannedCost: integer("planned_cost"),
  rop: integer("rop").notNull().default(0), // Reorder Point
  roq: integer("roq").notNull().default(0), // Reorder Quantity (Smart Ordering)
  moq: integer("moq").notNull().default(1), // Minimum Order Qty
  status: ingredientStatusEnum("status").notNull().default("Active"),
  countable: boolean("countable").notNull().default(true),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});
```

**Notes:**

- `roq` is **new** (Smart Reordering formula per FRD §5.3).
- `countable`: SO eligibility (FRD §8.1 General Logic).

### 3.7 `recipes`

FRD §3.1.2, §3.1.5, §3.1.8, §3.1.9, §3.1.12.

```ts
export const recipes = pgTable("recipes", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: text("code").notNull().unique(), // e.g. 'rec-01'
  name: text("name").notNull(),
  description: text("description"),
  imageUrl: text("image_url"),
  category: recipeCategoryEnum("category").notNull().default("makanan"),
  isSubRecipe: boolean("is_sub_recipe").notNull().default(false),
  basePrice: integer("base_price").notNull(),
  isBOGO: boolean("is_bogo").notNull().default(false),
  status: ingredientStatusEnum("status").notNull().default("Active"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});
```

**Notes:**

- `imageUrl` and `description` added per FRD §3.1.8 (Master Menu with image).
- `status` added per FRD §3.1.12 (Active/Inactive toggle to hide from POS).

### 3.8 `recipe_brands`

Many-to-many. FRD §3.1.2.

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

### 3.9 `recipe_ingredients`

BOM. FRD §3.1.5.

```ts
export const recipeIngredients = pgTable("recipe_ingredients", {
  id: uuid("id").defaultRandom().primaryKey(),
  recipeId: uuid("recipe_id")
    .notNull()
    .references(() => recipes.id, { onDelete: "cascade" }),
  ingredientId: uuid("ingredient_id")
    .notNull()
    .references(() => ingredients.id),
  quantity: integer("quantity").notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});
```

### 3.10 `recipe_child_recipes`

Bundle / BOGO parent-child. FRD §2.9.

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

### 3.11 `modifier_groups`

FRD §2.7, §3.2.

```ts
export const modifierGroups = pgTable("modifier_groups", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  minSelection: integer("min_selection").notNull().default(0),
  maxSelection: integer("max_selection").notNull().default(1),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});
```

### 3.12 `recipe_modifier_groups`

Which modifier groups attach to which recipe. FRD §2.7.

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
  (t) => [unique("recipe_mod_group_unique").on(t.recipeId, t.modifierGroupId)],
);
```

### 3.13 `modifiers`

FRD §2.7, §3.2.

```ts
export const modifiers = pgTable("modifiers", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: text("code").notNull().unique(),
  modifierGroupId: uuid("modifier_group_id")
    .notNull()
    .references(() => modifierGroups.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  price: integer("price").notNull().default(0),
  isExclusion: boolean("is_exclusion").notNull().default(false), // NEW — for "Tanpa X" logic
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});
```

### 3.14 `modifier_ingredients`

Add-on modifiers that consume extra stock. FRD §3.1.

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

### 3.15 `recipe_modifier_exclusions`

**New table** — FRD §3.2: Exclusion Logic (Minus Modifier).  
Defines which BOM ingredients are excluded when a specific exclusion modifier is chosen for a specific recipe.

```ts
export const recipeModifierExclusions = pgTable(
  "recipe_modifier_exclusions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    recipeId: uuid("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    modifierId: uuid("modifier_id")
      .notNull()
      .references(() => modifiers.id, { onDelete: "cascade" }),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => ingredients.id),
    quantity: integer("quantity").notNull(), // qty of this ingredient to NOT deduct
  },
  (t) => [unique("recipe_mod_excl_unique").on(t.recipeId, t.modifierId, t.ingredientId)],
);
```

### 3.16 `platform_fees`

FRD §4.6.

```ts
export const platformFees = pgTable("platform_fees", {
  id: uuid("id").defaultRandom().primaryKey(),
  channel: orderChannelEnum("channel").notNull().unique(),
  feePercentage: integer("fee_percentage").notNull().default(0),
  fixedFee: integer("fixed_fee").notNull().default(0), // NEW — e.g. +Rp1,000
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});
```

### 3.17 `vouchers`

FRD §3.1.7, §2.5.

```ts
export const vouchers = pgTable(
  "vouchers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: text("code").notNull().unique(),
    description: text("description").notNull(),
    discountType: voucherDiscountTypeEnum("discount_type").notNull(),
    discountValue: integer("discount_value").notNull(),
    minOrder: integer("min_order").notNull().default(0),
    validUntil: timestamp("valid_until", { mode: "date" }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [index("voucher_code_idx").on(t.code)],
);
```

### 3.18 `app_settings`

**New table** — FRD §2.3 (dynamic PB1), §5.3 (smart reordering formula parameter).  
Key-value store for system-wide configuration.

```ts
export const appSettings = pgTable("app_settings", {
  id: uuid("id").defaultRandom().primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
  description: text("description"),
  updatedBy: uuid("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});
```

**Seed values:**

- `tax_rate` → `"10"` (PB1 percentage)
- `tax_enabled` → `"true"`
- `smart_reorder_days` → `"5"` (formula multiplier)
- `max_report_date_range_days` → `"31"` (FRD §6.6)

### 3.19 `area_manager_branches`

FRD §2.

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
  (t) => [unique("am_branch_unique").on(t.userId, t.branchId)],
);
```

---

## 4. Module 2 — POS & Orders

### 4.1 `orders`

FRD §2, §4.4, §4.5, §4.6.

```ts
export const orders = pgTable(
  "orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    channel: orderChannelEnum("channel").notNull(),
    subtotal: integer("subtotal").notNull(),
    merchantDiscount: integer("merchant_discount").notNull().default(0),
    platformDiscount: integer("platform_discount").notNull().default(0),
    taxAmount: integer("tax_amount").notNull().default(0),
    totalAmount: integer("total_amount").notNull(),
    totalCogs: integer("total_cogs").notNull().default(0),
    mdrFee: integer("mdr_fee").notNull().default(0),
    netSales: integer("net_sales").notNull().default(0),
    orderCode: text("order_code"), // kode ojol (online) / customer name (dine-in)
    customerName: text("customer_name"), // NEW — FRD §4.4 offline flow
    paymentMethod: text("payment_method"), // NEW — Cash / QRIS / OVO / etc.
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

**Key change:** `brandId` **removed** from `orders` (Cross-Brand Cart support per FRD §2.6, §3.1.3). Brand tracking moves to `order_items`.

### 4.2 `order_items`

FRD §2.6, §3.1.3, §4.6.

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
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id), // NEW — tracks active Brand Tab
    quantity: integer("quantity").notNull(),
    price: integer("price").notNull(),
    cogsAtTransaction: integer("cogs_at_transaction").notNull().default(0),
    notes: text("notes"), // per-item notes: "Pisah sambal", etc.
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [
    index("order_item_order_idx").on(t.orderId),
    index("order_item_recipe_idx").on(t.recipeId),
  ],
);
```

**Note:** `cogsAtTransaction` is a **snapshot** at the moment of sale. It must never be recalculated from current master data (FRD §4.6).

### 4.3 `order_item_modifiers`

FRD §2.7, §4.4.

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

### 4.4 `order_item_exclusions`

**New table** — records which BOM ingredients were excluded per order item.  
Populated by the POS app when an exclusion modifier (e.g. "Tanpa Telur") is selected.  
The stock-deduction logic subtracts `recipe_ingredients` quantities MINUS these exclusions.

```ts
export const orderItemExclusions = pgTable(
  "order_item_exclusions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderItemId: uuid("order_item_id")
      .notNull()
      .references(() => orderItems.id, { onDelete: "cascade" }),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => ingredients.id),
    quantity: integer("quantity").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [index("oie_item_idx").on(t.orderItemId)],
);
```

### 4.5 `cancel_requests`

**New table** — FRD §4.5 formal cancel-request workflow.

```ts
export const cancelRequests = pgTable(
  "cancel_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    reason: cancelRequestReasonEnum("reason").notNull(),
    detail: text("detail"),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id),
    approvedBy: uuid("approved_by").references(() => users.id),
    status: cancelRequestStatusEnum("status").notNull().default("Pending"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    approvedAt: timestamp("approved_at", { mode: "date" }),
  },
  (t) => [index("cr_order_idx").on(t.orderId), index("cr_status_idx").on(t.status)],
);
```

### 4.6 `print_requests`

**New table** — FRD §2.11: re-print invoice requires Area Manager approval.

```ts
export const printRequests = pgTable(
  "print_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    requestType: text("request_type").notNull(), // 'reprint_invoice' | 'print_bill'
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id),
    approvedBy: uuid("approved_by").references(() => users.id),
    status: printRequestStatusEnum("status").notNull().default("Pending"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    approvedAt: timestamp("approved_at", { mode: "date" }),
  },
  (t) => [index("pr_order_idx").on(t.orderId), index("pr_status_idx").on(t.status)],
);
```

### 4.7 `shifts`

FRD §4.4.

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
    cashFloat: integer("cash_float").notNull(),
    actualCash: integer("actual_cash"),
    expectedCash: integer("expected_cash"),
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

### 4.8 `shift_edits`

**New table** — FRD §4.2: Admin Pusat can edit Shift History; edits must be logged.

```ts
export const shiftEdits = pgTable(
  "shift_edits",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shiftId: uuid("shift_id")
      .notNull()
      .references(() => shifts.id),
    fieldName: text("field_name").notNull(), // e.g. 'cash_float', 'actual_cash'
    oldValue: text("old_value"),
    newValue: text("new_value"),
    editedBy: uuid("edited_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [index("se_shift_idx").on(t.shiftId)],
);
```

### 4.9 `user_sessions`

**New table** — FRD §2: 1 active session per Branch Admin; new login kicks old session.

```ts
export const userSessions = pgTable(
  "user_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    deviceInfo: text("device_info"),
    ipAddress: text("ip_address"),
    isActive: boolean("is_active").notNull().default(true),
    expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [index("session_user_idx").on(t.userId), index("session_active_idx").on(t.isActive)],
);
```

---

## 5. Module 3 — Deep Inventory

### 5.1 `inventory`

FRD §3.3, §4.2. No batch/expiry (FIFO removed per prototype v2).

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

### 5.2 `in_transit_inventory`

**New table** — FRD §4.2: In-Transit Virtual Warehouse.  
Stock leaves source branch when SJ ships; enters destination branch only when received.

```ts
export const inTransitInventory = pgTable(
  "in_transit_inventory",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    deliveryNoteId: uuid("delivery_note_id")
      .notNull()
      .references(() => deliveryNotes.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id), // destination
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => ingredients.id),
    quantity: integer("quantity").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [
    index("iti_branch_idx").on(t.branchId),
    index("iti_ingredient_idx").on(t.ingredientId),
    index("iti_dn_idx").on(t.deliveryNoteId),
  ],
);
```

### 5.3 `stock_ledger`

FRD §3.3, §6.2.

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
    type: stockLedgerTypeEnum("type").notNull(),
    quantity: integer("quantity").notNull(),
    balance: integer("balance").notNull(),
    reference: text("reference").notNull(), // Order ID, SJ ID, Waste ID, Yield ID, etc.
    notes: text("notes"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [
    index("ledger_branch_idx").on(t.branchId),
    index("ledger_ingredient_idx").on(t.ingredientId),
    index("ledger_ref_idx").on(t.reference),
    index("ledger_created_idx").on(t.createdAt),
  ],
);
```

### 5.4 `yield_conversions`

FRD §5.1.

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

## 6. Module 4 — Supply Chain (SCM)

### 6.1 `purchase_requisitions`

FRD §4.2.

```ts
export const purchaseRequisitions = pgTable(
  "purchase_requisitions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: text("code").notNull().unique(),
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
    isAutoGenerated: boolean("is_auto_generated").notNull().default(false), // NEW — smart reordering
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [index("pr_branch_idx").on(t.branchId), index("pr_status_idx").on(t.status)],
);
```

### 6.2 `purchase_requisition_items`

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

### 6.3 `purchase_orders`

**New table** — FRD §4.2: PR → **PO** → SJ → Invoice.

```ts
export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: text("code").notNull().unique(),
    purchaseRequisitionId: uuid("purchase_requisition_id").references(
      () => purchaseRequisitions.id,
    ),
    supplierId: uuid("supplier_id").references(() => suppliers.id),
    fromBranchId: uuid("from_branch_id")
      .notNull()
      .references(() => branches.id),
    toBranchId: uuid("to_branch_id")
      .notNull()
      .references(() => branches.id),
    status: poStatusEnum("status").notNull().default("Draft"),
    notes: text("notes"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [
    index("po_pr_idx").on(t.purchaseRequisitionId),
    index("po_supplier_idx").on(t.supplierId),
    index("po_status_idx").on(t.status),
  ],
);
```

### 6.4 `purchase_order_items`

**New table**.

```ts
export const purchaseOrderItems = pgTable(
  "purchase_order_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    purchaseOrderId: uuid("purchase_order_id")
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: "cascade" }),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => ingredients.id),
    quantity: integer("quantity").notNull(),
    unitPrice: integer("unit_price"),
    totalPrice: integer("total_price"),
  },
  (t) => [index("poi_po_idx").on(t.purchaseOrderId)],
);
```

### 6.5 `delivery_notes`

FRD §4.2, §7.2.

```ts
export const deliveryNotes = pgTable(
  "delivery_notes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: text("code").notNull().unique(),
    purchaseRequisitionId: uuid("purchase_requisition_id").references(
      () => purchaseRequisitions.id,
    ),
    purchaseOrderId: uuid("purchase_order_id").references(() => purchaseOrders.id), // NEW
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
    printedAt: timestamp("printed_at", { mode: "date" }), // NEW — FRD §7.2
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
    receivedAt: timestamp("received_at", { mode: "date" }),
  },
  (t) => [
    index("dn_from_branch_idx").on(t.fromBranchId),
    index("dn_to_branch_idx").on(t.toBranchId),
    index("dn_pr_idx").on(t.purchaseRequisitionId),
    index("dn_po_idx").on(t.purchaseOrderId),
    index("dn_status_idx").on(t.status),
  ],
);
```

### 6.6 `delivery_note_items`

FRD §4.2: 3-pillar form (Jumlah Diorder | Jumlah Ready | Jumlah Dikirim).

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
    quantity: integer("quantity").notNull(), // qty ordered / expected
    readyQuantity: integer("ready_quantity"), // NEW — qty ready at source
    pickedQuantity: integer("picked_quantity"),
    receivedQuantity: integer("received_quantity"),
    rejectedQuantity: integer("rejected_quantity").default(0), // NEW — retur/rusak
    discrepancyNote: text("discrepancy_note"),
  },
  (t) => [index("dni_dn_idx").on(t.deliveryNoteId)],
);
```

### 6.7 `scm_invoices`

FRD §4.2: Invoice based on **actual received qty**, not ordered/sent.

```ts
export const scmInvoices = pgTable(
  "scm_invoices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: text("code").notNull().unique(),
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

### 6.8 `scm_invoice_items`

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
    quantity: integer("quantity").notNull(), // actual received qty
    unitPrice: integer("unit_price").notNull(),
    totalPrice: integer("total_price").notNull(),
  },
  (t) => [index("sii_invoice_idx").on(t.scmInvoiceId)],
);
```

### 6.9 `supplier_deliveries`

External supplier receipts. Updated to FK to `suppliers`.

```ts
export const supplierDeliveries = pgTable(
  "supplier_deliveries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    supplierId: uuid("supplier_id").references(() => suppliers.id), // NEW — was free-text
    supplierName: text("supplier_name").notNull(), // keep denormalized for quick display
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => ingredients.id),
    quantity: integer("quantity").notNull(),
    price: integer("price").notNull(),
    deliveryDate: timestamp("delivery_date", { mode: "date" }).notNull(),
    receivedBy: uuid("received_by")
      .notNull()
      .references(() => users.id),
    status: supplierDeliveryStatusEnum("status").notNull().default("Pending Invoice"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [
    index("sd_supplier_idx").on(t.supplierId),
    index("sd_ingredient_idx").on(t.ingredientId),
    index("sd_date_idx").on(t.deliveryDate),
  ],
);
```

### 6.10 `stock_transfers`

Inter-branch transfers (mutasi stok). FRD §8.1.  
Similar workflow to SJ but no PR/PO/Invoice.

```ts
export const stockTransfers = pgTable(
  "stock_transfers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: text("code").notNull().unique(),
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

## 7. Module 5 — Waste & Shrinkage

### 7.1 `waste_entries`

FRD §5.2. Categories revised to 3.

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
    category: wasteCategoryEnum("category").notNull(), // Beban Makan | Biaya Operasional | Spoiled
    notes: text("notes"),
    investigationNote: text("investigation_note"),
    submittedBy: uuid("submitted_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [
    index("waste_branch_idx").on(t.branchId),
    index("waste_category_idx").on(t.category),
    index("waste_created_idx").on(t.createdAt),
  ],
);
```

### 7.2 `operational_expenses`

**New table** — FRD §5.2, §5.3.  
Auto-linked from `waste_entries` with category `Biaya Operasional`. Also supports manual entry of fixed costs (Gaji, Listrik, Sewa).

```ts
export const operationalExpenses = pgTable(
  "operational_expenses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    wasteEntryId: uuid("waste_entry_id").references(() => wasteEntries.id), // auto-link
    category: text("category").notNull(), // 'Gaji', 'Listrik & Air', 'Sewa', 'Biaya Operasional', etc.
    amount: integer("amount").notNull(),
    date: text("date").notNull(), // 'yyyy-MM-dd'
    notes: text("notes"),
    submittedBy: uuid("submitted_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [
    index("oe_branch_idx").on(t.branchId),
    index("oe_date_idx").on(t.date),
    index("oe_waste_idx").on(t.wasteEntryId),
  ],
);
```

---

## 8. Module 6 — Audit & Stock Opname

### 8.1 `stock_opnames`

FRD §6.1, §6.2, §4.3.

```ts
export const stockOpnames = pgTable(
  "stock_opnames",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    date: text("date").notNull(),
    status: stockOpnameStatusEnum("status").notNull().default("Submitted"),
    triggeredBy: uuid("triggered_by")
      .notNull()
      .references(() => users.id), // NEW — FRD §6.1
    triggeredAt: timestamp("triggered_at", { mode: "date" }).defaultNow().notNull(), // NEW
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

FRD §6.2.

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
    variancePercentage: numeric("variance_percentage"),
    investigationNote: text("investigation_note"),
  },
  (t) => [index("soi_opname_idx").on(t.stockOpnameId)],
);
```

### 8.3 `audit_logs`

**New table** — FRD §6.2. Structured audit with JSONB old/new values.

```ts
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tableName: text("table_name").notNull(),
    recordId: text("record_id").notNull(), // UUID as string
    action: text("action").notNull(), // 'INSERT' | 'UPDATE' | 'DELETE'
    oldValues: jsonb("old_values"),
    newValues: jsonb("new_values"),
    userId: uuid("user_id").references(() => users.id),
    ipAddress: text("ip_address"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [
    index("audit_table_idx").on(t.tableName),
    index("audit_record_idx").on(t.recordId),
    index("audit_user_idx").on(t.userId),
    index("audit_created_idx").on(t.createdAt),
  ],
);
```

---

## 9. Module 7 — Finance & Reconciliation

### 9.1 `manual_revenues`

Offline revenue not flowing through POS. FRD §4.6, §7.1.

```ts
export const manualRevenues = pgTable(
  "manual_revenues",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    date: text("date").notNull(),
    amount: integer("amount").notNull(),
    notes: text("notes"),
    submittedBy: uuid("submitted_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [index("mr_branch_idx").on(t.branchId), index("mr_date_idx").on(t.date)],
);
```

### 9.2 `manual_revenue_brand_breakdowns`

FRD §3.1.3 (brand performance isolation).

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

### 9.3 `channel_revenues`

**New table** — FRD §7.1: Daily cash input per channel (Gofood, Grab, Shopee, Offline).

```ts
export const channelRevenues = pgTable(
  "channel_revenues",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    date: text("date").notNull(),
    channel: orderChannelEnum("channel").notNull(),
    amount: integer("amount").notNull(),
    notes: text("notes"),
    submittedBy: uuid("submitted_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [
    unique("channel_revenue_unique").on(t.branchId, t.date, t.channel),
    index("cr_branch_idx").on(t.branchId),
    index("cr_date_idx").on(t.date),
  ],
);
```

---

## 10. Module 8 — Period Control

### 10.1 `period_logs`

FRD §8.

```ts
export const periodLogs = pgTable(
  "period_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    periodName: text("period_name").notNull(),
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

### 10.2 `period_balances`

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

## 11. Module 9 — System, Notifications & Security

### 11.1 `system_logs`

High-level action logs (less granular than `audit_logs`).

```ts
export const systemLogs = pgTable(
  "system_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    action: text("action").notNull(),
    detail: text("detail").notNull(),
    userId: uuid("user_id").references(() => users.id),
    userName: text("user_name"),
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

### 11.2 `system_notifications`

**New table** — FRD §2.2 (negative stock flagging to Area Manager), general alerts.

```ts
export const systemNotifications = pgTable(
  "system_notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    title: text("title").notNull(),
    message: text("message").notNull(),
    type: notificationTypeEnum("type").notNull().default("info"),
    isRead: boolean("is_read").notNull().default(false),
    metadata: jsonb("metadata"), // e.g. { ingredientId, branchId, currentStock }
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [
    index("notif_user_idx").on(t.userId),
    index("notif_read_idx").on(t.isRead),
    index("notif_created_idx").on(t.createdAt),
  ],
);
```

---

## 12. Drizzle Relations (Complete)

Paste this block at the bottom of `src/db/schema.ts`.

```ts
// ─── Master Data ───

export const usersRelations = relations(users, ({ one, many }) => ({
  branch: one(branches, { fields: [users.branchId], references: [branches.id] }),
  areaManagerBranches: many(areaManagerBranches),
  sessions: many(userSessions),
  shifts: many(shifts),
  shiftEdits: many(shiftEdits),
  stockOpnamesTriggered: many(stockOpnames, { relationName: "triggeredBy" }),
  stockOpnamesSubmitted: many(stockOpnames, { relationName: "submittedBy" }),
  stockOpnamesApproved: many(stockOpnames, { relationName: "approvedBy" }),
  wasteEntries: many(wasteEntries),
  manualRevenues: many(manualRevenues),
  channelRevenues: many(channelRevenues),
  operationalExpenses: many(operationalExpenses),
  systemLogs: many(systemLogs),
  auditLogs: many(auditLogs),
  notifications: many(systemNotifications),
  cancelRequests: many(cancelRequests, { relationName: "requestedBy" }),
  cancelApprovals: many(cancelRequests, { relationName: "approvedBy" }),
  printRequests: many(printRequests, { relationName: "requestedBy" }),
  printApprovals: many(printRequests, { relationName: "approvedBy" }),
  vouchersCreated: many(vouchers),
  purchaseRequisitions: many(purchaseRequisitions, { relationName: "requestedBy" }),
  purchaseOrders: many(purchaseOrders),
  yieldConversions: many(yieldConversions),
  stockTransfers: many(stockTransfers, { relationName: "requestedBy" }),
}));

export const branchesRelations = relations(branches, ({ many }) => ({
  users: many(users),
  orders: many(orders),
  inventory: many(inventory),
  inTransitInventory: many(inTransitInventory),
  stockLedger: many(stockLedger),
  wasteEntries: many(wasteEntries),
  stockOpnames: many(stockOpnames),
  stockTransfersFrom: many(stockTransfers, { relationName: "fromBranch" }),
  stockTransfersTo: many(stockTransfers, { relationName: "toBranch" }),
  purchaseRequisitions: many(purchaseRequisitions),
  purchaseOrdersFrom: many(purchaseOrders, { relationName: "fromBranch" }),
  purchaseOrdersTo: many(purchaseOrders, { relationName: "toBranch" }),
  deliveryNotesFrom: many(deliveryNotes, { relationName: "fromBranch" }),
  deliveryNotesTo: many(deliveryNotes, { relationName: "toBranch" }),
  scmInvoicesFrom: many(scmInvoices, { relationName: "fromBranch" }),
  scmInvoicesTo: many(scmInvoices, { relationName: "toBranch" }),
  yieldConversions: many(yieldConversions),
  manualRevenues: many(manualRevenues),
  channelRevenues: many(channelRevenues),
  operationalExpenses: many(operationalExpenses),
  shifts: many(shifts),
  periodBalances: many(periodBalances),
}));

export const brandsRelations = relations(brands, ({ many }) => ({
  recipeBrands: many(recipeBrands),
  orderItems: many(orderItems),
  manualRevenueBreakdowns: many(manualRevenueBrandBreakdowns),
}));

export const suppliersRelations = relations(suppliers, ({ many }) => ({
  purchaseOrders: many(purchaseOrders),
  supplierDeliveries: many(supplierDeliveries),
}));

export const ingredientsRelations = relations(ingredients, ({ many }) => ({
  recipeIngredients: many(recipeIngredients),
  modifierIngredients: many(modifierIngredients),
  recipeModifierExclusions: many(recipeModifierExclusions),
  inventory: many(inventory),
  inTransitInventory: many(inTransitInventory),
  stockLedger: many(stockLedger),
  wasteEntries: many(wasteEntries),
  stockOpnameItems: many(stockOpnameItems),
  stockTransfers: many(stockTransfers),
  purchaseRequisitionItems: many(purchaseRequisitionItems),
  purchaseOrderItems: many(purchaseOrderItems),
  deliveryNoteItems: many(deliveryNoteItems),
  scmInvoiceItems: many(scmInvoiceItems),
  yieldConversionsSource: many(yieldConversions, { relationName: "source" }),
  yieldConversionsTarget: many(yieldConversions, { relationName: "target" }),
  supplierDeliveries: many(supplierDeliveries),
  orderItemExclusions: many(orderItemExclusions),
  periodBalances: many(periodBalances),
}));

export const recipesRelations = relations(recipes, ({ many }) => ({
  recipeBrands: many(recipeBrands),
  recipeIngredients: many(recipeIngredients),
  recipeChildRecipesParent: many(recipeChildRecipes, { relationName: "parent" }),
  recipeChildRecipesChild: many(recipeChildRecipes, { relationName: "child" }),
  recipeModifierGroups: many(recipeModifierGroups),
  recipeModifierExclusions: many(recipeModifierExclusions),
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
  recipeModifierExclusions: many(recipeModifierExclusions),
  orderItemModifiers: many(orderItemModifiers),
}));

// ─── POS & Orders ───

export const ordersRelations = relations(orders, ({ one, many }) => ({
  branch: one(branches, { fields: [orders.branchId], references: [branches.id] }),
  shift: one(shifts, { fields: [orders.shiftId], references: [shifts.id] }),
  orderItems: many(orderItems),
  cancelRequests: many(cancelRequests),
  printRequests: many(printRequests),
}));

export const orderItemsRelations = relations(orderItems, ({ one, many }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  recipe: one(recipes, { fields: [orderItems.recipeId], references: [recipes.id] }),
  brand: one(brands, { fields: [orderItems.brandId], references: [brands.id] }),
  orderItemModifiers: many(orderItemModifiers),
  orderItemExclusions: many(orderItemExclusions),
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

export const orderItemExclusionsRelations = relations(orderItemExclusions, ({ one }) => ({
  orderItem: one(orderItems, {
    fields: [orderItemExclusions.orderItemId],
    references: [orderItems.id],
  }),
  ingredient: one(ingredients, {
    fields: [orderItemExclusions.ingredientId],
    references: [ingredients.id],
  }),
}));

export const cancelRequestsRelations = relations(cancelRequests, ({ one }) => ({
  order: one(orders, { fields: [cancelRequests.orderId], references: [orders.id] }),
  requestedByUser: one(users, { fields: [cancelRequests.requestedBy], references: [users.id] }),
  approvedByUser: one(users, { fields: [cancelRequests.approvedBy], references: [users.id] }),
}));

export const printRequestsRelations = relations(printRequests, ({ one }) => ({
  order: one(orders, { fields: [printRequests.orderId], references: [orders.id] }),
  requestedByUser: one(users, { fields: [printRequests.requestedBy], references: [users.id] }),
  approvedByUser: one(users, { fields: [printRequests.approvedBy], references: [users.id] }),
}));

export const shiftsRelations = relations(shifts, ({ one, many }) => ({
  branch: one(branches, { fields: [shifts.branchId], references: [branches.id] }),
  user: one(users, { fields: [shifts.userId], references: [users.id] }),
  orders: many(orders),
  shiftEdits: many(shiftEdits),
}));

export const shiftEditsRelations = relations(shiftEdits, ({ one }) => ({
  shift: one(shifts, { fields: [shiftEdits.shiftId], references: [shifts.id] }),
  editedByUser: one(users, { fields: [shiftEdits.editedBy], references: [users.id] }),
}));

export const userSessionsRelations = relations(userSessions, ({ one }) => ({
  user: one(users, { fields: [userSessions.userId], references: [users.id] }),
}));

// ─── Inventory ───

export const inventoryRelations = relations(inventory, ({ one }) => ({
  branch: one(branches, { fields: [inventory.branchId], references: [branches.id] }),
  ingredient: one(ingredients, { fields: [inventory.ingredientId], references: [ingredients.id] }),
}));

export const inTransitInventoryRelations = relations(inTransitInventory, ({ one }) => ({
  branch: one(branches, { fields: [inTransitInventory.branchId], references: [branches.id] }),
  ingredient: one(ingredients, {
    fields: [inTransitInventory.ingredientId],
    references: [ingredients.id],
  }),
  deliveryNote: one(deliveryNotes, {
    fields: [inTransitInventory.deliveryNoteId],
    references: [deliveryNotes.id],
  }),
}));

export const stockLedgerRelations = relations(stockLedger, ({ one }) => ({
  branch: one(branches, { fields: [stockLedger.branchId], references: [branches.id] }),
  ingredient: one(ingredients, {
    fields: [stockLedger.ingredientId],
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

// ─── SCM ───

export const purchaseRequisitionsRelations = relations(purchaseRequisitions, ({ one, many }) => ({
  branch: one(branches, { fields: [purchaseRequisitions.branchId], references: [branches.id] }),
  requestedByUser: one(users, {
    fields: [purchaseRequisitions.requestedBy],
    references: [users.id],
  }),
  approvedByUser: one(users, { fields: [purchaseRequisitions.approvedBy], references: [users.id] }),
  items: many(purchaseRequisitionItems),
  purchaseOrders: many(purchaseOrders),
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

export const purchaseOrdersRelations = relations(purchaseOrders, ({ one, many }) => ({
  purchaseRequisition: one(purchaseRequisitions, {
    fields: [purchaseOrders.purchaseRequisitionId],
    references: [purchaseRequisitions.id],
  }),
  supplier: one(suppliers, { fields: [purchaseOrders.supplierId], references: [suppliers.id] }),
  fromBranch: one(branches, { fields: [purchaseOrders.fromBranchId], references: [branches.id] }),
  toBranch: one(branches, { fields: [purchaseOrders.toBranchId], references: [branches.id] }),
  createdByUser: one(users, { fields: [purchaseOrders.createdBy], references: [users.id] }),
  items: many(purchaseOrderItems),
  deliveryNotes: many(deliveryNotes),
}));

export const purchaseOrderItemsRelations = relations(purchaseOrderItems, ({ one }) => ({
  purchaseOrder: one(purchaseOrders, {
    fields: [purchaseOrderItems.purchaseOrderId],
    references: [purchaseOrders.id],
  }),
  ingredient: one(ingredients, {
    fields: [purchaseOrderItems.ingredientId],
    references: [ingredients.id],
  }),
}));

export const deliveryNotesRelations = relations(deliveryNotes, ({ one, many }) => ({
  purchaseRequisition: one(purchaseRequisitions, {
    fields: [deliveryNotes.purchaseRequisitionId],
    references: [purchaseRequisitions.id],
  }),
  purchaseOrder: one(purchaseOrders, {
    fields: [deliveryNotes.purchaseOrderId],
    references: [purchaseOrders.id],
  }),
  fromBranch: one(branches, { fields: [deliveryNotes.fromBranchId], references: [branches.id] }),
  toBranch: one(branches, { fields: [deliveryNotes.toBranchId], references: [branches.id] }),
  items: many(deliveryNoteItems),
  scmInvoices: many(scmInvoices),
  inTransitInventory: many(inTransitInventory),
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

export const supplierDeliveriesRelations = relations(supplierDeliveries, ({ one }) => ({
  supplier: one(suppliers, { fields: [supplierDeliveries.supplierId], references: [suppliers.id] }),
  ingredient: one(ingredients, {
    fields: [supplierDeliveries.ingredientId],
    references: [ingredients.id],
  }),
  receivedByUser: one(users, { fields: [supplierDeliveries.receivedBy], references: [users.id] }),
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

// ─── Waste ───

export const wasteEntriesRelations = relations(wasteEntries, ({ one, many }) => ({
  branch: one(branches, { fields: [wasteEntries.branchId], references: [branches.id] }),
  ingredient: one(ingredients, {
    fields: [wasteEntries.ingredientId],
    references: [ingredients.id],
  }),
  submittedByUser: one(users, { fields: [wasteEntries.submittedBy], references: [users.id] }),
  linkedOperationalExpense: many(operationalExpenses),
}));

export const operationalExpensesRelations = relations(operationalExpenses, ({ one }) => ({
  branch: one(branches, { fields: [operationalExpenses.branchId], references: [branches.id] }),
  wasteEntry: one(wasteEntries, {
    fields: [operationalExpenses.wasteEntryId],
    references: [wasteEntries.id],
  }),
  submittedByUser: one(users, {
    fields: [operationalExpenses.submittedBy],
    references: [users.id],
  }),
}));

// ─── Audit & SO ───

export const stockOpnamesRelations = relations(stockOpnames, ({ one, many }) => ({
  branch: one(branches, { fields: [stockOpnames.branchId], references: [branches.id] }),
  triggeredByUser: one(users, { fields: [stockOpnames.triggeredBy], references: [users.id] }),
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

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  user: one(users, { fields: [auditLogs.userId], references: [users.id] }),
}));

// ─── Finance ───

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

export const channelRevenuesRelations = relations(channelRevenues, ({ one }) => ({
  branch: one(branches, { fields: [channelRevenues.branchId], references: [branches.id] }),
  submittedByUser: one(users, { fields: [channelRevenues.submittedBy], references: [users.id] }),
}));

// ─── Period Control ───

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

// ─── System ───

export const vouchersRelations = relations(vouchers, ({ one }) => ({
  createdByUser: one(users, { fields: [vouchers.createdBy], references: [users.id] }),
}));

export const systemLogsRelations = relations(systemLogs, ({ one }) => ({
  user: one(users, { fields: [systemLogs.userId], references: [users.id] }),
}));

export const systemNotificationsRelations = relations(systemNotifications, ({ one }) => ({
  user: one(users, { fields: [systemNotifications.userId], references: [users.id] }),
}));

export const appSettingsRelations = relations(appSettings, ({ one }) => ({
  updatedByUser: one(users, { fields: [appSettings.updatedBy], references: [users.id] }),
}));

export const areaManagerBranchesRelations = relations(areaManagerBranches, ({ one }) => ({
  user: one(users, { fields: [areaManagerBranches.userId], references: [users.id] }),
  branch: one(branches, { fields: [areaManagerBranches.branchId], references: [branches.id] }),
}));
```

---

## 13. Execution Steps

1. **Backup** existing `src/db/schema.ts`.
2. **Replace** with the complete schema from this document (enums → tables → relations).
3. **Install dependencies:** `vp install` (ensure `drizzle-orm`, `drizzle-kit`, `pg` are present).
4. **Generate migration:**
   ```bash
   vp run db:generate
   ```
5. **Review generated SQL** in `./drizzle/` for:
   - Enum creation order (must precede table creation).
   - FK `ON DELETE` rules (only child/junction tables use `cascade`).
   - All indexes and unique constraints.
6. **Apply migration:**
   ```bash
   vp run db:migrate
   ```
7. **Seed `app_settings`** with default keys (`tax_rate`, `tax_enabled`, `smart_reorder_days`, `max_report_date_range_days`).
8. **Verify:**
   ```bash
   vp run db:studio
   ```

---

## 14. Feature → Table Coverage Checklist

| Module                | Feature                    | Table(s)                                                                                                       |
| --------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **1. Master Data**    | Multi-role auth            | `users`, `area_manager_branches`                                                                               |
|                       | Session restriction        | `user_sessions`                                                                                                |
|                       | Branch / Central Warehouse | `branches`                                                                                                     |
|                       | Brand mgmt                 | `brands`, `recipe_brands`                                                                                      |
|                       | Supplier master            | `suppliers`                                                                                                    |
|                       | Ingredient / SKU master    | `ingredients`                                                                                                  |
|                       | Recipe / BOM               | `recipes`, `recipe_ingredients`, `recipe_child_recipes`                                                        |
|                       | Modifier system            | `modifier_groups`, `modifiers`, `modifier_ingredients`, `recipe_modifier_groups`, `recipe_modifier_exclusions` |
|                       | Platform fee / MDR         | `platform_fees`                                                                                                |
|                       | Vouchers                   | `vouchers`                                                                                                     |
|                       | App config (tax, reorder)  | `app_settings`                                                                                                 |
| **2. POS**            | Orders                     | `orders`                                                                                                       |
|                       | Cross-Brand Cart           | `order_items` (with `brandId`)                                                                                 |
|                       | Modifiers & exclusions     | `order_item_modifiers`, `order_item_exclusions`                                                                |
|                       | Cancel request workflow    | `cancel_requests`                                                                                              |
|                       | Re-print approval          | `print_requests`                                                                                               |
|                       | Shift mgmt                 | `shifts`, `shift_edits`                                                                                        |
| **3. Deep Inventory** | Real-time stock            | `inventory`                                                                                                    |
|                       | In-transit tracking        | `in_transit_inventory`                                                                                         |
|                       | Stock ledger               | `stock_ledger`                                                                                                 |
|                       | Yield tracking             | `yield_conversions`                                                                                            |
| **4. SCM**            | Purchase Requisition       | `purchase_requisitions`, `purchase_requisition_items`                                                          |
|                       | Purchase Order             | `purchase_orders`, `purchase_order_items`                                                                      |
|                       | Surat Jalan                | `delivery_notes`, `delivery_note_items`                                                                        |
|                       | SCM Invoice                | `scm_invoices`, `scm_invoice_items`                                                                            |
|                       | Supplier deliveries        | `supplier_deliveries`                                                                                          |
|                       | Inter-branch transfer      | `stock_transfers`                                                                                              |
| **5. Waste**          | Waste entry (3 categories) | `waste_entries`                                                                                                |
|                       | Operational expense link   | `operational_expenses`                                                                                         |
| **6. Audit & SO**     | Stock Opname               | `stock_opnames`, `stock_opname_items`                                                                          |
|                       | Structured audit logs      | `audit_logs`                                                                                                   |
| **7. Finance**        | Manual revenue             | `manual_revenues`, `manual_revenue_brand_breakdowns`                                                           |
|                       | Channel revenue input      | `channel_revenues`                                                                                             |
| **8. Period**         | Period control             | `period_logs`, `period_balances`                                                                               |
| **9. System**         | Action logs                | `system_logs`                                                                                                  |
|                       | Notifications / flags      | `system_notifications`                                                                                         |

---

## 15. Migration Notes from Prototype

- **IDs:** Map prototype semantic IDs (`br-sub-01`, `rec-01`) to `code` columns; use UUIDs for PKs.
- **Brand on orders:** The prototype stored `brandId` on the order. In the new schema, **move this to each `order_item`** to support Cross-Brand Cart.
- **Waste categories:** Migrate old `Rusak` → `Spoiled` or `Biaya Operasional`; `Jatah Makan Karyawan` → `Beban Makan`.
- **COGS snapshots:** `cogsAtTransaction` on `order_items` and `order_item_modifiers` must be preserved exactly as historical snapshots.
- **Channel-specific prices:** The prototype's `goFoodPrice`, `grabFoodPrice`, `shopeeFoodPrice` were removed. All channels use `basePrice`.
- **Stock ledger `balance`:** Denormalized running total. When seeding, ensure cumulative accuracy.
- **In-transit data:** If seeding from prototype, any `delivery_notes` with `status = 'In Transit'` must generate corresponding `in_transit_inventory` rows.
- **Exclusion modifiers:** The prototype had exclusion modifiers with `ingredients: []`. For the new schema, map these to `recipe_modifier_exclusions` so the app knows exactly which BOM ingredients to skip.

---

_End of revised plan._
