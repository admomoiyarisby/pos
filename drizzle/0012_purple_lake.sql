CREATE TYPE "public"."ba_decision" AS ENUM('pending', 'accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."ca_decision" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."scm_procurement_status" AS ENUM('Draft', 'Pending', 'UnderReview', 'Rejected', 'InTransit', 'Delivered', 'ReviewingSJ', 'WaitingForPayment', 'Finished', 'Cancelled');--> statement-breakpoint
CREATE TABLE "pending_review_inventory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scm_procurement_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by_id" uuid NOT NULL,
	"cleared_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "scm_procurement_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scm_procurement_id" uuid NOT NULL,
	"event" text NOT NULL,
	"from_state" "scm_procurement_status",
	"to_state" "scm_procurement_status",
	"item_id" uuid,
	"actor_id" uuid NOT NULL,
	"actor_role" text NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "scm_procurement_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scm_procurement_id" uuid NOT NULL,
	"generated_at" timestamp NOT NULL,
	"generated_by_id" uuid NOT NULL,
	"total_amount" integer NOT NULL,
	"line_items" jsonb NOT NULL,
	"paid_at" timestamp,
	"paid_by_id" uuid,
	CONSTRAINT "scm_procurement_invoices_scm_procurement_id_unique" UNIQUE("scm_procurement_id")
);
--> statement-breakpoint
CREATE TABLE "scm_procurement_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scm_procurement_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"quantity" integer NOT NULL,
	"ready_quantity" integer,
	"picked_quantity" integer,
	"received_quantity" integer,
	"rejected_quantity" integer,
	"ca_decision" "ca_decision" DEFAULT 'pending' NOT NULL,
	"ba_decision" "ba_decision" DEFAULT 'pending' NOT NULL,
	"unit_price" integer,
	"reason" text,
	"rejection_note" text
);
--> statement-breakpoint
CREATE TABLE "scm_procurements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"status" "scm_procurement_status" DEFAULT 'Draft' NOT NULL,
	"requested_by_id" uuid NOT NULL,
	"reviewing_by_id" uuid,
	"receiving_by_id" uuid,
	"last_event" text,
	"last_event_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"submitted_at" timestamp,
	"shipped_at" timestamp,
	"received_at" timestamp,
	"paid_at" timestamp,
	"rejected_at" timestamp,
	"rejection_reason" text,
	"cancelled_at" timestamp,
	"cancelled_by_id" uuid,
	"cancellation_reason" text,
	"notes" text,
	CONSTRAINT "scm_procurements_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "pending_review_inventory" ADD CONSTRAINT "pending_review_inventory_scm_procurement_id_scm_procurements_id_fk" FOREIGN KEY ("scm_procurement_id") REFERENCES "public"."scm_procurements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_review_inventory" ADD CONSTRAINT "pending_review_inventory_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_review_inventory" ADD CONSTRAINT "pending_review_inventory_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_review_inventory" ADD CONSTRAINT "pending_review_inventory_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scm_procurement_audit_log" ADD CONSTRAINT "scm_procurement_audit_log_scm_procurement_id_scm_procurements_id_fk" FOREIGN KEY ("scm_procurement_id") REFERENCES "public"."scm_procurements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scm_procurement_audit_log" ADD CONSTRAINT "scm_procurement_audit_log_item_id_scm_procurement_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."scm_procurement_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scm_procurement_audit_log" ADD CONSTRAINT "scm_procurement_audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scm_procurement_invoices" ADD CONSTRAINT "scm_procurement_invoices_scm_procurement_id_scm_procurements_id_fk" FOREIGN KEY ("scm_procurement_id") REFERENCES "public"."scm_procurements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scm_procurement_invoices" ADD CONSTRAINT "scm_procurement_invoices_generated_by_id_users_id_fk" FOREIGN KEY ("generated_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scm_procurement_invoices" ADD CONSTRAINT "scm_procurement_invoices_paid_by_id_users_id_fk" FOREIGN KEY ("paid_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scm_procurement_items" ADD CONSTRAINT "scm_procurement_items_scm_procurement_id_scm_procurements_id_fk" FOREIGN KEY ("scm_procurement_id") REFERENCES "public"."scm_procurements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scm_procurement_items" ADD CONSTRAINT "scm_procurement_items_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scm_procurements" ADD CONSTRAINT "scm_procurements_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scm_procurements" ADD CONSTRAINT "scm_procurements_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scm_procurements" ADD CONSTRAINT "scm_procurements_reviewing_by_id_users_id_fk" FOREIGN KEY ("reviewing_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scm_procurements" ADD CONSTRAINT "scm_procurements_receiving_by_id_users_id_fk" FOREIGN KEY ("receiving_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scm_procurements" ADD CONSTRAINT "scm_procurements_cancelled_by_id_users_id_fk" FOREIGN KEY ("cancelled_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pri_procurement_idx" ON "pending_review_inventory" USING btree ("scm_procurement_id");--> statement-breakpoint
CREATE INDEX "pri_branch_ingredient_idx" ON "pending_review_inventory" USING btree ("branch_id","ingredient_id");--> statement-breakpoint
CREATE INDEX "pri_cleared_idx" ON "pending_review_inventory" USING btree ("cleared_at");--> statement-breakpoint
CREATE INDEX "spal_procurement_idx" ON "scm_procurement_audit_log" USING btree ("scm_procurement_id");--> statement-breakpoint
CREATE INDEX "spal_procurement_time_idx" ON "scm_procurement_audit_log" USING btree ("scm_procurement_id","timestamp");--> statement-breakpoint
CREATE INDEX "spin_procurement_idx" ON "scm_procurement_invoices" USING btree ("scm_procurement_id");--> statement-breakpoint
CREATE INDEX "spi_procurement_idx" ON "scm_procurement_items" USING btree ("scm_procurement_id");--> statement-breakpoint
CREATE INDEX "spi_ingredient_idx" ON "scm_procurement_items" USING btree ("ingredient_id");--> statement-breakpoint
CREATE INDEX "sp_branch_idx" ON "scm_procurements" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "sp_status_idx" ON "scm_procurements" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sp_requested_by_idx" ON "scm_procurements" USING btree ("requested_by_id");--> statement-breakpoint
CREATE INDEX "sp_created_at_idx" ON "scm_procurements" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "sp_branch_status_idx" ON "scm_procurements" USING btree ("branch_id","status");