# POS Fully Featured System — Implementation Plan

## Current State Analysis

The POS page (`src/routes/_layout/pos.tsx`) is **functionally incomplete** in three critical areas the user explicitly called out, plus several related gaps that prevent it from being production-ready:

### What's Broken / Missing

1. **No transaction feedback** — `createOrderMutation` has `onSuccess` but **no `onError`**. On failure, the user sees nothing. The button just stays in "Memproses..." state indefinitely.
2. **No invoice / receipt** — After checkout succeeds, there's no print dialog, no receipt popup, no thermal print HTML. The prototype had full 80mm receipt printing.
3. **Dirty inputs not fully cleared** — `setNotes("")` exists but `notes` state is **never bound to any input field**. Channel, payment method, brand filter, and category filter are never reset.
4. **All orders hardcoded to `"Completed"`** — No order lifecycle. No void, no cancel, no pending state.
5. **No order detail / reprint** — `lastOrders` only shows id+total+items summary. No click-to-view-detail, no reprint button.
6. **No stock check** — Cart allows adding items even if branch inventory is zero.
7. **No error boundary** — Network errors, validation errors, DB constraint failures all silently fail.

---

## Step 1: Transaction Feedback System

### Add `onError` to `createOrderMutation`

```ts
const createOrderMutation = useMutation({
  mutationFn: createOrder,
  onSuccess: (order) => {
    /* existing */
  },
  onError: (error) => {
    setCheckoutError(error instanceof Error ? error.message : "Gagal membuat order");
  },
});
```

### Add error display UI

Add a dismissible error banner above the checkout button:

```tsx
{
  checkoutError && (
    <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive flex items-start gap-2">
      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
      <div className="flex-1">
        <p className="font-medium">Gagal memproses transaksi</p>
        <p className="text-xs opacity-80">{checkoutError}</p>
      </div>
      <button onClick={() => setCheckoutError("")} className="shrink-0">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
```

### Add success confirmation modal

After `onSuccess`, show a **Success Modal** (not just clearing the cart):

```tsx
const [successOrder, setSuccessOrder] = useState<typeof order | null>(null);

// In onSuccess:
setSuccessOrder(order);
```

**Success Modal contents:**

- ✅ Icon + "Transaksi Berhasil!"
- Order number (show `order.id.slice(0, 8).toUpperCase()` as receipt number)
- Channel, payment method, total amount
- **"Cetak Struk"** button → triggers `printReceipt(order)`
- **"Transaksi Baru"** button → closes modal, fully resets form
- Auto-close after 10 seconds if user does nothing

### Add `checkoutError` state and clear it on new actions

- Clear `checkoutError` when:
  - User adds/removes cart item
  - User changes channel
  - User clicks "Bayar" again

---

## Step 2: Receipt / Invoice Printing

### Create `printReceipt(order)` utility function

Add inside `pos.tsx` (or extract to `src/lib/pos-utils.ts`):

```ts
function printReceipt(order: OrderResult, cartItems: CartItem[], branchName: string) {
  const printWindow = window.open("", "_blank");
  if (!printWindow) return;

  const itemsHtml = cartItems
    .map(
      (item) => `
    <div style="margin-bottom: 3mm;">
      <div style="display: flex; justify-content: space-between; font-size: 12px; font-weight: bold;">
        <div style="flex: 1;">${item.name}</div>
        <div style="width: 10mm; text-align: center;">${item.quantity}</div>
        <div style="width: 25mm; text-align: right;">${(item.price * item.quantity).toLocaleString("id-ID")}</div>
      </div>
      ${item.modifiers.length > 0 ? `<div style="font-size: 10px; color: #444; padding-left: 2mm;">${item.modifiers.map((m) => `+ ${m.name}`).join("<br>")}</div>` : ""}
      ${item.notes ? `<div style="font-size: 10px; font-style: italic; color: #666; padding-left: 2mm;">Note: ${item.notes}</div>` : ""}
    </div>
  `,
    )
    .join("");

  const html = `
    <html>
      <head>
        <title>Struk - ${order.id.slice(0, 8)}</title>
        <style>
          @page { size: 80mm auto; margin: 0; }
          body { font-family: 'Courier New', monospace; width: 80mm; margin: 0; padding: 5mm; font-size: 12px; }
          .center { text-align: center; }
          .header { font-size: 16px; font-weight: bold; margin-bottom: 2mm; }
          .subheader { font-size: 11px; color: #444; margin-bottom: 4mm; }
          .divider { border-top: 1px dashed #000; margin: 3mm 0; }
          .row { display: flex; justify-content: space-between; }
          .total { font-size: 14px; font-weight: bold; margin-top: 2mm; }
          .footer { margin-top: 5mm; font-size: 10px; color: #444; text-align: center; }
        </style>
      </head>
      <body>
        <div class="center header">Omoiyari POS</div>
        <div class="center subheader">${branchName}</div>
        <div class="center subheader">${new Date().toLocaleString("id-ID")}</div>
        <div class="divider"></div>
        <div class="row"><span>No. Order:</span><span>${order.id.slice(0, 8).toUpperCase()}</span></div>
        <div class="row"><span>Channel:</span><span>${order.channel}</span></div>
        <div class="row"><span>Pembayaran:</span><span>${order.paymentMethod}</span></div>
        <div class="divider"></div>
        ${itemsHtml}
        <div class="divider"></div>
        <div class="row"><span>Subtotal</span><span>Rp ${order.subtotal.toLocaleString("id-ID")}</span></div>
        ${order.voucherDiscount ? `<div class="row"><span>Diskon</span><span>-Rp ${order.voucherDiscount.toLocaleString("id-ID")}</span></div>` : ""}
        ${order.taxAmount ? `<div class="row"><span>PPN 11%</span><span>Rp ${order.taxAmount.toLocaleString("id-ID")}</span></div>` : ""}
        <div class="row total"><span>TOTAL</span><span>Rp ${order.totalAmount.toLocaleString("id-ID")}</span></div>
        <div class="divider"></div>
        <div class="footer">Terima kasih telah berbelanja</div>
        <script>window.onload = () => { window.print(); setTimeout(() => window.close(), 500); }</script>
      </body>
    </html>
  `;

  printWindow.document.write(html);
  printWindow.document.close();
}
```

**Call sites:**

1. **Success Modal** — "Cetak Struk" button
2. **Last Orders list** — Add a 🖨️ icon next to each recent order → reprint
3. **New server function needed** for reprint: `getOrderWithItems(orderId)` to fetch full order data for printing later

---

## Step 3: Full Form Reset After Checkout

### Current reset (incomplete):

```tsx
setCart([]);
setCustomerName("");
setOrderCode("");
setNotes(""); // ← state exists but NO INPUT is bound to it
setSelectedVoucher(null);
setPpnEnabled(false);
```

### Complete reset (add these):

```tsx
setCart([]);
setCustomerName("");
setOrderCode("");
setNotes("");
setSelectedVoucher(null);
setPpnEnabled(false);
setPaymentMethod("Cash"); // ← ADD
setChannel("Dine-in"); // ← ADD
setSelectedBrandId(""); // ← ADD
setSelectedCategory(""); // ← ADD
setSearchQuery(""); // ← ADD
setCheckoutError(null); // ← ADD
```

### Also add a proper "Catatan" input

The `notes` state exists but is never used. Add a `<textarea>` in the cart sidebar for **order-level notes** (not item-level, which already exists in modifier modal):

```tsx
<div className="space-y-2">
  <label className="text-xs text-muted-foreground">Catatan Order</label>
  <textarea
    value={notes}
    onChange={(e) => setNotes(e.target.value)}
    placeholder="Catatan untuk dapur / kasir..."
    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[50px] resize-none"
  />
</div>
```

Pass `notes` to `createOrder` payload — but first check if the server function accepts it. If not, add `orderNotes?: string` to the `createOrder` input and store it in `orders.notes` (add column if missing).

---

## Step 4: Order Status Lifecycle (Not Always "Completed")

### Current: All orders are `status: "Completed"`

This prevents voiding, canceling, or tracking unpaid orders.

### Proposed flow:

| Status        | Meaning                                | Who can set            |
| ------------- | -------------------------------------- | ---------------------- |
| `"New"`       | Just created, unpaid / pending payment | Auto on create         |
| `"Completed"` | Paid, finished                         | Cashier clicks "Bayar" |
| `"Voided"`    | Canceled before completion             | Manager approval       |
| `"Refunded"`  | Paid then refunded                     | Manager approval       |

### Changes needed:

1. **Default status**: Change `createOrder` server function to set `status: "New"` (not `"Completed"`)
2. **POS UI**: After `createOrder` returns, show the Success Modal with:
   - "Tandai Lunas" button → calls new `completeOrder(orderId)` → sets status `"Completed"`
   - This is the **moment of payment confirmation**
3. **New server function**: `completeOrder` (POST)
   - Input: `{ orderId: string }`
   - Sets `status: "Completed"`, `completedAt: new Date()`
   - Auth: `requireAuth()`
   - Log: system log `"Complete Order"`

### Alternative simpler approach (recommended for MVP):

Keep `"Completed"` as default but add a **void mechanism**:

- New server function: `voidOrder` (POST) — requires `super_admin` or `admin_pusat`
- Sets `status: "Voided"`, `voidReason: reason`
- Restores inventory (adds back deducted stock)
- Creates ledger IN entry for the restoration
- Creates cancel request record for audit trail

**POS UI addition**: Add a "🗑️ Batalkan" button next to each `lastOrders` entry (only visible to admin/area_manager, or creates a cancel request for kasir).

---

## Step 5: Last Orders → Full Order History Panel

### Current: `lastOrders` is a local React state array

```tsx
const [lastOrders, setLastOrders] = useState([...]);
```

Problems:

- Lost on page refresh
- Only shows last 3 orders from current session
- No detail view
- No reprint

### Replace with server-backed query:

```tsx
const { data: recentOrders } = useQuery({
  queryKey: ["pos-recent-orders", activeBranchId],
  queryFn: () => getOrders({ data: { branchId: activeBranchId, limit: 20 } }),
  enabled: !!activeBranchId,
});
```

### New server function: `getOrderWithItems` (GET)

```ts
export const getOrderWithItems = createServerFn({ method: "GET" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    await requireAuth();
    const [order] = await db.select().from(orders).where(eq(orders.id, data.id)).limit(1);
    if (!order) return null;

    const items = await db
      .select({
        id: orderItems.id,
        recipeId: orderItems.recipeId,
        recipeName: recipes.name,
        quantity: orderItems.quantity,
        price: orderItems.price,
        notes: orderItems.notes,
      })
      .from(orderItems)
      .leftJoin(recipes, eq(orderItems.recipeId, recipes.id))
      .where(eq(orderItems.orderId, data.id));

    const itemIds = items.map((i) => i.id);
    const mods =
      itemIds.length > 0
        ? await db
            .select({
              orderItemId: orderItemModifiers.orderItemId,
              modifierName: modifiers.name,
            })
            .from(orderItemModifiers)
            .leftJoin(modifiers, eq(orderItemModifiers.modifierId, modifiers.id))
            .where(eq(orderItemModifiers.orderItemId, itemIds[0]))
        : [];

    return {
      ...order,
      items: items.map((i) => ({
        ...i,
        modifiers: mods.filter((m) => m.orderItemId === i.id).map((m) => m.modifierName),
      })),
    };
  });
```

### Enhanced Last Orders UI:

Replace the simple list with a richer panel:

```tsx
{
  recentOrders?.map((o) => (
    <div key={o.id} className="rounded-lg border p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
            #{o.id.slice(0, 8).toUpperCase()}
          </span>
          <Badge
            variant={
              o.status === "Completed"
                ? "success"
                : o.status === "Voided"
                  ? "destructive"
                  : "warning"
            }
          >
            {o.status}
          </Badge>
        </div>
        <span className="text-xs text-muted-foreground">
          {new Date(o.createdAt).toLocaleTimeString("id-ID", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>
      <div className="text-xs text-muted-foreground truncate">
        {o.items.map((i) => `${i.quantity}x ${i.recipeName}`).join(", ")}
      </div>
      <div className="flex items-center justify-between">
        <span className="font-semibold text-sm">Rp {o.totalAmount.toLocaleString("id-ID")}</span>
        <div className="flex gap-1">
          <button onClick={() => handleReprint(o.id)} className="..." title="Cetak Ulang">
            <Printer className="h-3.5 w-3.5" />
          </button>
          {canVoid && o.status !== "Voided" && (
            <button onClick={() => handleVoid(o.id)} className="..." title="Batalkan">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  ));
}
```

---

## Step 6: Stock Availability Indicator

### Current: No stock check before adding to cart

Users can add items even when `inventory.quantity === 0` for that branch.

### Add stock check in `getPosMenu` or client-side:

**Client-side approach** (simpler, no schema change):

1. Fetch branch inventory in POS loader:

   ```tsx
   const { data: branchInventory } = useQuery({
     queryKey: ["inventory", activeBranchId],
     queryFn: () => getInventory({ data: { branchId: activeBranchId } }),
     enabled: !!activeBranchId,
   });
   ```

2. Check stock before adding to cart:

   ```tsx
   const handleAddToCart = (item: MenuItem) => {
     const recipeIngs = /* fetch from menu item or recipe data */;
     const hasStock = recipeIngs.every(ing => {
       const inv = branchInventory?.find(i => i.ingredientId === ing.ingredientId);
       return (inv?.quantity ?? 0) >= ing.quantity;
     });
     if (!hasStock) {
       setStockError(`Stok tidak mencukupi untuk ${item.name}`);
       return;
     }
     // ... existing add logic
   };
   ```

3. Visual indicator on menu grid:
   ```tsx
   {
     stockQty <= 0 && (
       <div className="absolute inset-0 bg-black/50 rounded-lg flex items-center justify-center">
         <span className="text-white text-xs font-bold">HABIS</span>
       </div>
     );
   }
   ```

**Note:** This requires `recipeIngredients` data to be included in `getPosMenu` return. Add to the server function.

---

## Step 7: Order Notes Column

### Current: `orders` table has no `notes` column

The `notes` state in POS is unused because there's nowhere to store it.

### Add column:

In `src/db/schema.ts`, add to `orders` table:

```ts
notes: text("notes"),
```

Generate migration:

```bash
vp exec drizzle-kit generate
```

Update `createOrder` server fn to accept and store `notes`.

---

## Step 8: Proper Error Handling Patterns

### Wrap all mutation handlers with try/catch user feedback:

```tsx
const handleCheckout = async () => {
  if (cart.length === 0 || !activeShift) return;
  setCheckoutError(null);

  try {
    const order = await createOrderMutation.mutateAsync({ data: { ... } });
    setSuccessOrder(order);
    resetForm();
  } catch (err) {
    setCheckoutError(err instanceof Error ? err.message : "Transaksi gagal");
  }
};
```

### Server-side validation errors:

In `createOrder` handler, add specific error messages:

- `"Stok tidak mencukupi untuk item X"` — before deducting inventory
- `"Shift tidak aktif"` — if no open shift found
- `"Voucher tidak valid atau sudah expired"` — if voucher check fails

---

## Files to Modify

| File                         | Changes                                                                                                                                                                                   |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/routes/_layout/pos.tsx` | Add success modal, error banner, print receipt, full form reset, order notes input, stock check, enhanced last orders, reprint/void buttons                                               |
| `src/lib/server/pos.ts`      | Add `getOrderWithItems`, `completeOrder`, `voidOrder`; update `createOrder` to accept `notes`, set default status `"New"` (or keep `"Completed"` with void support); add stock validation |
| `src/db/schema.ts`           | Add `notes` column to `orders` table                                                                                                                                                      |
| `src/components/Sidebar.tsx` | Already has "Order Entry (POS)" — no change needed                                                                                                                                        |

## Files to Create

| File                   | Purpose                                                     |
| ---------------------- | ----------------------------------------------------------- |
| `src/lib/pos-utils.ts` | `printReceipt()` utility (optional extraction from pos.tsx) |

## Database Migration

1. Add `notes: text("notes")` to `orders` table in `src/db/schema.ts`
2. Run `vp exec drizzle-kit generate` to create migration
3. Run `vp exec drizzle-kit migrate` to apply

---

## Verification Checklist

- [ ] `vp check --fix` passes with zero errors
- [ ] `vp build` succeeds
- [ ] Checkout with empty cart → shows validation error (disabled button is enough)
- [ ] Checkout with items → success modal appears with order number, total, "Cetak Struk" button
- [ ] Click "Cetak Struk" → 80mm receipt popup opens, auto-triggers print dialog
- [ ] Click "Transaksi Baru" → modal closes, ALL inputs reset (channel, brand, category, search, cart, customer, code, voucher, PPN, payment, notes)
- [ ] Checkout fails (e.g., no shift) → red error banner appears above checkout button
- [ ] Last Orders panel shows server-fetched recent orders with status badges
- [ ] Click 🖨️ on last order → reprints receipt
- [ ] Menu item with zero stock shows "HABIS" overlay
- [ ] Trying to add out-of-stock item shows error toast/banner
- [ ] Order notes are saved and visible in order detail
- [ ] Admin can void an order from the Last Orders panel
