# 0029 — Channel Revenue Dates Are ISO; Legacy DDMMYY Rows Were Normalized

## Context

`channel_revenues.date` is a `text` column written by the app as strict
`YYYY-MM-DD`. An import from the pre-POS system wrote **90 rows as `DDMMYY`**
(e.g. `010626` for 1 June 2026), covering 26 May – 25 June 2026 and Rp 40.2
million.

Every finance query filters that column as text:

```sql
channelRevenues.date >= '2026-06-01' AND channelRevenues.date <= '2026-06-30'
```

`'010626'` never falls inside an ISO range, so those rows have been invisible to
the ledger, the Per Channel sub-tab, and the omzet breakdown since the import.
Postgres itself parses `'010626'::date` as **2001-06-26**, not 2026-06-01, so a
cast would not have fixed it either. The unique key is on the text value, so a
legacy row and an ISO row for the same calendar day coexist rather than
conflict.

## Decision

- Normalize the 90 rows with `to_char(to_date(date, 'DDMMYY'), 'YYYY-MM-DD')`.
  All 90 round-trip exactly; there are no DDMMYY–DDMMYY duplicates.
- **Two rows are duplicates of an existing ISO row** for the same
  branch+channel+calendar date (Mulyorejo Grabfood, 20 and 23 June 2026). The
  ISO row wins — it is the value the app could already see — and the legacy
  copy is removed from the live table.
- Copy every legacy row to `channel_revenues_legacy_ddmmyy_archive` before
  changing anything, so the collision decision is reversible with an `INSERT`.
- Add `CHECK (date ~ '^\d{4}-\d{2}-\d{2}$')` so a future import cannot
  reintroduce the silent gap.
- Also delete one accidental zero payout (Darmo Permai, 1 Oct 2026, Gofood).
  ADR 0028 reads an explicit 0 as "zero revenue"; that row would hide the
  channel's POS fallback on a day with Rp 123,360 of Gofood sales.

Migration: `drizzle/0065_normalize_channel_revenue_dates.sql`.

## Consequences

- May–June 2026 payouts become visible. Combined with ADR 0028, those days now
  appear in the ledger with Omzet = payout, HPP 0, and a `—` margin (no POS
  orders existed before 22 Sep 2026), instead of not appearing at all.
- The two Mulyorejo cells keep the ISO amount (Rp 5,125,000), not the legacy
  amount (Rp 538,745 / Rp 236,017). Restoring the legacy values is a one-row
  `INSERT` from the archive if finance decides otherwise.
- `date` remains `text`; the CHECK enforces shape, not calendar validity. A
  proper `date` column is out of scope for this fix.
- The archive table is a one-off audit artifact, not part of the Drizzle
  schema; it exists only on databases that had legacy rows.
