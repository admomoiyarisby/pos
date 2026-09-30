-- Manual review flag for sales transactions (Data Penjualan).
--
-- A super_admin/admin_pusat can mark an order as "sudah diperiksa" after
-- verifying its numbers against the channel's report. Purely informational:
-- no effect on aggregates, stock, or exports. Audit context (who/when) is
-- kept alongside the flag.

ALTER TABLE orders
  ADD COLUMN verified boolean NOT NULL DEFAULT false,
  ADD COLUMN verified_at timestamp,
  ADD COLUMN verified_by_id uuid REFERENCES "users"("id");
