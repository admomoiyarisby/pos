-- ADR-0014: Modifier option kind (text / ingredient / recipe).
-- Add the native enum, the `kind` column, backfill existing rows from their
-- current joins (ingredient -> recipe -> text precedence), and delete the
-- stray conflicting link so the exactly-one-kind invariant holds from day one.
CREATE TYPE "public"."modifier_kind" AS ENUM('text', 'ingredient', 'recipe');--> statement-breakpoint
ALTER TABLE "modifiers" ADD COLUMN IF NOT EXISTS "kind" "public"."modifier_kind" DEFAULT 'text' NOT NULL;--> statement-breakpoint
UPDATE "modifiers" SET "kind" = 'ingredient' WHERE EXISTS (SELECT 1 FROM "modifier_ingredients" "mi" WHERE "mi"."modifier_id" = "modifiers"."id");--> statement-breakpoint
UPDATE "modifiers" SET "kind" = 'recipe' WHERE "kind" = 'text' AND EXISTS (SELECT 1 FROM "modifier_recipes" "mr" WHERE "mr"."modifier_id" = "modifiers"."id");--> statement-breakpoint
DELETE FROM "modifier_recipes" WHERE "modifier_id" IN (SELECT "id" FROM "modifiers" WHERE "kind" = 'ingredient');