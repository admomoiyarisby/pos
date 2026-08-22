// ============================================================
// Cart Sidebar — Desktop cart with checkout controls
// ============================================================

import { useState } from "react";
import { ShoppingCart, X, Printer, Percent, Plus, Minus, History } from "lucide-react";
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
  const [activeTab, setActiveTab] = useState<"cart" | "history">("cart");
  return (
    <div className="hidden lg:flex w-80 xl:w-[380px] shrink-0 lg:sticky lg:top-6 lg:h-[calc(100dvh-1.5rem)] lg:max-h-[calc(100dvh-1.5rem)] border-l lg:rounded-xl lg:border lg:shadow-sm bg-card flex-col overflow-hidden self-start">
      {/* Tabs — mimics mobile: Cart / History */}
      <div className="px-3 py-2 border-b shrink-0">
        <div className="inline-flex w-full p-1 bg-muted rounded-full gap-1">
          <button
            onClick={function () {
              setActiveTab("cart");
            }}
            aria-label={"Keranjang" + (cartCount > 0 ? " (" + cartCount + ")" : "")}
            className={
              "flex-1 inline-flex items-center justify-center gap-1.5 rounded-full px-3 min-h-[36px] text-xs font-medium transition-colors " +
              (activeTab === "cart"
                ? "bg-card shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground")
            }
          >
            <ShoppingCart className="h-3.5 w-3.5" />
            Keranjang
            {cartCount > 0 && (
              <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-bold px-1">
                {cartCount}
              </span>
            )}
          </button>
          <button
            onClick={function () {
              setActiveTab("history");
            }}
            aria-label="Riwayat"
            className={
              "flex-1 inline-flex items-center justify-center gap-1.5 rounded-full px-3 min-h-[36px] text-xs font-medium transition-colors " +
              (activeTab === "history"
                ? "bg-card shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground")
            }
          >
            <History className="h-3.5 w-3.5" />
            Riwayat
          </button>
        </div>
      </div>

      {activeTab === "cart" ? (
        <>
          {/* Cart items — scrollable, comfortable */}
          <div className="flex-1 overflow-y-auto min-h-0 px-4 py-3 space-y-2.5">
            {cart.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                <ShoppingCart className="h-10 w-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">Keranjang kosong</p>
                <p className="text-xs">Pilih menu untuk memulai</p>
              </div>
            ) : (
              cart.map(function (item, idx) {
                return (
                  // Near-imperceptible enter for a newly added line (fires only on
                  // mount — index keys keep existing lines from re-animating on
                  // qty changes). Off entirely for prefers-reduced-motion.
                  <div
                    key={idx}
                    className="rounded-lg border p-3 animate-in fade-in-0 slide-in-from-bottom-1 duration-150 ease-out motion-reduce:animate-none"
                  >
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
                          <Minus className="h-2.5 w-2.5" />
                        </button>
                        {/* Re-key on quantity so each +/- click pops the new value
                        in (subtle, near-imperceptible). Off for reduced motion. */}
                        <span
                          key={item.quantity}
                          className="w-6 text-center text-xs font-medium animate-in zoom-in-110 duration-100 motion-reduce:animate-none"
                        >
                          {item.quantity}
                        </span>
                        <button
                          onClick={function () {
                            onUpdateQty(idx, 1);
                          }}
                          aria-label="Tambah jumlah"
                          className="h-5 w-5 rounded border flex items-center justify-center"
                        >
                          <Plus className="h-2.5 w-2.5" />
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

          {/* Checkout section — pinned, comfortable */}
          <div className="border-t px-4 py-3 space-y-3 shrink-0">
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
                  <span className="text-primary">
                    -Rp {voucherDiscount.toLocaleString("id-ID")}
                  </span>
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

            {/* Payment */}
            {isDineIn ? (
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
            ) : (
              <div className="h-8 w-full rounded-md border bg-muted px-2 text-xs flex items-center text-muted-foreground">
                Online Payment
              </div>
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
        </>
      ) : (
        <div className="flex-1 overflow-y-auto min-h-0 flex flex-col">
          {children ? (
            children
          ) : (
            <div className="flex-1 flex items-center justify-center p-6 text-sm text-muted-foreground">
              Tidak ada riwayat
            </div>
          )}
        </div>
      )}
    </div>
  );
}
