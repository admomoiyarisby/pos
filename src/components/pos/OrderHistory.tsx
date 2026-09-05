// ============================================================
// Order History — Compact history list at bottom of cart
// ============================================================

import { useState } from "react";
import { Printer, X, Clock, CheckCircle2, ChevronDown, ChevronRight } from "lucide-react";
import type { OrderResult } from "#/lib/pos-types";
import OrderItemsTray from "#/components/pos/OrderItemsTray";
import HistoryDateFilter from "#/components/pos/HistoryDateFilter";
import HistoryPagination from "#/components/pos/HistoryPagination";
import { ORDER_CHANNEL_OPTIONS, channelLabel } from "#/lib/order-channels";

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
  dateFrom: string;
  dateTo: string;
  onDateChange: (dateFrom: string, dateTo: string) => void;
  /** Active channel filter ("" = all channels); drives server-side getOrders. */
  channelFilter: string;
  onChannelFilterChange: (channel: string) => void;
  page: number;
  hasNextPage: boolean;
  onPageChange: (page: number) => void;
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
  dateFrom,
  dateTo,
  onDateChange,
  channelFilter,
  onChannelFilterChange,
  page,
  hasNextPage,
  onPageChange,
  onPrintClick,
  onCancelClick,
  onDirectVoid,
}: OrderHistoryProps) {
  // Single open tray at a time — same as the expandable detail rows elsewhere.
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // When the list spans more than one branch (super_admin / area_manager),
  // label each row with its branch so the transactions are easy to tell apart.
  // Single-branch users (branch_admin) already see their branch in the header.
  const spansMultipleBranches = new Set(recentOrders.map((o) => o.branchId)).size > 1;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="px-4 pt-2.5 pb-2 border-b bg-muted/30 shrink-0">
        <h3 className="pr-6 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Riwayat Pesanan
        </h3>
        <div className="mt-1.5">
          <HistoryDateFilter dateFrom={dateFrom} dateTo={dateTo} onChange={onDateChange} />
        </div>
        <div className="mt-1.5">
          <select
            value={channelFilter}
            onChange={function (e) {
              onChannelFilterChange(e.target.value);
            }}
            aria-label="Filter channel"
            className="h-7 w-full rounded-md border border-input bg-background px-2 text-[11px] font-medium text-foreground"
          >
            <option value="">Semua Channel</option>
            {ORDER_CHANNEL_OPTIONS.map(function (c) {
              return (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              );
            })}
          </select>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-2.5 space-y-1">
        {recentOrders.length === 0 && page > 0 ? (
          <p className="text-[10px] text-muted-foreground text-center py-3">
            Tidak ada pesanan lagi — kembali ke halaman sebelumnya
          </p>
        ) : recentOrders.length === 0 ? (
          <p className="text-[10px] text-muted-foreground text-center py-3">
            {dateFrom || dateTo
              ? "Belum ada pesanan pada rentang tanggal ini"
              : "Belum ada pesanan"}
          </p>
        ) : (
          recentOrders.map(function (o: any) {
            const isVoid = o.status === "Void";
            const req = activeRequests[o.id];
            const printStatus = req?.print?.status ?? null;
            const cancelStatus = req?.cancel?.status ?? null;
            const isExpanded = expandedId === o.id;

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
              <div key={o.id} className="border-b border-dashed last:border-0">
                <div
                  className="flex items-center justify-between text-xs py-1 cursor-pointer select-none"
                  onClick={function () {
                    setExpandedId(isExpanded ? null : o.id);
                  }}
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
                    <span
                      title={o.channel}
                      className="shrink-0 text-[9px] px-1 py-0.5 rounded border border-primary/20 bg-primary/5 text-primary font-medium"
                    >
                      {channelLabel(o.channel)}
                    </span>
                    {spansMultipleBranches && o.branchName && (
                      <span
                        title={o.branchName}
                        className="shrink-0 max-w-[96px] overflow-hidden text-ellipsis whitespace-nowrap text-[9px] px-1 py-0.5 rounded bg-muted/70 text-muted-foreground"
                      >
                        {o.branchName}
                      </span>
                    )}
                    {isVoid && (
                      <span className="text-[9px] px-1 py-0.5 rounded bg-destructive/10 text-destructive font-medium">
                        VOID
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="font-semibold">
                      Rp {o.totalAmount.toLocaleString("id-ID")}
                    </span>

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
                          onClick={function (e: React.MouseEvent) {
                            e.stopPropagation();
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
                          onClick={function (e: React.MouseEvent) {
                            e.stopPropagation();
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
                        onClick={function (e: React.MouseEvent) {
                          e.stopPropagation();
                          onDirectVoid(o.id);
                        }}
                        className="h-5 w-5 inline-flex items-center justify-center rounded border text-destructive hover:bg-destructive/10"
                        title="Batalkan langsung"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    )}

                    {/* ── Detail tray toggle ── */}
                    <button
                      onClick={function (e: React.MouseEvent) {
                        e.stopPropagation();
                        setExpandedId(isExpanded ? null : o.id);
                      }}
                      aria-expanded={isExpanded}
                      aria-label={isExpanded ? "Tutup detail" : "Lihat detail"}
                      className="h-5 w-5 inline-flex items-center justify-center rounded border text-muted-foreground hover:bg-accent"
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-3 w-3" />
                      ) : (
                        <ChevronRight className="h-3 w-3" />
                      )}
                    </button>
                  </div>
                </div>

                {/* ── Order detail tray (mimics /order-history expandable row) ── */}
                {isExpanded && (
                  <div className="pb-2 animate-in fade-in-0 slide-in-from-top-1 duration-200">
                    <OrderItemsTray
                      orderId={o.id}
                      compact
                      branchName={spansMultipleBranches ? o.branchName : null}
                    />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
      <HistoryPagination page={page} hasNext={hasNextPage} onPageChange={onPageChange} />
    </div>
  );
}
