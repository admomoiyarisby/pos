// ============================================================
// SuccessModal — Order confirmation modal
// ============================================================

import { useEffect } from "react";
import { CheckCircle2, Printer } from "lucide-react";
import type { OrderResult, CartItem } from "#/lib/pos-types";

interface SuccessModalProps {
  order: OrderResult | null;
  cartItems: CartItem[];
  branchName: string;
  onClose: () => void;
  onNewTransaction: () => void;
  onPrintReceipt: (order: OrderResult, cartItems: CartItem[], branchName: string) => void;
}

export default function SuccessModal({
  order,
  cartItems,
  branchName,
  onClose: _onClose,
  onNewTransaction,
  onPrintReceipt,
}: SuccessModalProps) {
  // Auto-close after 4 seconds
  useEffect(() => {
    if (!order) return;
    const timer = setTimeout(() => {
      onNewTransaction();
    }, 4000);
    return () => clearTimeout(timer);
  }, [order, onNewTransaction]);

  if (!order) return null;

  let o = order;
  return (
    // Rare, high-emotion moment — a slightly longer, gentler entrance is the
    // delight budget here. Matches the shared Modal vocabulary. Off entirely
    // for prefers-reduced-motion.
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-in fade-in-0 duration-300 motion-reduce:animate-none">
      <div className="w-full max-w-sm rounded-lg border bg-card p-6 shadow-lg animate-in fade-in-0 zoom-in-95 duration-300 ease-out motion-reduce:animate-none">
        <div className="text-center mb-4">
          <CheckCircle2 className="h-12 w-12 text-primary mx-auto mb-2" />
          <h2 className="text-lg font-bold">Transaksi Berhasil!</h2>
        </div>

        <div className="rounded-md bg-muted p-4 space-y-2 text-sm mb-4">
          <div className="flex justify-between">
            <span className="text-muted-foreground">No. Order</span>
            <span className="font-mono font-bold">#{(o.id || "").slice(0, 8).toUpperCase()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Channel</span>
            <span>{o.channel}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Pembayaran</span>
            <span>{o.paymentMethod ?? "-"}</span>
          </div>
          <div className="flex justify-between border-t pt-2">
            <span className="font-semibold">Total</span>
            <span className="font-bold text-lg">Rp {o.totalAmount.toLocaleString("id-ID")}</span>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <button
            onClick={function () {
              onPrintReceipt(o, cartItems, branchName);
            }}
            className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium flex items-center justify-center gap-2"
          >
            <Printer className="h-4 w-4" /> Cetak Struk
          </button>
          <button
            onClick={function () {
              onNewTransaction();
            }}
            className="w-full h-10 rounded-md border text-sm font-medium"
          >
            Transaksi Baru
          </button>
        </div>
      </div>
    </div>
  );
}
