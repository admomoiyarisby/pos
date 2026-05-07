# POS Cart Section UI Refactor — Implementation Plan

## Context

The desktop cart sidebar in `src/routes/_layout/pos.tsx` is **too wide** (`420px`), **cluttered**, and has the **Riwayat Pesanan** (recent orders) mixed into the scrollable cart-items area instead of anchored at the bottom. Additionally, the **payment method selector** and **PPN toggle** should only appear for **Dine-in** orders (online channel orders are prepaid by the platform, so payment method and tax handling are different).

---

## Current Problems

1. **Width**: `w-[420px]` is excessive for a POS cart. Most POS terminals are on smaller screens. Target: `w-72` (`288px`) or `w-80` (`320px`).
2. **Riwayat position**: `RecentOrdersPanel` is rendered **inside** the scrollable flex-1 area, above the checkout section. It scrolls away when the cart has many items. It should be a **fixed-height panel at the very bottom** of the sidebar, always visible.
3. **Layout structure**: The sidebar uses a single scrollable area for everything (cart items + riwayat + checkout). The correct structure is:
   - Fixed header (Keranjang title)
   - Scrollable cart items (flex-1, min-h-0)
   - Fixed checkout summary (collapsible, compact)
   - Fixed riwayat panel (bottom, max-h fixed, scrollable internally)
4. **Payment method**: Shows for all channels. Should be **hidden** when `channel !== "Dine-in"`.
5. **PPN toggle**: Shows for all channels. Should be **hidden** when `channel !== "Dine-in"`.
6. **"Bayar" button text**: Always shows total. For online channels, should just say "Kirim" or "Konfirmasi".
7. **Voucher section**: Takes too much vertical space with a label row. Should be more compact.
8. **Cart item cards**: Excessive padding (`p-2.5`) for a narrow sidebar. Should be tighter (`p-2`).
9. **Error banners**: Full-width inside the narrow sidebar wastes space. Should be more compact.
10. **Order notes textarea**: Visible unconditionally. For online channels, order notes from the platform are usually not editable by the cashier. Consider hiding or making it channel-aware.

---

## Step 1: Thin the Sidebar Width

### Change desktop sidebar width

```tsx
// Before:
<div className="hidden md:flex w-[420px] border-l bg-card flex-col">

// After:
<div className="hidden md:flex w-72 border-l bg-card flex-col">
```

`w-72` = `288px`. This is the standard width for POS cart sidebars (similar to Square, Toast, etc.).

**Impact**: All child content must be audited for overflow. Specifically:

- Cart item name → already has `min-w-0` + `truncate` behavior, should be fine
- Voucher chips → may wrap more, acceptable
- "Bayar" button text → should use shorter label (see Step 5)
- Recent order row → already compact, should be fine

---

## Step 2: Re-structure the Sidebar Layout

### Current structure (broken):

```
┌─ Keranjang header (fixed) ─┐
│ Cart items (scrollable)    │  ← RecentOrdersPanel is INSIDE here
│                            │     (scrolls away with many items)
├─ Checkout section (fixed) ─┤
└────────────────────────────┘
```

### Target structure:

```
┌─ Keranjang header (fixed, shrink-0) ─┐
│ Cart items (flex-1, scrollable)      │
├─ Checkout summary (fixed, shrink-0) ─┤
├─ Riwayat (fixed h-48, scrollable) ───┤
└──────────────────────────────────────┘
```

### Implementation in `renderCartSidebar`:

Replace the current single `renderCartSidebar` with a cleaner inline structure (or keep the helper but restructure). The key change is separating the three zones:

```tsx
{/* Desktop sidebar */}
<div className="hidden md:flex w-72 border-l bg-card flex-col">
  {/* Header */}
  <div className="px-3 py-2 border-b shrink-0">
    <div className="flex items-center gap-2">
      <ShoppingCart className="h-4 w-4" />
      <h2 className="font-semibold text-sm">Keranjang</h2>
      {cartCount > 0 && (
        <Badge variant="secondary" className="ml-auto text-[10px]">
          {cartCount}
        </Badge>
      )}
    </div>
  </div>

  {/* Cart items — scrollable */}
  <div className="flex-1 overflow-y-auto min-h-0 px-3 py-2 space-y-2">
    {cart.length === 0 ? (
      <EmptyCartMessage />
    ) : (
      cart.map((item, idx) => <CompactCartItem key={idx} ... />)
    )}
  </div>

  {/* Checkout section — fixed */}
  <CheckoutSummary
    channel={channel}
    cartTotal={cartTotal}
    voucherDiscount={voucherDiscount}
    taxAmount={taxAmount}
    finalTotal={finalTotal}
    selectedVoucher={selectedVoucher}
    allVouchers={allVouchers}
    ppnEnabled={ppnEnabled}
    paymentMethod={paymentMethod}
    checkoutError={checkoutError}
    stockError={stockError}
    activeShift={activeShift}
    createOrderMutation={createOrderMutation}
    onToggleVoucher={toggleVoucher}
    onTogglePpn={setPpnEnabled}
    onPaymentMethodChange={setPaymentMethod}
    onCheckout={handleCheckout}
    onDismissError={() => setCheckoutError(null)}
  />

  {/* Riwayat — fixed at bottom */}
  <div className="shrink-0 border-t">
    <RecentOrdersPanel
      recentOrders={recentOrders as unknown as RecentOrder[]}
      canVoid={canVoid}
      onReprint={handleReprint}
      onVoid={(orderId) => setVoidModal({ orderId, reason: "" })}
    />
  </div>
</div>
```

### Important CSS details:

- `min-h-0` on the scrollable area is **required** for flex children to shrink properly in a flex-col container.
- Each section must have `shrink-0` except the cart items area.
- The Riwayat panel should have a **max-height** (e.g., `h-40` / `160px`) with its own internal `overflow-y-auto` so it doesn't push the checkout section off-screen.

---

## Step 3: Compact Cart Item Cards

### Current card:

```tsx
<div className="rounded-lg border p-2.5">{/* name, modifiers, notes, qty controls, price */}</div>
```

### Target card (narrower sidebar = tighter padding):

```tsx
<div className="rounded-md border p-2">
  <div className="flex items-start justify-between gap-1.5">
    <div className="flex-1 min-w-0">
      <p className="text-sm font-medium leading-tight">{item.name}</p>
      {/* Modifiers as inline text, not stacked */}
      {item.modifiers.length > 0 && (
        <p className="text-[10px] text-muted-foreground truncate">
          {item.modifiers.map((m) => m.name).join(", ")}
        </p>
      )}
      {item.notes && (
        <p className="text-[10px] text-muted-foreground italic truncate">"{item.notes}"</p>
      )}
    </div>
    <button onClick={() => removeItem(idx)} className="...">
      <X className="h-3 w-3" /> {/* Use X instead of Trash2 for compactness */}
    </button>
  </div>
  <div className="flex items-center justify-between mt-1">
    <div className="flex items-center gap-0.5">
      <button className="h-5 w-5 ...">
        <Minus className="h-2.5 w-2.5" />
      </button>
      <span className="w-6 text-center text-xs font-medium">{item.quantity}</span>
      <button className="h-5 w-5 ...">
        <Plus className="h-2.5 w-2.5" />
      </button>
    </div>
    <p className="text-xs font-semibold">
      Rp {(item.price * item.quantity).toLocaleString("id-ID")}
    </p>
  </div>
</div>
```

Key changes:

- `p-2.5` → `p-2`
- `Trash2` icon → `X` icon (saves space, common pattern in POS)
- `h-6 w-6` qty buttons → `h-5 w-5`
- Modifiers stacked vertically → single inline truncated line
- Remove excessive margins (`mt-0.5`, `space-y-0.5`)

---

## Step 4: Compact Checkout Summary

### Extract into a sub-component

```tsx
function CheckoutSummary({
  channel,
  cartTotal,
  voucherDiscount,
  taxAmount,
  finalTotal,
  selectedVoucher,
  allVouchers,
  ppnEnabled,
  paymentMethod,
  checkoutError,
  stockError,
  activeShift,
  createOrderMutation,
  onToggleVoucher,
  onTogglePpn,
  onPaymentMethodChange,
  onCheckout,
  onDismissError,
}: CheckoutSummaryProps) {
  const isDineIn = channel === "Dine-in";

  return (
    <div className="border-t px-3 py-2 space-y-1.5 shrink-0">
      {/* Vouchers — ultra-compact */}
      {allVouchers.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {allVouchers.map((v) => {
            const meetsMin = cartTotal >= v.minOrder;
            const isSel = selectedVoucher?.id === v.id;
            return (
              <button
                key={v.id}
                onClick={() => onToggleVoucher(v)}
                disabled={!meetsMin}
                className={`inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-[10px] ${
                  isSel
                    ? "border-primary bg-primary/10 text-primary font-semibold"
                    : meetsMin
                      ? "hover:border-primary/50"
                      : "opacity-40 cursor-not-allowed"
                }`}
              >
                <Percent className="h-2 w-2" />
                <span>{v.code}</span>
                <span className="text-muted-foreground">
                  {v.discountType === "percentage"
                    ? `-${v.discountValue}%`
                    : `-Rp${v.discountValue.toLocaleString("id-ID")}`}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Price lines */}
      <div className="space-y-0.5">
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">Subtotal</span>
          <span>Rp {cartTotal.toLocaleString("id-ID")}</span>
        </div>

        {voucherDiscount > 0 && (
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Diskon</span>
            <span className="text-emerald-600">-Rp {voucherDiscount.toLocaleString("id-ID")}</span>
          </div>
        )}

        {/* PPN — Dine-in only */}
        {isDineIn && (
          <div className="flex items-center justify-between text-xs">
            <label className="flex items-center gap-1 cursor-pointer text-muted-foreground">
              <input
                type="checkbox"
                checked={ppnEnabled}
                onChange={(e) => onTogglePpn(e.target.checked)}
                className="h-3 w-3 rounded border-gray-300"
              />
              PPN 11%
            </label>
            {taxAmount > 0 && (
              <span className="text-muted-foreground">+Rp {taxAmount.toLocaleString("id-ID")}</span>
            )}
          </div>
        )}

        <div className="flex justify-between text-sm font-bold border-t pt-1">
          <span>Total</span>
          <span>Rp {finalTotal.toLocaleString("id-ID")}</span>
        </div>
      </div>

      {/* Payment method — Dine-in only */}
      {isDineIn && (
        <select
          value={paymentMethod}
          onChange={(e) => onPaymentMethodChange(e.target.value)}
          className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
        >
          <option value="Cash">Cash</option>
          <option value="QRIS">QRIS</option>
          <option value="Transfer">Transfer</option>
        </select>
      )}

      {/* Checkout button */}
      <button
        onClick={onCheckout}
        disabled={cartTotal === 0 || !activeShift || createOrderMutation.isPending}
        className="w-full h-9 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
      >
        {createOrderMutation.isPending
          ? "Memproses..."
          : isDineIn
            ? `Bayar Rp ${finalTotal.toLocaleString("id-ID")}`
            : "Konfirmasi Pesanan"}
      </button>

      {!activeShift && (
        <p className="text-[10px] text-center text-destructive">Buka shift terlebih dahulu</p>
      )}

      {/* Error banners */}
      {checkoutError && (
        <div className="rounded bg-destructive/10 px-2 py-1 text-[11px] text-destructive flex items-center gap-1">
          <AlertCircle className="h-3 w-3 shrink-0" />
          <span className="flex-1 truncate">{checkoutError}</span>
          <button onClick={onDismissError}>
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
      {stockError && (
        <div className="rounded bg-warning/10 px-2 py-1 text-[11px] text-warning flex items-center gap-1">
          <AlertCircle className="h-3 w-3 shrink-0" />
          <span className="flex-1 truncate">{stockError}</span>
          <button onClick={() => {}}>
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}
```

---

## Step 5: Channel-Aware Checkout Button Label

### Button text logic:

```tsx
{
  createOrderMutation.isPending
    ? "Memproses..."
    : isDineIn
      ? `Bayar Rp ${finalTotal.toLocaleString("id-ID")}`
      : "Konfirmasi Pesanan";
}
```

For online channels (Gofood, Grabfood, ShopeeFood), the payment is handled by the platform. The cashier just confirms the order. The label should reflect this.

---

## Step 6: Anchor Riwayat at Bottom

### Current `RecentOrdersPanel`:

```tsx
<div className="p-3 border-t mt-2">
  <h3 className="text-[11px] font-semibold uppercase text-muted-foreground mb-1.5">
    Riwayat Pesanan
  </h3>
  <div className="space-y-2 max-h-[240px] overflow-y-auto">{/* orders */}</div>
</div>
```

### Updated `RecentOrdersPanel`:

```tsx
function RecentOrdersPanel({...}) {
  return (
    <div className="h-40 flex flex-col">
      <h3 className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase text-muted-foreground border-b bg-muted/30 shrink-0">
        Riwayat Pesanan
      </h3>
      <div className="flex-1 overflow-y-auto px-3 py-1.5 space-y-1.5">
        {recentOrders.length === 0 ? (
          <p className="text-[10px] text-muted-foreground text-center py-3">Belum ada pesanan</p>
        ) : (
          recentOrders.map((o) => (
            <div key={o.id} className="flex items-center justify-between text-xs py-1 border-b border-dashed last:border-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="font-mono text-[10px] bg-muted px-1 rounded shrink-0">
                  #{o.id.slice(0, 6).toUpperCase()}
                </span>
                <span className="truncate text-muted-foreground">
                  {new Date(o.createdAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="font-semibold">Rp {o.totalAmount.toLocaleString("id-ID")}</span>
                <button
                  onClick={() => onReprint(o.id)}
                  className="h-5 w-5 inline-flex items-center justify-center rounded border text-muted-foreground hover:bg-accent"
                  title="Cetak"
                >
                  <Printer className="h-2.5 w-2.5" />
                </button>
                {canVoid && o.status !== "Voided" && (
                  <button
                    onClick={() => onVoid(o.id)}
                    className="h-5 w-5 inline-flex items-center justify-center rounded border text-destructive hover:bg-destructive/10"
                    title="Batal"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
```

Key changes:

- Remove card-style borders from each row → simple `border-b border-dashed` list
- Remove status badge per row → saves width (status is implied by color or can be shown on hover)
- `h-5 w-5` icon buttons instead of `h-6 w-6`
- Truncate customer name (remove from inline display, show on hover tooltip instead)
- Fixed `h-40` container with internal scroll

---

## Step 7: Mobile Cart Drawer Updates

The mobile cart drawer should also adopt the same channel-aware behavior:

1. Hide PPN toggle when `channel !== "Dine-in"`
2. Hide payment method when `channel !== "Dine-in"`
3. Change button text to "Konfirmasi Pesanan" for online channels
4. Keep order notes textarea (mobile has more vertical space)

No structural changes needed for mobile — the drawer already works as a full-screen overlay.

---

## Step 8: Order Notes Visibility

### Current: Order notes textarea is always visible in cart sidebar

For online channels, the order note is typically not editable by the cashier (it's set by the customer on the platform). However, the cashier might still want to add internal notes.

**Decision**: Keep the order notes textarea for all channels but relabel it:

- Dine-in: "Catatan Order"
- Online: "Catatan Internal"

This is optional — the plan focuses on hiding PPN and payment method, not notes.

---

## Files to Modify

| File                         | Changes                                                                                                              |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `src/routes/_layout/pos.tsx` | Restructure sidebar layout, thin width, compact cart items, channel-aware checkout summary, anchor riwayat at bottom |

---

## Visual Layout (After)

```
┌──────────────────────────────────────┐  ← w-72 (288px)
│ 🛒 Keranjang                3        │  ← header, shrink-0
├──────────────────────────────────────┤
│ │ Nasi Goreng                 ✕ │   │  ← cart items, scrollable
│ │ Extra telur, pedas            │   │     flex-1, min-h-0
│ │ － 2 ＋          Rp 50.000   │   │
│ ───────────────────────────────── │   │
│ │ Es Teh                ✕ │        │
│ │ － 1 ＋          Rp 8.000   │    │
├──────────────────────────────────────┤
│ [Diskon10%] [FreeOngkir]             │  ← vouchers, inline chips
│ Subtotal      Rp 58,000              │  ← checkout summary,
│ Diskon        -Rp 5,800                 shrink-0
│ ☑ PPN 11%              +Rp 5,742     │     (PPN only for Dine-in)
│ ─────────────────────────            │
│ Total         Rp 57,942              │
│ [Cash ▼]                             │  ← payment only for Dine-in
│ [Bayar Rp 57,942]                    │  ← or "Konfirmasi Pesanan"
├──────────────────────────────────────┤
│ RIWAYAT PESANAN          ──────     │  ← riwayat header, shrink-0
│ #A3F21B  14:32  Rp 45,000  🖨️ ✕    │  ← riwayat rows, scrollable
│ #B7C90D  14:15  Rp 62,000  🖨️ ✕    │     inside h-40 container
│ #D4E81F  13:58  Rp 28,000  🖨️ ✕    │
└──────────────────────────────────────┘
```

---

## Verification Checklist

- [ ] `vp check --fix` passes with zero errors
- [ ] `vp build` succeeds
- [ ] Desktop sidebar is `288px` wide (`w-72`)
- [ ] Cart items scroll independently of checkout and riwayat
- [ ] Riwayat panel is always visible at the bottom, never scrolls away
- [ ] Riwayat panel has its own scrollbar when > 5 orders
- [ ] PPN toggle is **visible** when channel = "Dine-in"
- [ ] PPN toggle is **hidden** when channel = "Gofood" / "Grabfood" / "ShopeeFood"
- [ ] Payment method dropdown is **visible** when channel = "Dine-in"
- [ ] Payment method dropdown is **hidden** when channel = online
- [ ] Checkout button says "Bayar Rp {total}" for Dine-in
- [ ] Checkout button says "Konfirmasi Pesanan" for online channels
- [ ] Cart item cards are compact (`p-2`, `h-5` qty buttons)
- [ ] No horizontal overflow in the sidebar at any state
- [ ] Mobile drawer also respects channel-aware PPN/payment hiding
