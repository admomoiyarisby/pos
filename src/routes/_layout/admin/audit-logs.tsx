import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import { usePageTitle } from "#/hooks/usePageTitle";
import DataTable from "#/components/ui/DataTable";
import Modal from "#/components/ui/Modal";
import { getAuditLogs } from "#/lib/server/system";
import type { Column } from "#/components/ui/DataTable";
import { Badge } from "#/components/ui/badge";
import { Eye } from "lucide-react";

interface AuditRow {
  id: string;
  createdAt: Date;
  tableName: string;
  action: string;
  recordId: string;
  userName: string | null;
  userId: string | null;
  ipAddress: string | null;
  oldValues: unknown;
  newValues: unknown;
}

const actionColors: Record<string, "default" | "success" | "warning" | "destructive"> = {
  CREATE: "success",
  UPDATE: "warning",
  DELETE: "destructive",
  INSERT: "success",
};

export const Route = createFileRoute("/_layout/admin/audit-logs")({
  component: AuditLogsPage,
  loader: async () => {
    const logs = await getAuditLogs({ data: {} });
    return { logs };
  },
});

function AuditLogsPage() {
  const { logs: initial } = Route.useLoaderData();
  const [page, setPage] = useState(0);
  const [selectedLog, setSelectedLog] = useState<AuditRow | null>(null);
  const [filters, setFilters] = useState({
    tableName: "",
    action: "",
    dateFrom: "",
    dateTo: "",
  });

  const { data: logs } = useQuery({
    queryKey: ["audit-logs", page, filters],
    queryFn: () => getAuditLogs({ data: { ...filters, page, limit: 15 } }),
    initialData: initial,
  });

  const columns: Column<AuditRow>[] = [
    {
      key: "createdAt",
      header: "Waktu",
      width: "w-36",
      sortable: true,
      render: (r) =>
        new Date(r.createdAt).toLocaleString("id-ID", {
          day: "2-digit",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        }),
    },
    { key: "tableName", header: "Tabel", width: "w-28", sortable: true },
    {
      key: "action",
      header: "Aksi",
      width: "w-24",
      sortable: true,
      render: (r) => (
        <Badge
          variant={
            (actionColors[r.action] ?? "default") as
              | "default"
              | "success"
              | "warning"
              | "destructive"
          }
        >
          {r.action}
        </Badge>
      ),
    },
    {
      key: "recordId",
      header: "Record ID",
      width: "w-32",
      render: (r) => <span className="font-mono text-xs">{r.recordId.slice(0, 12)}</span>,
    },
    {
      key: "userName",
      header: "User",
      sortable: true,
      render: (r) => r.userName ?? r.userId?.slice(0, 8) ?? "system",
    },
    {
      key: "id",
      header: "",
      width: "w-12",
      render: (r) => (
        <button
          onClick={() => setSelectedLog(r)}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent"
        >
          <Eye className="h-4 w-4" />
        </button>
      ),
    },
  ];
  usePageTitle("Log Audit", "Jejak audit perubahan data tingkat database");

  return (
    <RoleGuard allowedRoles={["super_admin"]}>
      <div className="space-y-6">
        {/* Filters */}
        <div className="flex items-center gap-3">
          <input
            placeholder="Tabel..."
            value={filters.tableName}
            onChange={(e) => setFilters((p) => ({ ...p, tableName: e.target.value }))}
            className="h-9 w-32 rounded-md border border-input bg-background px-3 text-sm"
          />
          <select
            value={filters.action}
            onChange={(e) => setFilters((p) => ({ ...p, action: e.target.value }))}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Semua Aksi</option>
            <option value="CREATE">CREATE</option>
            <option value="UPDATE">UPDATE</option>
            <option value="DELETE">DELETE</option>
          </select>
          <input
            type="date"
            value={filters.dateFrom}
            onChange={(e) => setFilters((p) => ({ ...p, dateFrom: e.target.value }))}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          />
          <span className="text-muted-foreground">sampai</span>
          <input
            type="date"
            value={filters.dateTo}
            onChange={(e) => setFilters((p) => ({ ...p, dateTo: e.target.value }))}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          />
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

        <Modal
          open={!!selectedLog}
          onClose={() => setSelectedLog(null)}
          title="Detail Log Audit"
          size="lg"
        >
          {selectedLog && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground uppercase">Tabel</p>
                  <p className="font-medium">{selectedLog.tableName}</p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground uppercase">Aksi</p>
                  <Badge
                    variant={
                      (actionColors[selectedLog.action] ?? "default") as
                        | "default"
                        | "success"
                        | "warning"
                        | "destructive"
                    }
                  >
                    {selectedLog.action}
                  </Badge>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground uppercase">Record ID</p>
                  <p className="font-mono text-xs">{selectedLog.recordId}</p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground uppercase">User</p>
                  <p className="font-medium">
                    {selectedLog.userName ?? selectedLog.userId?.slice(0, 8) ?? "system"}
                  </p>
                </div>
              </div>
              {!!selectedLog.oldValues && (
                <div>
                  <p className="text-xs text-muted-foreground uppercase mb-2">Old Values</p>
                  <pre className="rounded-md bg-muted p-3 text-xs overflow-x-auto">
                    {JSON.stringify(selectedLog.oldValues, null, 2)}
                  </pre>
                </div>
              )}
              {!!selectedLog.newValues && (
                <div>
                  <p className="text-xs text-muted-foreground uppercase mb-2">New Values</p>
                  <pre className="rounded-md bg-muted p-3 text-xs overflow-x-auto">
                    {JSON.stringify(selectedLog.newValues, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </Modal>
      </div>
    </RoleGuard>
  );
}
