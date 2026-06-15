import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "#/lib/auth-context";
import { usePageTitle } from "#/hooks/usePageTitle";
import RoleGuard from "#/components/RoleGuard";
import DataTable from "#/components/ui/DataTable";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Plus, Eye, FileText } from "lucide-react";
import { listProcurements } from "#/lib/server/scm-queries";
import type { Column } from "#/components/ui/DataTable";
import type { ScmProcurementStatus } from "#/lib/server/scm-fsm";

export const Route = createFileRoute("/_layout/scm-procurements/")({
  component: ProcurementsListPage,
  validateSearch: (search: Record<string, unknown>) => {
    const raw = search.status;
    return {
      status: typeof raw === "string" && raw.length > 0 ? raw : undefined,
    };
  },
  loaderDeps: ({ search: { status } }) => ({ status }),
  loader: async ({ deps: { status } }) => {
    const rows = await listProcurements({
      data: status ? { status: status as ScmProcurementStatus } : {},
    });
    return { initialRows: rows, status };
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
  InTransit: "Dalam Pengiriman",
  Delivered: "Sudah Dikirim",
  ReviewingSJ: "Sedang Direview Cabang",
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

// Tab definitions. "all" is the default; per-status tabs deep-link via
// ?status=. (ADR 0004 §2)
type FilterKey = "all" | ScmProcurementStatus;

const FILTER_TABS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "Semua" },
  { key: "Draft", label: "Draft" },
  { key: "Pending", label: "Menunggu Review" },
  { key: "UnderReview", label: "Sedang Direview" },
  { key: "InTransit", label: "Dalam Pengiriman" },
  { key: "Delivered", label: "Sudah Dikirim" },
  { key: "ReviewingSJ", label: "Review Cabang" },
  { key: "WaitingForPayment", label: "Pembayaran" },
  { key: "Finished", label: "Lunas" },
  { key: "Cancelled", label: "Dibatalkan" },
  { key: "Rejected", label: "Ditolak" },
];

function ProcurementsListPage() {
  const { user } = useAuth();
  const { status: statusFilter } = Route.useSearch();
  const { initialRows } = Route.useLoaderData();
  const navigate = useNavigate({ from: Route.fullPath });

  // Query the right dataset depending on the URL filter. The cache key
  // includes the status, so the same query powers both the table and
  // the sidebar pending-count badge.
  const queryKey = statusFilter ? ["scm-procurements", statusFilter] : ["scm-procurements"];

  const { data: rows } = useQuery({
    queryKey,
    queryFn: () =>
      listProcurements({
        data: statusFilter ? { status: statusFilter as ScmProcurementStatus } : {},
      }),
    initialData: initialRows,
  });

  const setFilter = (next: FilterKey) => {
    void navigate({
      search: { status: next === "all" ? undefined : next },
      replace: true,
    });
  };

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
      render: (row) => <Badge variant={statusColors[row.status]}>{statusLabels[row.status]}</Badge>,
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

  const activeTab: FilterKey = (statusFilter as FilterKey | undefined) ?? "all";

  usePageTitle(
    "Pengadaan",
    "Restock dari Central ke Cabang. Satu dokumen mengikuti seluruh siklus dari Draft sampai Lunas.",
  );

  return (
    <RoleGuard allowedRoles={["branch_admin", "admin_pusat", "super_admin", "area_manager"]}>
      <div className="space-y-4 p-4 md:p-6">
        {user?.role === "branch_admin" || user?.role === "super_admin" ? (
          <div className="flex justify-end">
            <Link to="/scm-procurements/new">
              <Button>
                <Plus className="h-4 w-4" />
                Buat Pengadaan
              </Button>
            </Link>
          </div>
        ) : null}

        {/* Status filter tabs. URL-driven so the filter is shareable and
            deep-linkable. (ADR 0004 §2) */}
        <div className="flex flex-wrap gap-1 border-b">
          {FILTER_TABS.map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setFilter(tab.key)}
                className={
                  "rounded-t-md px-3 py-2 text-sm font-medium transition-colors " +
                  (isActive
                    ? "border-b-2 border-primary text-foreground"
                    : "text-muted-foreground hover:text-foreground")
                }
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-md border border-dashed py-12 text-center">
            <FileText className="mb-2 h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {statusFilter
                ? "Tidak ada pengadaan dengan status ini. Coba tab status lain, atau "
                : "Belum ada pengadaan. Buat pengadaan pertama untuk branch ini. "}
              <Link
                to="/scm-procurements/new"
                search={() => ({ status: undefined })}
                className="text-primary hover:underline"
              >
                buat pengadaan baru
              </Link>
              .
            </p>
          </div>
        ) : (
          <DataTable
            data={rows as ProcurementRow[]}
            columns={columns}
            keyExtractor={(row) => row.id}
            searchable
            searchKeys={["code"]}
          />
        )}
      </div>
    </RoleGuard>
  );
}
