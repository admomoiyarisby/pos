import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "#/lib/auth-context";
import RoleGuard from "#/components/RoleGuard";
import { getDeliveryNote, receiveDeliveryNote } from "#/lib/server/scm";
import { getBranches } from "#/lib/server/branches";
import { Badge } from "#/components/ui/badge";

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
  discrepancyNote: string | null;
}

const statusColors: Record<
  string,
  "default" | "warning" | "success" | "destructive" | "secondary"
> = {
  Draft: "secondary",
  Picking: "default",
  "In Transit": "warning",
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
    Record<string, { received: string; rejected: string; note: string }>
  >({});

  const { data: dn } = useQuery({
    queryKey: ["delivery-note", dnId],
    queryFn: () => getDeliveryNote({ data: { id: dnId } }),
    initialData: initial,
  });

  const receiveMutation = useMutation({
    mutationFn: receiveDeliveryNote,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["delivery-note", dnId] });
      void queryClient.invalidateQueries({ queryKey: ["delivery-notes"] });
    },
  });

  if (!dn) return <div className="text-muted-foreground">Surat jalan tidak ditemukan</div>;

  const canReceive =
    dn.status === "In Transit" && (user?.role === "branch_admin" || user?.role === "super_admin");
  const fromBranch = branches.find((b) => b.id === dn.fromBranchId);
  const toBranch = branches.find((b) => b.id === dn.toBranchId);

  const handleReceive = () => {
    const items = dn.items.map((item: DNItem) => ({
      itemId: item.id,
      receivedQuantity: Number(
        receiveInputs[item.id]?.received ?? item.receivedQuantity ?? item.quantity,
      ),
      rejectedQuantity: Number(receiveInputs[item.id]?.rejected ?? 0),
      discrepancyNote: receiveInputs[item.id]?.note || undefined,
    }));
    void receiveMutation.mutateAsync({ data: { dnId, items } });
  };

  return (
    <RoleGuard allowedRoles={["super_admin", "admin_pusat", "area_manager", "branch_admin"]}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold">{dn.code}</h1>
            <p className="text-sm text-muted-foreground">Surat Jalan & Transfer Stok</p>
          </div>
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

        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm min-w-[480px]">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Bahan</th>
                <th className="px-4 py-3 text-right font-medium">Diorder</th>
                <th className="px-4 py-3 text-right font-medium">Ready</th>
                {dn.status !== "Picking" && (
                  <th className="px-4 py-3 text-right font-medium">Dikirim</th>
                )}
                {(dn.status === "In Transit" || dn.status === "Received") && (
                  <>
                    <th className="px-4 py-3 text-right font-medium">Diterima</th>
                    <th className="px-4 py-3 text-right font-medium">Reject</th>
                    <th className="px-4 py-3 text-left font-medium">Keterangan</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {dn.items.map((item: DNItem) => (
                <tr key={item.id} className="border-b">
                  <td className="px-4 py-3">{item.ingredientName ?? item.ingredientCode}</td>
                  <td className="px-4 py-3 text-right">{item.quantity}</td>
                  <td className="px-4 py-3 text-right">{item.readyQuantity ?? "-"}</td>
                  {dn.status !== "Picking" && (
                    <td className="px-4 py-3 text-right">{item.pickedQuantity ?? item.quantity}</td>
                  )}
                  {(dn.status === "In Transit" || dn.status === "Received") && (
                    <>
                      <td className="px-4 py-3">
                        {canReceive ? (
                          <input
                            type="number"
                            min={0}
                            defaultValue={
                              item.receivedQuantity ?? item.pickedQuantity ?? item.quantity
                            }
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
                        ) : (
                          (item.discrepancyNote ?? "-")
                        )}
                      </td>
                    </>
                  )}
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
      </div>
    </RoleGuard>
  );
}
