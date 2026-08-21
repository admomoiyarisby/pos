import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  pgEnum,
  numeric,
  real,
  index,
  jsonb,
  unique,
  check,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

// =============================================================================
// ENUMS
// =============================================================================

export const USER_ROLE_VALUES = [
  "super_admin",
  "admin_pusat",
  "area_manager",
  "branch_admin",
  "central_kitchen",
] as const;

export const userRoleEnum = pgEnum("user_role", USER_ROLE_VALUES);

export const userStatusEnum = pgEnum("user_status", ["Active", "Inactive"]);

export const branchTypeEnum = pgEnum("branch_type", ["Central", "Outlet"]);

export const ingredientCategoryEnum = pgEnum("ingredient_category", ["Fresh", "Dry", "Packaging"]);

export const skuTypeEnum = pgEnum("sku_type", ["RM", "SFG", "FG"]);

// ADR-0009 mirror: 'Deleted' is a UI-irreversible soft-delete tombstone (restore
// is DB-only). Deleted rows never appear in lists; Inactive rows stay visible.
export const ingredientStatusEnum = pgEnum("ingredient_status", ["Active", "Inactive", "Deleted"]);

// Recipe lifecycle (ADR-0009): Active ⇄ Inactive → Deleted. Deliberately
// independent from ingredient_status so a future ingredient-status change can't
// silently affect recipes.
export const recipeStatusEnum = pgEnum("recipe_status", ["Active", "Inactive", "Deleted"]);

export const ORDER_CHANNEL_VALUES = [
  "Gofood",
  "Grabfood",
  "ShopeeFood",
  "Dine-in",
  "TikTok",
] as const;

export const orderChannelEnum = pgEnum("order_channel", ORDER_CHANNEL_VALUES);

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
  "Denda",
]);

export const stockOpnameStatusEnum = pgEnum("stock_opname_status", [
  "Submitted",
  "Approved",
  "Under Investigation",
]);

export const stockTransferStatusEnum = pgEnum("stock_transfer_status", [
  "Pending Approval",
  "Approved",
  "Rejected",
  "In Transit",
  "Completed",
  "Cancelled",
]);

export const PR_STATUS_VALUES = [
  "Draft",
  "Pending",
  "Approved",
  "Processed",
  "Rejected",
  "Fulfilled",
] as const;

export const prStatusEnum = pgEnum("pr_status", PR_STATUS_VALUES);

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
  "Partial Received",
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
  "Executed",
]);

export const printRequestStatusEnum = pgEnum("print_request_status", [
  "Pending",
  "Approved",
  "Rejected",
  "Consumed",
]);

export const logStatusEnum = pgEnum("log_status", ["Success", "Warning", "Error"]);

export const notificationTypeEnum = pgEnum("notification_type", ["info", "warning", "alert"]);
export const notificationPriorityEnum = pgEnum("notification_priority", ["normal", "urgent"]); // ID7

// --- SCM (new FSM, ADR 0002) ---

export const scmProcurementStatusEnum = pgEnum("scm_procurement_status", [
  "Draft",
  "Pending",
  "UnderReview",
  "Rejected",
  "InTransit",
  "Delivered",
  "ReviewingSJ",
  "WaitingForPayment",
  "Finished",
  "Cancelled",
]);

export const caDecisionEnum = pgEnum("ca_decision", ["pending", "approved", "rejected"]);

export const baDecisionEnum = pgEnum("ba_decision", ["pending", "accepted", "rejected"]);

// -----------------------------------------------------------------------------
// SCM (new FSM, ADR 0006) — Mutasi Stok: Branch→Branch transfers
// -----------------------------------------------------------------------------

export const scmTransferStatusEnum = pgEnum("scm_transfer_status", [
  "SuratJalanDraft",
  "PendingAMReview",
  "Approved",
  "InTransit",
  "Delivered",
  "ReviewingSJ",
  "WaitingForPayment",
  "Finished",
  "Rejected",
  "Cancelled",
]);

// =============================================================================
// MODULE 1 — MASTER DATA
// =============================================================================

export const categories = pgTable("categories", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").default(false).notNull(),
    image: text("image"),
    role: userRoleEnum("role").notNull(),
    pin: text("pin"),
    status: userStatusEnum("status").notNull().default("Active"),
    branchId: uuid("branch_id").references(() => branches.id),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [unique("user_pin_branch_unique").on(t.pin, t.branchId)],
);

export const branches = pgTable("branches", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  location: text("location").notNull(),
  pin: text("pin"), // Per-branch shared PIN for login
  active: boolean("active").notNull().default(true),
  isOnline: boolean("is_online").notNull().default(true),
  type: branchTypeEnum("type").notNull().default("Outlet"),
  pb1Rate: integer("pb1_rate").notNull().default(11),
  phone: text("phone"),
  complaintPhone: text("complaint_phone"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const brands = pgTable("brands", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  logo: text("logo"),
  status: text("status").notNull().default("Active"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

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

export const ingredients = pgTable("ingredients", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  category: ingredientCategoryEnum("category").notNull(),
  skuType: skuTypeEnum("sku_type").notNull(),
  purchaseUnit: text("purchase_unit").notNull(),
  stockUnit: text("stock_unit").notNull(),
  conversionFactor: integer("conversion_factor").notNull(),
  averageCost: integer("average_cost").notNull(),
  plannedCost: integer("planned_cost"),
  rop: integer("rop").notNull().default(0),
  roq: integer("roq").notNull().default(0),
  moq: integer("moq").notNull().default(1),
  status: ingredientStatusEnum("status").notNull().default("Active"),
  countable: boolean("countable").notNull().default(true),
  isNasi: boolean("is_nasi").notNull().default(false), // Special: cooked rice, only in stock opname
  isBranchVisible: boolean("is_branch_visible").notNull().default(false), // Branch (outlet) catalog item; false = central-warehouse + management only (omoiyari stock-opname catalog)
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

// MODULE — INGREDIENT BRANCH VISIBILITY
// -----------------------------------------------------------------------------
// Mirrors `recipe_branches` (MODULE 9): an ingredient with zero rows here is
// visible in ALL branches; rows restrict it to the listed branches. Enforced by
// a single gate in `getIngredients` keyed on the caller's currentBranchId.
export const ingredientBranches = pgTable(
  "ingredient_branches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => ingredients.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [unique("ingredient_branch_unique").on(t.ingredientId, t.branchId)],
);

export const recipes = pgTable("recipes", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  imageUrl: text("image_url"),
  // The categories table (managed on /categories) is the single source of
  // truth for recipe categories. The legacy `recipe_category` pgEnum column
  // was dropped in favor of this FK — the wizard dropdown, POS grouping, and
  // recipe list all read the category name via this join, so a category
  // created on /categories appears everywhere without an enum migration.
  categoryId: uuid("category_id")
    .notNull()
    .references(() => categories.id, { onDelete: "restrict" }),
  isSubRecipe: boolean("is_sub_recipe").notNull().default(false),
  basePrice: integer("base_price").notNull(),
  totalCogs: integer("total_cogs").notNull().default(0),
  isBOGO: boolean("is_bogo").notNull().default(false),
  isStaffMeal: boolean("is_staff_meal").notNull().default(false), // ID6: Staff meals display as Rp 0
  status: recipeStatusEnum("status").notNull().default("Active"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

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

export const recipeIngredients = pgTable("recipe_ingredients", {
  id: uuid("id").defaultRandom().primaryKey(),
  recipeId: uuid("recipe_id")
    .notNull()
    .references(() => recipes.id, { onDelete: "cascade" }),
  ingredientId: uuid("ingredient_id")
    .notNull()
    .references(() => ingredients.id),
  quantity: real("quantity").notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

// Finished-good (recipe) stock per branch. Unlike `inventory` (which is
// ingredient-scoped), this tracks produced menu units (e.g. "50 pcs Ayam
// Karage ready at Central Warehouse") so a recipe can be stocked and its
// movements recorded in Kartu Stok (see stockLedger.recipeId).
export const recipeInventory = pgTable(
  "recipe_inventory",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    recipeId: uuid("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    quantity: real("quantity").notNull().default(0),
    lastUpdated: timestamp("last_updated", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [
    unique("recipe_inventory_branch_recipe_unique").on(t.branchId, t.recipeId),
    index("recipe_inventory_branch_idx").on(t.branchId),
    index("recipe_inventory_recipe_idx").on(t.recipeId),
  ],
);

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
    quantity: real("quantity").notNull(),
  },
  (t) => [unique("recipe_child_unique").on(t.parentRecipeId, t.childRecipeId)],
);

export const modifierGroups = pgTable("modifier_groups", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  minSelection: integer("min_selection").notNull().default(0),
  maxSelection: integer("max_selection").notNull().default(1),
  // Manual group order (set via drag-and-drop on /modifier-groups). Drives the
  // order of modifier groups in the POS ModifierModal and the recipe-edit menu.
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

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

export const modifiers = pgTable("modifiers", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: text("code").notNull().unique(),
  modifierGroupId: uuid("modifier_group_id")
    .notNull()
    .references(() => modifierGroups.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  price: integer("price").notNull().default(0),
  isExclusion: boolean("is_exclusion").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

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
    quantity: real("quantity").notNull(),
  },
  (t) => [unique("modifier_ingredient_unique").on(t.modifierId, t.ingredientId)],
);

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
    quantity: real("quantity").notNull(),
  },
  (t) => [unique("recipe_mod_excl_unique").on(t.recipeId, t.modifierId, t.ingredientId)],
);

// =============================================================================
// MODULE 9 — RECIPE BRANCH VISIBILITY
// =============================================================================

export const recipeBranches = pgTable(
  "recipe_branches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    recipeId: uuid("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [unique("recipe_branch_unique").on(t.recipeId, t.branchId)],
);

export const platformFees = pgTable("platform_fees", {
  id: uuid("id").defaultRandom().primaryKey(),
  channel: orderChannelEnum("channel").notNull().unique(),
  feePercentage: integer("fee_percentage").notNull().default(0),
  fixedFee: integer("fixed_fee").notNull().default(0),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

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

export const appSettings = pgTable("app_settings", {
  id: uuid("id").defaultRandom().primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
  description: text("description"),
  updatedBy: uuid("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

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

// =============================================================================
// MODULE 2 — POS & ORDERS
// =============================================================================

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
    orderCode: text("order_code"),
    customerName: text("customer_name"),
    paymentMethod: text("payment_method"),
    voucherCode: text("voucher_code"),
    voucherDiscount: integer("voucher_discount"),
    status: orderStatusEnum("status").notNull().default("New"),
    voidReason: text("void_reason"),
    shiftId: uuid("shift_id").references(() => shifts.id),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    notes: text("notes"),
    completedAt: timestamp("completed_at", { mode: "date" }),
  },
  (t) => [
    index("order_branch_idx").on(t.branchId),
    index("order_status_idx").on(t.status),
    index("order_created_idx").on(t.createdAt),
    index("order_shift_idx").on(t.shiftId),
  ],
);

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
    brandId: uuid("brand_id").references(() => brands.id),
    quantity: integer("quantity").notNull(),
    price: integer("price").notNull(),
    cogsAtTransaction: integer("cogs_at_transaction").notNull().default(0),
    notes: text("notes"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [
    index("order_item_order_idx").on(t.orderId),
    index("order_item_recipe_idx").on(t.recipeId),
  ],
);

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

export const printRequests = pgTable(
  "print_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    requestType: text("request_type").notNull(),
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

export const shiftEdits = pgTable(
  "shift_edits",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shiftId: uuid("shift_id")
      .notNull()
      .references(() => shifts.id),
    fieldName: text("field_name").notNull(),
    oldValue: text("old_value"),
    newValue: text("new_value"),
    editedBy: uuid("edited_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [index("se_shift_idx").on(t.shiftId)],
);

// =============================================================================
// MODULE 3 — DEEP INVENTORY
// =============================================================================

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
    quantity: real("quantity").notNull().default(0),
    lastUpdated: timestamp("last_updated", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [
    unique("inventory_branch_ingredient_unique").on(t.branchId, t.ingredientId),
    index("inventory_branch_idx").on(t.branchId),
    index("inventory_ingredient_idx").on(t.ingredientId),
  ],
);

export const rejectionDispositionEnum = pgEnum("rejection_disposition", [
  "Return to Source",
  "Scrap",
  "Quarantine",
]);

export const inTransitInventory = pgTable(
  "in_transit_inventory",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    deliveryNoteId: uuid("delivery_note_id").references(() => deliveryNotes.id, {
      onDelete: "cascade",
    }),
    stockTransferId: uuid("stock_transfer_id").references(() => stockTransfers.id, {
      onDelete: "cascade",
    }),
    scmProcurementId: uuid("scm_procurement_id").references(() => scmProcurements.id, {
      onDelete: "cascade",
    }),
    scmTransferId: uuid("scm_transfer_id").references(() => scmTransfers.id, {
      onDelete: "cascade",
    }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
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
    index("iti_st_idx").on(t.stockTransferId),
    index("iti_proc_idx").on(t.scmProcurementId),
    index("iti_transfer_idx").on(t.scmTransferId),
    // Exactly one of deliveryNoteId / stockTransferId / scmProcurementId /
    // scmTransferId must be set. The legacy `stock_transfer_id` column is
    // frozen but its rows remain valid (no new rows are written to it).
    check(
      "iti_exactly_one_flow_fk",
      sql`(
        (CASE WHEN ${t.deliveryNoteId} IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN ${t.stockTransferId} IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN ${t.scmProcurementId} IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN ${t.scmTransferId} IS NOT NULL THEN 1 ELSE 0 END)
      ) = 1`,
    ),
  ],
);

export const stockLedger = pgTable(
  "stock_ledger",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    ingredientId: uuid("ingredient_id").references(() => ingredients.id),
    // Optional link to a finished-good (recipe) stock movement. When set, this
    // ledger row tracks a recipe's produced units rather than a raw ingredient.
    recipeId: uuid("recipe_id").references(() => recipes.id),
    type: stockLedgerTypeEnum("type").notNull(),
    quantity: integer("quantity").notNull(),
    balance: integer("balance").notNull(),
    reference: text("reference").notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [
    index("ledger_branch_idx").on(t.branchId),
    index("ledger_ingredient_idx").on(t.ingredientId),
    index("ledger_recipe_idx").on(t.recipeId),
    index("ledger_ref_idx").on(t.reference),
    index("ledger_created_idx").on(t.createdAt),
  ],
);

export const yieldConversions = pgTable(
  "yield_conversions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    notes: text("notes"),
    processedBy: uuid("processed_by")
      .notNull()
      .references(() => users.id),
    productionDate: timestamp("production_date", { mode: "date" }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [index("yc_branch_idx").on(t.branchId)],
);

// One row per ingredient movement within a production record.
// direction 'OUT' = consumed (barang keluar); 'PRODUCED' = output (barang dihasilkan).
// Replaces the legacy single source/target columns and the yield_conversion_sources junction.
export const yieldItemDirectionEnum = pgEnum("yield_item_direction", ["OUT", "PRODUCED"]);

export const yieldConversionItems = pgTable(
  "yield_conversion_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversionId: uuid("conversion_id")
      .notNull()
      .references(() => yieldConversions.id, { onDelete: "cascade" }),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => ingredients.id),
    quantity: integer("quantity").notNull(),
    direction: yieldItemDirectionEnum("direction").notNull(),
  },
  (t) => [
    index("yci_conversion_idx").on(t.conversionId),
    index("yci_ingredient_idx").on(t.ingredientId),
  ],
);

// =============================================================================
// MODULE 4 — SUPPLY CHAIN (SCM)
// =============================================================================

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
    isAutoGenerated: boolean("is_auto_generated").notNull().default(false),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [index("purq_branch_idx").on(t.branchId), index("purq_status_idx").on(t.status)],
);

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
  (t) => [index("puri_pr_idx").on(t.purchaseRequisitionId)],
);

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
    receivedQuantity: integer("received_quantity").default(0),
  },
  (t) => [index("poi_po_idx").on(t.purchaseOrderId)],
);

export const deliveryNotes = pgTable(
  "delivery_notes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: text("code").notNull().unique(),
    purchaseRequisitionId: uuid("purchase_requisition_id").references(
      () => purchaseRequisitions.id,
    ),
    purchaseOrderId: uuid("purchase_order_id").references(() => purchaseOrders.id),
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
    printedAt: timestamp("printed_at", { mode: "date" }),
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
    readyQuantity: integer("ready_quantity"),
    pickedQuantity: integer("picked_quantity"),
    receivedQuantity: integer("received_quantity"),
    rejectedQuantity: integer("rejected_quantity").default(0),
    rejectionDisposition: rejectionDispositionEnum("rejection_disposition"),
    discrepancyNote: text("discrepancy_note"),
  },
  (t) => [index("dni_dn_idx").on(t.deliveryNoteId)],
);

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

export const supplierDeliveries = pgTable(
  "supplier_deliveries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    supplierId: uuid("supplier_id").references(() => suppliers.id),
    supplierName: text("supplier_name").notNull(),
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
    status: stockTransferStatusEnum("status").notNull().default("Pending Approval"),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id),
    approvedBy: uuid("approved_by").references(() => users.id),
    rejectedBy: uuid("rejected_by").references(() => users.id),
    rejectionReason: text("rejection_reason"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [
    index("st_from_branch_idx").on(t.fromBranchId),
    index("st_to_branch_idx").on(t.toBranchId),
    index("st_status_idx").on(t.status),
  ],
);

// -----------------------------------------------------------------------------
// SCM (new FSM, ADR 0002) — unified procurement lifecycle
// -----------------------------------------------------------------------------

export const scmProcurements = pgTable(
  "scm_procurements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: text("code").notNull().unique(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    status: scmProcurementStatusEnum("status").notNull().default("Draft"),
    requestedById: uuid("requested_by_id")
      .notNull()
      .references(() => users.id),
    reviewingById: uuid("reviewing_by_id").references(() => users.id),
    receivingById: uuid("receiving_by_id").references(() => users.id),
    lastEvent: text("last_event"),
    lastEventAt: timestamp("last_event_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    submittedAt: timestamp("submitted_at", { mode: "date" }),
    shippedAt: timestamp("shipped_at", { mode: "date" }),
    receivedAt: timestamp("received_at", { mode: "date" }),
    paidAt: timestamp("paid_at", { mode: "date" }),
    rejectedAt: timestamp("rejected_at", { mode: "date" }),
    rejectionReason: text("rejection_reason"),
    cancelledAt: timestamp("cancelled_at", { mode: "date" }),
    cancelledById: uuid("cancelled_by_id").references(() => users.id),
    cancellationReason: text("cancellation_reason"),
    notes: text("notes"),
    requestSource: text("request_source"), // ID5: Where request originated (WhatsApp, Phone, System)
  },
  (t) => [
    index("sp_branch_idx").on(t.branchId),
    index("sp_status_idx").on(t.status),
    index("sp_requested_by_idx").on(t.requestedById),
    index("sp_created_at_idx").on(t.createdAt),
    index("sp_branch_status_idx").on(t.branchId, t.status),
  ],
);

export const scmProcurementItems = pgTable(
  "scm_procurement_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scmProcurementId: uuid("scm_procurement_id")
      .notNull()
      .references(() => scmProcurements.id, { onDelete: "cascade" }),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => ingredients.id),
    sortOrder: integer("sort_order").notNull().default(0),
    quantity: integer("quantity").notNull(),
    readyQuantity: integer("ready_quantity"),
    pickedQuantity: integer("picked_quantity"),
    receivedQuantity: integer("received_quantity"),
    rejectedQuantity: integer("rejected_quantity"),
    caDecision: caDecisionEnum("ca_decision").notNull().default("pending"),
    baDecision: baDecisionEnum("ba_decision").notNull().default("pending"),
    unitPrice: integer("unit_price"),
    reason: text("reason"),
    rejectionNote: text("rejection_note"),
  },
  (t) => [
    index("spi_procurement_idx").on(t.scmProcurementId),
    index("spi_ingredient_idx").on(t.ingredientId),
  ],
);

export const scmProcurementAuditLog = pgTable(
  "scm_procurement_audit_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scmProcurementId: uuid("scm_procurement_id")
      .notNull()
      .references(() => scmProcurements.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    fromState: scmProcurementStatusEnum("from_state"),
    toState: scmProcurementStatusEnum("to_state"),
    itemId: uuid("item_id").references(() => scmProcurementItems.id),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id),
    actorRole: text("actor_role").notNull(),
    timestamp: timestamp("timestamp", { mode: "date" }).defaultNow().notNull(),
    note: text("note"),
  },
  (t) => [
    index("spal_procurement_idx").on(t.scmProcurementId),
    index("spal_procurement_time_idx").on(t.scmProcurementId, t.timestamp),
  ],
);

export const scmProcurementInvoices = pgTable(
  "scm_procurement_invoices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scmProcurementId: uuid("scm_procurement_id")
      .notNull()
      .unique()
      .references(() => scmProcurements.id, { onDelete: "cascade" }),
    generatedAt: timestamp("generated_at", { mode: "date" }).notNull(),
    generatedById: uuid("generated_by_id")
      .notNull()
      .references(() => users.id),
    totalAmount: integer("total_amount").notNull(),
    lineItems: jsonb("line_items").notNull(),
    paidAt: timestamp("paid_at", { mode: "date" }),
    paidById: uuid("paid_by_id").references(() => users.id),
    // Set when the procurement is cancelled after finish-receive (issue #93).
    // Mirrors scm_transfer_invoices.cancelled_at (ADR 0006).
    cancelledAt: timestamp("cancelled_at", { mode: "date" }),
  },
  (t) => [index("spin_procurement_idx").on(t.scmProcurementId)],
);

export const pendingReviewInventory = pgTable(
  "pending_review_inventory",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scmProcurementId: uuid("scm_procurement_id").references(() => scmProcurements.id, {
      onDelete: "cascade",
    }),
    scmTransferId: uuid("scm_transfer_id").references(() => scmTransfers.id, {
      onDelete: "cascade",
    }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => ingredients.id),
    quantity: integer("quantity").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    createdById: uuid("created_by_id")
      .notNull()
      .references(() => users.id),
    clearedAt: timestamp("cleared_at", { mode: "date" }),
  },
  (t) => [
    index("pri_procurement_idx").on(t.scmProcurementId),
    index("pri_transfer_idx").on(t.scmTransferId),
    index("pri_branch_ingredient_idx").on(t.branchId, t.ingredientId),
    index("pri_cleared_idx").on(t.clearedAt),
    // Exactly one of scmProcurementId / scmTransferId must be set.
    check(
      "pri_exactly_one_flow_fk",
      sql`(
        (CASE WHEN ${t.scmProcurementId} IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN ${t.scmTransferId} IS NOT NULL THEN 1 ELSE 0 END)
      ) = 1`,
    ),
  ],
);

// -----------------------------------------------------------------------------
// Mutasi Stok (new FSM, ADR 0006) — Branch→Branch Surat Jalan transfers
// -----------------------------------------------------------------------------

export const scmTransfers = pgTable(
  "scm_transfers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: text("code").notNull().unique(),
    fromBranchId: uuid("from_branch_id")
      .notNull()
      .references(() => branches.id),
    toBranchId: uuid("to_branch_id")
      .notNull()
      .references(() => branches.id),
    status: scmTransferStatusEnum("status").notNull().default("SuratJalanDraft"),
    requestedById: uuid("requested_by_id")
      .notNull()
      .references(() => users.id),
    reviewingById: uuid("reviewing_by_id").references(() => users.id),
    receivingById: uuid("receiving_by_id").references(() => users.id),
    paidById: uuid("paid_by_id").references(() => users.id),
    cancelledById: uuid("cancelled_by_id").references(() => users.id),
    lastEvent: text("last_event"),
    lastEventAt: timestamp("last_event_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    submittedAt: timestamp("submitted_at", { mode: "date" }),
    approvedAt: timestamp("approved_at", { mode: "date" }),
    shippedAt: timestamp("shipped_at", { mode: "date" }),
    deliveredAt: timestamp("delivered_at", { mode: "date" }),
    receivedAt: timestamp("received_at", { mode: "date" }),
    paidAt: timestamp("paid_at", { mode: "date" }),
    rejectedAt: timestamp("rejected_at", { mode: "date" }),
    rejectionReason: text("rejection_reason"),
    cancelledAt: timestamp("cancelled_at", { mode: "date" }),
    cancellationReason: text("cancellation_reason"),
    notes: text("notes"),
    requestSource: text("request_source"), // ID5: Where request originated (WhatsApp, Phone, System)
  },
  (t) => [
    index("stx_from_branch_idx").on(t.fromBranchId),
    index("stx_to_branch_idx").on(t.toBranchId),
    index("stx_status_idx").on(t.status),
    index("stx_requested_by_idx").on(t.requestedById),
    index("stx_created_at_idx").on(t.createdAt),
    index("stx_branches_status_idx").on(t.fromBranchId, t.toBranchId, t.status),
    // Sender and receiver must be different branches.
    check("stx_branches_differ", sql`${t.fromBranchId} <> ${t.toBranchId}`),
  ],
);

export const scmTransferItems = pgTable(
  "scm_transfer_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scmTransferId: uuid("scm_transfer_id")
      .notNull()
      .references(() => scmTransfers.id, { onDelete: "cascade" }),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => ingredients.id),
    sortOrder: integer("sort_order").notNull().default(0),
    // Sender BA's promise at item-creation time. Editable only in SuratJalanDraft.
    quantity: integer("quantity").notNull(),
    // Receiver BA's actual count, set in finish-receive.
    receivedQuantity: integer("received_quantity"),
    rejectedQuantity: integer("rejected_quantity"),
    // Snapshot of ingredients.averageCost at item-creation time (global, matching
    // Pengadaan's pricing model in ADR 0003). Per-branch cost tracking is a
    // future migration; for now the sender's quoted price equals the global avg.
    unitPrice: integer("unit_price").notNull(),
    // Per-line rejection reason. Required iff rejectedQuantity > 0 — enforced
    // in the finish-receive handler, not the schema (since it's conditional).
    reason: text("reason"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    index("stxi_transfer_idx").on(t.scmTransferId),
    index("stxi_ingredient_idx").on(t.ingredientId),
    check("stxi_qty_positive", sql`${t.quantity} > 0`),
    check("stxi_received_nonneg", sql`${t.receivedQuantity} IS NULL OR ${t.receivedQuantity} >= 0`),
    check("stxi_rejected_nonneg", sql`${t.rejectedQuantity} IS NULL OR ${t.rejectedQuantity} >= 0`),
    check(
      "stxi_received_plus_rejected_le_qty",
      sql`(${t.receivedQuantity} IS NULL AND ${t.rejectedQuantity} IS NULL)
          OR (${t.receivedQuantity} IS NOT NULL AND ${t.rejectedQuantity} IS NOT NULL
              AND ${t.receivedQuantity} + ${t.rejectedQuantity} <= ${t.quantity})
          OR (${t.receivedQuantity} IS NOT NULL AND ${t.rejectedQuantity} IS NULL)
          OR (${t.receivedQuantity} IS NULL AND ${t.rejectedQuantity} IS NOT NULL)`,
    ),
  ],
);

export const scmTransferInvoices = pgTable(
  "scm_transfer_invoices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scmTransferId: uuid("scm_transfer_id")
      .notNull()
      .unique()
      .references(() => scmTransfers.id, { onDelete: "cascade" }),
    code: text("code").notNull().unique(),
    totalAmount: integer("total_amount").notNull(), // IDR
    lineItems: jsonb("line_items").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    createdById: uuid("created_by_id")
      .notNull()
      .references(() => users.id),
    paidAt: timestamp("paid_at", { mode: "date" }),
    paidById: uuid("paid_by_id").references(() => users.id),
    cancelledAt: timestamp("cancelled_at", { mode: "date" }),
  },
  (t) => [index("stxinv_transfer_idx").on(t.scmTransferId)],
);

export const scmTransferAuditLog = pgTable(
  "scm_transfer_audit_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scmTransferId: uuid("scm_transfer_id")
      .notNull()
      .references(() => scmTransfers.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    fromState: scmTransferStatusEnum("from_state"),
    toState: scmTransferStatusEnum("to_state"),
    itemId: uuid("item_id").references(() => scmTransferItems.id),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id),
    actorRole: text("actor_role").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [
    index("stxal_transfer_idx").on(t.scmTransferId),
    index("stxal_transfer_time_idx").on(t.scmTransferId, t.createdAt),
  ],
);

// =============================================================================
// MODULE 5 — WASTE & SHRINKAGE
// =============================================================================

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
    staffName: text("staff_name"), // For Denda category: who the penalty is assigned to
    notes: text("notes"),
    investigationNote: text("investigation_note"),
    valuation: integer("valuation").notNull().default(0),
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

export const operationalExpenses = pgTable(
  "operational_expenses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    wasteEntryId: uuid("waste_entry_id").references(() => wasteEntries.id),
    category: text("category").notNull(),
    amount: integer("amount").notNull(),
    date: text("date").notNull(),
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

export const dailyOverrides = pgTable(
  "daily_overrides",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    date: text("date").notNull(),
    field: text("field").notNull(), // "omzet", "hpp", etc.
    value: integer("value").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [
    index("do_branch_idx").on(t.branchId),
    index("do_date_idx").on(t.date),
    unique("do_branch_date_field_idx").on(t.branchId, t.date, t.field),
  ],
);

// =============================================================================
// MODULE 6 — AUDIT & STOCK OPNAME
// =============================================================================

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
      .references(() => users.id),
    triggeredAt: timestamp("triggered_at", { mode: "date" }).defaultNow().notNull(),
    submittedBy: uuid("submitted_by")
      .notNull()
      .references(() => users.id),
    approvedBy: uuid("approved_by").references(() => users.id),
    investigationNote: text("investigation_note"),
    realizedAt: timestamp("realized_at", { mode: "date" }), // ID4: When SO was realized
    realizedBy: uuid("realized_by").references(() => users.id), // ID4: Who realized the SO
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [
    index("so_branch_idx").on(t.branchId),
    index("so_date_idx").on(t.date),
    index("so_status_idx").on(t.status),
  ],
);

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

// ID3: Employee penalties linked to stock opname
export const employeePenalties = pgTable(
  "employee_penalties",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    stockOpnameId: uuid("stock_opname_id").references(() => stockOpnames.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    amount: integer("amount").notNull(),
    reason: text("reason").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [
    index("ep_branch_idx").on(t.branchId),
    index("ep_user_idx").on(t.userId),
    index("ep_so_idx").on(t.stockOpnameId),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tableName: text("table_name").notNull(),
    recordId: text("record_id").notNull(),
    action: text("action").notNull(),
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

// =============================================================================
// MODULE 7 — FINANCE & RECONCILIATION
// =============================================================================

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
    index("chrev_branch_idx").on(t.branchId),
    index("chrev_date_idx").on(t.date),
  ],
);

// =============================================================================
// MODULE 8 — PERIOD CONTROL
// =============================================================================

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
    balanceType: text("balance_type").notNull(),
    quantity: integer("quantity").notNull(),
  },
  (t) => [
    unique("period_balance_unique").on(t.periodLogId, t.branchId, t.ingredientId, t.balanceType),
    index("pb_period_idx").on(t.periodLogId),
  ],
);

// =============================================================================
// MODULE 9 — SYSTEM, NOTIFICATIONS & SECURITY
// =============================================================================

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
    priority: notificationPriorityEnum("priority").notNull().default("normal"), // ID7
    isRead: boolean("is_read").notNull().default(false),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [
    index("notif_user_idx").on(t.userId),
    index("notif_read_idx").on(t.isRead),
    index("notif_created_idx").on(t.createdAt),
  ],
);

// =============================================================================
// MODULE 10 — AUTH
// =============================================================================

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    // better-auth >=1.7 stores the credential issuer here ("local:credential"
    // for email/password accounts). Missing on older tables — without it,
    // signInEmail can never match a credential account and every login fails
    // with "Invalid email or password".
    issuer: text("issuer"),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const passkey = pgTable(
  "passkey",
  {
    id: text("id").primaryKey(),
    name: text("name"),
    publicKey: text("public_key").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    credentialID: text("credential_id").notNull(),
    counter: integer("counter").notNull(),
    deviceType: text("device_type").notNull(),
    backedUp: boolean("backed_up").notNull(),
    transports: text("transports"),
    createdAt: timestamp("created_at"),
    aaguid: text("aaguid"),
  },
  (table) => [
    index("passkey_userId_idx").on(table.userId),
    index("passkey_credentialID_idx").on(table.credentialID),
  ],
);

// ─── Document Code Sequences (ID9) ───

export const documentCodeSequences = pgTable(
  "document_code_sequences",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    prefix: text("prefix").notNull(),
    branchCode: text("branch_code").notNull(),
    date: text("date").notNull(), // ddmmyy format
    lastSerial: integer("last_serial").notNull().default(0),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [unique("doc_code_seq_unique").on(t.prefix, t.branchCode, t.date)],
);

// ─── Branch Staff Names (ID1) ───

export const branchStaffNames = pgTable(
  "branch_staff_names",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [unique("branch_staff_name_unique").on(t.branchId, t.name)],
);

// =============================================================================
// RELATIONS
// =============================================================================

// ─── Master Data ───

export const usersRelations = relations(users, ({ one, many }) => ({
  branch: one(branches, { fields: [users.branchId], references: [branches.id] }),
  areaManagerBranches: many(areaManagerBranches),
  passkeys: many(passkey),

  sessions: many(session),
  accounts: many(account),
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
  purchaseRequisitionsApproved: many(purchaseRequisitions, { relationName: "approvedBy" }),
  purchaseOrders: many(purchaseOrders),
  yieldConversions: many(yieldConversions),
  stockTransfers: many(stockTransfers, { relationName: "requestedBy" }),
  scmProcurementsRequested: many(scmProcurements, { relationName: "scmProcRequestedBy" }),
  scmProcurementsReviewing: many(scmProcurements, { relationName: "scmProcReviewingBy" }),
  scmProcurementsReceiving: many(scmProcurements, { relationName: "scmProcReceivingBy" }),
  scmProcurementsCancelled: many(scmProcurements, { relationName: "scmProcCancelledBy" }),
  scmProcurementAuditLog: many(scmProcurementAuditLog),
  scmProcurementInvoicesGenerated: many(scmProcurementInvoices, {
    relationName: "scmProcInvoiceGeneratedBy",
  }),
  scmProcurementInvoicesPaid: many(scmProcurementInvoices, {
    relationName: "scmProcInvoicePaidBy",
  }),
  pendingReviewInventoryCreated: many(pendingReviewInventory),
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
  recipesVisible: many(recipeBranches),
  scmProcurements: many(scmProcurements),
  pendingReviewInventory: many(pendingReviewInventory),
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
  visibleBranches: many(ingredientBranches),
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
  yieldConversionItems: many(yieldConversionItems),
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
  visibleBranches: many(recipeBranches),
}));

export const recipeChildRecipesRelations = relations(recipeChildRecipes, ({ one }) => ({
  parentRecipe: one(recipes, {
    fields: [recipeChildRecipes.parentRecipeId],
    references: [recipes.id],
    relationName: "parent",
  }),
  childRecipe: one(recipes, {
    fields: [recipeChildRecipes.childRecipeId],
    references: [recipes.id],
    relationName: "child",
  }),
}));

export const recipeBrandsRelations = relations(recipeBrands, ({ one }) => ({
  recipe: one(recipes, {
    fields: [recipeBrands.recipeId],
    references: [recipes.id],
  }),
  brand: one(brands, {
    fields: [recipeBrands.brandId],
    references: [brands.id],
  }),
}));

export const recipeIngredientsRelations = relations(recipeIngredients, ({ one }) => ({
  recipe: one(recipes, {
    fields: [recipeIngredients.recipeId],
    references: [recipes.id],
  }),
  ingredient: one(ingredients, {
    fields: [recipeIngredients.ingredientId],
    references: [ingredients.id],
  }),
}));

export const recipeModifierGroupsRelations = relations(recipeModifierGroups, ({ one }) => ({
  recipe: one(recipes, {
    fields: [recipeModifierGroups.recipeId],
    references: [recipes.id],
  }),
  modifierGroup: one(modifierGroups, {
    fields: [recipeModifierGroups.modifierGroupId],
    references: [modifierGroups.id],
  }),
}));

export const modifierIngredientsRelations = relations(modifierIngredients, ({ one }) => ({
  modifier: one(modifiers, {
    fields: [modifierIngredients.modifierId],
    references: [modifiers.id],
  }),
  ingredient: one(ingredients, {
    fields: [modifierIngredients.ingredientId],
    references: [ingredients.id],
  }),
}));

export const recipeModifierExclusionsRelations = relations(recipeModifierExclusions, ({ one }) => ({
  recipe: one(recipes, {
    fields: [recipeModifierExclusions.recipeId],
    references: [recipes.id],
  }),
  modifier: one(modifiers, {
    fields: [recipeModifierExclusions.modifierId],
    references: [modifiers.id],
  }),
  ingredient: one(ingredients, {
    fields: [recipeModifierExclusions.ingredientId],
    references: [ingredients.id],
  }),
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
  requestedByUser: one(users, {
    fields: [cancelRequests.requestedBy],
    references: [users.id],
    relationName: "requestedBy",
  }),
  approvedByUser: one(users, {
    fields: [cancelRequests.approvedBy],
    references: [users.id],
    relationName: "approvedBy",
  }),
}));

export const printRequestsRelations = relations(printRequests, ({ one }) => ({
  order: one(orders, { fields: [printRequests.orderId], references: [orders.id] }),
  requestedByUser: one(users, {
    fields: [printRequests.requestedBy],
    references: [users.id],
    relationName: "requestedBy",
  }),
  approvedByUser: one(users, {
    fields: [printRequests.approvedBy],
    references: [users.id],
    relationName: "approvedBy",
  }),
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

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(users, {
    fields: [session.userId],
    references: [users.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(users, {
    fields: [account.userId],
    references: [users.id],
  }),
}));

export const passkeyRelations = relations(passkey, ({ one }) => ({
  user: one(users, {
    fields: [passkey.userId],
    references: [users.id],
  }),
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
  procurement: one(scmProcurements, {
    fields: [inTransitInventory.scmProcurementId],
    references: [scmProcurements.id],
  }),
  transfer: one(scmTransfers, {
    fields: [inTransitInventory.scmTransferId],
    references: [scmTransfers.id],
  }),
}));

export const stockLedgerRelations = relations(stockLedger, ({ one }) => ({
  branch: one(branches, { fields: [stockLedger.branchId], references: [branches.id] }),
  ingredient: one(ingredients, {
    fields: [stockLedger.ingredientId],
    references: [ingredients.id],
  }),
}));

export const yieldConversionsRelations = relations(yieldConversions, ({ one, many }) => ({
  branch: one(branches, { fields: [yieldConversions.branchId], references: [branches.id] }),
  items: many(yieldConversionItems),
  processedByUser: one(users, { fields: [yieldConversions.processedBy], references: [users.id] }),
}));

// ─── SCM ───

export const purchaseRequisitionsRelations = relations(purchaseRequisitions, ({ one, many }) => ({
  branch: one(branches, { fields: [purchaseRequisitions.branchId], references: [branches.id] }),
  requestedByUser: one(users, {
    fields: [purchaseRequisitions.requestedBy],
    references: [users.id],
    relationName: "requestedBy",
  }),
  approvedByUser: one(users, {
    fields: [purchaseRequisitions.approvedBy],
    references: [users.id],
    relationName: "approvedBy",
  }),
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
  fromBranch: one(branches, {
    fields: [purchaseOrders.fromBranchId],
    references: [branches.id],
    relationName: "fromBranch",
  }),
  toBranch: one(branches, {
    fields: [purchaseOrders.toBranchId],
    references: [branches.id],
    relationName: "toBranch",
  }),
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
  fromBranch: one(branches, {
    fields: [deliveryNotes.fromBranchId],
    references: [branches.id],
    relationName: "fromBranch",
  }),
  toBranch: one(branches, {
    fields: [deliveryNotes.toBranchId],
    references: [branches.id],
    relationName: "toBranch",
  }),
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
  fromBranch: one(branches, {
    fields: [scmInvoices.fromBranchId],
    references: [branches.id],
    relationName: "fromBranch",
  }),
  toBranch: one(branches, {
    fields: [scmInvoices.toBranchId],
    references: [branches.id],
    relationName: "toBranch",
  }),
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
  fromBranch: one(branches, {
    fields: [stockTransfers.fromBranchId],
    references: [branches.id],
    relationName: "fromBranch",
  }),
  toBranch: one(branches, {
    fields: [stockTransfers.toBranchId],
    references: [branches.id],
    relationName: "toBranch",
  }),
  ingredient: one(ingredients, {
    fields: [stockTransfers.ingredientId],
    references: [ingredients.id],
  }),
  requestedByUser: one(users, {
    fields: [stockTransfers.requestedBy],
    references: [users.id],
    relationName: "requestedBy",
  }),
  approvedByUser: one(users, {
    fields: [stockTransfers.approvedBy],
    references: [users.id],
    relationName: "approvedBy",
  }),
}));

// ─── SCM new FSM (ADR 0002) ───

export const scmProcurementsRelations = relations(scmProcurements, ({ one, many }) => ({
  branch: one(branches, { fields: [scmProcurements.branchId], references: [branches.id] }),
  requestedBy: one(users, {
    fields: [scmProcurements.requestedById],
    references: [users.id],
    relationName: "scmProcRequestedBy",
  }),
  reviewingBy: one(users, {
    fields: [scmProcurements.reviewingById],
    references: [users.id],
    relationName: "scmProcReviewingBy",
  }),
  receivingBy: one(users, {
    fields: [scmProcurements.receivingById],
    references: [users.id],
    relationName: "scmProcReceivingBy",
  }),
  cancelledBy: one(users, {
    fields: [scmProcurements.cancelledById],
    references: [users.id],
    relationName: "scmProcCancelledBy",
  }),
  items: many(scmProcurementItems),
  auditLog: many(scmProcurementAuditLog),
  invoice: one(scmProcurementInvoices, {
    fields: [scmProcurements.id],
    references: [scmProcurementInvoices.scmProcurementId],
  }),
  pendingReviewInventory: many(pendingReviewInventory),
}));

export const scmProcurementItemsRelations = relations(scmProcurementItems, ({ one }) => ({
  procurement: one(scmProcurements, {
    fields: [scmProcurementItems.scmProcurementId],
    references: [scmProcurements.id],
  }),
  ingredient: one(ingredients, {
    fields: [scmProcurementItems.ingredientId],
    references: [ingredients.id],
  }),
}));

export const scmProcurementAuditLogRelations = relations(scmProcurementAuditLog, ({ one }) => ({
  procurement: one(scmProcurements, {
    fields: [scmProcurementAuditLog.scmProcurementId],
    references: [scmProcurements.id],
  }),
  item: one(scmProcurementItems, {
    fields: [scmProcurementAuditLog.itemId],
    references: [scmProcurementItems.id],
  }),
  actor: one(users, { fields: [scmProcurementAuditLog.actorId], references: [users.id] }),
}));

export const scmProcurementInvoicesRelations = relations(scmProcurementInvoices, ({ one }) => ({
  procurement: one(scmProcurements, {
    fields: [scmProcurementInvoices.scmProcurementId],
    references: [scmProcurements.id],
  }),
  generatedBy: one(users, {
    fields: [scmProcurementInvoices.generatedById],
    references: [users.id],
    relationName: "scmProcInvoiceGeneratedBy",
  }),
  paidBy: one(users, {
    fields: [scmProcurementInvoices.paidById],
    references: [users.id],
    relationName: "scmProcInvoicePaidBy",
  }),
}));

export const pendingReviewInventoryRelations = relations(pendingReviewInventory, ({ one }) => ({
  procurement: one(scmProcurements, {
    fields: [pendingReviewInventory.scmProcurementId],
    references: [scmProcurements.id],
  }),
  transfer: one(scmTransfers, {
    fields: [pendingReviewInventory.scmTransferId],
    references: [scmTransfers.id],
  }),
  branch: one(branches, { fields: [pendingReviewInventory.branchId], references: [branches.id] }),
  ingredient: one(ingredients, {
    fields: [pendingReviewInventory.ingredientId],
    references: [ingredients.id],
  }),
  createdBy: one(users, {
    fields: [pendingReviewInventory.createdById],
    references: [users.id],
  }),
}));

// ─── Mutasi Stok (ADR 0006) ───

export const scmTransfersRelations = relations(scmTransfers, ({ one, many }) => ({
  fromBranch: one(branches, {
    fields: [scmTransfers.fromBranchId],
    references: [branches.id],
    relationName: "scmTransferFromBranch",
  }),
  toBranch: one(branches, {
    fields: [scmTransfers.toBranchId],
    references: [branches.id],
    relationName: "scmTransferToBranch",
  }),
  requestedBy: one(users, {
    fields: [scmTransfers.requestedById],
    references: [users.id],
    relationName: "scmTransferRequestedBy",
  }),
  reviewingBy: one(users, {
    fields: [scmTransfers.reviewingById],
    references: [users.id],
    relationName: "scmTransferReviewingBy",
  }),
  receivingBy: one(users, {
    fields: [scmTransfers.receivingById],
    references: [users.id],
    relationName: "scmTransferReceivingBy",
  }),
  paidBy: one(users, {
    fields: [scmTransfers.paidById],
    references: [users.id],
    relationName: "scmTransferPaidBy",
  }),
  cancelledBy: one(users, {
    fields: [scmTransfers.cancelledById],
    references: [users.id],
    relationName: "scmTransferCancelledBy",
  }),
  items: many(scmTransferItems),
  auditLog: many(scmTransferAuditLog),
  invoice: one(scmTransferInvoices, {
    fields: [scmTransfers.id],
    references: [scmTransferInvoices.scmTransferId],
  }),
  inTransitInventory: many(inTransitInventory),
  pendingReviewInventory: many(pendingReviewInventory),
}));

export const scmTransferItemsRelations = relations(scmTransferItems, ({ one }) => ({
  transfer: one(scmTransfers, {
    fields: [scmTransferItems.scmTransferId],
    references: [scmTransfers.id],
  }),
  ingredient: one(ingredients, {
    fields: [scmTransferItems.ingredientId],
    references: [ingredients.id],
  }),
}));

export const scmTransferInvoicesRelations = relations(scmTransferInvoices, ({ one }) => ({
  transfer: one(scmTransfers, {
    fields: [scmTransferInvoices.scmTransferId],
    references: [scmTransfers.id],
  }),
  createdBy: one(users, {
    fields: [scmTransferInvoices.createdById],
    references: [users.id],
    relationName: "scmTransferInvoiceCreatedBy",
  }),
  paidBy: one(users, {
    fields: [scmTransferInvoices.paidById],
    references: [users.id],
    relationName: "scmTransferInvoicePaidBy",
  }),
}));

export const scmTransferAuditLogRelations = relations(scmTransferAuditLog, ({ one }) => ({
  transfer: one(scmTransfers, {
    fields: [scmTransferAuditLog.scmTransferId],
    references: [scmTransfers.id],
  }),
  item: one(scmTransferItems, {
    fields: [scmTransferAuditLog.itemId],
    references: [scmTransferItems.id],
  }),
  actor: one(users, { fields: [scmTransferAuditLog.actorId], references: [users.id] }),
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

export const dailyOverridesRelations = relations(dailyOverrides, ({ one }) => ({
  branch: one(branches, { fields: [dailyOverrides.branchId], references: [branches.id] }),
}));

// ─── Audit & SO ───

export const stockOpnamesRelations = relations(stockOpnames, ({ one, many }) => ({
  branch: one(branches, { fields: [stockOpnames.branchId], references: [branches.id] }),
  triggeredByUser: one(users, {
    fields: [stockOpnames.triggeredBy],
    references: [users.id],
    relationName: "triggeredBy",
  }),
  submittedByUser: one(users, {
    fields: [stockOpnames.submittedBy],
    references: [users.id],
    relationName: "submittedBy",
  }),
  approvedByUser: one(users, {
    fields: [stockOpnames.approvedBy],
    references: [users.id],
    relationName: "approvedBy",
  }),
  realizedByUser: one(users, {
    fields: [stockOpnames.realizedBy],
    references: [users.id],
    relationName: "realizedBy",
  }),
  items: many(stockOpnameItems),
  penalties: many(employeePenalties),
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

export const employeePenaltiesRelations = relations(employeePenalties, ({ one }) => ({
  branch: one(branches, { fields: [employeePenalties.branchId], references: [branches.id] }),
  stockOpname: one(stockOpnames, {
    fields: [employeePenalties.stockOpnameId],
    references: [stockOpnames.id],
  }),
  user: one(users, {
    fields: [employeePenalties.userId],
    references: [users.id],
    relationName: "penalizedUser",
  }),
  createdByUser: one(users, {
    fields: [employeePenalties.createdBy],
    references: [users.id],
    relationName: "penaltyCreatedBy",
  }),
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

// ─── Recipe Branches ───

export const recipeBranchesRelations = relations(recipeBranches, ({ one }) => ({
  recipe: one(recipes, {
    fields: [recipeBranches.recipeId],
    references: [recipes.id],
  }),
  branch: one(branches, {
    fields: [recipeBranches.branchId],
    references: [branches.id],
  }),
}));

export const branchStaffNamesRelations = relations(branchStaffNames, ({ one }) => ({
  branch: one(branches, {
    fields: [branchStaffNames.branchId],
    references: [branches.id],
  }),
}));
