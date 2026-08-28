-- stock_ledger.quantity / balance: integer -> real
-- inventory.quantity is real and BOM yields can be fractional (e.g. 0.5 kg per
-- order). Integer ledger columns rejected fractional POS deductions
-- (balance == inventory.quantity invariant, docs/report/integration-paths-kartu-stok.md).
ALTER TABLE "stock_ledger" ALTER COLUMN "quantity" SET DATA TYPE real;--> statement-breakpoint
ALTER TABLE "stock_ledger" ALTER COLUMN "balance" SET DATA TYPE real;
