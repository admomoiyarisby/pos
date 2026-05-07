ALTER TABLE "branches" ADD COLUMN "pb1_rate" integer DEFAULT 11 NOT NULL;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "total_cogs" integer DEFAULT 0 NOT NULL;