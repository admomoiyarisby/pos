-- stock_opname_items: integer -> real (fractional stock opname).
--
-- The SO count sheet is a snapshot of `inventory.quantity`, which became `real`
-- in 0016. These three columns stayed `integer`, so `triggerStockOpname` — which
-- copies the current stock straight in — crashed with
-- `invalid input syntax for type integer: "23.5"` for any branch holding a
-- fractional quantity on a countable ingredient. Physical counts were blocked
-- from carrying a fraction too (`Number.isInteger` in both count cores), which
-- is not a constraint a warehouse can actually count in: the same build that
-- made SCM quantities fractional end-to-end (9db9cc7) left opname behind.
--
-- `variance` is physicalStock - systemStock, so it inherits the fraction.
-- `variance_percentage` is already `numeric` and unaffected. Casting
-- integer -> real is lossless, so existing whole-number counts are unchanged.
ALTER TABLE "stock_opname_items"
  ALTER COLUMN "system_stock" SET DATA TYPE real;
--> statement-breakpoint
ALTER TABLE "stock_opname_items"
  ALTER COLUMN "physical_stock" SET DATA TYPE real;
--> statement-breakpoint
ALTER TABLE "stock_opname_items"
  ALTER COLUMN "variance" SET DATA TYPE real;
