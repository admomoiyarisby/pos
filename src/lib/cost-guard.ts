/**
 * Guard against a package price typed into a per-unit cost field.
 *
 * `ingredients.average_cost` is rupiah **per stock unit** (per ml, per gr, per
 * pcs). It is also the COGS basis for every recipe, and COGS is frozen into each
 * sale, so one wrong number silently misprices every menu containing that
 * ingredient for as long as it stands. The 26 Sep 2026 incident was exactly
 * this: water entered at Rp 369/ml (a bottle price) instead of Rp 1/ml, which
 * put Rp 66.420 of water into a bowl of miso soup and Rp 4.9M of phantom HPP
 * into one day across nine branches.
 *
 * The guard is a ratio, not a sanity range: absolute rupiah limits differ per
 * ingredient, and every ingredient legitimately starts at 0 (first costing), so
 * only a *change* is informative. Two bands keep it from becoming noise:
 *
 *  - up to 5× (either direction) — a normal price move, applied silently.
 *  - 5×–50× — plausible but suspicious (a supplier swap, a new pack size).
 *    Applies only after the user confirms a preview of the menus it reprices.
 *  - above 50× — almost certainly a unit mistake. Same confirmation, logged at
 *    Warning so it is visible after the fact.
 *
 * Pure: no DB, no clock — unit-tested in `cost-guard.test.ts`.
 */

/** Largest change applied without asking, in either direction. */
export const COST_SILENT_RATIO = 5;
/** Beyond this the change is treated as an almost-certain unit mistake. */
export const COST_EXTREME_RATIO = 50;

export type CostChangeVerdict = "unchanged" | "silent" | "confirm" | "extreme";

export interface CostChangeAssessment {
  verdict: CostChangeVerdict;
  /** `next / previous`. `null` when there is no previous price to compare with. */
  ratio: number | null;
  /** `next − previous`, in rupiah per stock unit. */
  delta: number;
}

/**
 * How a cost edit should be handled.
 *
 * `previous <= 0` is deliberately *not* a ratio case: every ingredient is created
 * at 0, so first costing would otherwise trip the guard on every row — and a
 * guard that fires on the normal case is one users learn to click through.
 * Dropping a priced ingredient to 0 *is* extreme: it makes every menu containing
 * it free, which distorts COGS as badly as an inflated price.
 */
export function assessCostChange(previous: number, next: number): CostChangeAssessment {
  const delta = next - previous;
  if (delta === 0) return { verdict: "unchanged", ratio: previous > 0 ? 1 : null, delta: 0 };
  if (previous <= 0) return { verdict: "silent", ratio: null, delta };
  if (next <= 0) return { verdict: "extreme", ratio: 0, delta };

  const ratio = next / previous;
  const factor = ratio >= 1 ? ratio : 1 / ratio;
  const verdict: CostChangeVerdict =
    factor <= COST_SILENT_RATIO ? "silent" : factor <= COST_EXTREME_RATIO ? "confirm" : "extreme";

  return { verdict, ratio, delta };
}

/** A cost edit that must be confirmed before it is written. */
export function needsCostConfirmation(verdict: CostChangeVerdict): boolean {
  return verdict === "confirm" || verdict === "extreme";
}

/**
 * The price the user would pay for one *purchase* unit, which is the number a
 * human recognises ("Rp 221.400 per botol") and the number they meant to type.
 */
export function costPerPurchaseUnit(costPerStockUnit: number, conversionFactor: number): number {
  const factor = conversionFactor > 0 ? conversionFactor : 1;
  return Math.round(costPerStockUnit * factor);
}

/** The unit triple an ingredient's price is expressed against. */
export interface CostUnits {
  stockUnit: string;
  purchaseUnit: string;
  conversionFactor: number;
}

export type QuotedCostResolution =
  | {
      ok: true;
      /** The price expressed per stock unit — what `average_cost` stores. */
      costPerStockUnit: number;
      /** The CSV/quote unit when it had to be converted, else null. */
      convertedFrom: string | null;
    }
  | { ok: false };

/**
 * Turn a price quoted in some unit into rupiah per stock unit.
 *
 * Bulk imports are the other place this goes wrong: a spreadsheet quotes
 * "Harga per item" in its own `Satuan`, and writing that number straight into
 * `average_cost` silently reinterprets it as per stock unit. A price per
 * purchase unit divides by the conversion factor; a unit that matches neither
 * side is refused rather than guessed.
 *
 * An absent unit on either side keeps the old behaviour (take the number as
 * quoted) — the goal is to catch the mismatch, not to block a source that does
 * not carry units at all.
 */
export function resolveQuotedCost(
  price: number,
  quotedUnit: string,
  units: CostUnits,
): QuotedCostResolution {
  const quoted = quotedUnit.trim().toLowerCase();
  const stock = units.stockUnit.trim().toLowerCase();
  const purchase = units.purchaseUnit.trim().toLowerCase();

  if (!quoted || !stock) return { ok: true, costPerStockUnit: price, convertedFrom: null };
  if (quoted === stock) return { ok: true, costPerStockUnit: price, convertedFrom: null };
  if (quoted === purchase) {
    const factor = units.conversionFactor > 1 ? units.conversionFactor : 1;
    return { ok: true, costPerStockUnit: Math.round(price / factor), convertedFrom: quoted };
  }
  return { ok: false };
}

/**
 * A menu whose HPP now meets or exceeds what it is sold for.
 *
 * Ratio bands only describe a *change*; they cannot see a first costing (0 → price
 * has no previous value) and they are blind to a small change that still tips a
 * menu underwater. This is the check that does not depend on either: the sale is
 * losing money on paper, so the number has to be wrong (or the price does).
 *
 * `sellPrice > 0` keeps pseudo-menus — the ones created with price 0 for
 * packaging or LPG — from asking forever.
 */
export function costBreaksSellingPrice(
  cogsBefore: number,
  cogsAfter: number,
  sellPrice: number,
): boolean {
  return sellPrice > 0 && cogsAfter >= sellPrice && cogsAfter > cogsBefore;
}
