// ============================================================
// POS Utility Functions
// ============================================================

import type { MenuItem, CartItem, Voucher } from "./pos-types";

interface BranchInventoryItem {
  ingredientId: string;
  quantity: number;
}

export function getStockQuantity(
  item: MenuItem,
  branchInventory: BranchInventoryItem[] | undefined,
): number {
  if (!branchInventory || item.ingredientIds.length === 0) return 999;
  let minQty = Infinity;
  for (let k = 0; k < item.ingredientIds.length; k++) {
    let ri = item.ingredientIds[k];
    let inv = branchInventory.find(function (i) {
      return i.ingredientId === ri.ingredientId;
    });
    let q = inv ? Math.floor(inv.quantity / ri.quantity) : 0;
    if (q < minQty) minQty = q;
  }
  return Number.isFinite(minQty) ? minQty : 999;
}

export function calculateCartTotal(cart: CartItem[]): number {
  return cart.reduce(function (sum, item) {
    return sum + item.price * item.quantity;
  }, 0);
}

export function calculateCartCount(cart: CartItem[]): number {
  return cart.reduce(function (sum, item) {
    return sum + item.quantity;
  }, 0);
}

// ── Voucher application ──

/**
 * Which voucher is actually applied to the current cart, and for how much.
 *
 * Eligibility depends on the cart total, so a voucher that qualified when the
 * cashier picked it can stop qualifying the moment an item is removed or a
 * quantity is lowered. Resolving that on every render — rather than trusting
 * the stored selection — is what keeps the voucher pill, the "Diskon" line, and
 * the payload's `voucherCode` from disagreeing. Previously a selection that
 * fell below `minOrder` kept its highlighted pill and still submitted its code,
 * while the discount silently vanished: the promo looked applied and the price
 * did not move.
 *
 * A `null` return means "no voucher" in every respect: no discount, and no
 * voucher code on the order.
 *
 * A fixed discount is capped at the cart total. The order total is computed as
 * `subtotal - discount + tax` server-side with no clamp, so an uncapped fixed
 * voucher larger than the cart would submit a negative total.
 */
export function resolveAppliedVoucher(
  selected: Voucher | null | undefined,
  cartTotal: number,
): { voucher: Voucher; discount: number } | null {
  if (!selected) return null;
  if (cartTotal < selected.minOrder) return null;

  const raw =
    selected.discountType === "percentage"
      ? Math.round((cartTotal * selected.discountValue) / 100)
      : selected.discountValue;

  return { voucher: selected, discount: Math.min(raw, cartTotal) };
}

// ── Applied modifier formatting (order history / data-penjualan detail) ──
//
// The server returns each applied option as a structured row carrying its
// group id/name and its own name. These helpers turn that into human-readable
// "Group: option1, option2" lines grouped per modifier group, in the order the
// options were applied.

export interface AppliedModifier {
  modifierGroupId: string;
  modifierGroupName: string | null;
  modifierId: string;
  modifierName: string | null;
  isExclusion?: boolean;
  price?: number;
}

// One "Group: option1, option2" line per modifier group.
export function appliedModifierLines(modifiers: AppliedModifier[]): string[] {
  const byGroup: { groupName: string; options: string[] }[] = [];
  const index = new Map<string, number>();
  for (const m of modifiers) {
    const groupName = m.modifierGroupName ?? "Modifier";
    let i = index.get(groupName);
    if (i === undefined) {
      i = byGroup.length;
      index.set(groupName, i);
      byGroup.push({ groupName, options: [] });
    }
    byGroup[i].options.push(m.modifierName ?? "Opsi");
  }
  return byGroup.map((g) => `${g.groupName}: ${g.options.join(", ")}`);
}

// A single comma-joined string of "Group: option1, option2" for compact rows
// where multiple lines would break the layout.
export function appliedModifiersSummary(modifiers: AppliedModifier[]): string {
  return appliedModifierLines(modifiers).join(" · ");
}
