// ============================================================
// POS Types — shared across all POS component files
// ============================================================

export interface CartModifier {
  groupId: string;
  modifierId: string;
  name: string;
  price: number;
  isExclusion: boolean;
}

export interface CartItem {
  recipeId: string;
  brandId?: string;
  name: string;
  price: number;
  quantity: number;
  modifiers: CartModifier[];
  notes: string;
}

export interface MenuItemModifier {
  id: string;
  name: string;
  price: number;
  isExclusion: boolean;
  excludedIngredientId: string | null;
}

export interface ModifierGroup {
  modifierGroupId: string;
  groupName: string | null;
  minSelection: number | null;
  maxSelection: number | null;
  modifiers: MenuItemModifier[];
}

export interface MenuItem {
  id: string;
  code: string;
  name: string;
  imageUrl: string | null;
  category: string;
  basePrice: number;
  isBOGO: boolean;
  isStaffMeal: boolean;
  isBundle: boolean;
  brands: { id: string; name: string | null }[];
  modifierGroups: ModifierGroup[];
  ingredientIds: { ingredientId: string; quantity: number }[];
}

export interface Voucher {
  id: string;
  code: string;
  description: string;
  discountType: "percentage" | "fixed";
  discountValue: number;
  minOrder: number;
  validUntil: Date;
  isActive: boolean;
}

export interface OrderResult {
  id: string;
  branchId: string;
  channel: string;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  totalCogs: number;
  orderCode: string | null;
  customerName: string | null;
  paymentMethod: string | null;
  voucherCode: string | null;
  voucherDiscount: number | null;
  status: string;
  voidReason: string | null;
  notes: string | null;
  shiftId: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

export interface ModifierModalState {
  item: MenuItem;
  selectedModifiers: CartModifier[];
  itemNotes: string;
}

export interface ShiftModalState {
  mode: "open" | "close";
}

export interface VoidModalState {
  orderId: string;
  reason: string;
}
