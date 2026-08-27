import { createFileRoute } from "@tanstack/react-router";
import { useTableSearch } from "#/hooks/useTableSearch";
import { useTableUrlState } from "#/hooks/useTableUrlState";
import { useQuery } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import { usePageTitle } from "#/hooks/usePageTitle";
import DataTable from "#/components/ui/DataTable";
import { getSystemLogs } from "#/lib/server/system";
import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";

interface LogRow {
  id: string;
  createdAt: Date;
  action: string;
  detail: string;
  userName: string | null;
  status: "Success" | "Warning" | "Error";
}

const statusConfig = {
  Success: { color: "success" as const, icon: CheckCircle2 },
  Warning: { color: "warning" as const, icon: AlertTriangle },
  Error: { color: "destructive" as const, icon: XCircle },
};

export const Route = createFileRoute("/_layout/admin/system-logs")({
  component: SystemLogsPage,
  loader: async () => {
    const logs = await getSystemLogs({ data: {} });
    return { logs };
  },
});

function SystemLogsPage() {
  const [search, setSearch] = useTableSearch();
  const { logs: initial } = Route.useLoaderData();
  const { page, setPage, filters, setFilter } = useTableUrlState<{
    status?: string;
  }>(["status"]);
  // SAFETY: the status filter select only offers the four status literals, so
  // a URL value is narrowed to that set (anything else falls back to "").
  const statusFilter = (filters.status ?? "") as "" | "Success" | "Warning" | "Error";

  const { data: logs } = useQuery({
    queryKey: ["system-logs", page, statusFilter],
    queryFn: () =>
      getSystemLogs({
        data: {
          status: statusFilter || undefined,
          page,
          limit: 15,
        },
      }),
    initialData: initial,
  });

  const columns: ColumnDef<LogRow>[] = [
    {
      accessorKey: "createdAt",
      header: "Waktu",
      width: "w-36",
      cell: ({ row }) =>
        new Date(row.original.createdAt).toLocaleString("id-ID", {
          day: "2-digit",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        }),
    },
    {
      accessorKey: "status",
      header: "",
      width: "w-8",
      cell: ({ row }) => {
        const config = statusConfig[row.original.status];
        const Icon = config.icon;
        return (
          <Icon
            className={`h-4 w-4 text-${config.color === "success" ? "green" : config.color === "warning" ? "amber" : "red"}-500`}
          />
        );
      },
    },
    { accessorKey: "action", header: "Aksi", width: "w-40", enableSorting: true },
    { accessorKey: "detail", header: "Detail" },
    {
      accessorKey: "userName",
      header: "User",
      width: "w-32",
      enableSorting: true,
      cell: ({ row }) => row.original.userName ?? "system",
    },
  ];

  usePageTitle("Log Sistem", "Log operasional sistem");

  return (
    <RoleGuard allowedRoles={["super_admin"]}>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <select
            value={statusFilter}
            onChange={(e) => setFilter("status", e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Semua Status</option>
            <option value="Success">Success</option>
            <option value="Warning">Warning</option>
            <option value="Error">Error</option>
          </select>
        </div>

        <DataTable
          columns={columns}
          data={logs}
          keyExtractor={(r) => r.id}
          pageSize={15}
          pagination={false}
          search={search}
          onSearchChange={setSearch}
        />

        <div className="flex items-center justify-between">
          <button
            onClick={() => setPage(Math.max(0, page - 1))}
            disabled={page === 0}
            className="h-9 px-4 rounded-md border text-sm disabled:opacity-50"
          >
            Sebelumnya
          </button>
          <span className="text-sm text-muted-foreground">Halaman {page + 1}</span>
          <button onClick={() => setPage(page + 1)} className="h-9 px-4 rounded-md border text-sm">
            Berikutnya
          </button>
        </div>
      </div>
    </RoleGuard>
  );
}
