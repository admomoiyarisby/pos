ALTER TABLE "modifier_ingredients" ALTER COLUMN "quantity" SET DATA TYPE real;--> statement-breakpoint
ALTER TABLE "recipe_child_recipes" ALTER COLUMN "quantity" SET DATA TYPE real;--> statement-breakpoint
ALTER TABLE "recipe_ingredients" ALTER COLUMN "quantity" SET DATA TYPE real;--> statement-breakpoint
ALTER TABLE "recipe_modifier_exclusions" ALTER COLUMN "quantity" SET DATA TYPE real;