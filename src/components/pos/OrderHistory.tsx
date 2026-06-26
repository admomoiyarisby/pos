// ============================================================
// Order History — Compact history list at bottom of cart
// ============================================================

import { Printer, X, Clock, CheckCircle2 } from "lucide-react";
import type { OrderResult } from "#/lib/pos-types";

interface RequestStatus {
  status: string;
  reason?: string;
}

interface OrderHistoryProps {
  recentOrders: OrderResult[];
  canVoid: boolean;
  canRequestCancel?: boolean;
  canDirectPrint?: boolean;
  activeRequests: Record<string, { print: RequestStatus | null; cancel: RequestStatus | null }>;
  onPrintClick: (orderId: string) => void;
  onCancelClick: (orderId: string) => void;
  onDirectVoid: (orderId: string) => void;
}

export default function OrderHistory({
  recentOrders,
  canVoid,
  canRequestCancel,
  canDirectPrint,
  activeRequests,
  onPrintClick,
  onCancelClick,
  onDirectVoid,
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
            const isVoid = o.status === "Void";
            const req = activeRequests[o.id];
            const printStatus = req?.print?.status ?? null;
            const cancelStatus = req?.cancel?.status ?? null;

            // Print button: neutral | pending | active | direct
            const printState = canDirectPrint
              ? "direct"
              : isVoid
                ? "hidden"
                : printStatus === "Approved"
                  ? "active"
                  : printStatus === "Pending"
                    ? "pending"
                    : "neutral";

            // Cancel button: neutral | pending | active | hidden
            const cancelState = isVoid
              ? "hidden"
              : cancelStatus === "Approved"
                ? "active"
                : cancelStatus === "Pending"
                  ? "pending"
                  : "neutral";

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
                  {isVoid && (
                    <span className="text-[9px] px-1 py-0.5 rounded bg-destructive/10 text-destructive font-medium">
                      VOID
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="font-semibold">Rp {o.totalAmount.toLocaleString("id-ID")}</span>

                  {/* ── Print button ── */}
                  {printState !== "hidden" && (
                    <span
                      title={
                        printState === "direct"
                          ? "Cetak"
                          : printState === "pending"
                            ? "Menunggu persetujuan..."
                            : printState === "active"
                              ? "Klik untuk cetak"
                              : "Minta cetak ulang"
                      }
                    >
                      <button
                        onClick={function () {
                          onPrintClick(o.id);
                        }}
                        disabled={printState === "pending"}
                        className={
                          "h-5 w-5 inline-flex items-center justify-center rounded border transition-colors " +
                          (printState === "direct" || printState === "active"
                            ? "bg-primary text-primary-foreground border-primary hover:bg-primary/90"
                            : printState === "pending"
                              ? "bg-warning/10 text-warning border-warning/30 cursor-not-allowed"
                              : "text-muted-foreground hover:bg-accent")
                        }
                      >
                        <Printer className="h-2.5 w-2.5" />
                      </button>
                    </span>
                  )}

                  {/* ── Cancel button (state machine, branch_admin) ── */}
                  {!canVoid && canRequestCancel && cancelState !== "hidden" && (
                    <span
                      title={
                        cancelState === "pending"
                          ? "Menunggu persetujuan..."
                          : cancelState === "active"
                            ? "Klik untuk batalkan"
                            : "Minta pembatalan"
                      }
                    >
                      <button
                        onClick={function () {
                          onCancelClick(o.id);
                        }}
                        disabled={cancelState === "pending"}
                        className={
                          "h-5 px-1.5 inline-flex items-center justify-center rounded border text-[10px] font-medium transition-colors " +
                          (cancelState === "active"
                            ? "bg-primary text-primary-foreground border-primary hover:bg-primary/90"
                            : cancelState === "pending"
                              ? "bg-warning/10 text-warning border-warning/30 cursor-not-allowed"
                              : "text-destructive hover:bg-destructive/10 border-destructive/30")
                        }
                      >
                        {cancelState === "pending" ? (
                          <Clock className="h-2.5 w-2.5" />
                        ) : cancelState === "active" ? (
                          <CheckCircle2 className="h-2.5 w-2.5" />
                        ) : (
                          "Btl"
                        )}
                      </button>
                    </span>
                  )}

                  {/* ── Direct void button (admin only) ── */}
                  {canVoid && !isVoid && (
                    <button
                      onClick={function () {
                        onDirectVoid(o.id);
                      }}
                      className="h-5 w-5 inline-flex items-center justify-center rounded border text-destructive hover:bg-destructive/10"
                      title="Batalkan langsung"
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
