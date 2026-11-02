-- ADR 0031 — freeze each ingredient row's rupiah cost at sale time.
--
-- ADR 0020 froze the *quantities* an order item consumed, but cost stayed on
-- the live `ingredients.average_cost`. Every later report therefore had to
-- re-price historical consumption at today's price and then guess a scale
-- factor to match `orders.total_cogs`. That approximation smeared price drift
-- across unrelated ingredients.
--
-- Storing the row cost removes the guess: the HPP breakdown becomes a plain
-- SUM of these columns. NULL marks rows written before this migration; readers
-- keep the old current-cost x quantity path (and rescale to the line's
-- `order_items.cogs_at_transaction`) until they age out.

ALTER TABLE "order_item_ingredients"
  ADD COLUMN IF NOT EXISTS "cost_at_transaction" integer;

COMMENT ON COLUMN "order_item_ingredients"."cost_at_transaction" IS
  'Rupiah cost of this row frozen at sale time (ADR 0031). NULL = pre-migration row; fall back to current cost x quantity.';
