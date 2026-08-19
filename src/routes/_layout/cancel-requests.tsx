import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { searchStringParam } from "#/lib/utils";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import { usePageTitle } from "#/hooks/usePageTitle";
import { lookupLabel } from "#/lib/label-lookup";
import { Badge } from "#/components/ui/badge";
import Modal from "#/components/ui/Modal";
import { getCancelRequests, approveCancelRequest, rejectCancelRequest } from "#/lib/server/pos";

import { XCircle } from "lucide-react";

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

function CancelRequestsPage() {
  usePageTitle("Permintaan Pembatalan", "Review dan approve permintaan cancel order dari kasir");
  const queryClient = useQueryClient();

  const [selectedRequest, setSelectedRequest] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<"approve" | "reject" | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["cancel-requests"],
    queryFn: () =>
      getCancelRequests({
        data: {},
      }),
  });

  const requests: CancelRequest[] = data ?? [];

  const statusFilter = searchStringParam(Route.useSearch(), "status");
  const filteredRequests = statusFilter
    ? requests.filter((r) => r.status === statusFilter)
    : requests;

  const approveMutation = useMutation({
    mutationFn: approveCancelRequest,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["cancel-requests"] });
      setConfirmAction(null);
      setSelectedRequest(null);
    },
  });

  const rejectMutation = useMutation({
    mutationFn: rejectCancelRequest,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["cancel-requests"] });
      setConfirmAction(null);
      setSelectedRequest(null);
    },
  });

  function handleApprove(requestId: string) {
    void approveMutation.mutateAsync({ data: { requestId } });
  }

  function handleReject(requestId: string) {
    void rejectMutation.mutateAsync({ data: { requestId } });
  }

  return (
    <RoleGuard allowedRoles={["super_admin", "area_manager"]}>
      {isLoading ? (
        <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
          Memuat...
        </div>
      ) : filteredRequests.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
          <XCircle className="h-10 w-10 mb-2 opacity-30" />
          <p className="text-sm font-medium">Tidak ada permintaan pembatalan</p>
          <p className="text-xs">Permintaan dari kasir akan muncul di sini</p>
        </div>
      ) : (
        <div className="rounded-md border overflow-x-auto">
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
                <tr key={r.id} className="border-b hover:bg-muted/30">
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                    {new Date(r.createdAt).toLocaleString("id-ID", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">
                    #{r.orderId.slice(0, 8).toUpperCase()}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="outline">
                      {lookupLabel(reasonLabels, r.reason) ?? r.reason}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground max-w-[200px] truncate">
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
                          className="h-8 px-3 rounded-md border text-xs text-destructive hover:bg-destructive/10"
                        >
                          Reject
                        </button>
                        <button
                          onClick={() => {
                            setSelectedRequest(r.id);
                            setConfirmAction("approve");
                          }}
                          className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs"
                        >
                          Approve
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmAction(null)}
                className="h-9 px-4 rounded-md border text-sm"
              >
                Batal
              </button>
              <button
                onClick={() => {
                  if (confirmAction === "approve" && selectedRequest)
                    handleApprove(selectedRequest);
                  else if (selectedRequest) handleReject(selectedRequest);
                }}
                disabled={approveMutation.isPending || rejectMutation.isPending}
                className={
                  "h-9 px-4 rounded-md text-sm text-white disabled:opacity-50 " +
                  (confirmAction === "approve" ? "bg-primary" : "bg-destructive")
                }
              >
                {confirmAction === "approve" ? "Setujui" : "Tolak"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </RoleGuard>
  );
}
