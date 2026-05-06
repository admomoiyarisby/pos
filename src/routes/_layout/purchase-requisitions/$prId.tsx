import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "#/lib/auth-context";
import RoleGuard from "#/components/RoleGuard";
import { getPurchaseRequisition } from "#/lib/server/scm";
import { Badge } from "#/components/ui/badge";

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
  const [isEditing, setIsEditing] = useState(false);

  const { data: pr } = useQuery({
    queryKey: ["purchase-requisition", prId],
    queryFn: () => getPurchaseRequisition({ data: { id: prId } }),
    initialData: initial,
  });

  if (!pr) return <div className="text-muted-foreground">PR tidak ditemukan</div>;

  const isProcessed = pr.status === "Processed";
  const canEdit =
    !isProcessed &&
    (user?.role === "super_admin" ||
      user?.role === "admin_pusat" ||
      (user?.role === "branch_admin" && ["Draft", "Pending"].includes(pr.status)));

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
            <p className="text-sm text-muted-foreground">Cabang: {pr.branchId.slice(0, 8)}</p>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant={statusColors[pr.status] ?? "default"}>{pr.status}</Badge>
            {canEdit && (
              <button
                onClick={() => setIsEditing(!isEditing)}
                className="h-9 px-4 rounded-md border text-sm"
              >
                {isEditing ? "Batal" : "Edit"}
              </button>
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
              {pr.items.map((item) => (
                <tr key={item.id} className="border-b">
                  <td className="px-4 py-3 font-mono text-xs">{item.ingredientCode}</td>
                  <td className="px-4 py-3">{item.ingredientName}</td>
                  <td className="px-4 py-3 text-right font-medium">
                    {item.quantity.toLocaleString("id-ID")}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{item.stockUnit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {pr.notes && (
          <div className="rounded-md border p-4">
            <p className="text-xs text-muted-foreground uppercase">Catatan</p>
            <p className="mt-1">{pr.notes}</p>
          </div>
        )}
      </div>
    </RoleGuard>
  );
}
