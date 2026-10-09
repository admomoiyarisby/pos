-- ADR 0020 — transaction-time ingredient consumption snapshots per order item.
--
-- Every stock restore (void / edit restore / delete restore) used to re-resolve
-- the recipe BOM at restore time. A recipe edited between sale and restore made
-- the restored quantity differ from the deducted one, and the difference
-- vanished with no ledger row written — the silent half of the Mulyorejo /
-- Royal Plaza audits (system owed physical stock back with nothing on Kartu
-- Stok to explain it).
--
-- This table freezes, inside the ordering transaction, exactly what each order
-- item consumed. Restores replay these rows instead of re-resolving the live
-- BOM, so "restored == deducted" holds by construction — the same pattern
-- `order_items.cogs_at_transaction` already applies to cost.
--
-- Backfill is deliberately NOT attempted: order-time BOMs no longer exist for
-- historical orders, and inventing quantities would cement wrong values.
-- Orders without rows keep the legacy live-resolution path (warned in the
-- resolver) until a manual reconciliation writes them.

CREATE TABLE IF NOT EXISTS "order_item_ingredients" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_item_id" uuid NOT NULL REFERENCES "order_items"("id") ON DELETE CASCADE,
  "ingredient_id" uuid NOT NULL REFERENCES "ingredients"("id"),
  -- positive = consumed, negative = exclusion restored back at sale time;
  -- real (not integer) because BOM yields can be fractional (0.5 kg flour).
  "quantity" real NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "order_item_ingredient_unique"
  ON "order_item_ingredients" ("order_item_id", "ingredient_id");

CREATE INDEX IF NOT EXISTS "oii_item_idx"
  ON "order_item_ingredients" ("order_item_id");
