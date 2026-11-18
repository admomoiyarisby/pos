// ============================================================
// Duplicate Order Guard — shared matching rules
// ============================================================
//
// One physical order should produce one row. Two shapes count as a
// duplicate (see ADR 0032):
//
//  - `same-code`: a non-void order at the same branch + channel already
//    carries the same Kode Order (the external platform's code). This is
//    certain enough to block outright — re-entering a delivered order is
//    always a mistake, never a new sale.
//  - `same-identity`: the same channel, total, customer and item lines were
//    recorded within the last few minutes. That is what a double-tap or a
//    re-typed order looks like, but it is also what two genuinely separate
//    identical orders look like, so the cashier confirms it explicitly.
//
// The rules live here (pure) so the POS popup and the server guard cannot
// drift apart. `src/lib/server/pos.ts` loads candidate rows; this module
// decides whether they match.

/** How far back an identically-shaped order counts as a likely duplicate. */
export const DUPLICATE_ORDER_WINDOW_MINUTES = 10;

const WINDOW_MS = DUPLICATE_ORDER_WINDOW_MINUTES * 60 * 1000;

/** One order line, in the shape both the cart and stored orders provide. */
export interface DuplicateOrderLine {
  recipeId: string;
  /** Display only — never part of the match signature. */
  recipeName?: string | null;
  quantity: number;
  price: number;
  /** Applied modifier ids; order does not matter. */
  modifierIds: string[];
  notes?: string | null;
}

/** The order being checked. */
export interface DuplicateOrderIdentity {
  channel: string;
  orderCode?: string | null;
  customerName?: string | null;
  totalAmount: number;
  lines: DuplicateOrderLine[];
}

/** An existing order loaded from the database. */
export interface DuplicateOrderCandidate extends DuplicateOrderIdentity {
  id: string;
  status: string;
  createdAt: Date;
}

export type DuplicateOrderReason = "same-code" | "same-identity";

export interface DuplicateOrderMatch {
  reason: DuplicateOrderReason;
  order: DuplicateOrderCandidate;
}

/**
 * Trim + case-fold a Kode Order. Cashiers retype these codes from a tablet;
 * whitespace and casing differences are input noise, not a different order.
 */
export function normalizeOrderCode(code: string | null | undefined): string | null {
  const normalized = (code ?? "").trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

/** Customer names are compared case- and whitespace-insensitively. */
export function normalizeCustomerName(name: string | null | undefined): string {
  return (name ?? "").trim().toLowerCase();
}

/**
 * Canonical identity of an order's lines: same recipes, quantities, prices,
 * modifiers and notes regardless of the order they were entered in. Prices
 * are part of the identity so a re-priced order (e.g. a different voucher
 * era) is not mistaken for a copy.
 */
export function orderIdentityKey(order: Pick<DuplicateOrderIdentity, "lines">): string {
  return order.lines
    .map(function (line) {
      const modifiers = [...line.modifierIds].sort().join(",");
      return [line.recipeId, line.quantity, line.price, modifiers, (line.notes ?? "").trim()].join(
        ":",
      );
    })
    .sort()
    .join("|");
}

/** True when at least one match is certain enough to refuse the order. */
export function hasBlockingDuplicate(matches: DuplicateOrderMatch[]): boolean {
  return matches.some(function (match) {
    return match.reason === "same-code";
  });
}

/**
 * Match an order against previously loaded candidates.
 *
 * `now` is injected so the window is testable and so the server can apply one
 * consistent clock to every candidate in a batch.
 */
export function findDuplicateOrderMatches(
  input: DuplicateOrderIdentity,
  candidates: DuplicateOrderCandidate[],
  now: Date,
): DuplicateOrderMatch[] {
  const inputCode = normalizeOrderCode(input.orderCode);
  const inputName = normalizeCustomerName(input.customerName);
  const inputSignature = orderIdentityKey(input);
  const nowMs = now.getTime();
  const seen = new Set<string>();
  const matches: DuplicateOrderMatch[] = [];

  for (const candidate of candidates) {
    // A void stays in history for audit, but it never blocks or warns about
    // its replacement: re-entering a voided order is exactly the fix.
    if (candidate.status === "Void") continue;
    if (seen.has(candidate.id)) continue;

    const candidateCode = normalizeOrderCode(candidate.orderCode);

    // Certain duplicate: the platform order code is unique per branch/channel.
    if (inputCode !== null && candidateCode !== null && inputCode === candidateCode) {
      seen.add(candidate.id);
      matches.push({ reason: "same-code", order: candidate });
      continue;
    }

    // Two different platform codes are two different orders, even when the
    // cashier happened to ring up identical items.
    if (inputCode !== null && candidateCode !== null) continue;

    // A missing code on either side is not a differentiator — it is exactly
    // the "re-typed the delivery order without the code" case this guards.
    const ageMs = nowMs - candidate.createdAt.getTime();
    if (ageMs > WINDOW_MS) continue;

    if (
      candidate.channel === input.channel &&
      candidate.totalAmount === input.totalAmount &&
      normalizeCustomerName(candidate.customerName) === inputName &&
      orderIdentityKey(candidate) === inputSignature
    ) {
      seen.add(candidate.id);
      matches.push({ reason: "same-identity", order: candidate });
    }
  }

  // Certain matches lead so the popup can state the strongest finding first.
  return matches.sort(function (a, b) {
    if (a.reason === b.reason) return 0;
    return a.reason === "same-code" ? -1 : 1;
  });
}
