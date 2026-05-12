ALTER TYPE "public"."recipe_category" ADD VALUE 'paket_bundle';--> statement-breakpoint
ALTER TABLE "order_items" ALTER COLUMN "brand_id" DROP NOT NULL;