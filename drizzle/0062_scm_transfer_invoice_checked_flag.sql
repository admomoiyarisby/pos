-- Manual "sudah dicek" flag for Mutasi Stok invoices.
--
-- The client needs a way to record that a Surat Jalan's invoice has been
-- verified against the receiver's review while the money has not moved yet
-- (the transfer is still in WaitingForPayment). Purely informational: it does
-- NOT change the FSM state, does NOT affect stock, and does NOT gate
-- `mark-paid`. Mirrors `orders.verified` (migration 0056) used by Data
-- Penjualan.
--
-- The flag lives on the invoice (not on the transfer) because the invoice is
-- the document being checked — it only exists from the `finish-receive`
-- transition onwards, so a transfer without an invoice simply has no
-- checkbox. Audit context (who / when) is kept alongside the flag.

ALTER TABLE scm_transfer_invoices
  ADD COLUMN checked boolean NOT NULL DEFAULT false,
  ADD COLUMN checked_at timestamp,
  ADD COLUMN checked_by_id uuid REFERENCES "users"("id");
