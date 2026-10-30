# Safety stock is 3 days of usage times 5 days of lead time

## Context

Branch staff order from the Central Kitchen without a stock reference: they
choose quantities from memory, so a fast-moving item runs out before the next
delivery while a slow one sits on the shelf. The client asked for a
colour/marker showing when current stock is below a reference, plus a
recommendation column staff can follow, in both the stock list and the order
form.

The formula the client named is "average stock-out over 3 days × 5 days (lead
time)". It leaves three things open: which 3 days, what "average" divides by,
and what the marker compares against.

## Decision

**The reference is `avgDailyUsage × 5`, where `avgDailyUsage` is the last 3
complete Jakarta days of stock-out divided by 3.**

1. **Window.** The three days are yesterday, the day before, and the day before
   that — today is partial, so including it would understate usage and
   recommend too little. Days are bucketed in `Asia/Jakarta`, the same calendar
   as Stok Keluar.
2. **Source rows.** `stockLedger` `OUT` rows for raw ingredients (`recipeId`
   null, `isNasi` false), with the Stok Keluar cancellation filters exported
   from `finance.ts`: voided orders, cancelled waste and cancelled production
   never count as consumption even though their original OUT rows stay in the
   ledger for audit. A ledger row without an inventory row counts as usage with
   current stock 0, so an item that is fully stocked out still gets a
   recommendation.
3. **Status.** `daysCover = currentStock / avgDailyUsage`. Under 5 days is
   `low` (red — the next delivery may not arrive in time), 5–7 days is `watch`
   (amber), above 7 is `ok` (green), and a window with no usage is `no-data`
   (no marker; the recommendation is 0 rather than a fabricated target).
4. **Recommendation.** `roundQuantity(max(0, targetStock - currentStock))` at
   the 3-decimal quantity precision. An `ok` item already covers the target, so
   its recommendation is 0; a negative balance adds to the shortfall.
5. **Surfaces.** `/inventory` (Stok saat ini) gains `Status` and `Rekomendasi`
   columns; `/scm-procurements/new` shows the same numbers beside the selected
   ingredient with a one-click "Isi rekomendasi" that fills the quantity. The
   colours reuse the shared `StockStatusBadge` so both screens agree.
6. **Scope.** `branch_admin` / `central_kitchen` read their own branch,
   `area_manager` the assigned branches, `super_admin` / `admin_pusat` any or
   all — the same branches and the same "ignore an out-of-scope request"
   behaviour as Stok Keluar.

The arithmetic lives in `src/lib/stock-recommendation.ts` (pure, unit tested)
and the database read in `src/lib/server/stock-recommendation.ts` (ADR 0015
core seam with an injectable `now`).

## Consequences

- The marker is a planning hint, not an accounting figure: it reads the same
  ledger as Stok Keluar but never writes stock, and it does not value the
  shortfall in Rupiah.
- A single quiet weekend pushes an intermittent item to `no-data` instead of
  inventing a target from one small sale; that is deliberate. Three days is
  short and noisy by nature, and `no-data` is the honest answer.
- The 3-and-5 numbers are constants, not per-ingredient settings. Per-ingredient
  lead times or seasonal targets would need their own columns and a migration;
  the pure function keeps that door open.
- Cancelled-document filters are shared with Stok Keluar rather than
  reimplemented, so the two reports cannot drift on what "usage" means.
