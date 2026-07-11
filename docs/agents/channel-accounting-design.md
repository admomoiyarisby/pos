# Mulyorejo channel-accounting loader — design (resolved by wayfinder #40)

## Status

Decision ticket. All design questions resolved by HITL grilling. Implementation is #42.

## Source of truth for revenue

`docs/excel/File Omoiyari Pembukuan TENANT (Mulyorejo)-(Juni,2026).xlsx` — its
**daily sheets** (named `DDMMYYYY`, e.g. `25062026`) each have columns
`PLATFORM | Tanggal | Nama Item | HPP | Jumlah | Jumlah QR | Total Jumlah |
Total | Total HPP | Uang Masuk | Margin | Gross Profit`. The `Uang Masuk`
column is the **gross daily revenue per platform/channel** — that is the amount
to load.

> The other Excel (`Data Penjualan Omoiyari Mulyorejo.xlsx`) is a per-order
> item-count tracker (columns = order IDs, rows = items). It validates volumes
> but does NOT yield a clean daily revenue total, so it is NOT the revenue
> source. Use it only for cross-checking.

## Decisions (grilled)

1. **Granularity = daily; amount = GROSS.** One `channel_revenues` row per
   (Mulyorejo, date, channel). ~90 rows for June 2026. Use the daily sheet's
   `Uang Masuk` (or sum of `Total` per platform) as gross daily revenue.
2. **Channels = ShopeeFood, Grabfood, Gofood, Dine-in** (Excel Shopee / Grab /
   Gojek / Offline). Also **seed `platform_fees`** for these 4 if absent:
   ShopeeFood/Grabfood/Gofood = 20%, Dine-in = 0% — reuses the existing Path B
   fee values (`seed.ts` seedPlatformFees).
3. **submittedBy = Mulyorejo branch_admin** (`dewi.mulyorejo@omoiyari.net`,
   MLY-01) — the natural reporter. **date format = `ddmmyy`** to match the
   schema's document-code convention.

## Module spec (`scripts/migrate-csv/channel-accounting.ts`)

- Registered in `scripts/migrate-csv/index.ts` AFTER the CSV steps (Path A
  canonical per #44).
- Reads the Pembukuan TENANT workbook daily sheets; for each (date, platform):
  - map platform → channel enum (Shopee→ShopeeFood, Grab→Grabfood,
    Gojek→Gofood, Offline→Dine-in).
  - amount = gross `Uang Masuk` for that platform on that date (integer IDR).
  - upsert `channel_revenues` keyed on (branchId=MLY-01, date=ddmmyy, channel) —
    idempotent (INSERT … ON CONFLICT DO NOTHING, or update amount).
- Upsert `platform_fees` for the 4 channels (20/20/20/0) if absent.
- **dry-run**: print the (date, channel, amount) rows it would insert; no DB
  writes.
- **submittedBy**: resolve the MLY-01 branch_admin user id at runtime (look up by
  branch code + role, fallback to super_admin if not found).

## Schema refs

- `channel_revenues(branchId FK, date text, channel order_channel, amount int,
notes text, submittedBy FK users.id NOT NULL)`. Unique on
  (branchId, date, channel).
- `order_channel` enum = Gofood | Grabfood | ShopeeFood | Dine-in | TikTok.
- `platform_fees(channel UNIQUE, feePercentage int, fixedFee int)`.

## Path B mirror (per #44)

The `seed-data.ts` `CHANNEL_REVENUES_DATA` already seeds channel_revenues via
Path B (dev-only). Mark that the historical Mulyorejo June-2026 data is loaded by
this Path A module, not by the dev demo. No change strictly required to
seed-data.ts for this, but note the divergence in AGENTS.md.

## Verification

- `vp run migrate-csv --only channel-accounting --dry-run` prints ~90 (date,
  channel, amount) rows.
- Second run is a no-op (idempotent).
- `vp run test` / `vp check` pass.

## Implementation notes (#42, as-built)

- Excel platform labels across the 30 daily sheets are: `SHOPEE`, `GOJEK`,
  `GRAB`, `OFFLINE`, and `GRAB/ OFFLINE Q` (a merged Grab + offline-QR block on
  some days). Mapping: SHOPEE→ShopeeFood, GOJEK→Gofood, GRAB→Grabfood,
  OFFLINE→Dine-in, `GRAB/ OFFLINE Q`→Grabfood (with a `notes` marker
  "includes offline QR"). Same (date,channel) rows are summed.
- Parsing rule: a platform revenue row is one where column A is a known
  platform label AND the `Uang Masuk` column (index 9) is a finite number.
  This naturally excludes the second (inventory) section of each daily sheet.
- Uses the already-installed `xlsx` (SheetJS) dep via
  `XLSX.read(readFileSync(path), { type: "buffer" })` (ESM build has no
  `readFile`).
- As-built totals (June 2026): ShopeeFood 30d Rp19,966,876; Grabfood 30d
  Rp15,193,608; Gofood 29d Rp4,594,583; Dine-in 1d Rp420,000 (90 rows).
- **Ordering dependency (surfaced during impl):** `channel_revenues.submitted_by`
  is NOT NULL → users.id, but a bare `migrate-csv` run seeds NO users. The module
  resolves submittedBy (MLY-01 branch_admin → any super_admin → any user) and, if
  no user exists, logs a warning and SKIPS the revenue inserts (platform_fees
  still seed). To load revenue, run after Path B's user seed, or ensure a user
  exists. This is the key wiring concern for #43.
