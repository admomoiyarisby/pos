CREATE TABLE IF NOT EXISTS "modifier_recipes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "modifier_id" uuid NOT NULL,
  "recipe_id" uuid NOT NULL,
  "quantity" real NOT NULL,
  CONSTRAINT "modifier_recipe_unique" UNIQUE("modifier_id", "recipe_id")
);
--> statement-breakpoint
ALTER TABLE "modifier_recipes" ADD CONSTRAINT "modifier_recipes_modifier_id_modifiers_id_fk" FOREIGN KEY ("modifier_id") REFERENCES "public"."modifiers"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "modifier_recipes" ADD CONSTRAINT "modifier_recipes_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE no action ON UPDATE no action;
