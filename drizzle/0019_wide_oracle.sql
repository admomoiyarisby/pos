CREATE TYPE "public"."notification_priority" AS ENUM('normal', 'urgent');--> statement-breakpoint
ALTER TYPE "public"."order_channel" ADD VALUE 'TikTok';--> statement-breakpoint
ALTER TYPE "public"."waste_category" ADD VALUE 'Denda';--> statement-breakpoint
CREATE TABLE "branch_staff_names" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "branch_staff_name_unique" UNIQUE("branch_id","name")
);
--> statement-breakpoint
CREATE TABLE "daily_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"date" text NOT NULL,
	"field" text NOT NULL,
	"value" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "do_branch_date_field_idx" UNIQUE("branch_id","date","field")
);
--> statement-breakpoint
CREATE TABLE "document_code_sequences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prefix" text NOT NULL,
	"branch_code" text NOT NULL,
	"date" text NOT NULL,
	"last_serial" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "doc_code_seq_unique" UNIQUE("prefix","branch_code","date")
);
--> statement-breakpoint
CREATE TABLE "employee_penalties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"stock_opname_id" uuid,
	"user_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "pin" text;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "is_staff_meal" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "scm_procurements" ADD COLUMN "request_source" text;--> statement-breakpoint
ALTER TABLE "scm_transfers" ADD COLUMN "request_source" text;--> statement-breakpoint
ALTER TABLE "stock_opnames" ADD COLUMN "realized_at" timestamp;--> statement-breakpoint
ALTER TABLE "stock_opnames" ADD COLUMN "realized_by" uuid;--> statement-breakpoint
ALTER TABLE "system_notifications" ADD COLUMN "priority" "notification_priority" DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "waste_entries" ADD COLUMN "staff_name" text;--> statement-breakpoint
ALTER TABLE "yield_conversions" ADD COLUMN "production_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "branch_staff_names" ADD CONSTRAINT "branch_staff_names_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_overrides" ADD CONSTRAINT "daily_overrides_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_penalties" ADD CONSTRAINT "employee_penalties_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_penalties" ADD CONSTRAINT "employee_penalties_stock_opname_id_stock_opnames_id_fk" FOREIGN KEY ("stock_opname_id") REFERENCES "public"."stock_opnames"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_penalties" ADD CONSTRAINT "employee_penalties_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_penalties" ADD CONSTRAINT "employee_penalties_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "do_branch_idx" ON "daily_overrides" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "do_date_idx" ON "daily_overrides" USING btree ("date");--> statement-breakpoint
CREATE INDEX "ep_branch_idx" ON "employee_penalties" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "ep_user_idx" ON "employee_penalties" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ep_so_idx" ON "employee_penalties" USING btree ("stock_opname_id");--> statement-breakpoint
ALTER TABLE "stock_opnames" ADD CONSTRAINT "stock_opnames_realized_by_users_id_fk" FOREIGN KEY ("realized_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;