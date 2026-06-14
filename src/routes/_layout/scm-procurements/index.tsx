import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "#/lib/auth-context";
import RoleGuard from "#/components/RoleGuard";
import DataTable from "#/components/ui/DataTable";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Plus, Eye } from "lucide-react";
import { listProcurements } from "#/lib/server/scm-queries";
import type { Column } from "#/components/ui/DataTable";
import type { ScmProcurementStatus } from "#/lib/server/scm-fsm";

export const Route = createFileRoute("/_layout/scm-procurements/")({
  component: ProcurementsListPage,
  loader: async () => {
    const rows = await listProcurements({ data: {} });
    return { initialRows: rows };
  },
});

interface ProcurementRow extends Record<string, unknown> {
  id: string;
  code: string;
  branchId: string;
  status: ScmProcurementStatus;
  createdAt: Date | string;
  submittedAt: Date | string | null;
}

const statusLabels: Record<ScmProcurementStatus, string> = {
  Draft: "Draft",
  Pending: "Menunggu Review",
  UnderReview: "Sedang Direview",
  Rejected: "Ditolak",
  InTransit: "Disetujui",
  Delivered: "Dalam Pengiriman",
  ReviewingSJ: "Sampai di Cabang",
  WaitingForPayment: "Menunggu Pembayaran",
  Finished: "Lunas",
  Cancelled: "Dibatalkan",
};

const statusColors: Record<
  ScmProcurementStatus,
  "default" | "warning" | "success" | "destructive" | "secondary"
> = {
  Draft: "secondary",
  Pending: "warning",
  UnderReview: "default",
  Rejected: "destructive",
  InTransit: "default",
  Delivered: "default",
  ReviewingSJ: "default",
  WaitingForPayment: "warning",
  Finished: "success",
  Cancelled: "secondary",
};

function ProcurementsListPage() {
  const { user } = useAuth();
  const { data: rows = [] } = useQuery({
    queryKey: ["scm-procurements"],
    queryFn: () => listProcurements({ data: {} }),
  });

  const columns: Column<ProcurementRow>[] = [
    {
      key: "code",
      header: "Kode",
      render: (row) => (
        <Link
          to="/scm-procurements/$procurementId"
          params={{ procurementId: row.id }}
          className="font-mono text-sm font-medium text-primary hover:underline"
        >
          {row.code}
        </Link>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <Badge variant={statusColors[row.status]}>{statusLabels[row.status]}</Badge>
      ),
    },
    {
      key: "createdAt",
      header: "Tanggal",
      render: (row) => new Date(row.createdAt).toLocaleDateString("id-ID"),
    },
    {
      key: "actions",
      header: "Aksi",
      render: (row) => (
        <Link to="/scm-procurements/$procurementId" params={{ procurementId: row.id }}>
          <Button variant="ghost" size="sm">
            <Eye className="h-4 w-4" />
            Detail
          </Button>
        </Link>
      ),
    },
  ];

  return (
    <RoleGuard
      allowedRoles={["branch_admin", "admin_pusat", "super_admin", "area_manager"]}
    >
      <div className="space-y-4 p-4 md:p-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Pengadaan</h1>
            <p className="text-sm text-muted-foreground">
              Restock dari Central ke Cabang. Satu dokumen mengikuti seluruh siklus dari Draft sampai Lunas.
            </p>
          </div>
          {user?.role === "branch_admin" || user?.role === "super_admin" ? (
            <Link to="/scm-procurements/new">
              <Button>
                <Plus className="h-4 w-4" />
                Buat Pengadaan
              </Button>
            </Link>
          ) : null}
        </div>
        <DataTable
          data={(rows as ProcurementRow[]) ?? []}
          columns={columns}
          keyExtractor={(row) => row.id}
          searchable
          searchKeys={["code"]}
        />
      </div>
    </RoleGuard>
  );
}
