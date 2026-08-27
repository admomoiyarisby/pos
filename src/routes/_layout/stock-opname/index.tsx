import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useTableSearch } from "#/hooks/useTableSearch";
import { useTableUrlState } from "#/hooks/useTableUrlState";
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "#/lib/auth-context";
import RoleGuard from "#/components/RoleGuard";
import { usePageTitle } from "#/hooks/usePageTitle";
import DataTable from "#/components/ui/DataTable";
import Modal from "#/components/ui/Modal";
import { getStockOpnames, triggerStockOpname, getAssignedBranchIds } from "#/lib/server/inventory";
import { getBranches } from "#/lib/server/branches";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "#/components/ui/badge";
import { ArrowRight, Search, X, Plus, Building2, CalendarDays, FileText } from "lucide-react";

interface SORow {
  id: string;
  branchId: string;
  date: string;
  status: "Submitted" | "Approved" | "Under Investigation";
  branchName: string | null;
  createdAt: Date;
}

const statusColors = {
  Submitted: "default",
  Approved: "success",
  "Under Investigation": "warning",
} satisfies Record<string, "default" | "warning" | "success">;

const columns: ColumnDef<SORow>[] = [
  { accessorKey: "date", header: "Tanggal", enableSorting: true },
  { accessorKey: "branchName", header: "Cabang", enableSorting: true },
  {
    accessorKey: "status",
    header: "Status",
    enableSorting: true,
    cell: ({ row }) => (
      <Badge variant={statusColors[row.original.status] ?? "default"}>
        {row.original.status === "Under Investigation" ? "Investigasi" : row.original.status}
      </Badge>
    ),
  },
  {
    accessorKey: "createdAt",
    header: "Dibuat",
    enableSorting: true,
    cell: ({ row }) =>
      new Date(row.original.createdAt).toLocaleString("id-ID", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }),
  },
  {
    accessorKey: "id",
    header: "",
    width: "w-12",
    cell: ({ row }) => (
      <Link
        to="/stock-opname/$soId"
        params={{ soId: row.original.id }}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent"
      >
        <ArrowRight className="h-4 w-4" />
      </Link>
    ),
  },
];

export const Route = createFileRoute("/_layout/stock-opname/")({
  component: StockOpnamePage,
  loader: async () => {
    const opnames = await getStockOpnames({ data: {} });
    const branches = await getBranches({ data: {} });
    return { opnames, branches };
  },
});

function StockOpnamePage() {
  const [search, setSearch] = useTableSearch();
  const { page, setPage, sort, setSort, filters, setFilter } = useTableUrlState<{
    status?: string;
  }>(["status"]);
  const { user } = useAuth();
  const { opnames: initial, branches } = Route.useLoaderData();
  const queryClient = useQueryClient();
  const navigate = useNavigate({ from: Route.fullPath });
  const [triggerModal, setTriggerModal] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState("");
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split("T")[0]);

  const { data: assignedBranchIds } = useQuery({
    queryKey: ["assigned-branch-ids"],
    queryFn: getAssignedBranchIds,
    enabled: user?.role === "area_manager",
  });

  // Compute visible branches for the trigger modal based on role
  const visibleBranches = branches.filter((b) => {
    if (user?.role === "admin_pusat") return b.type === "Central";
    if (user?.role === "area_manager") return assignedBranchIds?.includes(b.id);
    if (user?.role === "branch_admin") return b.id === user.branchId;
    return true; // super_admin sees all
  });

  useEffect(() => {
    if (visibleBranches.length === 1 && !selectedBranch) {
      setSelectedBranch(visibleBranches[0].id);
    }
  }, [visibleBranches, selectedBranch]);

  const canTrigger = ["super_admin", "admin_pusat", "area_manager", "branch_admin"].includes(
    user?.role ?? "",
  );

  const { data: opnames } = useQuery({
    queryKey: ["stock-opnames"],
    queryFn: () => getStockOpnames({ data: {} }),
    initialData: initial,
  });

  const triggerMutation = useMutation({
    mutationFn: triggerStockOpname,
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["stock-opnames"] });
      void navigate({ to: "/stock-opname/$soId", params: { soId: result.id } });
    },
  });

  const handleTrigger = () => {
    if (!selectedBranch || !selectedDate) return;
    void triggerMutation.mutateAsync({
      data: { branchId: selectedBranch, date: selectedDate },
    });
  };
  const statusFilter = filters.status;
  const STATUS_TABS = ["Submitted", "Approved", "Under Investigation"] as const;
  const filteredOpnames = statusFilter ? opnames.filter((o) => o.status === statusFilter) : opnames;
  const displayRows = filteredOpnames.filter((r) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      r.date.toLowerCase().includes(q) ||
      (r.branchName ?? "").toLowerCase().includes(q) ||
      r.status.toLowerCase().includes(q)
    );
  });
  const totalPages = Math.ceil(displayRows.length / 15) || 1;
  const pagedRows = displayRows.slice(page * 15, (page + 1) * 15);
  const hasActiveFilters = !!(statusFilter || search.trim());
  usePageTitle("Opname Stok", "Verifikasi fisik stok per cabang");

  return (
    <RoleGuard
      allowedRoles={[
        "super_admin",
        "admin_pusat",
        "area_manager",
        "branch_admin",
        "central_kitchen",
      ]}
    >
      {/* ── Toolbar: search + trigger (mobile-first) ── */}
      <div className="space-y-3 mb-4">
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
          <div className="relative flex-1 sm:max-w-[380px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              inputMode="search"
              autoComplete="off"
              aria-label="Cari opname"
              placeholder="Cari tanggal, cabang, status…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-11 w-full rounded-xl border border-input bg-background pl-9 pr-9 text-[16px] shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9 sm:rounded-lg sm:text-sm"
            />
            {search ? (
              <button
                type="button"
                aria-label="Hapus pencarian"
                onClick={() => setSearch("")}
                className="absolute right-1.5 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
          {canTrigger && (
            <button
              onClick={() => setTriggerModal(true)}
              className="inline-flex items-center justify-center gap-1.5 h-11 sm:h-9 px-4 rounded-xl sm:rounded-md bg-primary text-primary-foreground text-sm font-medium shadow-sm hover:bg-primary/90 active:scale-[0.98] transition-all sm:ml-auto w-full sm:w-auto shrink-0"
            >
              <Plus className="h-4 w-4" />
              Trigger SO
            </button>
          )}
        </div>
        {/* Status pills — edge bleed on mobile */}
        <div className="flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden -mx-4 px-4 sm:mx-0 sm:px-0 pb-1 snap-x snap-mandatory">
          <button
            onClick={() => {
              setFilter("status", "");
              setPage(0);
            }}
            aria-pressed={!statusFilter}
            className={`shrink-0 snap-start inline-flex items-center h-8 px-3.5 rounded-full text-xs font-medium border transition-all whitespace-nowrap ${!statusFilter ? "bg-foreground text-background border-foreground shadow-sm" : "bg-background border-border hover:bg-muted text-foreground"}`}
          >
            Semua
          </button>
          {STATUS_TABS.map((s) => {
            const active = statusFilter === s;
            return (
              <button
                key={s}
                onClick={() => {
                  setFilter("status", active ? "" : s);
                  setPage(0);
                }}
                aria-pressed={active}
                className={`shrink-0 snap-start inline-flex items-center h-8 px-3.5 rounded-full text-xs font-medium border transition-all whitespace-nowrap ${active ? "bg-foreground text-background border-foreground shadow-sm" : "bg-background border-border hover:bg-muted text-foreground"}`}
              >
                {s === "Under Investigation" ? "Investigasi" : s}
              </button>
            );
          })}
        </div>
        <div className="flex items-center justify-between sm:hidden text-xs">
          <span className="text-muted-foreground tabular-nums">
            {displayRows.length} opname • Hal {page + 1}/{totalPages}
          </span>
          {hasActiveFilters && (
            <button
              onClick={() => {
                setSearch("");
                setFilter("status", "");
                setPage(0);
              }}
              className="font-medium text-primary hover:underline underline-offset-4"
            >
              Reset filter
            </button>
          )}
        </div>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-2.5 -mx-4 px-4">
        {pagedRows.length === 0
          ? null
          : pagedRows.map((r) => (
              <Link
                key={r.id}
                to="/stock-opname/$soId"
                params={{ soId: r.id }}
                className="block rounded-xl border bg-card p-3.5 shadow-xs active:scale-[0.99] transition-transform"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <CalendarDays className="h-3 w-3" />
                      {r.date}
                    </div>
                    <div className="flex items-center gap-1.5 mt-1">
                      <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-sm font-medium truncate">{r.branchName ?? "—"}</span>
                    </div>
                  </div>
                  <Badge
                    variant={statusColors[r.status] ?? "default"}
                    className="shrink-0 rounded-full px-2.5 py-1 text-[11px]"
                  >
                    {r.status === "Under Investigation" ? "Investigasi" : r.status}
                  </Badge>
                </div>
                <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground border-t pt-2">
                  <span className="tabular-nums">
                    {new Date(r.createdAt).toLocaleString("id-ID", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <span className="inline-flex items-center gap-1 text-primary font-medium">
                    Buka <ArrowRight className="h-3.5 w-3.5" />
                  </span>
                </div>
              </Link>
            ))}
        {totalPages > 1 && pagedRows.length > 0 && (
          <div className="flex items-center justify-between pt-2">
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="inline-flex items-center justify-center h-9 px-3 rounded-lg border bg-background text-sm font-medium disabled:opacity-30 hover:bg-muted min-w-[96px]"
            >
              Sebelumnya
            </button>
            <span className="text-xs tabular-nums text-muted-foreground">
              Hal {page + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
              disabled={page >= totalPages - 1}
              className="inline-flex items-center justify-center h-9 px-3 rounded-lg border bg-background text-sm font-medium disabled:opacity-30 hover:bg-muted min-w-[96px]"
            >
              Selanjutnya
            </button>
          </div>
        )}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block -mx-4 md:mx-0">
        <DataTable
          columns={columns}
          data={displayRows}
          keyExtractor={(r) => r.id}
          searchable={false}
          page={page}
          onPageChange={setPage}
          sort={sort}
          onSortChange={setSort}
        />
      </div>

      {displayRows.length === 0 && (
        <div className="rounded-xl border border-dashed bg-muted/20 p-8 text-center">
          <FileText className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">
            {hasActiveFilters ? "Tidak ada hasil" : "Tidak ada Stock Opname"}
          </p>
          <p className="text-muted-foreground text-xs mt-1 max-w-[32ch] mx-auto">
            {hasActiveFilters
              ? "Coba ubah filter atau pencarian."
              : "Tidak ada Stock Opname yang aktif untuk cabang Anda. Hubungi Area Manager untuk memulai proses Stock Opname."}
          </p>
          {hasActiveFilters && (
            <button
              onClick={() => {
                setSearch("");
                setFilter("status", "");
                setPage(0);
              }}
              className="mt-3 inline-flex h-9 px-3 rounded-lg border bg-background text-sm font-medium hover:bg-muted"
            >
              Reset filter
            </button>
          )}
        </div>
      )}

      <Modal
        open={triggerModal}
        onClose={() => setTriggerModal(false)}
        title="Trigger Stock Opname"
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Cabang</label>
            <select
              value={selectedBranch}
              onChange={(e) => setSelectedBranch(e.target.value)}
              disabled={user?.role === "branch_admin"}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
            >
              <option value="">Pilih cabang...</option>
              {visibleBranches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            {user?.role === "branch_admin" && (
              <p className="text-xs text-muted-foreground">
                Branch Admin hanya bisa trigger SO untuk cabang sendiri
              </p>
            )}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Tanggal</label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <button
            onClick={handleTrigger}
            disabled={!selectedBranch || triggerMutation.isPending}
            className="w-full h-9 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
          >
            {triggerMutation.isPending ? "Memproses..." : "Trigger SO"}
          </button>
        </div>
      </Modal>
    </RoleGuard>
  );
}
