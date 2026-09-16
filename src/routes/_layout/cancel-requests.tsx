import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import { usePageTitle } from "#/hooks/usePageTitle";
import { useTableUrlState } from "#/hooks/useTableUrlState";
import { lookupLabel } from "#/lib/label-lookup";
import { Badge } from "#/components/ui/badge";
import Modal from "#/components/ui/Modal";
import {
  getCancelRequests,
  approveCancelRequest,
  rejectCancelRequest,
  softDeleteCancelRequest,
} from "#/lib/server/pos";
import { toast } from "sonner";
import { useAuth } from "#/lib/auth-context";

import { XCircle, CheckCircle2, Ban, Trash2 } from "lucide-react";

interface CancelRequest {
  id: string;
  orderId: string;
  reason: string;
  detail: string | null;
  requestedBy: string;
  requestedByName: string | null;
  status: "Pending" | "Approved" | "Rejected" | "Executed";
  createdAt: Date;
}

export const Route = createFileRoute("/_layout/cancel-requests")({
  component: CancelRequestsPage,
});

const reasonLabels = {
  "Stok Habis": "Stok Habis",
  "Salah Input": "Salah Input",
  "Customer Cancel": "Customer Cancel",
};

function StatusBadge({ status }: { status: string }) {
  const variant: "warning" | "success" | "destructive" | "secondary" =
    status === "Pending"
      ? "warning"
      : status === "Approved" || status === "Executed"
        ? "success"
        : "secondary";
  return (
    <Badge variant={variant}>
      {status === "Pending"
        ? "Menunggu"
        : status === "Approved"
          ? "Disetujui"
          : status === "Executed"
            ? "Dieksekusi"
            : "Ditolak"}
    </Badge>
  );
}

function formatDateTime(d: Date) {
  return new Date(d).toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STATUS_FILTERS = [
  ["", "Semua"],
  ["Pending", "Menunggu"],
  ["Approved", "Disetujui"],
  ["Rejected", "Ditolak"],
  ["Executed", "Dieksekusi"],
] as const;

function CancelRequestsPage() {
  usePageTitle("Permintaan Pembatalan", "Review dan approve permintaan cancel order dari kasir");
  const queryClient = useQueryClient();

  const [selectedRequest, setSelectedRequest] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<"approve" | "reject" | null>(null);

  // Status filter persists in the URL (?status=Pending) so a shared link or a
  // back-navigation restores the view — same mechanism as sibling list pages.
  const { filters, setFilter } = useTableUrlState<{ status?: string }>(["status"]);
  const statusFilter = filters.status;

  const { data, isLoading } = useQuery({
    queryKey: ["cancel-requests"],
    queryFn: () =>
      getCancelRequests({
        data: {},
      }),
  });

  const requests: CancelRequest[] = data ?? [];

  const filteredRequests = statusFilter
    ? requests.filter((r) => r.status === statusFilter)
    : requests;

  const approveMutation = useMutation({
    mutationFn: approveCancelRequest,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["cancel-requests"] });
      setConfirmAction(null);
      setSelectedRequest(null);
      toast.success("Permintaan disetujui", {
        description: "Kasir sekarang dapat mengeksekusi pembatalan.",
      });
    },
    onError: (error: Error) => {
      toast.error("Gagal menyetujui permintaan", { description: error.message });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: rejectCancelRequest,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["cancel-requests"] });
      setConfirmAction(null);
      setSelectedRequest(null);
      toast.success("Permintaan ditolak");
    },
    onError: (error: Error) => {
      toast.error("Gagal menolak permintaan", { description: error.message });
    },
  });

  // Soft-delete (history housekeeping) — super_admin only, non-Pending rows.
  const user = useAuth().user;
  const canDelete = user?.role === "super_admin";
  const [deleteTarget, setDeleteTarget] = useState<CancelRequest | null>(null);
  const deleteMutation = useMutation({
    mutationFn: softDeleteCancelRequest,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["cancel-requests"] });
      setDeleteTarget(null);
      toast.success("Permintaan dihapus dari riwayat");
    },
    onError: (error: Error) => {
      toast.error("Gagal menghapus permintaan", { description: error.message });
    },
  });

  const pendingCount = requests.filter((r) => r.status === "Pending").length;
  const mutationPending = approveMutation.isPending || rejectMutation.isPending;

  function handleApprove(requestId: string) {
    void approveMutation.mutateAsync({ data: { requestId } });
  }

  function handleReject(requestId: string) {
    void rejectMutation.mutateAsync({ data: { requestId } });
  }

  return (
    <RoleGuard allowedRoles={["super_admin", "area_manager"]}>
      <div className="space-y-4">
        {/* Toolbar: status filter pills (URL-backed), edge-bleed scroll on mobile */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden -mx-4 px-4 sm:mx-0 sm:px-0 pb-1 snap-x snap-mandatory">
            {STATUS_FILTERS.map(([key, label]) => {
              const active = (statusFilter ?? "") === key;
              return (
                <button
                  key={key || "all"}
                  onClick={() => setFilter("status", key || undefined)}
                  aria-pressed={active}
                  className={`shrink-0 snap-start inline-flex items-center h-8 px-3.5 rounded-full text-xs font-medium border transition-all whitespace-nowrap ${
                    active
                      ? "bg-foreground text-background border-foreground shadow-sm"
                      : "bg-background border-border hover:bg-muted text-foreground"
                  }`}
                >
                  {label}
                  {key === "Pending" && pendingCount > 0 && (
                    <span
                      className={`ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums ${
                        active ? "bg-background/20 text-background" : "bg-warning/20 text-warning"
                      }`}
                    >
                      {pendingCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="tabular-nums">
              {filteredRequests.length} permintaan
              {pendingCount > 0 ? ` · ${pendingCount} menunggu review` : ""}
            </span>
            {statusFilter && (
              <button
                onClick={() => setFilter("status", undefined)}
                className="font-medium text-primary hover:underline underline-offset-4"
              >
                Reset
              </button>
            )}
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-2.5">
            {/* Skeleton mirrors the list layout it stands in for */}
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="rounded-xl border bg-card p-3.5 animate-pulse"
                style={{ animationDelay: `${i * 120}ms` }}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="h-3.5 w-24 rounded bg-muted" />
                  <div className="h-5 w-16 rounded-full bg-muted" />
                </div>
                <div className="mt-2.5 h-3 w-3/4 rounded bg-muted" />
                <div className="mt-2 flex items-center justify-between">
                  <div className="h-3 w-20 rounded bg-muted" />
                  <div className="h-8 w-32 rounded-md bg-muted" />
                </div>
              </div>
            ))}
          </div>
        ) : filteredRequests.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-muted/20 p-8 text-center">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-muted">
              <XCircle className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="mt-3 text-sm font-medium">
              {statusFilter ? "Tidak ada hasil" : "Tidak ada permintaan pembatalan"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {statusFilter
                ? `Tidak ada permintaan dengan status "${STATUS_FILTERS.find(([k]) => k === statusFilter)?.[1]}".`
                : "Permintaan dari kasir akan muncul di sini."}
            </p>
          </div>
        ) : (
          <>
            {/* Mobile cards — own everything below lg: at md (768px) the fixed
                16rem sidebar leaves only ~460px of content width, less than
                the desktop table's min-w-[640px], so the table would overflow. */}
            <div className="lg:hidden space-y-2.5 -mx-4 px-4">
              {filteredRequests.map((r) => (
                <div
                  key={r.id}
                  className={`rounded-xl border bg-card p-3.5 shadow-xs ${
                    r.status === "Pending" ? "border-warning/40" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-sm font-semibold tracking-tight">
                        #{r.orderId.slice(0, 8).toUpperCase()}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 tabular-nums">
                        {formatDateTime(r.createdAt)} · {r.requestedByName ?? "-"}
                      </div>
                    </div>
                    <StatusBadge status={r.status} />
                  </div>
                  <div className="mt-2.5 flex items-center gap-1.5 text-xs">
                    <Badge variant="outline" className="shrink-0">
                      {lookupLabel(reasonLabels, r.reason) ?? r.reason}
                    </Badge>
                  </div>
                  {r.detail && (
                    <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">
                      {r.detail}
                    </p>
                  )}
                  {r.status === "Pending" && (
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button
                        onClick={() => {
                          setSelectedRequest(r.id);
                          setConfirmAction("reject");
                        }}
                        className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border text-sm font-medium text-destructive hover:bg-destructive/10 active:scale-[0.99] transition-transform"
                      >
                        <Ban className="h-3.5 w-3.5" />
                        Tolak
                      </button>
                      <button
                        onClick={() => {
                          setSelectedRequest(r.id);
                          setConfirmAction("approve");
                        }}
                        className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium active:scale-[0.99] transition-transform"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Setujui
                      </button>
                    </div>
                  )}
                  {canDelete && r.status !== "Pending" && (
                    <div className="mt-3 flex justify-end">
                      <button
                        onClick={() => setDeleteTarget(r)}
                        className="inline-flex h-9 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="h-3 w-3" />
                        Hapus
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Desktop table */}
            <div className="hidden lg:block rounded-md border overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead className="border-b bg-muted/50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Waktu</th>
                    <th className="px-4 py-3 text-left font-medium">Order</th>
                    <th className="px-4 py-3 text-left font-medium">Alasan</th>
                    <th className="px-4 py-3 text-left font-medium">Detail</th>
                    <th className="px-4 py-3 text-left font-medium">Diajukan Oleh</th>
                    <th className="px-4 py-3 text-left font-medium">Status</th>
                    <th className="px-4 py-3 text-right font-medium">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRequests.map((r) => (
                    <tr
                      key={r.id}
                      className={`border-b ${r.status === "Pending" ? "bg-warning/[0.04]" : ""} hover:bg-muted/30`}
                    >
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap tabular-nums">
                        {formatDateTime(r.createdAt)}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">
                        #{r.orderId.slice(0, 8).toUpperCase()}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="outline">
                          {lookupLabel(reasonLabels, r.reason) ?? r.reason}
                        </Badge>
                      </td>
                      <td
                        className="px-4 py-3 text-muted-foreground max-w-[220px] truncate"
                        title={r.detail ?? undefined}
                      >
                        {r.detail ?? "-"}
                      </td>
                      <td className="px-4 py-3">{r.requestedByName ?? "-"}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        {r.status === "Pending" && (
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => {
                                setSelectedRequest(r.id);
                                setConfirmAction("reject");
                              }}
                              className="h-8 px-3 rounded-md border text-xs font-medium text-destructive hover:bg-destructive/10"
                            >
                              Tolak
                            </button>
                            <button
                              onClick={() => {
                                setSelectedRequest(r.id);
                                setConfirmAction("approve");
                              }}
                              className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium"
                            >
                              Setujui
                            </button>
                          </div>
                        )}
                        {canDelete && r.status !== "Pending" && (
                          <button
                            onClick={() => setDeleteTarget(r)}
                            title="Hapus dari riwayat"
                            aria-label="Hapus permintaan"
                            className="h-8 w-8 inline-flex items-center justify-center rounded-md border text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* ── Soft Delete Confirm Modal ── */}
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Hapus dari Riwayat"
        size="sm"
      >
        {deleteTarget && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Permintaan pembatalan untuk order #{deleteTarget.orderId.slice(0, 8).toUpperCase()} (
              {deleteTarget.status}) akan disembunyikan dari riwayat (soft delete).
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="h-9 px-4 rounded-md border text-sm"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => deleteMutation.mutate({ data: { requestId: deleteTarget.id } })}
                disabled={deleteMutation.isPending}
                className="h-9 px-4 rounded-md bg-destructive text-destructive-foreground text-sm disabled:opacity-50"
              >
                {deleteMutation.isPending ? "Memproses..." : "Hapus"}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Confirm modal — approve/reject */}
      {confirmAction && (
        <Modal
          open={!!confirmAction}
          onClose={() => setConfirmAction(null)}
          title={confirmAction === "approve" ? "Setujui Pembatalan" : "Tolak Pembatalan"}
          size="sm"
        >
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {confirmAction === "approve"
                ? "Apakah Anda yakin ingin menyetujui pembatalan ini? Pesanan akan dibatalkan dan stok akan dikembalikan."
                : "Apakah Anda yakin ingin menolak permintaan pembatalan ini?"}
            </p>
            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2">
              <button
                onClick={() => setConfirmAction(null)}
                disabled={mutationPending}
                className="h-10 sm:h-9 px-4 rounded-md border text-sm disabled:opacity-50"
              >
                Batal
              </button>
              <button
                onClick={() => {
                  if (confirmAction === "approve" && selectedRequest)
                    handleApprove(selectedRequest);
                  else if (selectedRequest) handleReject(selectedRequest);
                }}
                disabled={mutationPending}
                className={
                  "h-10 sm:h-9 px-4 rounded-md text-sm font-medium text-white disabled:opacity-50 " +
                  (confirmAction === "approve" ? "bg-primary" : "bg-destructive")
                }
              >
                {mutationPending
                  ? "Memproses..."
                  : confirmAction === "approve"
                    ? "Setujui"
                    : "Tolak"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </RoleGuard>
  );
}
