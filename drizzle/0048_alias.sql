-- Alias for ingredients, recipes and modifiers (mask actual name)
ALTER TABLE "ingredients" ADD COLUMN IF NOT EXISTS "alias" text;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN IF NOT EXISTS "alias" text;--> statement-breakpoint
ALTER TABLE "modifiers" ADD COLUMN IF NOT EXISTS "alias" text;
