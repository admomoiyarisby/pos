# 0032 — POS Refuses Same Kode Order and Warns on Identical Recent Orders

## Context

The POS history at Omoiyari Darmo Permai showed two `ShopeeFood` orders placed
one minute apart with the same Rp 60.000 total: one carried a Kode Order, the
other was entered without it. The second row is a hand-made copy of the first —
the platform only sends the order once, so the extra row overstates sales,
deducts ingredients twice, and corrupts shift cash expectations.

Two mechanisms produce it:

1. The same Kode Order is typed or scanned twice (double tap, reopened payment
   modal, two cashiers on the same tablet).
2. The delivery order is re-entered without its code, usually after a
   "transaksi gagal" that had actually succeeded, so the code alone cannot
   identify the copy.

`order_code` had no uniqueness constraint and `createOrderCore` wrote every
submission, so nothing upstream of the database could catch either shape. The
existing history filters (branch, date, channel) are also the wrong tool for
spotting a copy at entry time: the cashier would have to search by hand while
the customer waits.

## Decision

Check every order before it is written, using two match strengths defined once
in `src/lib/duplicate-order.ts` (shared by the popup and the server guard):

- **Same Kode Order — blocked, no override.** For the same branch and channel,
  any non-void, non-deleted order whose `order_code` matches after trimming and
  case-folding makes the new order a duplicate. Age is irrelevant: re-entering
  a delivered order is always a mistake. There is no "save anyway" button.
- **Same order identity — warned, confirmable.** Same branch, channel, total,
  customer name, and item lines (recipes, quantities, prices, modifiers, notes)
  within the last **10 minutes**. This covers the code-less retype and the
  double-submit. Because two genuinely separate identical orders are possible
  (two customers buying the same meal within minutes at a busy counter), the
  cashier sees a popup listing the existing order and may choose **Tetap
  Simpan**; the resubmission carries `confirmDuplicate` and the server writes
  it.

The POS calls `checkDuplicateOrders` when the cashier confirms payment and
opens the popup _before_ writing anything. The write still re-runs the same
rules in `createOrderCore` (`DuplicateOrderError`), because a popup is advisory:
direct API calls, two tablets, and races can all bypass it. A failed pre-check
does not stop the sale — the server recheck remains authoritative.

A submission ref (`submitLock`) plus the disabled pending buttons close the
same-frame double-tap window on the client; a genuine second tap after a
confirmed warning is a deliberate action.

## Consequences

- Same-code re-entry is a dead end by design; the popup points at Riwayat
  Pesanan. The refusal is not a lost sale — the sale already exists.
- Identical separate orders remain possible, but only as a deliberate,
  recorded choice made against a shown duplicate.
- Detection is application-level, not a database unique index: existing
  duplicate history may predate the guard, and voided orders must be
  re-enterable, which a partial index would complicate. Concurrent writes are
  still closed on the client; the server recheck narrows, but does not
  formally eliminate, the cross-device race.
- The 10-minute window is a constant, not a setting. It is long enough for a
  retype after a failed-looking checkout and short enough that another round
  for the same table later is not flagged.

## References

- ADR 0019 — the same "one physical movement, one record" principle for stock.
- `src/lib/duplicate-order.ts`, `checkDuplicateOrders` and
  `createOrderCore` (`src/lib/server/pos.ts`), `DuplicateOrderModal`
  (`src/components/pos/DuplicateOrderModal.tsx`).
