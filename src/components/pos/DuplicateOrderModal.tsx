// ============================================================
// DuplicateOrderModal — pre-submit duplicate order guard (ADR 0032)
// ============================================================

import { AlertTriangle, Clock3 } from "lucide-react";
import Modal from "#/components/ui/Modal";
import { channelLabel } from "#/lib/order-channels";
import type { DuplicateOrderMatch } from "#/lib/duplicate-order";

interface DuplicateOrderModalProps {
  open: boolean;
  /** `same-code` is refused outright; `same-identity` only after confirmation. */
  blocking: boolean;
  matches: DuplicateOrderMatch[];
  confirmPending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

function formatTime(date: Date): string {
  return new Date(date).toLocaleTimeString("id-ID", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function lineSummary(match: DuplicateOrderMatch): string {
  const lines = match.order.lines.slice(0, 3).map(function (line) {
    return `${line.quantity}× ${line.recipeName ?? "Item"}`;
  });
  const rest = match.order.lines.length - lines.length;
  return rest > 0 ? `${lines.join(", ")} +${rest} lainnya` : lines.join(", ");
}

export default function DuplicateOrderModal({
  open,
  blocking,
  matches,
  confirmPending,
  onClose,
  onConfirm,
}: DuplicateOrderModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={blocking ? "Kode Order Sudah Tercatat" : "Pesanan Ganda Terdeteksi"}
      size="md"
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-md border border-warning/30 bg-warning/10 p-3">
          <AlertTriangle className="h-5 w-5 shrink-0 text-warning mt-0.5" />
          <p className="text-sm text-foreground">
            {blocking
              ? "Kode order ini sudah dipakai pesanan lain di cabang dan channel ini. Pesanan tidak dapat disimpan — periksa Riwayat Pesanan sebelum mengulang input."
              : "Item, total, dan waktu pesanan ini sama dengan pesanan yang baru masuk. Periksa dulu: simpan hanya jika ini memang pesanan terpisah."}
          </p>
        </div>

        <div className="space-y-2">
          {matches.map(function (match) {
            return (
              <div key={match.order.id} className="rounded-md border bg-card p-3 text-sm space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-semibold bg-muted px-1.5 py-0.5 rounded">
                    #{match.order.id.slice(0, 6).toUpperCase()}
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock3 className="h-3 w-3" />
                    {formatTime(match.order.createdAt)} WIB
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span className="px-1.5 py-0.5 rounded border border-primary/20 bg-primary/5 text-primary font-medium">
                    {channelLabel(match.order.channel)}
                  </span>
                  {match.order.orderCode && (
                    <span className="px-1.5 py-0.5 rounded bg-muted font-mono">
                      Kode {match.order.orderCode}
                    </span>
                  )}
                  <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                    {match.order.status}
                  </span>
                  <span
                    className={
                      "px-1.5 py-0.5 rounded font-medium " +
                      (match.reason === "same-code"
                        ? "bg-destructive/10 text-destructive"
                        : "bg-warning/10 text-warning")
                    }
                  >
                    {match.reason === "same-code" ? "Kode sama" : "Item & total sama"}
                  </span>
                </div>

                {match.order.customerName && (
                  <p className="text-xs text-muted-foreground">
                    Pelanggan: {match.order.customerName}
                  </p>
                )}

                {match.order.lines.length > 0 && (
                  <p className="text-xs text-muted-foreground line-clamp-2">{lineSummary(match)}</p>
                )}

                <div className="flex justify-between border-t pt-1.5">
                  <span className="text-xs text-muted-foreground">Total</span>
                  <span className="font-semibold">
                    Rp {match.order.totalAmount.toLocaleString("id-ID")}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="h-10 px-6 rounded-md border text-sm font-medium">
            {blocking ? "Tutup, periksa pesanan" : "Batal, periksa pesanan"}
          </button>
          {!blocking && (
            <button
              onClick={onConfirm}
              disabled={confirmPending}
              className="h-10 px-6 rounded-md bg-warning text-warning-foreground text-sm font-medium disabled:opacity-50"
            >
              {confirmPending ? "Menyimpan..." : "Tetap Simpan"}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
