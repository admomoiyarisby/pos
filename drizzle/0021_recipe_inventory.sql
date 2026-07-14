CREATE TABLE "recipe_inventory" (
	"id" uuid PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
	"recipe_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"quantity" real DEFAULT 0 NOT NULL,
	"last_updated" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "recipe_inventory_branch_recipe_unique" UNIQUE("branch_id", "recipe_id")
);
--> statement-breakpoint
ALTER TABLE "recipe_inventory" ADD CONSTRAINT "recipe_inventory_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "recipe_inventory" ADD CONSTRAINT "recipe_inventory_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "recipe_inventory_branch_idx" ON "recipe_inventory" USING btree ("branch_id");
--> statement-breakpoint
CREATE INDEX "recipe_inventory_recipe_idx" ON "recipe_inventory" USING btree ("recipe_id");
--> statement-breakpoint
ALTER TABLE "stock_ledger" ALTER COLUMN "ingredient_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD COLUMN "recipe_id" uuid;
--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "ledger_recipe_idx" ON "stock_ledger" USING btree ("recipe_id");
