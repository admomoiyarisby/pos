# Branch contact phones on `branches`

The CSV source `docs/csv/Detail POS - List Cabang.csv` carries two phone numbers per outlet (`No telp`, `No Pengaduan`). These are branch-level facts (printed on receipts, called by customers) — they belong on `branches`, not on a `branch_admin` user or a separate `branch_contacts` table. We extend the schema with `phone` and `complaint_phone` (both nullable text) instead.
