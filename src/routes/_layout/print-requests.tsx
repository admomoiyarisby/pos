import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { lookupLabel } from "#/lib/label-lookup";
import RoleGuard from "#/components/RoleGuard";
import { usePageTitle } from "#/hooks/usePageTitle";
import { Badge } from "#/components/ui/badge";
import Modal from "#/components/ui/Modal";
import { getPendingPrintRequests, approveReprint, rejectReprint } from "#/lib/server/pos";
import { Ban, CheckCircle2, Printer } from "lucide-react";
import { toast } from "sonner";

interface PrintRequest {
  id: string;
  orderId: string;
  requestType: string;
  requestedBy: string;
  requestedByName: string | null;
  status: string;
  createdAt: Date;
  orderCode: string | null;
  orderChannel: string | null;
  orderTotal: number | null;
  orderCreatedAt: Date | null;
}

export const Route = createFileRoute("/_layout/print-requests")({
  component: PrintRequestsPage,
});

function StatusBadge(props: { status: string }) {
  const s = props.status;
  const variant: "warning" | "success" | "destructive" | "secondary" =
    s === "Pending" ? "warning" : s === "Approved" ? "success" : "destructive";
  return (
    <Badge variant={variant}>
      {s === "Pending" ? "Menunggu" : s === "Approved" ? "Disetujui" : "Ditolak"}
    </Badge>
  );
}

function formatDateTime(d: Date) {
  return new Date(d).toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function PrintRequestsPage() {
  usePageTitle("Permintaan Cetak Ulang", "Review dan approve permintaan re-print struk dari kasir");
  const queryClient = useQueryClient();

  const _a = useState<string | null>(null);
  const selectedRequest = _a[0];
  const setSelectedRequest = _a[1];

  const _b = useState<"approve" | "reject" | null>(null);
  const confirmAction = _b[0];
  const setConfirmAction = _b[1];

  const { data, isLoading } = useQuery({
    queryKey: ["print-requests"],
    queryFn: function () {
      return getPendingPrintRequests({ data: {} });
    },
  });

  const requests: PrintRequest[] = data ?? [];

  const approveMutation = useMutation({
    mutationFn: approveReprint,
    onSuccess: function () {
      void queryClient.invalidateQueries({ queryKey: ["print-requests"] });
      setConfirmAction(null);
      setSelectedRequest(null);
    },
    // Without this the failure is silent: call sites discard the rejected
    // promise with `void ...mutateAsync()`, so a refused action looked
    // exactly like an unresponsive control.
    onError: (error: Error) => {
      toast.error("Gagal menyetujui", { description: error.message });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: rejectReprint,
    onSuccess: function () {
      void queryClient.invalidateQueries({ queryKey: ["print-requests"] });
      setConfirmAction(null);
      setSelectedRequest(null);
    },

    // Without this the failure is silent: call sites discard the rejected
    // promise with `void ...mutateAsync()`, so a refused action looked
    // exactly like an unresponsive control.
    onError: (error: Error) => {
      toast.error("Gagal menolak permintaan cetak", { description: error.message });
    },
  });

  function handleApprove(requestId: string) {
    void approveMutation.mutateAsync({ data: { requestId } });
  }

  function handleReject(requestId: string) {
    void rejectMutation.mutateAsync({ data: { requestId } });
  }

  const channelLabels = {
    Gofood: "Gofood",
    Grabfood: "Grabfood",
    ShopeeFood: "ShopeeFood",
    "Dine-in": "Dine-in",
    TikTok: "TikTok",
    Perlengkapan: "Perlengkapan",
  } satisfies Record<string, string>;

  return (
    <RoleGuard allowedRoles={["super_admin", "area_manager"]}>
      {isLoading ? (
        <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
          Memuat...
        </div>
      ) : requests.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
          <Printer className="h-10 w-10 mb-2 opacity-30" />
          <p className="text-sm font-medium">Tidak ada permintaan cetak ulang</p>
          <p className="text-xs">Permintaan dari kasir akan muncul di sini</p>
        </div>
      ) : (
        <>
          {/* Mobile cards — own everything below lg: at md (768px) the fixed
              16rem sidebar leaves only ~460px of content width, less than the
              desktop table's min-w-[640px], so the table would overflow. */}
          <div className="lg:hidden space-y-2.5 -mx-4 px-4">
            {requests.map(function (r) {
              return (
                <div
                  key={r.id}
                  className={
                    "rounded-xl border bg-card p-3.5 shadow-xs " +
                    (r.status === "Pending" ? "border-warning/40" : "")
                  }
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-sm font-semibold tracking-tight">
                        #{(r.orderId || "").slice(0, 8).toUpperCase()}
                      </div>
                      {r.orderCode && (
                        <div className="mt-0.5 truncate text-xs text-muted-foreground">
                          {r.orderCode}
                        </div>
                      )}
                    </div>
                    <StatusBadge status={r.status} />
                  </div>

                  <div className="mt-2.5 flex items-center gap-1.5 text-xs">
                    <Badge variant="outline" className="shrink-0">
                      {r.orderChannel
                        ? (lookupLabel(channelLabels, r.orderChannel) ?? r.orderChannel)
                        : "-"}
                    </Badge>
                    <span className="text-muted-foreground">·</span>
                    <span className="font-medium">
                      {r.requestType === "reprint" ? "Cetak Ulang" : "Bill"}
                    </span>
                  </div>

                  <div className="mt-2.5 flex items-end justify-between gap-3 border-t pt-2.5">
                    <div className="text-sm font-semibold tabular-nums">
                      Rp {(r.orderTotal ?? 0).toLocaleString("id-ID")}
                    </div>
                    <div className="min-w-0 text-right text-xs text-muted-foreground">
                      <div className="tabular-nums">{formatDateTime(r.createdAt)}</div>
                      <div className="truncate">{r.requestedByName ?? "-"}</div>
                    </div>
                  </div>

                  {r.status === "Pending" && (
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button
                        onClick={function () {
                          setSelectedRequest(r.id);
                          setConfirmAction("reject");
                        }}
                        className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border text-sm font-medium text-destructive transition-transform hover:bg-destructive/10 active:scale-[0.99]"
                      >
                        <Ban className="h-3.5 w-3.5" />
                        Tolak
                      </button>
                      <button
                        onClick={function () {
                          setSelectedRequest(r.id);
                          setConfirmAction("approve");
                        }}
                        className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-primary text-sm font-medium text-primary-foreground transition-transform active:scale-[0.99]"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Setujui
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Desktop table */}
          <div className="hidden lg:block rounded-md border overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="border-b bg-muted/50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Waktu</th>
                  <th className="px-4 py-3 text-left font-medium">Order</th>
                  <th className="px-4 py-3 text-left font-medium">Channel</th>
                  <th className="px-4 py-3 text-left font-medium">Total</th>
                  <th className="px-4 py-3 text-left font-medium">Tipe</th>
                  <th className="px-4 py-3 text-left font-medium">Diajukan Oleh</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {requests.map(function (r) {
                  return (
                    <tr key={r.id} className="border-b hover:bg-muted/30">
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap tabular-nums">
                        {formatDateTime(r.createdAt)}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">
                        #{(r.orderId || "").slice(0, 8).toUpperCase()}
                        {r.orderCode && (
                          <span className="ml-1 text-muted-foreground">({r.orderCode})</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="outline">
                          {r.orderChannel
                            ? (lookupLabel(channelLabels, r.orderChannel) ?? r.orderChannel)
                            : "-"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 font-medium">
                        Rp {(r.orderTotal ?? 0).toLocaleString("id-ID")}
                      </td>
                      <td className="px-4 py-3">
                        {r.requestType === "reprint" ? "Cetak Ulang" : "Bill"}
                      </td>
                      <td className="px-4 py-3">{r.requestedByName ?? "-"}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        {r.status === "Pending" && (
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={function () {
                                setSelectedRequest(r.id);
                                setConfirmAction("reject");
                              }}
                              className="h-8 px-3 rounded-md border text-xs font-medium text-destructive hover:bg-destructive/10"
                            >
                              Tolak
                            </button>
                            <button
                              onClick={function () {
                                setSelectedRequest(r.id);
                                setConfirmAction("approve");
                              }}
                              className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium"
                            >
                              Setujui
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Confirm modal */}
      <Modal
        open={!!confirmAction}
        onClose={function () {
          setConfirmAction(null);
        }}
        title={confirmAction === "approve" ? "Setujui Cetak Ulang" : "Tolak Cetak Ulang"}
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {confirmAction === "approve"
              ? "Apakah Anda yakin ingin menyetujui permintaan cetak ulang ini?"
              : "Apakah Anda yakin ingin menolak permintaan cetak ulang ini?"}
          </p>
          <div className="flex flex-col-reverse sm:flex-row justify-end gap-2">
            <button
              onClick={function () {
                setConfirmAction(null);
              }}
              disabled={approveMutation.isPending || rejectMutation.isPending}
              className="h-10 sm:h-9 px-4 rounded-md border text-sm disabled:opacity-50"
            >
              Batal
            </button>
            <button
              onClick={function () {
                if (confirmAction === "approve" && selectedRequest) handleApprove(selectedRequest);
                else if (selectedRequest) handleReject(selectedRequest);
              }}
              disabled={approveMutation.isPending || rejectMutation.isPending}
              className={
                "h-10 sm:h-9 px-4 rounded-md text-sm text-white disabled:opacity-50 " +
                (confirmAction === "approve" ? "bg-primary" : "bg-destructive")
              }
            >
              {approveMutation.isPending || rejectMutation.isPending
                ? "Memproses..."
                : confirmAction === "approve"
                  ? "Setujui"
                  : "Tolak"}
            </button>
          </div>
        </div>
      </Modal>
    </RoleGuard>
  );
}
