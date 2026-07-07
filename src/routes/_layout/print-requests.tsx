import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import RoleGuard from "#/components/RoleGuard";
import { usePageTitle } from "#/hooks/usePageTitle";
import { Badge } from "#/components/ui/badge";
import Modal from "#/components/ui/Modal";
import { getPendingPrintRequests, approveReprint, rejectReprint } from "#/lib/server/pos";
import { Printer } from "lucide-react";

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
  });

  const rejectMutation = useMutation({
    mutationFn: rejectReprint,
    onSuccess: function () {
      void queryClient.invalidateQueries({ queryKey: ["print-requests"] });
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

  const channelLabels: Record<string, string> = {
    Gofood: "Gofood",
    Grabfood: "Grabfood",
    ShopeeFood: "ShopeeFood",
    "Dine-in": "Dine-in",
    TikTok: "TikTok",
  };

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
        <div className="rounded-md border overflow-x-auto">
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
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                      {new Date(r.createdAt).toLocaleString("id-ID", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      #{(r.orderId || "").slice(0, 8).toUpperCase()}
                      {r.orderCode && (
                        <span className="ml-1 text-muted-foreground">({r.orderCode})</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline">
                        {r.orderChannel ? (channelLabels[r.orderChannel] ?? r.orderChannel) : "-"}
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
                            className="h-8 px-3 rounded-md border text-xs text-destructive hover:bg-destructive/10"
                          >
                            Reject
                          </button>
                          <button
                            onClick={function () {
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
                );
              })}
            </tbody>
          </table>
        </div>
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
          <div className="flex justify-end gap-2">
            <button
              onClick={function () {
                setConfirmAction(null);
              }}
              className="h-9 px-4 rounded-md border text-sm"
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
                "h-9 px-4 rounded-md text-sm text-white disabled:opacity-50 " +
                (confirmAction === "approve" ? "bg-primary" : "bg-destructive")
              }
            >
              {confirmAction === "approve" ? "Setujui" : "Tolak"}
            </button>
          </div>
        </div>
      </Modal>
    </RoleGuard>
  );
}
