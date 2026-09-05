// ============================================================
// POS Utility Functions
// ============================================================

import type { MenuItem, CartItem } from "./pos-types";

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
