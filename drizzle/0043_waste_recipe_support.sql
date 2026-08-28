ALTER TABLE "waste_entries" ALTER COLUMN "ingredient_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "waste_entries" ADD COLUMN "recipe_id" uuid;
--> statement-breakpoint
ALTER TABLE "waste_entries" ADD CONSTRAINT "waste_entries_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "waste_ingredient_idx" ON "waste_entries" USING btree ("ingredient_id");
--> statement-breakpoint
CREATE INDEX "waste_recipe_idx" ON "waste_entries" USING btree ("recipe_id");
--> statement-breakpoint
ALTER TABLE "waste_entries" ADD CONSTRAINT "waste_exactly_one_target" CHECK (((CASE WHEN ("ingredient_id" IS NOT NULL) THEN 1 ELSE 0 END) + (CASE WHEN ("recipe_id" IS NOT NULL) THEN 1 ELSE 0 END)) = 1);
