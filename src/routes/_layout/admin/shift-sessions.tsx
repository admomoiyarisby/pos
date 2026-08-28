import { createFileRoute } from "@tanstack/react-router";
import { useTableSearch } from "#/hooks/useTableSearch";
import { useTableUrlState } from "#/hooks/useTableUrlState";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "#/lib/auth-context";
import RoleGuard from "#/components/RoleGuard";
import { usePageTitle } from "#/hooks/usePageTitle";
import DataTable, { type Column } from "#/components/ui/DataTable";
import { getShiftSessions } from "#/lib/server/pos";
import { getBranches } from "#/lib/server/branches";
import { Badge } from "#/components/ui/badge";

interface ShiftSessionRow {
  id: string;
  shiftId: string;
  branchId: string;
  branchCode: string;
  branchName: string;
  userId: string;
  userName: string;
  action: "open" | "take_over";
  loggedInAt: Date;
  loggedOutAt: Date | null;
  shiftStatus: "Open" | "Closed";
  shiftStartTime: Date;
  shiftEndTime: Date | null;
}

const actionLabels = {
  open: { label: "Buka Shift", variant: "success" },
  take_over: { label: "Take Over", variant: "warning" },
} satisfies Record<string, { label: string; variant: "success" | "warning" }>;

function formatDateTime(d: Date) {
  return new Date(d).toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(from: Date, to: Date | null) {
  if (!to) return "Berjalan";
  const ms = new Date(to).getTime() - new Date(from).getTime();
  if (ms < 0) return "-";
  const totalMinutes = Math.floor(ms / 60000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m} mnt`;
  if (m === 0) return `${h} jam`;
  return `${h} jam ${m} mnt`;
}

export const Route = createFileRoute("/_layout/admin/shift-sessions")({
  component: ShiftSessionsPage,
  loader: async () => {
    const [branches, sessions] = await Promise.all([
      getBranches({ data: {} }),
      getShiftSessions({ data: {} }),
    ]);
    return { branches, sessions };
  },
});

function ShiftSessionsPage() {
  usePageTitle("Riwayat Shift", "Siapa yang memegang setiap shift dan kapan login/logout");
  const user = useAuth().user;
  const isBranchAdmin = user?.role === "branch_admin";
  const isAreaManager = user?.role === "area_manager";
  const [search, setSearch] = useTableSearch();
  const { branches: allBranches, sessions: initial } = Route.useLoaderData();
  const { page, setPage, filters, setFilter } = useTableUrlState<{
    branchId?: string;
    dateFrom?: string;
    dateTo?: string;
  }>(["branchId", "dateFrom", "dateTo"]);

  const { data: sessions } = useQuery({
    queryKey: ["shift-sessions", page, filters],
    queryFn: () =>
      getShiftSessions({
        data: {
          // Branch admins are scoped server-side to their own branch; area
          // managers to their assigned branches.
          branchId: isBranchAdmin ? undefined : filters.branchId || undefined,
          dateFrom: filters.dateFrom || undefined,
          dateTo: filters.dateTo || undefined,
          page,
          limit: 20,
        },
      }),
    initialData: initial,
  });

  const columns: Column<ShiftSessionRow>[] = [
    {
      accessorKey: "loggedInAt",
      header: "Login",
      width: "w-36",
      enableSorting: true,
      cell: ({ row }) => formatDateTime(row.original.loggedInAt),
    },
    {
      accessorKey: "loggedOutAt",
      header: "Logout",
      width: "w-36",
      cell: ({ row }) =>
        row.original.loggedOutAt ? (
          formatDateTime(row.original.loggedOutAt)
        ) : (
          <Badge variant="success">Aktif</Badge>
        ),
    },
    {
      accessorKey: "userName",
      header: "Staff",
      enableSorting: true,
      cell: ({ row }) => (
        <span className="font-medium">
          {row.original.userName ?? row.original.userId.slice(0, 8)}
        </span>
      ),
    },
    {
      accessorKey: "branchCode",
      header: "Cabang",
      width: "w-28",
      enableSorting: true,
      cell: ({ row }) => (
        <span title={row.original.branchName}>
          {row.original.branchCode}
          <span className="block text-xs text-muted-foreground">{row.original.branchName}</span>
        </span>
      ),
    },
    {
      accessorKey: "action",
      header: "Aksi",
      width: "w-28",
      cell: ({ row }) => {
        const a = actionLabels[row.original.action];
        return <Badge variant={a.variant}>{a.label}</Badge>;
      },
    },
    {
      accessorKey: "id",
      header: "Durasi",
      width: "w-28",
      cell: ({ row }) => formatDuration(row.original.loggedInAt, row.original.loggedOutAt),
    },
    {
      accessorKey: "shiftStatus",
      header: "Status Shift",
      width: "w-28",
      cell: ({ row }) =>
        row.original.shiftStatus === "Open" ? (
          <Badge variant="success">Terbuka</Badge>
        ) : (
          <Badge variant="secondary">Ditutup</Badge>
        ),
    },
  ];

  const ownBranch = allBranches.find((b) => b.id === user?.branchId);
  // Area managers may only filter among the branches assigned to them.
  const filterableBranches = isAreaManager
    ? allBranches.filter((b) => user?.assignedBranches?.includes(b.id))
    : allBranches;

  return (
    <RoleGuard allowedRoles={["super_admin", "branch_admin", "area_manager"]}>
      <div className="space-y-6">
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          {!isBranchAdmin ? (
            <select
              value={filters.branchId ?? ""}
              onChange={(e) => setFilter("branchId", e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Semua Cabang</option>
              {filterableBranches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code} — {b.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="inline-flex items-center h-9 rounded-md border border-input bg-muted px-3 text-sm font-medium">
              {ownBranch ? `${ownBranch.code} — ${ownBranch.name}` : "Cabang saya"}
            </span>
          )}
          <input
            type="date"
            value={filters.dateFrom ?? ""}
            onChange={(e) => setFilter("dateFrom", e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          />
          <span className="text-sm text-muted-foreground">sampai</span>
          <input
            type="date"
            value={filters.dateTo ?? ""}
            onChange={(e) => setFilter("dateTo", e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          />
        </div>

        <DataTable
          columns={columns}
          data={sessions}
          keyExtractor={(r) => r.id}
          pageSize={20}
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
