CREATE TYPE "public"."scm_transfer_status" AS ENUM('SuratJalanDraft', 'PendingAMReview', 'Approved', 'InTransit', 'Delivered', 'ReviewingSJ', 'WaitingForPayment', 'Finished', 'Rejected', 'Cancelled');--> statement-breakpoint
CREATE TABLE "scm_transfer_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scm_transfer_id" uuid NOT NULL,
	"event" text NOT NULL,
	"from_state" "scm_transfer_status",
	"to_state" "scm_transfer_status",
	"item_id" uuid,
	"actor_id" uuid NOT NULL,
	"actor_role" text NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scm_transfer_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scm_transfer_id" uuid NOT NULL,
	"code" text NOT NULL,
	"total_amount" integer NOT NULL,
	"line_items" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by_id" uuid NOT NULL,
	"paid_at" timestamp,
	"paid_by_id" uuid,
	"cancelled_at" timestamp,
	CONSTRAINT "scm_transfer_invoices_scm_transfer_id_unique" UNIQUE("scm_transfer_id"),
	CONSTRAINT "scm_transfer_invoices_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "scm_transfer_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scm_transfer_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"quantity" integer NOT NULL,
	"received_quantity" integer,
	"rejected_quantity" integer,
	"unit_price" integer NOT NULL,
	"reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "stxi_qty_positive" CHECK ("scm_transfer_items"."quantity" > 0),
	CONSTRAINT "stxi_received_nonneg" CHECK ("scm_transfer_items"."received_quantity" IS NULL OR "scm_transfer_items"."received_quantity" >= 0),
	CONSTRAINT "stxi_rejected_nonneg" CHECK ("scm_transfer_items"."rejected_quantity" IS NULL OR "scm_transfer_items"."rejected_quantity" >= 0),
	CONSTRAINT "stxi_received_plus_rejected_le_qty" CHECK (("scm_transfer_items"."received_quantity" IS NULL AND "scm_transfer_items"."rejected_quantity" IS NULL)
          OR ("scm_transfer_items"."received_quantity" IS NOT NULL AND "scm_transfer_items"."rejected_quantity" IS NOT NULL
              AND "scm_transfer_items"."received_quantity" + "scm_transfer_items"."rejected_quantity" <= "scm_transfer_items"."quantity")
          OR ("scm_transfer_items"."received_quantity" IS NOT NULL AND "scm_transfer_items"."rejected_quantity" IS NULL)
          OR ("scm_transfer_items"."received_quantity" IS NULL AND "scm_transfer_items"."rejected_quantity" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "scm_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"from_branch_id" uuid NOT NULL,
	"to_branch_id" uuid NOT NULL,
	"status" "scm_transfer_status" DEFAULT 'SuratJalanDraft' NOT NULL,
	"requested_by_id" uuid NOT NULL,
	"reviewing_by_id" uuid,
	"receiving_by_id" uuid,
	"paid_by_id" uuid,
	"cancelled_by_id" uuid,
	"last_event" text,
	"last_event_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"submitted_at" timestamp,
	"approved_at" timestamp,
	"shipped_at" timestamp,
	"delivered_at" timestamp,
	"received_at" timestamp,
	"paid_at" timestamp,
	"rejected_at" timestamp,
	"rejection_reason" text,
	"cancelled_at" timestamp,
	"cancellation_reason" text,
	"notes" text,
	CONSTRAINT "scm_transfers_code_unique" UNIQUE("code"),
	CONSTRAINT "stx_branches_differ" CHECK ("scm_transfers"."from_branch_id" <> "scm_transfers"."to_branch_id")
);
--> statement-breakpoint
ALTER TABLE "pending_review_inventory" ALTER COLUMN "scm_procurement_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "complaint_phone" text;--> statement-breakpoint
ALTER TABLE "in_transit_inventory" ADD COLUMN "scm_transfer_id" uuid;--> statement-breakpoint
ALTER TABLE "pending_review_inventory" ADD COLUMN "scm_transfer_id" uuid;--> statement-breakpoint
ALTER TABLE "scm_transfer_audit_log" ADD CONSTRAINT "scm_transfer_audit_log_scm_transfer_id_scm_transfers_id_fk" FOREIGN KEY ("scm_transfer_id") REFERENCES "public"."scm_transfers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scm_transfer_audit_log" ADD CONSTRAINT "scm_transfer_audit_log_item_id_scm_transfer_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."scm_transfer_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scm_transfer_audit_log" ADD CONSTRAINT "scm_transfer_audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scm_transfer_invoices" ADD CONSTRAINT "scm_transfer_invoices_scm_transfer_id_scm_transfers_id_fk" FOREIGN KEY ("scm_transfer_id") REFERENCES "public"."scm_transfers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scm_transfer_invoices" ADD CONSTRAINT "scm_transfer_invoices_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scm_transfer_invoices" ADD CONSTRAINT "scm_transfer_invoices_paid_by_id_users_id_fk" FOREIGN KEY ("paid_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scm_transfer_items" ADD CONSTRAINT "scm_transfer_items_scm_transfer_id_scm_transfers_id_fk" FOREIGN KEY ("scm_transfer_id") REFERENCES "public"."scm_transfers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scm_transfer_items" ADD CONSTRAINT "scm_transfer_items_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scm_transfers" ADD CONSTRAINT "scm_transfers_from_branch_id_branches_id_fk" FOREIGN KEY ("from_branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scm_transfers" ADD CONSTRAINT "scm_transfers_to_branch_id_branches_id_fk" FOREIGN KEY ("to_branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scm_transfers" ADD CONSTRAINT "scm_transfers_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scm_transfers" ADD CONSTRAINT "scm_transfers_reviewing_by_id_users_id_fk" FOREIGN KEY ("reviewing_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scm_transfers" ADD CONSTRAINT "scm_transfers_receiving_by_id_users_id_fk" FOREIGN KEY ("receiving_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scm_transfers" ADD CONSTRAINT "scm_transfers_paid_by_id_users_id_fk" FOREIGN KEY ("paid_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scm_transfers" ADD CONSTRAINT "scm_transfers_cancelled_by_id_users_id_fk" FOREIGN KEY ("cancelled_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stxal_transfer_idx" ON "scm_transfer_audit_log" USING btree ("scm_transfer_id");--> statement-breakpoint
CREATE INDEX "stxal_transfer_time_idx" ON "scm_transfer_audit_log" USING btree ("scm_transfer_id","created_at");--> statement-breakpoint
CREATE INDEX "stxinv_transfer_idx" ON "scm_transfer_invoices" USING btree ("scm_transfer_id");--> statement-breakpoint
CREATE INDEX "stxi_transfer_idx" ON "scm_transfer_items" USING btree ("scm_transfer_id");--> statement-breakpoint
CREATE INDEX "stxi_ingredient_idx" ON "scm_transfer_items" USING btree ("ingredient_id");--> statement-breakpoint
CREATE INDEX "stx_from_branch_idx" ON "scm_transfers" USING btree ("from_branch_id");--> statement-breakpoint
CREATE INDEX "stx_to_branch_idx" ON "scm_transfers" USING btree ("to_branch_id");--> statement-breakpoint
CREATE INDEX "stx_status_idx" ON "scm_transfers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "stx_requested_by_idx" ON "scm_transfers" USING btree ("requested_by_id");--> statement-breakpoint
CREATE INDEX "stx_created_at_idx" ON "scm_transfers" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "stx_branches_status_idx" ON "scm_transfers" USING btree ("from_branch_id","to_branch_id","status");--> statement-breakpoint
ALTER TABLE "in_transit_inventory" ADD CONSTRAINT "in_transit_inventory_scm_transfer_id_scm_transfers_id_fk" FOREIGN KEY ("scm_transfer_id") REFERENCES "public"."scm_transfers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_review_inventory" ADD CONSTRAINT "pending_review_inventory_scm_transfer_id_scm_transfers_id_fk" FOREIGN KEY ("scm_transfer_id") REFERENCES "public"."scm_transfers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "iti_transfer_idx" ON "in_transit_inventory" USING btree ("scm_transfer_id");--> statement-breakpoint
CREATE INDEX "pri_transfer_idx" ON "pending_review_inventory" USING btree ("scm_transfer_id");--> statement-breakpoint
ALTER TABLE "in_transit_inventory" ADD CONSTRAINT "iti_exactly_one_flow_fk" CHECK ((
        (CASE WHEN "in_transit_inventory"."delivery_note_id" IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN "in_transit_inventory"."stock_transfer_id" IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN "in_transit_inventory"."scm_procurement_id" IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN "in_transit_inventory"."scm_transfer_id" IS NOT NULL THEN 1 ELSE 0 END)
      ) = 1);--> statement-breakpoint
ALTER TABLE "pending_review_inventory" ADD CONSTRAINT "pri_exactly_one_flow_fk" CHECK ((
        (CASE WHEN "pending_review_inventory"."scm_procurement_id" IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN "pending_review_inventory"."scm_transfer_id" IS NOT NULL THEN 1 ELSE 0 END)
      ) = 1);