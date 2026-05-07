import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import { usePageTitle } from "#/hooks/usePageTitle";
import DataTable from "#/components/ui/DataTable";
import { getSystemLogs } from "#/lib/server/system";
import type { Column } from "#/components/ui/DataTable";
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
  const { logs: initial } = Route.useLoaderData();
  const [page, setPage] = useState(0);
  const [statusFilter, setStatusFilter] = useState("");

  const { data: logs } = useQuery({
    queryKey: ["system-logs", page, statusFilter],
    queryFn: () =>
      getSystemLogs({
        data: {
          status: statusFilter as "Success" | "Warning" | "Error" | undefined,
          page,
          limit: 15,
        },
      }),
    initialData: initial,
  });

  const columns: Column<LogRow>[] = [
    {
      key: "createdAt",
      header: "Waktu",
      width: "w-36",
      render: (r) =>
        new Date(r.createdAt).toLocaleString("id-ID", {
          day: "2-digit",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        }),
    },
    {
      key: "status",
      header: "",
      width: "w-8",
      render: (r) => {
        const config = statusConfig[r.status];
        const Icon = config.icon;
        return (
          <Icon
            className={`h-4 w-4 text-${config.color === "success" ? "green" : config.color === "warning" ? "amber" : "red"}-500`}
          />
        );
      },
    },
    { key: "action", header: "Aksi", width: "w-40", sortable: true },
    { key: "detail", header: "Detail" },
    {
      key: "userName",
      header: "User",
      width: "w-32",
      sortable: true,
      render: (r) => r.userName ?? "system",
    },
  ];

  usePageTitle("System Logs", "Log operasional sistem");

  return (
    <RoleGuard allowedRoles={["super_admin"]}>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Semua Status</option>
            <option value="Success">Success</option>
            <option value="Warning">Warning</option>
            <option value="Error">Error</option>
          </select>
        </div>

        <DataTable columns={columns} data={logs} keyExtractor={(r) => r.id} pageSize={15} />

        <div className="flex items-center justify-between">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="h-9 px-4 rounded-md border text-sm disabled:opacity-50"
          >
            Sebelumnya
          </button>
          <span className="text-sm text-muted-foreground">Halaman {page + 1}</span>
          <button
            onClick={() => setPage((p) => p + 1)}
            className="h-9 px-4 rounded-md border text-sm"
          >
            Berikutnya
          </button>
        </div>
      </div>
    </RoleGuard>
  );
}
