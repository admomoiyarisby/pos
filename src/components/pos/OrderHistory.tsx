// ============================================================
// Order History — Compact history list at bottom of cart
// ============================================================

import { Printer, X } from "lucide-react";
import type { OrderResult } from "#/lib/pos-types";

interface OrderHistoryProps {
  recentOrders: OrderResult[];
  canVoid: boolean;
  onReprint: (orderId: string) => void;
  onVoid: (orderId: string) => void;
}

export default function OrderHistory({
  recentOrders,
  canVoid,
  onReprint,
  onVoid,
}: OrderHistoryProps) {
  return (
    <div className="shrink-0 border-t h-40 flex flex-col">
      <h3 className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase text-muted-foreground border-b bg-muted/30 shrink-0">
        Riwayat Pesanan
      </h3>
      <div className="flex-1 overflow-y-auto px-3 py-1.5 space-y-1">
        {recentOrders.length === 0 ? (
          <p className="text-[10px] text-muted-foreground text-center py-3">Belum ada pesanan</p>
        ) : (
          recentOrders.map(function (o: any) {
            return (
              <div
                key={o.id}
                className="flex items-center justify-between text-xs py-1 border-b border-dashed last:border-0"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="font-mono text-[10px] bg-muted px-1 rounded shrink-0">
                    #{(o.id || "").slice(0, 6).toUpperCase()}
                  </span>
                  <span className="truncate text-muted-foreground">
                    {new Date(o.createdAt).toLocaleTimeString("id-ID", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="font-semibold">Rp {o.totalAmount.toLocaleString("id-ID")}</span>
                  <button
                    onClick={function () {
                      onReprint(o.id);
                    }}
                    className="h-5 w-5 inline-flex items-center justify-center rounded border text-muted-foreground hover:bg-accent"
                    title="Cetak"
                  >
                    <Printer className="h-2.5 w-2.5" />
                  </button>
                  {canVoid && o.status !== "Void" && (
                    <button
                      onClick={function () {
                        onVoid(o.id);
                      }}
                      className="h-5 w-5 inline-flex items-center justify-center rounded border text-destructive hover:bg-destructive/10"
                      title="Batal"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
