import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "#/lib/auth-context";
import RoleGuard from "#/components/RoleGuard";
import {
  getPurchaseOrder,
  updatePurchaseOrder,
  sendPurchaseOrder,
  receivePurchaseOrder,
  cancelPurchaseOrder,
} from "#/lib/server/scm";
import { getBranches } from "#/lib/server/branches";
import { getIngredients } from "#/lib/server/ingredients";
import { Badge } from "#/components/ui/badge";
import { Check, PackageCheck, Ban } from "lucide-react";

const statusColors: Record<
  string,
  "default" | "secondary" | "warning" | "success" | "destructive"
> = {
  Draft: "secondary",
  Sent: "warning",
  Partial: "default",
  Completed: "success",
  Cancelled: "destructive",
};

export const Route = createFileRoute("/_layout/purchase-orders/$poId")({
  component: PODetailPage,
  loader: async ({ params }) => {
    const po = await getPurchaseOrder({ data: { id: params.poId } });
    const branches = await getBranches({ data: {} });
    const ingredients = await getIngredients({ data: {} });
    return { po, branches, ingredients };
  },
});

function PODetailPage() {
  const { user } = useAuth();
  const { po: initial, branches, ingredients } = Route.useLoaderData();
  const { poId } = Route.useParams();
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [editItems, setEditItems] = useState<
    { ingredientId: string; quantity: number; unitPrice?: number }[]
  >([]);

  const { data: po } = useQuery({
    queryKey: ["purchase-order", poId],
    queryFn: () => getPurchaseOrder({ data: { id: poId } }),
    initialData: initial,
  });

  const updateMutation = useMutation({
    mutationFn: updatePurchaseOrder,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["purchase-order", poId] });
      void queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      setIsEditing(false);
    },
  });

  const sendMutation = useMutation({
    mutationFn: sendPurchaseOrder,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["purchase-order", poId] });
      void queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
    },
  });

  const receiveMutation = useMutation({
    mutationFn: receivePurchaseOrder,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["purchase-order", poId] });
      void queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: cancelPurchaseOrder,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["purchase-order", poId] });
      void queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
    },
  });

  if (!po) return <div className="text-muted-foreground">PO tidak ditemukan</div>;

  const isAdmin = ["super_admin", "admin_pusat"].includes(user?.role ?? "");
  const canEdit = isAdmin && po.status === "Draft";
  const canSend = isAdmin && po.status === "Draft";
  const canReceive = isAdmin && ["Sent", "Partial"].includes(po.status);
  const canCancel = isAdmin && po.status !== "Completed" && po.status !== "Cancelled";

  const fromBranch = branches.find((b) => b.id === po.fromBranchId);
  const toBranch = branches.find((b) => b.id === po.toBranchId);

  const handleSaveEdit = () => {
    void updateMutation.mutateAsync({
      data: { id: poId, items: editItems },
    });
  };

  const handleReceive = () => {
    const items = po.items.map((item: { id: string; quantity: number }) => ({
      itemId: item.id,
      receivedQuantity: item.quantity,
    }));
    void receiveMutation.mutateAsync({ data: { id: poId, items } });
  };

  return (
    <RoleGuard allowedRoles={["super_admin", "admin_pusat"]}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold">{po.code}</h1>
            <p className="text-sm text-muted-foreground">Purchase Order</p>
          </div>
          <div className="flex items-center gap-3">
            <Badge
              variant={
                (statusColors[po.status] ?? "default") as
                  | "default"
                  | "success"
                  | "warning"
                  | "destructive"
                  | "secondary"
              }
            >
              {po.status}
            </Badge>
            {canEdit && (
              <button
                onClick={() => {
                  if (isEditing) {
                    setIsEditing(false);
                  } else {
                    setEditItems(
                      po.items.map(
                        (item: {
                          ingredientId: string;
                          quantity: number;
                          unitPrice?: number | null;
                        }) => ({
                          ingredientId: item.ingredientId,
                          quantity: item.quantity,
                          unitPrice: item.unitPrice ?? undefined,
                        }),
                      ),
                    );
                    setIsEditing(true);
                  }
                }}
                className="h-9 px-4 rounded-md border text-sm"
              >
                {isEditing ? "Batal Edit" : "Edit PO"}
              </button>
            )}
            {canSend && (
              <button
                onClick={() => void sendMutation.mutateAsync({ data: { id: poId } })}
                disabled={sendMutation.isPending}
                className="h-9 px-4 rounded-md bg-blue-600 text-white text-sm font-medium disabled:opacity-50"
              >
                <Check className="h-4 w-4 inline mr-1" />
                {sendMutation.isPending ? "Memproses..." : "Kirim PO"}
              </button>
            )}
            {canReceive && (
              <button
                onClick={handleReceive}
                disabled={receiveMutation.isPending}
                className="h-9 px-4 rounded-md bg-emerald-600 text-white text-sm font-medium disabled:opacity-50"
              >
                <PackageCheck className="h-4 w-4 inline mr-1" />
                {receiveMutation.isPending ? "Memproses..." : "Terima PO"}
              </button>
            )}
            {canCancel && (
              <button
                onClick={() => {
                  if (confirm("Yakin ingin membatalkan PO ini?")) {
                    void cancelMutation.mutateAsync({ data: { id: poId } });
                  }
                }}
                disabled={cancelMutation.isPending}
                className="h-9 px-4 rounded-md bg-red-600 text-white text-sm font-medium disabled:opacity-50"
              >
                <Ban className="h-4 w-4 inline mr-1" />
                Batal
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground uppercase">Dari</p>
            <p className="font-medium mt-1">{fromBranch?.name ?? po.fromBranchId.slice(0, 8)}</p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground uppercase">Ke</p>
            <p className="font-medium mt-1">{toBranch?.name ?? po.toBranchId.slice(0, 8)}</p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground uppercase">Dibuat</p>
            <p className="font-medium mt-1">{new Date(po.createdAt).toLocaleDateString("id-ID")}</p>
          </div>
        </div>

        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm min-w-[480px]">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Bahan</th>
                <th className="px-4 py-3 text-right font-medium">Qty Order</th>
                <th className="px-4 py-3 text-right font-medium">Harga Satuan</th>
                <th className="px-4 py-3 text-right font-medium">Total</th>
                {po.status !== "Draft" && (
                  <th className="px-4 py-3 text-right font-medium">Diterima</th>
                )}
              </tr>
            </thead>
            <tbody>
              {po.items.map(
                (item: {
                  id: string;
                  ingredientId: string;
                  ingredientName: string | null;
                  ingredientCode: string | null;
                  quantity: number;
                  unitPrice: number | null;
                  totalPrice: number | null;
                  receivedQuantity?: number | null;
                }) => {
                  const ing = ingredients.find((i) => i.id === item.ingredientId);
                  return (
                    <tr key={item.id} className="border-b">
                      <td className="px-4 py-3">
                        {item.ingredientName ?? ing?.name ?? item.ingredientId.slice(0, 8)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {isEditing ? (
                          <input
                            type="number"
                            min={1}
                            defaultValue={item.quantity}
                            onChange={(e) =>
                              setEditItems((prev) =>
                                prev.map((pi) =>
                                  pi.ingredientId === item.ingredientId
                                    ? { ...pi, quantity: Number(e.target.value) }
                                    : pi,
                                ),
                              )
                            }
                            className="h-8 w-20 rounded-md border border-input bg-background px-2 text-sm text-right"
                          />
                        ) : (
                          item.quantity.toLocaleString("id-ID")
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {isEditing ? (
                          <input
                            type="number"
                            min={0}
                            defaultValue={item.unitPrice ?? 0}
                            onChange={(e) =>
                              setEditItems((prev) =>
                                prev.map((pi) =>
                                  pi.ingredientId === item.ingredientId
                                    ? { ...pi, unitPrice: Number(e.target.value) }
                                    : pi,
                                ),
                              )
                            }
                            className="h-8 w-24 rounded-md border border-input bg-background px-2 text-sm text-right"
                          />
                        ) : (
                          `Rp ${(item.unitPrice ?? 0).toLocaleString("id-ID")}`
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {isEditing ? "-" : `Rp ${(item.totalPrice ?? 0).toLocaleString("id-ID")}`}
                      </td>
                      {po.status !== "Draft" && (
                        <td className="px-4 py-3 text-right">
                          {item.receivedQuantity?.toLocaleString("id-ID") ?? "-"}
                        </td>
                      )}
                    </tr>
                  );
                },
              )}
            </tbody>
          </table>
        </div>

        {isEditing && (
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setIsEditing(false)}
              className="h-9 px-4 rounded-md border text-sm"
            >
              Batal
            </button>
            <button
              onClick={handleSaveEdit}
              disabled={updateMutation.isPending}
              className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50"
            >
              Simpan Perubahan
            </button>
          </div>
        )}

        {po.notes && (
          <div className="rounded-md border p-4">
            <p className="text-xs text-muted-foreground uppercase">Catatan</p>
            <p className="mt-1">{po.notes}</p>
          </div>
        )}
      </div>
    </RoleGuard>
  );
}
