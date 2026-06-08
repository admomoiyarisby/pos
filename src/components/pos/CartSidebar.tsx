// ============================================================
// Cart Sidebar — Desktop cart with checkout controls
// ============================================================

import { ShoppingCart, X, Printer, Percent } from "lucide-react";
import { Badge } from "#/components/ui/badge";
import type { CartItem, Voucher } from "#/lib/pos-types";

interface CartSidebarProps {
  cart: CartItem[];
  cartCount: number;
  cartTotal: number;
  voucherDiscount: number;
  taxAmount: number;
  finalTotal: number;
  ppnEnabled: boolean;
  pb1Rate: number;
  channel: string;
  isDineIn: boolean;
  paymentMethod: string;
  selectedVoucher: Voucher | null;
  allVouchers: Voucher[];
  checkoutError: string | null;
  stockError: string | null;
  activeShift: any;
  createOrderPending: boolean;
  onRemoveItem: (idx: number) => void;
  onUpdateQty: (idx: number, delta: number) => void;
  onToggleVoucher: (v: Voucher) => void;
  onPaymentMethodChange: (method: string) => void;
  onCheckout: () => void;
  onPrintBill: () => void;
  onClearError: () => void;
  onClearStockError: () => void;
  onPpnToggle: (checked: boolean) => void;
  children?: React.ReactNode;
}

export default function CartSidebar({
  cart,
  cartCount,
  cartTotal,
  voucherDiscount,
  taxAmount,
  finalTotal,
  ppnEnabled,
  pb1Rate,
  isDineIn,
  paymentMethod,
  selectedVoucher,
  allVouchers,
  checkoutError,
  stockError,
  activeShift,
  createOrderPending,
  onRemoveItem,
  onUpdateQty,
  onToggleVoucher,
  onPaymentMethodChange,
  onCheckout,
  onPrintBill,
  onClearError,
  onClearStockError,
  onPpnToggle,
  children,
}: CartSidebarProps) {
  return (
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
          <div className="text-center text-muted-foreground py-8">
            <ShoppingCart className="h-10 w-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm">Keranjang kosong</p>
            <p className="text-xs">Pilih menu untuk memulai</p>
          </div>
        ) : (
          cart.map(function (item, idx) {
            return (
              <div key={idx} className="rounded-md border p-2">
                <div className="flex items-start justify-between gap-1.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium leading-tight">{item.name}</p>
                    {item.modifiers.length > 0 && (
                      <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                        {item.modifiers
                          .map(function (m) {
                            return m.name;
                          })
                          .join(", ")}
                      </p>
                    )}
                    {item.notes && (
                      <p className="text-[10px] text-muted-foreground italic truncate">
                        {"\u201C" + item.notes + "\u201D"}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={function () {
                      onRemoveItem(idx);
                    }}
                    aria-label={`Hapus ${item.name}`}
                    className="text-muted-foreground hover:text-destructive shrink-0"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
                <div className="flex items-center justify-between mt-1">
                  <div className="flex items-center gap-0.5">
                    <button
                      onClick={function () {
                        onUpdateQty(idx, -1);
                      }}
                      aria-label="Kurangi jumlah"
                      className="h-5 w-5 rounded border flex items-center justify-center"
                    >
                      <X className="h-2.5 w-2.5 rotate-45" />
                    </button>
                    <span className="w-6 text-center text-xs font-medium">{item.quantity}</span>
                    <button
                      onClick={function () {
                        onUpdateQty(idx, 1);
                      }}
                      aria-label="Tambah jumlah"
                      className="h-5 w-5 rounded border flex items-center justify-center"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </div>
                  <p className="text-xs font-semibold">
                    Rp {(item.price * item.quantity).toLocaleString("id-ID")}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Checkout section */}
      <div className="border-t px-3 py-2 space-y-1.5 shrink-0">
        {/* Vouchers */}
        {allVouchers.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {allVouchers.map(function (v) {
              let meetsMinOrder = cartTotal >= v.minOrder;
              let isSelected = selectedVoucher?.id === v.id;
              return (
                <button
                  key={v.id}
                  onClick={function () {
                    onToggleVoucher(v);
                  }}
                  disabled={!meetsMinOrder}
                  className={
                    "inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-[10px] " +
                    (isSelected
                      ? "border-primary bg-primary/10 text-primary font-semibold"
                      : meetsMinOrder
                        ? "hover:border-primary/50"
                        : "opacity-40 cursor-not-allowed")
                  }
                >
                  <Percent className="h-2 w-2" />
                  <span>{v.code}</span>
                  <span className="text-muted-foreground">
                    {v.discountType === "percentage"
                      ? "-" + v.discountValue + "%"
                      : "-Rp" + v.discountValue.toLocaleString("id-ID")}
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
              <span className="text-primary">-Rp {voucherDiscount.toLocaleString("id-ID")}</span>
            </div>
          )}
          {isDineIn && pb1Rate > 0 && (
            <div className="flex items-center justify-between text-xs">
              <label className="flex items-center gap-1 cursor-pointer text-muted-foreground">
                <input
                  type="checkbox"
                  checked={ppnEnabled}
                  onChange={function (e) {
                    onPpnToggle(e.target.checked);
                  }}
                  className="h-3 w-3 rounded border-gray-300"
                />
                PB1 {pb1Rate}%
              </label>
              {taxAmount > 0 && (
                <span className="text-muted-foreground">
                  +Rp {taxAmount.toLocaleString("id-ID")}
                </span>
              )}
            </div>
          )}
          <div className="flex justify-between text-sm font-bold border-t pt-1">
            <span>Total</span>
            <span>Rp {finalTotal.toLocaleString("id-ID")}</span>
          </div>
        </div>

        {/* Payment — Dine-in only */}
        {isDineIn && (
          <select
            value={paymentMethod}
            onChange={function (e) {
              onPaymentMethodChange(e.target.value);
            }}
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
          >
            <option value="Cash">Cash</option>
            <option value="QRIS">QRIS</option>
            <option value="Transfer">Transfer</option>
          </select>
        )}

        {/* Print Bill button */}
        {cart.length > 0 && (
          <button
            onClick={function () {
              onPrintBill();
            }}
            className="w-full h-8 rounded-md border border-dashed text-xs font-medium text-muted-foreground hover:bg-muted flex items-center justify-center gap-1.5"
          >
            <Printer className="h-3 w-3" /> Cetak Tagihan
          </button>
        )}

        {/* Checkout button */}
        <button
          onClick={function () {
            onCheckout();
          }}
          disabled={cartTotal === 0 || !activeShift || createOrderPending}
          className="w-full h-9 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {createOrderPending
            ? "Memproses..."
            : isDineIn
              ? "Bayar Rp " + finalTotal.toLocaleString("id-ID")
              : "Konfirmasi Pesanan"}
        </button>
        {!activeShift && (
          <p className="text-[10px] text-center text-destructive">Buka shift terlebih dahulu</p>
        )}

        {checkoutError && (
          <div className="rounded bg-destructive/10 px-2 py-1 text-[11px] text-destructive flex items-center gap-1">
            <X className="h-3 w-3 shrink-0" />
            <span className="flex-1 truncate">{checkoutError}</span>
            <button
              onClick={function () {
                onClearError();
              }}
              aria-label="Tutup pesan error"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
        {stockError && (
          <div className="rounded bg-warning/10 px-2 py-1 text-[11px] text-warning flex items-center gap-1">
            <X className="h-3 w-3 shrink-0" />
            <span className="flex-1 truncate">{stockError}</span>
            <button
              onClick={function () {
                onClearStockError();
              }}
              aria-label="Tutup pesan stok"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>

      {children}
    </div>
  );
}
