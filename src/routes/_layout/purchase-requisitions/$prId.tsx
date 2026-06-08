import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useAuth } from "#/lib/auth-context";
import RoleGuard from "#/components/RoleGuard";
import Modal from "#/components/ui/Modal";
import {
  getPurchaseRequisition,
  updatePurchaseRequisition,
  processPurchaseRequisition,
  getDeliveryNotes,
} from "#/lib/server/scm";
import { Badge } from "#/components/ui/badge";
import { Truck, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/_layout/purchase-requisitions/$prId")({
  component: PRDetailPage,
  loader: async ({ params }) => {
    const pr = await getPurchaseRequisition({ data: { id: params.prId } });
    return { pr };
  },
});

function PRDetailPage() {
  const { user } = useAuth();
  const { pr: initial } = Route.useLoaderData();
  const { prId } = Route.useParams();
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [showProcessModal, setShowProcessModal] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [editedQuantities, setEditedQuantities] = useState<Record<string, number>>({});
  const [editError, setEditError] = useState<string | null>(null);

  const isApprover =
    user?.role === "super_admin" || user?.role === "admin_pusat" || user?.role === "area_manager";
  const isBranchAdmin = user?.role === "branch_admin";

  const { data: pr } = useQuery({
    queryKey: ["purchase-requisition", prId],
    queryFn: () => getPurchaseRequisition({ data: { id: prId } }),
    initialData: initial,
  });

  // Sync edited quantities when PR loads or edit mode opens
  useEffect(() => {
    if (pr && isEditing) {
      const qtyMap: Record<string, number> = {};
      for (const item of pr.items) {
        qtyMap[(item as any).id] = (item as any).quantity;
      }
      setEditedQuantities(qtyMap);
      setEditError(null);
    }
  }, [pr, isEditing]);

  const { data: deliveryNotes } = useQuery({
    queryKey: ["delivery-notes"],
    queryFn: () => getDeliveryNotes({ data: {} }),
  });

  const linkedDN = deliveryNotes?.find((dn) => dn.purchaseRequisitionId === prId);

  const editMutation = useMutation({
    mutationFn: updatePurchaseRequisition,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["purchase-requisition", prId] });
      void queryClient.invalidateQueries({ queryKey: ["purchase-requisitions"] });
      setIsEditing(false);
      setEditedQuantities({});
      setEditError(null);
    },
    onError: (err) => {
      setEditError(err instanceof Error ? err.message : 'Gagal menyimpan perubahan');
    },
  });

  const processMutation = useMutation({
    mutationFn: processPurchaseRequisition,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["purchase-requisition", prId] });
      void queryClient.invalidateQueries({ queryKey: ["purchase-requisitions"] });
      void queryClient.invalidateQueries({ queryKey: ["delivery-notes"] });
      setShowProcessModal(false);
    },
  });

  const rejectMutation = useMutation({
    mutationFn: updatePurchaseRequisition,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["purchase-requisition", prId] });
      void queryClient.invalidateQueries({ queryKey: ["purchase-requisitions"] });
      setShowRejectModal(false);
    },
  });

  if (!pr) return <div className="text-muted-foreground">PR tidak ditemukan</div>;

  const canProcess = isApprover && ["Pending", "Approved"].includes(pr.status);
  const canReject = isApprover && ["Pending", "Approved"].includes(pr.status);
  const canEdit = isBranchAdmin && ["Draft", "Pending"].includes(pr.status);

  const statusColors: Record<
    string,
    "default" | "warning" | "success" | "destructive" | "secondary"
  > = {
    Draft: "secondary",
    Pending: "warning",
    Approved: "default",
    Processed: "success",
    Rejected: "destructive",
    Fulfilled: "success",
  };

  return (
    <RoleGuard allowedRoles={["super_admin", "admin_pusat", "area_manager", "branch_admin"]}>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">{pr.code}</h1>
            <p className="text-sm text-muted-foreground">
              Cabang: {pr.branchId.slice(0, 8)}
              {pr.approvedBy && ` — Disetujui oleh: ${pr.approvedBy.slice(0, 8)}`}
              {pr.rejectionReason && (
                <span className="text-destructive"> — Alasan ditolak: {pr.rejectionReason}</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant={statusColors[pr.status] ?? "default"}>{pr.status}</Badge>
            {canProcess && (
              <button
                onClick={() => setShowProcessModal(true)}
                className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm"
              >
                Proses
              </button>
            )}
            {canReject && (
              <button
                onClick={() => setShowRejectModal(true)}
                className="h-9 px-4 rounded-md bg-destructive text-destructive-foreground text-sm"
              >
                Tolak
              </button>
            )}
            {canEdit && !isEditing && (
              <button
                onClick={() => setIsEditing(true)}
                className="h-9 px-4 rounded-md border text-sm"
              >
                Edit
              </button>
            )}
            {isEditing && (
              <>
                {editError && (
                  <span className="text-xs text-destructive">{editError}</span>
                )}
                <button
                  onClick={() => {
                    setIsEditing(false);
                    setEditError(null);
                  }}
                  className="h-9 px-4 rounded-md border text-sm"
                >
                  Batal
                </button>
                <button
                  onClick={() => {
                    const items = Object.entries(editedQuantities).map(([id, quantity]) => ({
                      ingredientId: id,
                      quantity,
                    }));
                    void editMutation.mutateAsync({
                      data: { id: prId, items },
                    });
                  }}
                  disabled={editMutation.isPending}
                  className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50"
                >
                  {editMutation.isPending ? "Menyimpan..." : "Simpan"}
                </button>
              </>
            )}
          </div>
        </div>

        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm min-w-[480px]">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Kode</th>
                <th className="px-4 py-3 text-left font-medium">Nama Bahan</th>
                <th className="px-4 py-3 text-right font-medium">Qty Order</th>
                <th className="px-4 py-3 text-left font-medium">Satuan</th>
              </tr>
            </thead>
            <tbody>
              {pr.items.map(
                (item: {
                  id: string;
                  ingredientCode: string | null;
                  ingredientName: string | null;
                  quantity: number;
                  stockUnit: string | null;
                }) => (
                  <tr key={item.id} className="border-b">
                    <td className="px-4 py-3 font-mono text-xs">{item.ingredientCode}</td>
                    <td className="px-4 py-3">{item.ingredientName}</td>
                    <td className="px-4 py-3 text-right font-medium">
                      {isEditing ? (
                        <input
                          type="number"
                          min={1}
                          value={editedQuantities[item.id] ?? item.quantity}
                          onChange={(e) =>
                            setEditedQuantities((prev) => ({
                              ...prev,
                              [item.id]: Number(e.target.value),
                            }))
                          }
                          className="h-8 w-24 rounded-md border border-input bg-background px-2 text-sm text-right"
                        />
                      ) : (
                        item.quantity.toLocaleString("id-ID")
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{item.stockUnit}</td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>

        {/* Linked Delivery Note */}
        {linkedDN && (
          <div className="rounded-md border p-4 space-y-2">
            <p className="text-xs text-muted-foreground uppercase">Surat Jalan Terkait</p>
            <Link
              to="/delivery-notes/$dnId"
              params={{ dnId: linkedDN.id }}
              className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
            >
              <Truck className="h-4 w-4" />
              {linkedDN.code} — {linkedDN.status}
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        )}

        {pr.notes && (
          <div className="rounded-md border p-4">
            <p className="text-xs text-muted-foreground uppercase">Catatan</p>
            <p className="mt-1">{pr.notes}</p>
          </div>
        )}

        {pr.rejectionReason && pr.status === "Rejected" && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4">
            <p className="text-xs text-muted-foreground uppercase">Alasan Ditolak</p>
            <p className="mt-1 text-destructive">{pr.rejectionReason}</p>
          </div>
        )}
      </div>

      {/* Process Confirmation Modal */}
      <Modal
        open={showProcessModal}
        onClose={() => setShowProcessModal(false)}
        title="Proses Purchase Requisition"
      >
        <div className="space-y-4">
          <p className="text-sm">
            Proses PR <strong>{pr.code}</strong>?
          </p>
          <p className="text-sm text-muted-foreground">
            Tindakan ini akan mengubah status PR menjadi <strong>Processed</strong>.
          </p>
          <div className="rounded-md border p-3 space-y-2">
            <p className="text-sm font-medium">Buat Surat Jalan juga?</p>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  void processMutation.mutateAsync({
                    data: { id: prId, alsoCreateSJ: true },
                  });
                }}
                disabled={processMutation.isPending}
                className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm flex items-center gap-2"
              >
                <Truck className="h-4 w-4" />
                Ya, Buat SJ
              </button>
              <button
                onClick={() => {
                  void processMutation.mutateAsync({
                    data: { id: prId, alsoCreateSJ: false },
                  });
                }}
                disabled={processMutation.isPending}
                className="h-9 px-4 rounded-md border text-sm"
              >
                Tidak, Hanya Proses
              </button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Reject Confirmation Modal */}
      <Modal
        open={showRejectModal}
        onClose={() => setShowRejectModal(false)}
        title="Tolak Purchase Requisition"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            void rejectMutation.mutateAsync({
              data: {
                id: prId,
                status: "Rejected",
                rejectionReason: fd.get("reason") as string,
              },
            });
          }}
          className="space-y-4"
        >
          <p className="text-sm">
            Tolak PR <strong>{pr.code}</strong>?
          </p>
          <div className="space-y-2">
            <label className="text-sm font-medium">Alasan Penolakan</label>
            <textarea
              name="reason"
              required
              rows={3}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              placeholder="Contoh: Stok masih mencukupi, tidak perlu pengadaan..."
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowRejectModal(false)}
              className="h-9 px-4 rounded-md border text-sm"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={rejectMutation.isPending}
              className="h-9 px-4 rounded-md bg-destructive text-destructive-foreground text-sm"
            >
              Tolak PR
            </button>
          </div>
        </form>
      </Modal>
    </RoleGuard>
  );
}
