import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "#/lib/auth-context";
import RoleGuard from "#/components/RoleGuard";
import {
  getDeliveryNote,
  receiveDeliveryNote,
  reviewDeliveryNote,
  generateSCMInvoice,
  cancelDeliveryNote,
} from "#/lib/server/scm";
import { printSuratJalan } from "#/lib/pos-print";
import { getBranches } from "#/lib/server/branches";
import { Badge } from "#/components/ui/badge";
import { CheckCircle, Printer } from "lucide-react";
import { toast } from "sonner";

interface DNItem {
  id: string;
  ingredientId: string;
  ingredientName: string | null;
  ingredientCode: string | null;
  quantity: number;
  readyQuantity: number | null;
  pickedQuantity: number | null;
  receivedQuantity: number | null;
  rejectedQuantity: number | null;
  rejectionDisposition: "Return to Source" | "Scrap" | "Quarantine" | null;
  discrepancyNote: string | null;
}

const statusColors: Record<
  string,
  "default" | "warning" | "success" | "destructive" | "secondary"
> = {
  Draft: "secondary",
  Picking: "default",
  "In Transit": "warning",
  "Partial Received": "warning",
  Received: "success",
  Cancelled: "destructive",
};

export const Route = createFileRoute("/_layout/delivery-notes/$dnId")({
  component: DNDetailPage,
  loader: async ({ params }) => {
    const dn = await getDeliveryNote({ data: { id: params.dnId } });
    const branches = await getBranches({ data: {} });
    return { dn, branches };
  },
});

function DNDetailPage() {
  const { user } = useAuth();
  const { dn: initial, branches } = Route.useLoaderData();
  const { dnId } = Route.useParams();
  const queryClient = useQueryClient();
  const [receiveInputs, setReceiveInputs] = useState<
    Record<
      string,
      {
        received: string;
        rejected: string;
        note: string;
        disposition: "Return to Source" | "Scrap" | "Quarantine";
      }
    >
  >({});
  const [cancelReason, setCancelReason] = useState("");
  const [showCancelModal, setShowCancelModal] = useState(false);

  const { data: dn } = useQuery({
    queryKey: ["delivery-note", dnId],
    queryFn: () => getDeliveryNote({ data: { id: dnId } }),
    initialData: initial,
  });

  const receiveMutation = useMutation({
    mutationFn: async (data: {
      dnId: string;
      items: {
        itemId: string;
        receivedQuantity: number;
        rejectedQuantity: number;
        rejectionDisposition?: "Return to Source" | "Scrap" | "Quarantine";
        discrepancyNote?: string;
      }[];
    }) => {
      try {
        const result = await receiveDeliveryNote({ data });
        toast.success("Penerimaan Pengadaan berhasil. Stok telah diperbarui.");
        return result;
      } catch (error) {
        toast.error(
          `Gagal memperbarui stok: ${error instanceof Error ? error.message : String(error)}`,
        );
        console.error("Pengadaan receive error:", error);
        throw error;
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["delivery-note", dnId] });
      void queryClient.invalidateQueries({ queryKey: ["delivery-notes"] });
    },
  });

  const reviewMutation = useMutation({
    mutationFn: reviewDeliveryNote,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["delivery-note", dnId] });
      void queryClient.invalidateQueries({ queryKey: ["delivery-notes"] });
    },
  });

  const generateInvoiceMutation = useMutation({
    mutationFn: generateSCMInvoice,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["delivery-note", dnId] });
      void queryClient.invalidateQueries({ queryKey: ["delivery-notes"] });
      void queryClient.invalidateQueries({ queryKey: ["scm-invoices"] });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: cancelDeliveryNote,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["delivery-note", dnId] });
      void queryClient.invalidateQueries({ queryKey: ["delivery-notes"] });
      setShowCancelModal(false);
    },
  });

  if (!dn) return <div className="text-muted-foreground">Surat jalan tidak ditemukan</div>;

  const canReceive =
    (dn.status === "In Transit" || dn.status === "Partial Received") &&
    (user?.role === "branch_admin" || user?.role === "super_admin");
  const canReview =
    (dn.status === "Received" || dn.status === "Partial Received") &&
    !dn.reviewedByAdminPusat &&
    ["super_admin", "admin_pusat"].includes(user?.role ?? "");
  const canGenerateInvoice =
    dn.status === "Received" &&
    dn.reviewedByAdminPusat &&
    ["super_admin", "admin_pusat"].includes(user?.role ?? "");
  const canCancel =
    ["Picking", "In Transit"].includes(dn.status) &&
    ["super_admin", "admin_pusat"].includes(user?.role ?? "");

  const fromBranch = branches.find((b) => b.id === dn.fromBranchId);
  const toBranch = branches.find((b) => b.id === dn.toBranchId);

  const handleReceive = () => {
    const items = dn.items.map((item: DNItem) => {
      const picked = item.pickedQuantity ?? item.quantity;
      const received = Number(receiveInputs[item.id]?.received ?? item.receivedQuantity ?? picked);
      const rejected = Number(receiveInputs[item.id]?.rejected ?? item.rejectedQuantity ?? 0);
      return {
        itemId: item.id,
        receivedQuantity: received,
        rejectedQuantity: rejected,
        rejectionDisposition:
          rejected > 0 ? (receiveInputs[item.id]?.disposition ?? "Return to Source") : undefined,
        discrepancyNote: receiveInputs[item.id]?.note || undefined,
      };
    });
    void receiveMutation.mutateAsync({ dnId, items });
  };

  return (
    <RoleGuard allowedRoles={["super_admin", "admin_pusat", "area_manager", "branch_admin"]}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold">{dn.code}</h1>
            <p className="text-sm text-muted-foreground">Surat Jalan & Transfer Stok</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                printSuratJalan({
                  code: dn.code,
                  fromBranchName: fromBranch?.name ?? dn.fromBranchId.slice(0, 8),
                  toBranchName: toBranch?.name ?? dn.toBranchId.slice(0, 8),
                  driverName: dn.driverName,
                  vehicleNumber: dn.vehicleNumber ?? null,
                  status: dn.status,
                  items: dn.items.map((item: any) => ({
                    ingredientName: item.ingredientName ?? item.ingredientCode,
                    quantity: item.quantity,
                    readyQuantity: item.readyQuantity,
                  })),
                  createdAt: dn.createdAt,
                });
              }}
              className="h-9 px-3 rounded-md border text-sm flex items-center gap-2 hover:bg-accent"
              title="Cetak Surat Jalan"
            >
              <Printer className="h-4 w-4" />
              Cetak
            </button>
            <Badge
              variant={
                (statusColors[dn.status] ?? "default") as
                  | "default"
                  | "success"
                  | "warning"
                  | "destructive"
                  | "secondary"
              }
            >
              {dn.status}
            </Badge>
            {canReview && (
              <button
                onClick={() => void reviewMutation.mutateAsync({ data: { dnId } })}
                disabled={reviewMutation.isPending}
                className="h-9 px-4 rounded-md bg-amber-500 text-white text-sm font-medium disabled:opacity-50"
              >
                {reviewMutation.isPending ? "Memproses..." : "Review SJ"}
              </button>
            )}
            {canGenerateInvoice && (
              <button
                onClick={() => void generateInvoiceMutation.mutateAsync({ data: { dnId } })}
                disabled={generateInvoiceMutation.isPending}
                className="h-9 px-4 rounded-md bg-success text-success-foreground text-sm font-medium disabled:opacity-50"
              >
                {generateInvoiceMutation.isPending ? "Memproses..." : "Buat Invoice"}
              </button>
            )}
            {canCancel && (
              <button
                onClick={() => setShowCancelModal(true)}
                className="h-9 px-4 rounded-md bg-destructive text-destructive-foreground text-sm font-medium"
              >
                Batalkan SJ
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground uppercase">Dari</p>
            <p className="font-medium mt-1">{fromBranch?.name ?? dn.fromBranchId.slice(0, 8)}</p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground uppercase">Ke</p>
            <p className="font-medium mt-1">{toBranch?.name ?? dn.toBranchId.slice(0, 8)}</p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground uppercase">Driver</p>
            <p className="font-medium mt-1">{dn.driverName ?? "-"}</p>
          </div>
        </div>

        {dn.reviewedByAdminPusat && (
          <div className="rounded-md border p-3 bg-success/10">
            <p className="text-xs text-success-foreground">
              <CheckCircle className="inline h-3 w-3 mr-1" />
              Direview oleh Admin Pusat
            </p>
          </div>
        )}

        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Bahan</th>
                <th className="px-4 py-3 text-right font-medium">Diorder</th>
                <th className="px-4 py-3 text-right font-medium">Ready</th>
                <th className="px-4 py-3 text-right font-medium">Dikirim</th>
                <th className="px-4 py-3 text-right font-medium">Diterima</th>
                <th className="px-4 py-3 text-right font-medium">Reject</th>
                <th className="px-4 py-3 text-left font-medium">Keterangan</th>
              </tr>
            </thead>
            <tbody>
              {dn.items.map((item: DNItem) => (
                <tr key={item.id} className="border-b">
                  <td className="px-4 py-3">{item.ingredientName ?? item.ingredientCode}</td>
                  <td className="px-4 py-3 text-right">{item.quantity}</td>
                  <td className="px-4 py-3 text-right">{item.readyQuantity ?? "-"}</td>
                  <td className="px-4 py-3 text-right">{item.pickedQuantity ?? item.quantity}</td>
                  <td className="px-4 py-3">
                    {canReceive ? (
                      <input
                        type="number"
                        min={0}
                        defaultValue={item.receivedQuantity ?? item.pickedQuantity ?? item.quantity}
                        onChange={(e) =>
                          setReceiveInputs((prev) => ({
                            ...prev,
                            [item.id]: { ...prev[item.id], received: e.target.value },
                          }))
                        }
                        className="h-8 w-20 rounded-md border border-input bg-background px-2 text-sm text-right"
                      />
                    ) : (
                      <span className="text-right block">{item.receivedQuantity ?? "-"}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {canReceive ? (
                      <input
                        type="number"
                        min={0}
                        defaultValue={item.rejectedQuantity ?? 0}
                        onChange={(e) =>
                          setReceiveInputs((prev) => ({
                            ...prev,
                            [item.id]: { ...prev[item.id], rejected: e.target.value },
                          }))
                        }
                        className="h-8 w-20 rounded-md border border-input bg-background px-2 text-sm text-right"
                      />
                    ) : (
                      <span className="text-right block">{item.rejectedQuantity ?? "-"}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {canReceive ? (
                      <div className="space-y-1">
                        <input
                          type="text"
                          placeholder="Keterangan..."
                          onChange={(e) =>
                            setReceiveInputs((prev) => ({
                              ...prev,
                              [item.id]: { ...prev[item.id], note: e.target.value },
                            }))
                          }
                          className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                        />
                        {Number(receiveInputs[item.id]?.rejected ?? item.rejectedQuantity ?? 0) >
                          0 && (
                          <select
                            onChange={(e) =>
                              setReceiveInputs((prev) => ({
                                ...prev,
                                [item.id]: {
                                  ...prev[item.id],
                                  disposition: e.target.value as
                                    | "Return to Source"
                                    | "Scrap"
                                    | "Quarantine",
                                },
                              }))
                            }
                            defaultValue={item.rejectionDisposition ?? "Return to Source"}
                            className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs"
                          >
                            <option value="Return to Source">Return ke Pusat</option>
                            <option value="Scrap">Scrap / Buang</option>
                            <option value="Quarantine">Karantina</option>
                          </select>
                        )}
                      </div>
                    ) : (
                      <div>
                        <span>{item.discrepancyNote ?? "-"}</span>
                        {item.rejectionDisposition && (
                          <span className="ml-2 text-xs text-warning-foreground">
                            ({item.rejectionDisposition})
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {canReceive && (
          <button
            onClick={handleReceive}
            disabled={receiveMutation.isPending}
            className="h-10 px-6 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
          >
            {receiveMutation.isPending ? "Memproses..." : "Konfirmasi Penerimaan"}
          </button>
        )}

        {/* Cancel Modal */}
        {showCancelModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-md rounded-lg border bg-background p-6 space-y-4">
              <h3 className="text-lg font-bold">Batalkan Surat Jalan</h3>
              <p className="text-sm text-muted-foreground">
                Pembatalan akan mengembalikan stok ke gudang pusat (jika sedang In Transit).
              </p>
              <div className="space-y-2">
                <label className="text-sm font-medium">Alasan Pembatalan</label>
                <textarea
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  required
                  rows={3}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowCancelModal(false)}
                  className="h-9 px-4 rounded-md border text-sm"
                >
                  Batal
                </button>
                <button
                  onClick={() =>
                    void cancelMutation.mutateAsync({
                      data: { dnId, reason: cancelReason || "Tidak ada alasan" },
                    })
                  }
                  disabled={cancelMutation.isPending || !cancelReason.trim()}
                  className="h-9 px-4 rounded-md bg-destructive text-destructive-foreground text-sm disabled:opacity-50"
                >
                  {cancelMutation.isPending ? "Memproses..." : "Batalkan SJ"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </RoleGuard>
  );
}
