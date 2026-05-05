CREATE TYPE "public"."branch_type" AS ENUM('Central', 'Outlet');--> statement-breakpoint
CREATE TYPE "public"."cancel_request_reason" AS ENUM('Stok Habis', 'Salah Input', 'Customer Cancel');--> statement-breakpoint
CREATE TYPE "public"."cancel_request_status" AS ENUM('Pending', 'Approved', 'Rejected');--> statement-breakpoint
CREATE TYPE "public"."delivery_note_status" AS ENUM('Draft', 'Picking', 'In Transit', 'Received', 'Cancelled');--> statement-breakpoint
CREATE TYPE "public"."ingredient_category" AS ENUM('Fresh', 'Dry', 'Packaging');--> statement-breakpoint
CREATE TYPE "public"."ingredient_status" AS ENUM('Active', 'Inactive');--> statement-breakpoint
CREATE TYPE "public"."log_status" AS ENUM('Success', 'Warning', 'Error');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('info', 'warning', 'alert');--> statement-breakpoint
CREATE TYPE "public"."order_channel" AS ENUM('Gofood', 'Grabfood', 'ShopeeFood', 'Dine-in');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('New', 'Processing', 'In Delivery', 'Completed', 'Void', 'Cancel Requested');--> statement-breakpoint
CREATE TYPE "public"."period_status" AS ENUM('Open', 'Closed');--> statement-breakpoint
CREATE TYPE "public"."po_status" AS ENUM('Draft', 'Sent', 'Partial', 'Completed', 'Cancelled');--> statement-breakpoint
CREATE TYPE "public"."pr_status" AS ENUM('Draft', 'Pending', 'Approved', 'Processed', 'Rejected', 'Fulfilled');--> statement-breakpoint
CREATE TYPE "public"."print_request_status" AS ENUM('Pending', 'Approved', 'Rejected');--> statement-breakpoint
CREATE TYPE "public"."recipe_category" AS ENUM('makanan', 'minuman', 'snack', 'add_ons');--> statement-breakpoint
CREATE TYPE "public"."scm_invoice_status" AS ENUM('Unpaid', 'Paid', 'Cancelled');--> statement-breakpoint
CREATE TYPE "public"."shift_status" AS ENUM('Open', 'Closed');--> statement-breakpoint
CREATE TYPE "public"."sku_type" AS ENUM('RM', 'SFG', 'FG');--> statement-breakpoint
CREATE TYPE "public"."stock_ledger_type" AS ENUM('IN', 'OUT');--> statement-breakpoint
CREATE TYPE "public"."stock_opname_status" AS ENUM('Submitted', 'Approved', 'Under Investigation');--> statement-breakpoint
CREATE TYPE "public"."stock_transfer_status" AS ENUM('Pending', 'Pending Approval', 'Approved', 'Rejected', 'In Transit', 'Completed', 'Cancelled');--> statement-breakpoint
CREATE TYPE "public"."supplier_delivery_status" AS ENUM('Pending Invoice', 'Completed');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('super_admin', 'admin_pusat', 'area_manager', 'branch_admin', 'central_kitchen');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('Active', 'Inactive');--> statement-breakpoint
CREATE TYPE "public"."voucher_discount_type" AS ENUM('percentage', 'fixed');--> statement-breakpoint
CREATE TYPE "public"."waste_category" AS ENUM('Beban Makan', 'Biaya Operasional', 'Spoiled');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"description" text,
	"updated_by" uuid,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "app_settings_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "area_manager_branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	CONSTRAINT "am_branch_unique" UNIQUE("user_id","branch_id")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"table_name" text NOT NULL,
	"record_id" text NOT NULL,
	"action" text NOT NULL,
	"old_values" jsonb,
	"new_values" jsonb,
	"user_id" uuid,
	"ip_address" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"location" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"is_online" boolean DEFAULT true NOT NULL,
	"type" "branch_type" DEFAULT 'Outlet' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "branches_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"logo" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "brands_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "cancel_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"reason" "cancel_request_reason" NOT NULL,
	"detail" text,
	"requested_by" uuid NOT NULL,
	"approved_by" uuid,
	"status" "cancel_request_status" DEFAULT 'Pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"approved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "channel_revenues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"date" text NOT NULL,
	"channel" "order_channel" NOT NULL,
	"amount" integer NOT NULL,
	"notes" text,
	"submitted_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "channel_revenue_unique" UNIQUE("branch_id","date","channel")
);
--> statement-breakpoint
CREATE TABLE "delivery_note_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_note_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"ready_quantity" integer,
	"picked_quantity" integer,
	"received_quantity" integer,
	"rejected_quantity" integer DEFAULT 0,
	"discrepancy_note" text
);
--> statement-breakpoint
CREATE TABLE "delivery_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"purchase_requisition_id" uuid,
	"purchase_order_id" uuid,
	"from_branch_id" uuid NOT NULL,
	"to_branch_id" uuid NOT NULL,
	"status" "delivery_note_status" DEFAULT 'Draft' NOT NULL,
	"driver_name" text,
	"vehicle_number" text,
	"picked_by" uuid,
	"delivered_by" uuid,
	"received_by" uuid,
	"reviewed_by_admin_pusat" boolean DEFAULT false NOT NULL,
	"printed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"received_at" timestamp,
	CONSTRAINT "delivery_notes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "in_transit_inventory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_note_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingredients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"category" "ingredient_category" NOT NULL,
	"sku_type" "sku_type" NOT NULL,
	"purchase_unit" text NOT NULL,
	"stock_unit" text NOT NULL,
	"conversion_factor" integer NOT NULL,
	"average_cost" integer NOT NULL,
	"planned_cost" integer,
	"rop" integer DEFAULT 0 NOT NULL,
	"roq" integer DEFAULT 0 NOT NULL,
	"moq" integer DEFAULT 1 NOT NULL,
	"status" "ingredient_status" DEFAULT 'Active' NOT NULL,
	"countable" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ingredients_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "inventory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"last_updated" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_branch_ingredient_unique" UNIQUE("branch_id","ingredient_id")
);
--> statement-breakpoint
CREATE TABLE "manual_revenue_brand_breakdowns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"manual_revenue_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	CONSTRAINT "mr_brand_unique" UNIQUE("manual_revenue_id","brand_id")
);
--> statement-breakpoint
CREATE TABLE "manual_revenues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"date" text NOT NULL,
	"amount" integer NOT NULL,
	"notes" text,
	"submitted_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "modifier_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"min_selection" integer DEFAULT 0 NOT NULL,
	"max_selection" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "modifier_groups_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "modifier_ingredients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"modifier_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "modifier_ingredient_unique" UNIQUE("modifier_id","ingredient_id")
);
--> statement-breakpoint
CREATE TABLE "modifiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"modifier_group_id" uuid NOT NULL,
	"name" text NOT NULL,
	"price" integer DEFAULT 0 NOT NULL,
	"is_exclusion" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "modifiers_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "operational_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"waste_entry_id" uuid,
	"category" text NOT NULL,
	"amount" integer NOT NULL,
	"date" text NOT NULL,
	"notes" text,
	"submitted_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_item_exclusions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_item_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_item_modifiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_item_id" uuid NOT NULL,
	"modifier_group_id" uuid NOT NULL,
	"modifier_id" uuid NOT NULL,
	"cogs_at_transaction" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"recipe_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"price" integer NOT NULL,
	"cogs_at_transaction" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"channel" "order_channel" NOT NULL,
	"subtotal" integer NOT NULL,
	"merchant_discount" integer DEFAULT 0 NOT NULL,
	"platform_discount" integer DEFAULT 0 NOT NULL,
	"tax_amount" integer DEFAULT 0 NOT NULL,
	"total_amount" integer NOT NULL,
	"total_cogs" integer DEFAULT 0 NOT NULL,
	"mdr_fee" integer DEFAULT 0 NOT NULL,
	"net_sales" integer DEFAULT 0 NOT NULL,
	"order_code" text,
	"customer_name" text,
	"payment_method" text,
	"voucher_code" text,
	"voucher_discount" integer,
	"status" "order_status" DEFAULT 'New' NOT NULL,
	"void_reason" text,
	"shift_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "period_balances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period_log_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"balance_type" text NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "period_balance_unique" UNIQUE("period_log_id","branch_id","ingredient_id","balance_type")
);
--> statement-breakpoint
CREATE TABLE "period_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period_name" text NOT NULL,
	"status" "period_status" NOT NULL,
	"opened_at" timestamp NOT NULL,
	"closed_at" timestamp,
	"opened_by" uuid NOT NULL,
	"closed_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "period_name_unique" UNIQUE("period_name")
);
--> statement-breakpoint
CREATE TABLE "platform_fees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel" "order_channel" NOT NULL,
	"fee_percentage" integer DEFAULT 0 NOT NULL,
	"fixed_fee" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "platform_fees_channel_unique" UNIQUE("channel")
);
--> statement-breakpoint
CREATE TABLE "print_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"request_type" text NOT NULL,
	"requested_by" uuid NOT NULL,
	"approved_by" uuid,
	"status" "print_request_status" DEFAULT 'Pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"approved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "purchase_order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price" integer,
	"total_price" integer
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"purchase_requisition_id" uuid,
	"supplier_id" uuid,
	"from_branch_id" uuid NOT NULL,
	"to_branch_id" uuid NOT NULL,
	"status" "po_status" DEFAULT 'Draft' NOT NULL,
	"notes" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_orders_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "purchase_requisition_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_requisition_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"quantity" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_requisitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"status" "pr_status" DEFAULT 'Draft' NOT NULL,
	"requested_by" uuid NOT NULL,
	"approved_by" uuid,
	"notes" text,
	"rejection_reason" text,
	"is_auto_generated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_requisitions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "recipe_brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipe_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	CONSTRAINT "recipe_brand_unique" UNIQUE("recipe_id","brand_id")
);
--> statement-breakpoint
CREATE TABLE "recipe_child_recipes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_recipe_id" uuid NOT NULL,
	"child_recipe_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "recipe_child_unique" UNIQUE("parent_recipe_id","child_recipe_id")
);
--> statement-breakpoint
CREATE TABLE "recipe_ingredients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipe_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipe_modifier_exclusions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipe_id" uuid NOT NULL,
	"modifier_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "recipe_mod_excl_unique" UNIQUE("recipe_id","modifier_id","ingredient_id")
);
--> statement-breakpoint
CREATE TABLE "recipe_modifier_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipe_id" uuid NOT NULL,
	"modifier_group_id" uuid NOT NULL,
	CONSTRAINT "recipe_mod_group_unique" UNIQUE("recipe_id","modifier_group_id")
);
--> statement-breakpoint
CREATE TABLE "recipes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"image_url" text,
	"category" "recipe_category" DEFAULT 'makanan' NOT NULL,
	"is_sub_recipe" boolean DEFAULT false NOT NULL,
	"base_price" integer NOT NULL,
	"is_bogo" boolean DEFAULT false NOT NULL,
	"status" "ingredient_status" DEFAULT 'Active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "recipes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "scm_invoice_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scm_invoice_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price" integer NOT NULL,
	"total_price" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scm_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"delivery_note_id" uuid NOT NULL,
	"from_branch_id" uuid NOT NULL,
	"to_branch_id" uuid NOT NULL,
	"total_amount" integer NOT NULL,
	"status" "scm_invoice_status" DEFAULT 'Unpaid' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"due_date" timestamp NOT NULL,
	"paid_at" timestamp,
	CONSTRAINT "scm_invoices_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "shift_edits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shift_id" uuid NOT NULL,
	"field_name" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"edited_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"start_time" timestamp NOT NULL,
	"end_time" timestamp,
	"cash_float" integer NOT NULL,
	"actual_cash" integer,
	"expected_cash" integer,
	"status" "shift_status" DEFAULT 'Open' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"type" "stock_ledger_type" NOT NULL,
	"quantity" integer NOT NULL,
	"balance" integer NOT NULL,
	"reference" text NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_opname_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stock_opname_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"system_stock" integer NOT NULL,
	"physical_stock" integer NOT NULL,
	"variance" integer NOT NULL,
	"variance_percentage" numeric,
	"investigation_note" text
);
--> statement-breakpoint
CREATE TABLE "stock_opnames" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"date" text NOT NULL,
	"status" "stock_opname_status" DEFAULT 'Submitted' NOT NULL,
	"triggered_by" uuid NOT NULL,
	"triggered_at" timestamp DEFAULT now() NOT NULL,
	"submitted_by" uuid NOT NULL,
	"approved_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"from_branch_id" uuid NOT NULL,
	"to_branch_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"status" "stock_transfer_status" DEFAULT 'Pending' NOT NULL,
	"requested_by" uuid NOT NULL,
	"approved_by" uuid,
	"rejection_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "stock_transfers_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "supplier_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid,
	"supplier_name" text NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"price" integer NOT NULL,
	"delivery_date" timestamp NOT NULL,
	"received_by" uuid NOT NULL,
	"status" "supplier_delivery_status" DEFAULT 'Pending Invoice' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"contact_person" text,
	"phone" text,
	"email" text,
	"address" text,
	"status" text DEFAULT 'Active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "suppliers_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "system_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action" text NOT NULL,
	"detail" text NOT NULL,
	"user_id" uuid,
	"user_name" text,
	"status" "log_status" DEFAULT 'Success' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"type" "notification_type" DEFAULT 'info' NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" "user_role" NOT NULL,
	"pin" text,
	"status" "user_status" DEFAULT 'Active' NOT NULL,
	"branch_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "user_pin_branch_unique" UNIQUE("pin","branch_id")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vouchers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"description" text NOT NULL,
	"discount_type" "voucher_discount_type" NOT NULL,
	"discount_value" integer NOT NULL,
	"min_order" integer DEFAULT 0 NOT NULL,
	"valid_until" timestamp NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "vouchers_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "waste_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"category" "waste_category" NOT NULL,
	"notes" text,
	"investigation_note" text,
	"submitted_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "yield_conversions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"source_ingredient_id" uuid NOT NULL,
	"source_quantity" integer NOT NULL,
	"target_ingredient_id" uuid NOT NULL,
	"target_quantity" integer NOT NULL,
	"yield_percentage" numeric NOT NULL,
	"shrinkage_quantity" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"processed_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "area_manager_branches" ADD CONSTRAINT "area_manager_branches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "area_manager_branches" ADD CONSTRAINT "area_manager_branches_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cancel_requests" ADD CONSTRAINT "cancel_requests_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cancel_requests" ADD CONSTRAINT "cancel_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cancel_requests" ADD CONSTRAINT "cancel_requests_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_revenues" ADD CONSTRAINT "channel_revenues_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_revenues" ADD CONSTRAINT "channel_revenues_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_note_items" ADD CONSTRAINT "delivery_note_items_delivery_note_id_delivery_notes_id_fk" FOREIGN KEY ("delivery_note_id") REFERENCES "public"."delivery_notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_note_items" ADD CONSTRAINT "delivery_note_items_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_purchase_requisition_id_purchase_requisitions_id_fk" FOREIGN KEY ("purchase_requisition_id") REFERENCES "public"."purchase_requisitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_from_branch_id_branches_id_fk" FOREIGN KEY ("from_branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_to_branch_id_branches_id_fk" FOREIGN KEY ("to_branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_picked_by_users_id_fk" FOREIGN KEY ("picked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_delivered_by_users_id_fk" FOREIGN KEY ("delivered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "in_transit_inventory" ADD CONSTRAINT "in_transit_inventory_delivery_note_id_delivery_notes_id_fk" FOREIGN KEY ("delivery_note_id") REFERENCES "public"."delivery_notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "in_transit_inventory" ADD CONSTRAINT "in_transit_inventory_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "in_transit_inventory" ADD CONSTRAINT "in_transit_inventory_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_revenue_brand_breakdowns" ADD CONSTRAINT "manual_revenue_brand_breakdowns_manual_revenue_id_manual_revenues_id_fk" FOREIGN KEY ("manual_revenue_id") REFERENCES "public"."manual_revenues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_revenue_brand_breakdowns" ADD CONSTRAINT "manual_revenue_brand_breakdowns_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_revenues" ADD CONSTRAINT "manual_revenues_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_revenues" ADD CONSTRAINT "manual_revenues_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modifier_ingredients" ADD CONSTRAINT "modifier_ingredients_modifier_id_modifiers_id_fk" FOREIGN KEY ("modifier_id") REFERENCES "public"."modifiers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modifier_ingredients" ADD CONSTRAINT "modifier_ingredients_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modifiers" ADD CONSTRAINT "modifiers_modifier_group_id_modifier_groups_id_fk" FOREIGN KEY ("modifier_group_id") REFERENCES "public"."modifier_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_expenses" ADD CONSTRAINT "operational_expenses_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_expenses" ADD CONSTRAINT "operational_expenses_waste_entry_id_waste_entries_id_fk" FOREIGN KEY ("waste_entry_id") REFERENCES "public"."waste_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_expenses" ADD CONSTRAINT "operational_expenses_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item_exclusions" ADD CONSTRAINT "order_item_exclusions_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item_exclusions" ADD CONSTRAINT "order_item_exclusions_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item_modifiers" ADD CONSTRAINT "order_item_modifiers_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item_modifiers" ADD CONSTRAINT "order_item_modifiers_modifier_group_id_modifier_groups_id_fk" FOREIGN KEY ("modifier_group_id") REFERENCES "public"."modifier_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item_modifiers" ADD CONSTRAINT "order_item_modifiers_modifier_id_modifiers_id_fk" FOREIGN KEY ("modifier_id") REFERENCES "public"."modifiers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_balances" ADD CONSTRAINT "period_balances_period_log_id_period_logs_id_fk" FOREIGN KEY ("period_log_id") REFERENCES "public"."period_logs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_balances" ADD CONSTRAINT "period_balances_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_balances" ADD CONSTRAINT "period_balances_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_logs" ADD CONSTRAINT "period_logs_opened_by_users_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_logs" ADD CONSTRAINT "period_logs_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_requests" ADD CONSTRAINT "print_requests_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_requests" ADD CONSTRAINT "print_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_requests" ADD CONSTRAINT "print_requests_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_purchase_requisition_id_purchase_requisitions_id_fk" FOREIGN KEY ("purchase_requisition_id") REFERENCES "public"."purchase_requisitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_from_branch_id_branches_id_fk" FOREIGN KEY ("from_branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_to_branch_id_branches_id_fk" FOREIGN KEY ("to_branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requisition_items" ADD CONSTRAINT "purchase_requisition_items_purchase_requisition_id_purchase_requisitions_id_fk" FOREIGN KEY ("purchase_requisition_id") REFERENCES "public"."purchase_requisitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requisition_items" ADD CONSTRAINT "purchase_requisition_items_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_brands" ADD CONSTRAINT "recipe_brands_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_brands" ADD CONSTRAINT "recipe_brands_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_child_recipes" ADD CONSTRAINT "recipe_child_recipes_parent_recipe_id_recipes_id_fk" FOREIGN KEY ("parent_recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_child_recipes" ADD CONSTRAINT "recipe_child_recipes_child_recipe_id_recipes_id_fk" FOREIGN KEY ("child_recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_modifier_exclusions" ADD CONSTRAINT "recipe_modifier_exclusions_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_modifier_exclusions" ADD CONSTRAINT "recipe_modifier_exclusions_modifier_id_modifiers_id_fk" FOREIGN KEY ("modifier_id") REFERENCES "public"."modifiers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_modifier_exclusions" ADD CONSTRAINT "recipe_modifier_exclusions_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_modifier_groups" ADD CONSTRAINT "recipe_modifier_groups_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_modifier_groups" ADD CONSTRAINT "recipe_modifier_groups_modifier_group_id_modifier_groups_id_fk" FOREIGN KEY ("modifier_group_id") REFERENCES "public"."modifier_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scm_invoice_items" ADD CONSTRAINT "scm_invoice_items_scm_invoice_id_scm_invoices_id_fk" FOREIGN KEY ("scm_invoice_id") REFERENCES "public"."scm_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scm_invoice_items" ADD CONSTRAINT "scm_invoice_items_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scm_invoices" ADD CONSTRAINT "scm_invoices_delivery_note_id_delivery_notes_id_fk" FOREIGN KEY ("delivery_note_id") REFERENCES "public"."delivery_notes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scm_invoices" ADD CONSTRAINT "scm_invoices_from_branch_id_branches_id_fk" FOREIGN KEY ("from_branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scm_invoices" ADD CONSTRAINT "scm_invoices_to_branch_id_branches_id_fk" FOREIGN KEY ("to_branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_edits" ADD CONSTRAINT "shift_edits_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_edits" ADD CONSTRAINT "shift_edits_edited_by_users_id_fk" FOREIGN KEY ("edited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_opname_items" ADD CONSTRAINT "stock_opname_items_stock_opname_id_stock_opnames_id_fk" FOREIGN KEY ("stock_opname_id") REFERENCES "public"."stock_opnames"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_opname_items" ADD CONSTRAINT "stock_opname_items_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_opnames" ADD CONSTRAINT "stock_opnames_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_opnames" ADD CONSTRAINT "stock_opnames_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_opnames" ADD CONSTRAINT "stock_opnames_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_opnames" ADD CONSTRAINT "stock_opnames_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_from_branch_id_branches_id_fk" FOREIGN KEY ("from_branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_to_branch_id_branches_id_fk" FOREIGN KEY ("to_branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_deliveries" ADD CONSTRAINT "supplier_deliveries_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_deliveries" ADD CONSTRAINT "supplier_deliveries_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_deliveries" ADD CONSTRAINT "supplier_deliveries_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_logs" ADD CONSTRAINT "system_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_notifications" ADD CONSTRAINT "system_notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waste_entries" ADD CONSTRAINT "waste_entries_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waste_entries" ADD CONSTRAINT "waste_entries_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waste_entries" ADD CONSTRAINT "waste_entries_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yield_conversions" ADD CONSTRAINT "yield_conversions_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yield_conversions" ADD CONSTRAINT "yield_conversions_source_ingredient_id_ingredients_id_fk" FOREIGN KEY ("source_ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yield_conversions" ADD CONSTRAINT "yield_conversions_target_ingredient_id_ingredients_id_fk" FOREIGN KEY ("target_ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yield_conversions" ADD CONSTRAINT "yield_conversions_processed_by_users_id_fk" FOREIGN KEY ("processed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_table_idx" ON "audit_logs" USING btree ("table_name");--> statement-breakpoint
CREATE INDEX "audit_record_idx" ON "audit_logs" USING btree ("record_id");--> statement-breakpoint
CREATE INDEX "audit_user_idx" ON "audit_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "cr_order_idx" ON "cancel_requests" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "cr_status_idx" ON "cancel_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "chrev_branch_idx" ON "channel_revenues" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "chrev_date_idx" ON "channel_revenues" USING btree ("date");--> statement-breakpoint
CREATE INDEX "dni_dn_idx" ON "delivery_note_items" USING btree ("delivery_note_id");--> statement-breakpoint
CREATE INDEX "dn_from_branch_idx" ON "delivery_notes" USING btree ("from_branch_id");--> statement-breakpoint
CREATE INDEX "dn_to_branch_idx" ON "delivery_notes" USING btree ("to_branch_id");--> statement-breakpoint
CREATE INDEX "dn_pr_idx" ON "delivery_notes" USING btree ("purchase_requisition_id");--> statement-breakpoint
CREATE INDEX "dn_po_idx" ON "delivery_notes" USING btree ("purchase_order_id");--> statement-breakpoint
CREATE INDEX "dn_status_idx" ON "delivery_notes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "iti_branch_idx" ON "in_transit_inventory" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "iti_ingredient_idx" ON "in_transit_inventory" USING btree ("ingredient_id");--> statement-breakpoint
CREATE INDEX "iti_dn_idx" ON "in_transit_inventory" USING btree ("delivery_note_id");--> statement-breakpoint
CREATE INDEX "inventory_branch_idx" ON "inventory" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "inventory_ingredient_idx" ON "inventory" USING btree ("ingredient_id");--> statement-breakpoint
CREATE INDEX "mr_branch_idx" ON "manual_revenues" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "mr_date_idx" ON "manual_revenues" USING btree ("date");--> statement-breakpoint
CREATE INDEX "oe_branch_idx" ON "operational_expenses" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "oe_date_idx" ON "operational_expenses" USING btree ("date");--> statement-breakpoint
CREATE INDEX "oe_waste_idx" ON "operational_expenses" USING btree ("waste_entry_id");--> statement-breakpoint
CREATE INDEX "oie_item_idx" ON "order_item_exclusions" USING btree ("order_item_id");--> statement-breakpoint
CREATE INDEX "oim_item_idx" ON "order_item_modifiers" USING btree ("order_item_id");--> statement-breakpoint
CREATE INDEX "order_item_order_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_item_recipe_idx" ON "order_items" USING btree ("recipe_id");--> statement-breakpoint
CREATE INDEX "order_branch_idx" ON "orders" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "order_status_idx" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "order_created_idx" ON "orders" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "order_shift_idx" ON "orders" USING btree ("shift_id");--> statement-breakpoint
CREATE INDEX "pb_period_idx" ON "period_balances" USING btree ("period_log_id");--> statement-breakpoint
CREATE INDEX "period_status_idx" ON "period_logs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "pr_order_idx" ON "print_requests" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "pr_status_idx" ON "print_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "poi_po_idx" ON "purchase_order_items" USING btree ("purchase_order_id");--> statement-breakpoint
CREATE INDEX "po_pr_idx" ON "purchase_orders" USING btree ("purchase_requisition_id");--> statement-breakpoint
CREATE INDEX "po_supplier_idx" ON "purchase_orders" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "po_status_idx" ON "purchase_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "puri_pr_idx" ON "purchase_requisition_items" USING btree ("purchase_requisition_id");--> statement-breakpoint
CREATE INDEX "purq_branch_idx" ON "purchase_requisitions" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "purq_status_idx" ON "purchase_requisitions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sii_invoice_idx" ON "scm_invoice_items" USING btree ("scm_invoice_id");--> statement-breakpoint
CREATE INDEX "inv_dn_idx" ON "scm_invoices" USING btree ("delivery_note_id");--> statement-breakpoint
CREATE INDEX "inv_status_idx" ON "scm_invoices" USING btree ("status");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "se_shift_idx" ON "shift_edits" USING btree ("shift_id");--> statement-breakpoint
CREATE INDEX "shift_branch_idx" ON "shifts" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "shift_user_idx" ON "shifts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "shift_status_idx" ON "shifts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ledger_branch_idx" ON "stock_ledger" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "ledger_ingredient_idx" ON "stock_ledger" USING btree ("ingredient_id");--> statement-breakpoint
CREATE INDEX "ledger_ref_idx" ON "stock_ledger" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "ledger_created_idx" ON "stock_ledger" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "soi_opname_idx" ON "stock_opname_items" USING btree ("stock_opname_id");--> statement-breakpoint
CREATE INDEX "so_branch_idx" ON "stock_opnames" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "so_date_idx" ON "stock_opnames" USING btree ("date");--> statement-breakpoint
CREATE INDEX "so_status_idx" ON "stock_opnames" USING btree ("status");--> statement-breakpoint
CREATE INDEX "st_from_branch_idx" ON "stock_transfers" USING btree ("from_branch_id");--> statement-breakpoint
CREATE INDEX "st_to_branch_idx" ON "stock_transfers" USING btree ("to_branch_id");--> statement-breakpoint
CREATE INDEX "st_status_idx" ON "stock_transfers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sd_supplier_idx" ON "supplier_deliveries" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "sd_ingredient_idx" ON "supplier_deliveries" USING btree ("ingredient_id");--> statement-breakpoint
CREATE INDEX "sd_date_idx" ON "supplier_deliveries" USING btree ("delivery_date");--> statement-breakpoint
CREATE INDEX "log_action_idx" ON "system_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "log_user_idx" ON "system_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "log_created_idx" ON "system_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "notif_user_idx" ON "system_notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notif_read_idx" ON "system_notifications" USING btree ("is_read");--> statement-breakpoint
CREATE INDEX "notif_created_idx" ON "system_notifications" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "voucher_code_idx" ON "vouchers" USING btree ("code");--> statement-breakpoint
CREATE INDEX "waste_branch_idx" ON "waste_entries" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "waste_category_idx" ON "waste_entries" USING btree ("category");--> statement-breakpoint
CREATE INDEX "waste_created_idx" ON "waste_entries" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "yc_branch_idx" ON "yield_conversions" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "yc_source_idx" ON "yield_conversions" USING btree ("source_ingredient_id");--> statement-breakpoint
CREATE INDEX "yc_target_idx" ON "yield_conversions" USING btree ("target_ingredient_id");