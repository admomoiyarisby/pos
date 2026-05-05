# POS Page Fix Plan

## Problem Summary

The POS page (`src/routes/_layout/pos.tsx`) has several UX gaps:

1. **Superadmin sees no menu** — `branchId` is empty for superadmin (`user?.branchId ?? ""`), so `enabled: !!branchId` disables the `getPosMenu` query entirely.
2. **No active branch indicator** — Users don't know which branch they're ordering for.
3. **No voucher support** — Vouchers exist in the schema and admin UI but cannot be applied at checkout.
4. **No PPN toggle** — Tax is hard-coded/absent; users need a toggle for 11% PPN.

## Current Code Analysis

### Data Flow

```
getPosMenu({ branchId, brandId?, category?, search? })
  → queries recipes (where status="Active")
  → joins brands, modifier groups, modifiers
  → returns MenuItem[]
```

The query is **disabled** when `branchId` is falsy. Superadmin has no `branchId`, so the menu never loads.

### Cart Calculation (current)

```
cartTotal = sum(item.price * item.quantity)
// No tax, no voucher discount
```

## Fixes Required

### Fix 1: Superadmin can see all menus

**Root cause**: `enabled: !!branchId` blocks the query.

**Solution**:

- For `super_admin` / `admin_pusat`: allow fetching all recipes regardless of branch.
- Change `branchId` logic:
  ```tsx
  const isAdmin = user?.role === "super_admin" || user?.role === "admin_pusat";
  ```
- Pass a sentinel value (e.g. `"all"`) or omit `branchId` from `getPosMenu` when admin.
- Update `getPosMenu` server function to make `branchId` optional.
- For admin users, show a **branch selector dropdown** (Fix 2) and still allow menu browsing. The selected branch is only needed at `createOrder` time.

**Files to change**:

- `src/lib/server/pos.ts` — make `branchId` optional in `getPosMenu` input
- `src/routes/_layout/pos.tsx` — remove `enabled: !!branchId` dependency; always fetch menu

### Fix 2: Show active branch name

**Design**: Add a branch indicator in the top bar.

- **For `branch_admin`**: Read `user.branchId` → fetch branch name via `getBranches` or include it in auth context. Display as a non-editable badge: **"📍 Omoiyari Surabaya Pusat"**.
- **For `super_admin`/`admin_pusat`**: Show a `<select>` dropdown of all branches. The selected branch becomes the "active branch" for order creation. Default to the first branch.
  ```tsx
  const [activeBranchId, setActiveBranchId] = useState("");
  ```
  Pass `activeBranchId` to `createOrder` (not `branchId` from user).

**Files to change**:

- `src/routes/_layout/pos.tsx` — add branch display/selector in top bar area

### Fix 3: Vouchers as clickable toggle cards

**Data**: Fetch active vouchers via `getVouchers({ activeOnly: true })`.

**UI**: In the cart sidebar, below the subtotal and above payment method, add a voucher section:

```
┌─────────────────────────────┐
│  🎟 Voucher                 │
│  ┌──────┐ ┌──────┐         │
│  │PROMO10│ │FREE..│         │
│  │ -10% │ │ -20k │         │
│  └──────┘ └──────┘         │
│  (click to toggle)          │
└─────────────────────────────┘
```

- Each voucher is a card showing `code`, `discountValue` + `discountType`.
- Clicking toggles it on/off. Only **one voucher at a time**.
- Show `minOrder` requirement (e.g. "Min. Rp 50,000").
- If cart subtotal < `minOrder`, disable the voucher card with dimmed styling.
- When applied, show discount line in cart summary:
  ```
  Subtotal     Rp 100,000
  Voucher      -Rp 10,000   ← new
  PPN (11%)    +Rp 11,000   ← new (Fix 4)
  ─────────────────────────
  Total        Rp 101,000
  ```

**State**:

```tsx
const [selectedVoucher, setSelectedVoucher] = useState<Voucher | null>(null);
```

**Discount calculation**:

```tsx
const discountAmount = selectedVoucher
  ? selectedVoucher.discountType === "percentage"
    ? Math.round((cartTotal * selectedVoucher.discountValue) / 100)
    : selectedVoucher.discountValue
  : 0;
```

**Files to change**:

- `src/routes/_layout/pos.tsx` — add voucher state, UI, calculation
- May need to import `getVouchers` from `#/lib/server/vouchers`

### Fix 4: PPN 11% toggle

**UI**: A simple toggle switch in the cart sidebar, above the "Bayar" button:

```
☐ PPN 11% (Rp 11,000)
```

- When checked, add `taxAmount = Math.round(cartTotal * 0.11)`.
- The tax is calculated on the **post-discount** subtotal if a voucher is applied.
- Show the tax amount next to the checkbox.

**State**:

```tsx
const [ppnEnabled, setPpnEnabled] = useState(false);
```

**Calculation**:

```tsx
const subtotalAfterDiscount = Math.max(0, cartTotal - discountAmount);
const taxAmount = ppnEnabled ? Math.round(subtotalAfterDiscount * 0.11) : 0;
const finalTotal = subtotalAfterDiscount + taxAmount;
```

**Order creation**: Include `voucherCode` and `voucherDiscount` and `taxAmount` in the `createOrder` payload. Check the `createOrder` server function to ensure it accepts these fields. If not, update it.

Let me check `createOrder` payload:

Looking at `src/lib/server/pos.ts` `createOrder`:

```ts
input: {
  branchId: string,
  channel: "Dine-in" | ...,
  customerName?: string,
  orderCode?: string,
  items: [...],
  paymentMethod: string,
  shiftId: string,
}
```

**Check**: Does the `orders` table have `voucherCode`, `voucherDiscount`, `taxAmount` fields?

Looking at schema (lines ~410–430): yes! The `orders` table has:

- `voucherCode: text("voucher_code")` — optional
- `voucherDiscount: integer("voucher_discount")` — optional
- `taxAmount: integer("tax_amount").notNull().default(0)` — exists with default 0

So the DB supports it. Check if `createOrder` server function reads these fields:

Looking at `createOrder` in `src/lib/server/pos.ts` (around line 192), need to verify it accepts these. The worker agent should check and add them if missing.

**Files to change**:

- `src/lib/server/pos.ts` — update `createOrder` to accept and store `voucherCode`, `voucherDiscount`, `taxAmount`
- `src/routes/_layout/pos.tsx` — add PPN toggle, update `handleCheckout` to include tax/voucher

## Implementation Order

1. **Fix superadmin menu visibility** (Fix 1)
   - Update `getPosMenu` to make `branchId` optional
   - Update POS page query to always be enabled
2. **Add branch indicator/selector** (Fix 2)
   - Fetch branches for admin dropdown
   - Show branch badge for branch_admin
3. **Add voucher UI** (Fix 3)
   - Fetch vouchers
   - Build toggle cards
   - Add discount to cart summary
4. **Add PPN toggle** (Fix 4)
   - Add toggle switch
   - Update cart total calculation
   - Update `createOrder` payload and server function

## Files to Modify

| File                         | Changes                                                                           |
| ---------------------------- | --------------------------------------------------------------------------------- |
| `src/routes/_layout/pos.tsx` | Branch selector, voucher cards, PPN toggle, updated checkout logic                |
| `src/lib/server/pos.ts`      | Make `branchId` optional in `getPosMenu`; add voucher/tax fields to `createOrder` |

## Checklist

- [ ] Superadmin sees menu without needing a branch assignment
- [ ] Branch name is visible for all users (badge for branch_admin, dropdown for admin)
- [ ] Active vouchers appear as clickable cards in cart sidebar
- [ ] Only one voucher can be selected at a time
- [ ] Voucher disabled when cart subtotal < minOrder
- [ ] PPN 11% toggle adds tax to cart total
- [ ] Tax calculated on post-discount amount
- [ ] `createOrder` stores `voucherCode`, `voucherDiscount`, `taxAmount`
- [ ] Final total displayed correctly in cart and passed to server
