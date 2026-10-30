# Stock opname realizes its variance onto live stock

## Context

ADR 0021 established that only an opname dated the 25th moves stock, and that
realize is the step that does it. It left the measurement rule to ADR 0001:
adjust **against the current inventory at apply time**, i.e.
`inventory = physicalStock`.

That rule assumed realize happens right after the count. In production it often
does not: the outlet closes the books and counts on the 25th, the supervisor
approves, and the SO is realized on the 28th or 29th. Every sale recorded in
between had already written its `OUT` ledger row, so setting the balance to the
25th count silently erased those days of stock-out:

```
25th  system 10, counted 7      → variance -3
26-28 5 units sold              → system 5 (each sale applied normally)
28th  realize sets stock = 7    → the 5 sales vanish from the balance
```

The branch asked exactly this: does realizing late overwrite the penjualan that
already ran on the 28th/29th? It did.

## Decision

**Realize applies the variance the count found — `physicalStock - systemStock`
— to the live balance, it does not replace the balance.**

1. `systemStock` is the trigger-time snapshot and the count is taken against
   that snapshot, so `physicalStock - systemStock` is the discrepancy the count
   discovered. Movements recorded after the snapshot are not part of it.
2. `realizeStockOpnameCore` computes
   `newQty = max(0, currentQty + variance)` per counted item, writes the
   **applied** delta (`newQty - currentQty`) to `stockLedger` under `SO:<id>`,
   and records both numbers in the notes:
   `SO Realization: selisih -3 (sistem 10 → fisik 7), stok 5 → 2`.
   The clamp stops a variance larger than the remaining stock from pushing
   inventory negative; the ledger then reports the movement that actually
   happened, not the theoretical one.
3. `approveStockOpnameCore` previews the same computation (variance applied to
   current inventory), and `getStockOpnameDetailCore`'s pending "Ringkasan
   Perubahan" mirrors it. The approve preview therefore states what realize
   will do, including when drift is present.
4. The Nasi sub-path follows the same idea: only the positive variance in
   portions (extra nasi found versus the snapshot) is converted to raw
   ingredients; a count equal to the snapshot consumes nothing.

## Consequences

- Sales, waste and deliveries recorded between the count and a late realize stay
  applied. Realizing on the 28th no longer rewinds the books to the 25th.
- The resulting balance equals "physical count at the 25th, plus everything
  recorded afterwards", which is what the outlet's own books say.
- Known residual: the baseline is the trigger snapshot, so stock that moved
  between **trigger** and the **physical count** is interpreted as part of the
  variance. Outlets trigger the SO at closing and count immediately, which
  keeps the two instants the same; a count entered hours after it was taken
  inherits the same limitation. Storing a count-time snapshot would remove it
  and is the natural follow-up if the gap becomes real.
- Ledger notes changed from `SO Realization: Adjusted from X to Y` to
  `SO Realization: selisih V (sistem X → fisik Y), stok A → B`. Historical rows
  keep the old text; both start with `SO Realization:`, so
  `usage-source.ts` classifies them identically.

## Supersedes

ADR 0001's measurement rule (`inventory = physicalStock`) and the part of ADR
0021's residual note that described movements between the count and realize as
absorbed into the `SO Realization` row.
