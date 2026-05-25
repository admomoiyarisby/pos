CREATE TYPE "public"."rejection_disposition" AS ENUM('Return to Source', 'Scrap', 'Quarantine');--> statement-breakpoint
ALTER TYPE "public"."delivery_note_status" ADD VALUE 'Partial Received' BEFORE 'Received';--> statement-breakpoint
ALTER TABLE "stock_transfers" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "stock_transfers" ALTER COLUMN "status" SET DEFAULT 'Pending Approval'::text;--> statement-breakpoint
DROP TYPE "public"."stock_transfer_status";--> statement-breakpoint
CREATE TYPE "public"."stock_transfer_status" AS ENUM('Pending Approval', 'Approved', 'Rejected', 'In Transit', 'Completed', 'Cancelled');--> statement-breakpoint
ALTER TABLE "stock_transfers" ALTER COLUMN "status" SET DEFAULT 'Pending Approval'::"public"."stock_transfer_status";--> statement-breakpoint
ALTER TABLE "stock_transfers" ALTER COLUMN "status" SET DATA TYPE "public"."stock_transfer_status" USING "status"::"public"."stock_transfer_status";--> statement-breakpoint
ALTER TABLE "in_transit_inventory" ALTER COLUMN "delivery_note_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "delivery_note_items" ADD COLUMN "rejection_disposition" "rejection_disposition";--> statement-breakpoint
ALTER TABLE "in_transit_inventory" ADD COLUMN "stock_transfer_id" uuid;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD COLUMN "received_quantity" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD COLUMN "rejected_by" uuid;--> statement-breakpoint
ALTER TABLE "in_transit_inventory" ADD CONSTRAINT "in_transit_inventory_stock_transfer_id_stock_transfers_id_fk" FOREIGN KEY ("stock_transfer_id") REFERENCES "public"."stock_transfers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_rejected_by_users_id_fk" FOREIGN KEY ("rejected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "iti_st_idx" ON "in_transit_inventory" USING btree ("stock_transfer_id");