CREATE TABLE "recipe_branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipe_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "recipe_branch_unique" UNIQUE("recipe_id","branch_id")
);
--> statement-breakpoint
CREATE TABLE "yield_conversion_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"yield_conversion_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"quantity" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "yield_conversions" ALTER COLUMN "source_ingredient_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "yield_conversions" ALTER COLUMN "source_quantity" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "recipe_branches" ADD CONSTRAINT "recipe_branches_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_branches" ADD CONSTRAINT "recipe_branches_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yield_conversion_sources" ADD CONSTRAINT "yield_conversion_sources_yield_conversion_id_yield_conversions_id_fk" FOREIGN KEY ("yield_conversion_id") REFERENCES "public"."yield_conversions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yield_conversion_sources" ADD CONSTRAINT "yield_conversion_sources_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ycs_conversion_idx" ON "yield_conversion_sources" USING btree ("yield_conversion_id");--> statement-breakpoint
CREATE INDEX "ycs_ingredient_idx" ON "yield_conversion_sources" USING btree ("ingredient_id");