import { createFileRoute } from "@tanstack/react-router";
import { badgeVariant } from "#/lib/utils";
import { lookupLabel } from "#/lib/label-lookup";
import { useQuery } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import { getStockTransfer } from "#/lib/server/scm";
import { getBranches } from "#/lib/server/branches";
import { getIngredients } from "#/lib/server/ingredients";
import { Badge } from "#/components/ui/badge";

const statusColors = {
  "Pending Approval": "warning",
  Approved: "default",
  Rejected: "destructive",
  "In Transit": "warning",
  Completed: "success",
  Cancelled: "destructive",
} satisfies Record<string, "default" | "warning" | "success" | "destructive" | "secondary">;

export const Route = createFileRoute("/_layout/stock-transfers/$trId")({
  component: TransferDetailPage,
  loader: async ({ params }) => {
    const transfer = await getStockTransfer({ data: { id: params.trId } });
    const branches = await getBranches({ data: {} });
    const ingredients = await getIngredients({ data: { excludeNasi: true } });
    return { transfer, branches, ingredients };
  },
});

function TransferDetailPage() {
  const { transfer: initial, branches, ingredients } = Route.useLoaderData();
  const { trId } = Route.useParams();

  const { data: transfer } = useQuery({
    queryKey: ["stock-transfer", trId],
    queryFn: () => getStockTransfer({ data: { id: trId } }),
    initialData: initial,
  });

  if (!transfer) return <div className="text-muted-foreground">Mutasi stok tidak ditemukan</div>;

  const fromBranch = branches.find((b) => b.id === transfer.fromBranchId);
  const toBranch = branches.find((b) => b.id === transfer.toBranchId);
  const ingredient = ingredients.find((i) => i.id === transfer.ingredientId);

  return (
    <RoleGuard allowedRoles={["super_admin", "admin_pusat", "area_manager", "branch_admin"]}>
      <div className="mb-4 rounded-md bg-warning/10 border border-warning/30 px-4 py-2 text-xs text-warning">
        Halaman detail lawas. Mutasi baru menggunakan alur FSM di{" "}
        <code className="bg-warning/20 px-1 rounded">/scm-transfers</code> (ADR 0006).
      </div>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold">{transfer.code}</h1>
            <p className="text-sm text-muted-foreground">Mutasi Stok Antar Cabang</p>
          </div>
          <Badge variant={badgeVariant(lookupLabel(statusColors, transfer.status))}>
            {transfer.status}
          </Badge>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground uppercase">Dari Cabang</p>
            <p className="font-medium mt-1">{fromBranch?.name ?? transfer.fromBranchId}</p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground uppercase">Ke Cabang</p>
            <p className="font-medium mt-1">{toBranch?.name ?? transfer.toBranchId}</p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground uppercase">Bahan</p>
            <p className="font-medium mt-1">{ingredient?.name ?? transfer.ingredientId}</p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground uppercase">Jumlah</p>
            <p className="font-medium mt-1">
              {transfer.quantity.toLocaleString("id-ID")} {ingredient?.stockUnit ?? ""}
            </p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground uppercase">Diajukan Oleh</p>
            <p className="font-medium mt-1">{transfer.requestedBy.slice(0, 8)}</p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground uppercase">Tanggal</p>
            <p className="font-medium mt-1">
              {new Date(transfer.createdAt).toLocaleDateString("id-ID")}
            </p>
          </div>
        </div>

        {transfer.rejectionReason && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4">
            <p className="text-xs text-muted-foreground uppercase">Alasan Penolakan</p>
            <p className="mt-1 text-destructive">{transfer.rejectionReason}</p>
          </div>
        )}
      </div>
    </RoleGuard>
  );
}
