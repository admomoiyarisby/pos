import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { Button } from "#/components/ui/button";
import { ScmItemTable, type ScmItemRow } from "./ScmItemTable";
import { AuditLogTimeline, type AuditLogEntry } from "./AuditLogTimeline";
import { transitionProcurement, updateProcurementItem } from "#/lib/server/scm-queries";

/**
 * Shared props for all state views. The detail page passes the procurement
 * row, items, audit log, and (optionally) the invoice. Each view renders
 * a portion of the data and provides the actions the current actor can take.
 */
export interface StateViewProps {
  procurement: Record<string, unknown>;
  items: Array<Record<string, unknown>>;
  auditLog: Array<Record<string, unknown>>;
  invoice: Record<string, unknown> | null;
  pendingReview: Array<Record<string, unknown>>;
}

function rowsToItems(items: Array<Record<string, unknown>>): ScmItemRow[] {
  return items as unknown as ScmItemRow[];
}

function entriesToAuditLog(log: Array<Record<string, unknown>>): AuditLogEntry[] {
  return log as unknown as AuditLogEntry[];
}

function useTransitionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      procurementId: string;
      event: string;
      payload?: Record<string, unknown>;
    }) =>
      transitionProcurement({
        data: {
          procurementId: vars.procurementId,
          event: vars.event,
          payload: vars.payload ?? {},
        },
      }),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["scm-procurement", vars.procurementId] });
      queryClient.invalidateQueries({ queryKey: ["scm-procurements"] });
    },
  });
}

function useUpdateItemMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      procurementId: string;
      itemId: string;
      patch: Record<string, unknown>;
    }) =>
      updateProcurementItem({
        data: { procurementId: vars.procurementId, itemId: vars.itemId, patch: vars.patch },
      }),
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ["scm-procurement-items", vars.procurementId] });
    },
  });
}

// =============================================================================
// Draft — BA: editable form with Submit button
// =============================================================================
export function DraftForm({ procurement, items, auditLog }: StateViewProps) {
  const transitionM = useTransitionMutation();
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Item Pengadaan</CardTitle>
        </CardHeader>
        <CardContent>
          <ScmItemTable mode="read-only" items={rowsToItems(items)} />
        </CardContent>
      </Card>
      <div className="flex justify-end gap-2">
        <Button
          onClick={() =>
            transitionM.mutate({ procurementId: procurement.id as string, event: "cancel" })
          }
          variant="ghost"
          disabled={transitionM.isPending}
        >
          Batalkan
        </Button>
        <Button
          onClick={() =>
            transitionM.mutate({ procurementId: procurement.id as string, event: "submit" })
          }
          disabled={transitionM.isPending}
        >
          Submit Pengadaan
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Riwayat</CardTitle>
        </CardHeader>
        <CardContent>
          <AuditLogTimeline entries={entriesToAuditLog(auditLog)} />
        </CardContent>
      </Card>
    </div>
  );
}

// =============================================================================
// Pending — BA: read-only + Withdraw button; CA: review queue (placeholder)
// =============================================================================
export function PendingBaView({ procurement, items, auditLog }: StateViewProps) {
  const transitionM = useTransitionMutation();
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Menunggu Review</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            Pengadaan sudah disubmit. Admin Pusat akan membuka review. Anda masih bisa menariknya kembali.
          </p>
          <ScmItemTable mode="read-only" items={rowsToItems(items)} />
        </CardContent>
      </Card>
      <div className="flex justify-end gap-2">
        <Button
          variant="ghost"
          disabled={transitionM.isPending}
          onClick={() =>
            transitionM.mutate({ procurementId: procurement.id as string, event: "withdraw" })
          }
        >
          Tarik Kembali
        </Button>
        <Button
          variant="ghost"
          disabled={transitionM.isPending}
          onClick={() =>
            transitionM.mutate({ procurementId: procurement.id as string, event: "cancel" })
          }
        >
          Batalkan
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Riwayat</CardTitle>
        </CardHeader>
        <CardContent>
          <AuditLogTimeline entries={entriesToAuditLog(auditLog)} />
        </CardContent>
      </Card>
    </div>
  );
}

export function PendingCaQueue() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Antrian Review</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Buka pengadaan untuk mulai review. Daftar antrian tersedia di halaman utama Pengadaan (filter status Pending).
        </p>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// UnderReview — CA: interactive table; BA: live read-only
// =============================================================================
export function UnderReviewCaReview({ procurement, items, auditLog }: StateViewProps) {
  const updateM = useUpdateItemMutation();
  const transitionM = useTransitionMutation();
  const [rejectionReason, setRejectionReason] = useState("");

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Review Pengadaan</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            Setujui per item atau tolak seluruh pengadaan. Item yang disetujui akan dikirim; yang ditolak diabaikan.
          </p>
          <ScmItemTable
            mode="ca-review"
            items={rowsToItems(items)}
            onItemChange={(itemId, patch) => updateM.mutate({ procurementId: procurement.id as string, itemId, patch: patch as Record<string, unknown> })}
            disabled={updateM.isPending}
          />
        </CardContent>
      </Card>
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1">
          <input
            type="text"
            placeholder="Alasan penolakan (wajib jika menolak semua)"
            value={rejectionReason}
            onChange={(e) => setRejectionReason(e.target.value)}
            className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm"
          />
        </div>
        <div className="flex gap-2">
          <Button
            variant="destructive"
            disabled={!rejectionReason || transitionM.isPending}
            onClick={() =>
              transitionM.mutate({
                procurementId: procurement.id as string,
                event: "reject",
                payload: { reason: rejectionReason },
              })
            }
          >
            Tolak Semua
          </Button>
          <Button
            disabled={transitionM.isPending}
            onClick={() =>
              transitionM.mutate({ procurementId: procurement.id as string, event: "accept-and-ship" })
            }
          >
            Setujui & Buat SJ
          </Button>
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Riwayat</CardTitle>
        </CardHeader>
        <CardContent>
          <AuditLogTimeline entries={entriesToAuditLog(auditLog)} />
        </CardContent>
      </Card>
    </div>
  );
}

export function UnderReviewBaLive({ items, auditLog }: StateViewProps) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Sedang Direview</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            Admin Pusat sedang memutuskan item mana yang akan dikirim. Anda hanya bisa melihat progresnya.
          </p>
          <ScmItemTable mode="read-only" items={rowsToItems(items)} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Riwayat</CardTitle>
        </CardHeader>
        <CardContent>
          <AuditLogTimeline entries={entriesToAuditLog(auditLog)} />
        </CardContent>
      </Card>
    </div>
  );
}

// =============================================================================
// Rejected — read-only
// =============================================================================
export function RejectedView({ procurement, auditLog }: StateViewProps) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Pengadaan Ditolak</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm">
            <strong>Alasan:</strong> {(procurement.rejectionReason as string) || "-"}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Riwayat</CardTitle>
        </CardHeader>
        <CardContent>
          <AuditLogTimeline entries={entriesToAuditLog(auditLog)} />
        </CardContent>
      </Card>
    </div>
  );
}

// =============================================================================
// InTransit — BA: tracking; CA: detail + Mark Delivered
// =============================================================================
export function InTransitBaTracking({ items, auditLog }: StateViewProps) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Dalam Pengiriman</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            Stock sedang dalam perjalanan. Tunggu sampai Admin Pusat menandai sudah dikirim.
          </p>
          <ScmItemTable mode="read-only" items={rowsToItems(items)} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Riwayat</CardTitle>
        </CardHeader>
        <CardContent>
          <AuditLogTimeline entries={entriesToAuditLog(auditLog)} />
        </CardContent>
      </Card>
    </div>
  );
}

export function InTransitCaDetail({ procurement, items, auditLog }: StateViewProps) {
  const transitionM = useTransitionMutation();
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Dalam Pengiriman</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            Stock sudah keluar dari gudang. Tandai "Sudah Dikirim" setelah branch konfirmasi barang tiba.
          </p>
          <ScmItemTable mode="read-only" items={rowsToItems(items)} />
        </CardContent>
      </Card>
      <div className="flex justify-end">
        <Button
          disabled={transitionM.isPending}
          onClick={() =>
            transitionM.mutate({ procurementId: procurement.id as string, event: "mark-delivered" })
          }
        >
          Tandai Sudah Dikirim
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Riwayat</CardTitle>
        </CardHeader>
        <CardContent>
          <AuditLogTimeline entries={entriesToAuditLog(auditLog)} />
        </CardContent>
      </Card>
    </div>
  );
}

// =============================================================================
// Delivered — BA: receiving form; CA: waiting
// =============================================================================
export function DeliveredBaForm({ procurement, items, auditLog }: StateViewProps) {
  const updateM = useUpdateItemMutation();
  const transitionM = useTransitionMutation();
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Sudah Dikirim — Mulai Penerimaan</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            Periksa barang. Isi jumlah yang diterima, yang ditolak, dan alasan penolakan (jika ada).
          </p>
          <ScmItemTable
            mode="ba-receive"
            items={rowsToItems(items)}
            onItemChange={(itemId, patch) => updateM.mutate({ procurementId: procurement.id as string, itemId, patch: patch as Record<string, unknown> })}
            disabled={updateM.isPending}
          />
        </CardContent>
      </Card>
      <div className="flex justify-end">
        <Button
          disabled={transitionM.isPending}
          onClick={() =>
            transitionM.mutate({ procurementId: procurement.id as string, event: "open-receive" })
          }
        >
          Lanjut ke Review
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Riwayat</CardTitle>
        </CardHeader>
        <CardContent>
          <AuditLogTimeline entries={entriesToAuditLog(auditLog)} />
        </CardContent>
      </Card>
    </div>
  );
}

export function DeliveredCaWaiting({ items, auditLog }: StateViewProps) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Menunggu Review Cabang</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            Barang sudah sampai di cabang. Cabang akan menerima dan review.
          </p>
          <ScmItemTable mode="read-only" items={rowsToItems(items)} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Riwayat</CardTitle>
        </CardHeader>
        <CardContent>
          <AuditLogTimeline entries={entriesToAuditLog(auditLog)} />
        </CardContent>
      </Card>
    </div>
  );
}

// =============================================================================
// ReviewingSJ — BA: interactive (can split qty); CA: live
// =============================================================================
export function ReviewingSjBaInteractive({ procurement, items, auditLog }: StateViewProps) {
  const updateM = useUpdateItemMutation();
  const transitionM = useTransitionMutation();
  const [cancellationReason, setCancellationReason] = useState("");

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Review Penerimaan</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            Konfirmasi jumlah yang diterima dan yang ditolak. Total harus sama dengan jumlah dikirim.
          </p>
          <ScmItemTable
            mode="ba-receive"
            items={rowsToItems(items)}
            onItemChange={(itemId, patch) => updateM.mutate({ procurementId: procurement.id as string, itemId, patch: patch as Record<string, unknown> })}
            disabled={updateM.isPending}
          />
        </CardContent>
      </Card>
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1">
          <input
            type="text"
            placeholder="Alasan pembatalan (wajib jika batal)"
            value={cancellationReason}
            onChange={(e) => setCancellationReason(e.target.value)}
            className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm"
          />
        </div>
        <div className="flex gap-2">
          <Button
            variant="destructive"
            disabled={!cancellationReason || transitionM.isPending}
            onClick={() =>
              transitionM.mutate({
                procurementId: procurement.id as string,
                event: "cancel",
                payload: { reason: cancellationReason },
              })
            }
          >
            Batalkan
          </Button>
          <Button
            disabled={transitionM.isPending}
            onClick={() =>
              transitionM.mutate({
                procurementId: procurement.id as string,
                event: "finish-receive",
                payload: {
                  items: rowsToItems(items).map((it) => ({
                    id: it.id,
                    receivedQuantity: it.receivedQuantity ?? 0,
                    rejectedQuantity: it.rejectedQuantity ?? 0,
                    reason: it.reason,
                  })),
                },
              })
            }
          >
            Selesai Review
          </Button>
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Riwayat</CardTitle>
        </CardHeader>
        <CardContent>
          <AuditLogTimeline entries={entriesToAuditLog(auditLog)} />
        </CardContent>
      </Card>
    </div>
  );
}

export function ReviewingSjCaLive({ items, auditLog }: StateViewProps) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Sedang Direview Cabang</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            Cabang sedang menerima barang. Anda hanya bisa melihat progresnya.
          </p>
          <ScmItemTable mode="read-only" items={rowsToItems(items)} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Riwayat</CardTitle>
        </CardHeader>
        <CardContent>
          <AuditLogTimeline entries={entriesToAuditLog(auditLog)} />
        </CardContent>
      </Card>
    </div>
  );
}

// =============================================================================
// WaitingForPayment — BA: invoice preview; CA: invoice + Mark Paid
// =============================================================================
export function WaitingForPaymentBaInvoice({ items, auditLog, invoice }: StateViewProps) {
  const total = (invoice?.totalAmount as number) ?? 0;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Invoice — Menunggu Pembayaran</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            Invoice berikut sudah diterbitkan. Silakan transfer sesuai total di bawah.
          </p>
          <ScmItemTable mode="invoice-preview" items={rowsToItems(items)} />
          <p className="mt-4 text-right text-lg font-semibold">
            Total: Rp {total.toLocaleString("id-ID")}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Riwayat</CardTitle>
        </CardHeader>
        <CardContent>
          <AuditLogTimeline entries={entriesToAuditLog(auditLog)} />
        </CardContent>
      </Card>
    </div>
  );
}

export function WaitingForPaymentCaInvoice({ procurement, items, auditLog, invoice }: StateViewProps) {
  const transitionM = useTransitionMutation();
  const total = (invoice?.totalAmount as number) ?? 0;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Invoice — Tandai Pembayaran</CardTitle>
        </CardHeader>
        <CardContent>
          <ScmItemTable mode="invoice-preview" items={rowsToItems(items)} />
          <p className="mt-4 text-right text-lg font-semibold">
            Total: Rp {total.toLocaleString("id-ID")}
          </p>
        </CardContent>
      </Card>
      <div className="flex justify-end">
        <Button
          disabled={transitionM.isPending}
          onClick={() =>
            transitionM.mutate({ procurementId: procurement.id as string, event: "mark-paid" })
          }
        >
          Tandai Telah Dibayar
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Riwayat</CardTitle>
        </CardHeader>
        <CardContent>
          <AuditLogTimeline entries={entriesToAuditLog(auditLog)} />
        </CardContent>
      </Card>
    </div>
  );
}

// =============================================================================
// Finished — read-only "Lunas"
// =============================================================================
export function FinishedView({ items, auditLog, invoice }: StateViewProps) {
  const total = (invoice?.totalAmount as number) ?? 0;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Lunas</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm">
            Pengadaan sudah lunas. Total dibayar:{" "}
            <strong>Rp {total.toLocaleString("id-ID")}</strong>
          </p>
          <ScmItemTable mode="read-only" items={rowsToItems(items)} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Riwayat</CardTitle>
        </CardHeader>
        <CardContent>
          <AuditLogTimeline entries={entriesToAuditLog(auditLog)} />
        </CardContent>
      </Card>
    </div>
  );
}

// =============================================================================
// Cancelled — read-only
// =============================================================================
export function CancelledView({ procurement, auditLog }: StateViewProps) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Pengadaan Dibatalkan</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm">
            <strong>Alasan:</strong> {(procurement.cancellationReason as string) || "-"}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Riwayat</CardTitle>
        </CardHeader>
        <CardContent>
          <AuditLogTimeline entries={entriesToAuditLog(auditLog)} />
        </CardContent>
      </Card>
    </div>
  );
}
