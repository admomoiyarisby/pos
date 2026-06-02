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
