import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "#/lib/auth-context";
import { usePageTitle } from "#/hooks/usePageTitle";
import RoleGuard from "#/components/RoleGuard";
import DataTable from "#/components/ui/DataTable";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Plus, ArrowRight, Lock } from "lucide-react";
import { getMutasiTransfers } from "#/lib/server/scm-transfers";
import { canAmAct } from "#/lib/server/scm-transfer-queries";
import type { Column } from "#/components/ui/DataTable";
import type { ScmTransferStatus as _ScmTransferStatus } from "#/lib/server/scm-transfer-fsm";

export const Route = createFileRoute("/_layout/scm-transfers/")({
  component: TransfersListPage,
  loader: async () => {
    const rows = await getMutasiTransfers({ data: {} });
    return { initialRows: rows };
  },
});

interface TransferRow {
  id: string;
  code: string;
  fromBranchId: string;
  toBranchId: string;
  status: string;
  createdAt: Date | string;
  requestedById: string;
  [key: string]: unknown;
}

const statusLabels: Record<string, string> = {
  SuratJalanDraft: "Draft SJ",
  PendingAMReview: "Menunggu AM",
  Approved: "Disetujui",
  InTransit: "Dalam Pengiriman",
  Delivered: "Diterima Cabang",
  ReviewingSJ: "Review Penerima",
  WaitingForPayment: "Menunggu Bayar",
  Finished: "Lunas",
  Rejected: "Ditolak",
  Cancelled: "Dibatalkan",
};

const statusColors: Record<
  string,
  "default" | "warning" | "success" | "destructive" | "secondary"
> = {
  SuratJalanDraft: "secondary",
  PendingAMReview: "warning",
  Approved: "default",
  InTransit: "default",
  Delivered: "default",
  ReviewingSJ: "default",
  WaitingForPayment: "warning",
  Finished: "success",
  Rejected: "destructive",
  Cancelled: "secondary",
};

function TransfersListPage() {
  const { user } = useAuth();
  const { initialRows } = Route.useLoaderData();

  const { data: rows } = useQuery({
    queryKey: ["scm-transfers"],
    queryFn: () => getMutasiTransfers({ data: {} }),
    initialData: initialRows,
  });

  usePageTitle("Mutasi Stok", "Surat Jalan antar cabang");

  const columns: Column<TransferRow>[] = [
    { key: "code", header: "Kode", width: "w-32", sortable: true },
    {
      key: "fromBranchId",
      header: "Dari",
      sortable: true,
      render: (r) => r.fromBranchId.slice(0, 8) + "…",
    },
    {
      key: "toBranchId",
      header: "Ke",
      sortable: true,
      render: (r) => r.toBranchId.slice(0, 8) + "…",
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      render: (r) => (
        <Badge
          variant={
            (statusColors[r.status] ?? "default") as
              | "default"
              | "success"
              | "warning"
              | "destructive"
              | "secondary"
          }
        >
          {statusLabels[r.status] ?? r.status}
        </Badge>
      ),
    },
    {
      key: "createdAt",
      header: "Tgl Dibuat",
      sortable: true,
      render: (r) => new Date(r.createdAt).toLocaleDateString("id-ID"),
    },
    {
      key: "id",
      header: "",
      width: "w-44",
      render: (r) => {
        const isAm = user?.role === "area_manager";
        const isCrossJurisdiction =
          isAm &&
          user.assignedBranches &&
          !canAmAct(
            { assignedBranches: user.assignedBranches },
            { fromBranchId: r.fromBranchId, toBranchId: r.toBranchId },
          );

        return (
          <div className="flex items-center justify-end gap-1">
            {isCrossJurisdiction && (
              <Badge variant="outline" className="text-[10px]">
                <Lock className="h-3 w-3 mr-1" />
                Lintas Wilayah
              </Badge>
            )}
            <Link
              to="/scm-transfers/$transferId"
              params={{ transferId: r.id }}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent"
            >
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        );
      },
    },
  ];

  return (
    <RoleGuard allowedRoles={["super_admin", "admin_pusat", "area_manager", "branch_admin"]}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            Total: {rows.length} mutasi
          </p>
          {user?.role === "branch_admin" && user.branchId && (
            <Link to="/scm-transfers/new">
              <Button>
                <Plus className="h-4 w-4 mr-1" />
                Buat Mutasi
              </Button>
            </Link>
          )}
        </div>
        <DataTable columns={columns} data={rows as unknown as TransferRow[]} keyExtractor={(r) => r.id} />
      </div>
    </RoleGuard>
  );
}
