ALTER TYPE "public"."print_request_status" ADD VALUE IF NOT EXISTS 'Consumed';--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "status" text DEFAULT 'Active' NOT NULL;