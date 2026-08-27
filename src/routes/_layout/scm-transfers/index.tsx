import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { badgeVariant } from "#/lib/utils";
import { z } from "zod";
import { lookupLabel } from "#/lib/label-lookup";
import { useTableSearch } from "#/hooks/useTableSearch";
import { useTableUrlState } from "#/hooks/useTableUrlState";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "#/lib/auth-context";
import { usePageTitle } from "#/hooks/usePageTitle";
import RoleGuard from "#/components/RoleGuard";
import DataTable from "#/components/ui/DataTable";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import {
  Plus,
  ArrowRight,
  Lock,
  Search,
  X,
  ArrowUpRight,
  Building2,
  CalendarDays,
} from "lucide-react";
import { getMutasiTransfers } from "#/lib/server/scm-transfers";
import { canAmAct } from "#/lib/server/scm-transfer-queries";
import type { ColumnDef } from "@tanstack/react-table";
import { SCM_TRANSFER_STATUS_VALUES, type ScmTransferStatus } from "#/lib/server/scm-transfer-fsm";
import type { UnknownRecord } from "#/lib/unknown-record";
import { getBranches } from "#/lib/server/branches";

export const Route = createFileRoute("/_layout/scm-transfers/")({
  component: TransfersListPage,
  validateSearch: (search: UnknownRecord) => ({
    status: z.enum(SCM_TRANSFER_STATUS_VALUES).optional().catch(undefined).parse(search.status),
    search: z.string().optional().catch(undefined).parse(search.search),
    // URL-persisted table state (see useTableUrlState).
    page: z.coerce.number().int().min(0).optional().catch(undefined).parse(search.page),
    sortKey: z.string().optional().catch(undefined).parse(search.sortKey),
    sortDir: z.enum(["asc", "desc"]).optional().catch(undefined).parse(search.sortDir),
  }),
  loaderDeps: ({ search: { status } }) => ({ status }),
  loader: async ({ deps: { status } }) => {
    const [allRows, branches] = await Promise.all([
      getMutasiTransfers({ data: {} }),
      getBranches({ data: {} }),
    ]);
    // Filter by status for the table if a tab is active
    const rows = status ? allRows.filter((r) => r.status === status) : allRows;
    return { initialRows: rows, initialAllRows: allRows, initialBranches: branches, status };
  },
});

interface TransferRow {
  id: string;
  code: string;
  fromBranchId: string;
  toBranchId: string;
  status: ScmTransferStatus;
  createdAt: Date | string;
  requestedById: string;
  availableEvents?: string[];
}

const statusLabels = {
  SuratJalanDraft: "Draft SJ",
  PendingAMReview: "Menunggu AM",
  Approved: "Disetujui",
  InTransit: "Dalam Pengiriman",
  Delivered: "Diterima",
  ReviewingSJ: "Review Penerima",
  WaitingForPayment: "Menunggu Bayar",
  Finished: "Lunas",
  Rejected: "Ditolak",
  Cancelled: "Dibatalkan",
} satisfies Record<string, string>;

const statusColors = {
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
} satisfies Record<string, "default" | "warning" | "success" | "destructive" | "secondary">;

// Events that count as "actionable" for badge counts.
// Excludes escape-hatch events (cancel, withdraw) so the badge reflects
// genuine forward-progress work.
const FORWARD_EVENTS = new Set([
  "submit",
  "approve",
  "reject",
  "ship",
  "mark-delivered",
  "open-receive",
  "finish-receive",
  "mark-paid",
]);

// Tab definitions. "all" is the default; per-status tabs deep-link via
// ?status=.
type FilterKey = "all" | ScmTransferStatus;

const FILTER_TABS: { accessorKey: FilterKey; label: string; annotation?: string }[] = [
  { accessorKey: "all", label: "Semua" },
  {
    accessorKey: "SuratJalanDraft",
    label: "Draft SJ",
    annotation: "cabang pengirim: edit & kirim",
  },
  {
    accessorKey: "PendingAMReview",
    label: "Menunggu AM",
    annotation: "area manager: review & setujui",
  },
  { accessorKey: "Approved", label: "Disetujui", annotation: "cabang pengirim: kirim barang" },
  {
    accessorKey: "InTransit",
    label: "Dalam Pengiriman",
    annotation: "cabang penerima: tandai diterima",
  },
  { accessorKey: "Delivered", label: "Diterima", annotation: "cabang penerima: periksa barang" },
  {
    accessorKey: "ReviewingSJ",
    label: "Review Penerima",
    annotation: "cabang penerima: konfirmasi jumlah",
  },
  {
    accessorKey: "WaitingForPayment",
    label: "Menunggu Bayar",
    annotation: "cabang penerima: tandai bayar",
  },
  { accessorKey: "Finished", label: "Lunas", annotation: "selesai" },
  { accessorKey: "Rejected", label: "Ditolak", annotation: "ditolak" },
  { accessorKey: "Cancelled", label: "Dibatalkan", annotation: "batal" },
];

function TransfersListPage() {
  const [search, setSearch] = useTableSearch();
  const { page, setPage, sort, setSort } = useTableUrlState();
  const { user } = useAuth();
  const { status: statusFilter } = Route.useSearch();
  const { initialRows, initialAllRows, initialBranches } = Route.useLoaderData();
  const navigate = useNavigate({ from: Route.fullPath });

  const branchById = useMemo(
    () => new Map(initialBranches.map((b) => [b.id, b])),
    [initialBranches],
  );

  // Filtered query for the table display.
  const queryKey = statusFilter ? ["scm-transfers", statusFilter] : ["scm-transfers"];

  const { data: rows } = useQuery({
    queryKey,
    queryFn: () =>
      getMutasiTransfers({ data: {} }).then((all) =>
        statusFilter ? all.filter((r) => r.status === statusFilter) : all,
      ),
    initialData: initialRows,
  });

  // Unfiltered query for badge counts. We need ALL transfers to compute
  // per-status actionable counts, regardless of which tab is active.
  const { data: allRows } = useQuery({
    queryKey: ["scm-transfers"],
    queryFn: () => getMutasiTransfers({ data: {} }),
    initialData: initialAllRows,
  });

  const setFilter = (next: FilterKey) => {
    void navigate({
      search: (prev) => ({
        ...prev,
        status: next === "all" ? undefined : next,
        search: undefined,
      }),
      replace: true,
    });
  };

  const activeTab: FilterKey = statusFilter ?? "all";

  // Compute per-status actionable counts from ALL rows (unfiltered).
  // Each row includes `availableEvents` from the server (filtered by role +
  // branch); we count a row as actionable if it has at least one
  // forward-progress event.
  const actionableCounts = useMemo(() => {
    const source = allRows ?? rows;
    const counts: Partial<Record<FilterKey, number>> = {};
    let total = 0;
    for (const row of source) {
      const events = row.availableEvents ?? [];
      const isActionable = events.some((e) => FORWARD_EVENTS.has(e));
      if (isActionable) {
        const statusKey: FilterKey = row.status;
        counts[statusKey] = (counts[statusKey] ?? 0) + 1;
        total++;
      }
    }
    counts.all = total;
    return counts;
  }, [allRows, rows]);

  const displayRows = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter(
      (r) =>
        r.code.toLowerCase().includes(q) ||
        (branchById.get(r.fromBranchId)?.name ?? "").toLowerCase().includes(q) ||
        (branchById.get(r.toBranchId)?.name ?? "").toLowerCase().includes(q) ||
        (lookupLabel(statusLabels, r.status) ?? r.status).toLowerCase().includes(q),
    );
  }, [rows, search, branchById]);

  const totalPages = Math.ceil(displayRows.length / 15) || 1;
  const pagedRows = useMemo(
    () => displayRows.slice(page * 15, (page + 1) * 15),
    [displayRows, page],
  );
  const hasActiveFilters = !!(statusFilter || search.trim());

  usePageTitle("Mutasi Stok", "Surat Jalan antar cabang");

  const columns: ColumnDef<TransferRow>[] = [
    { accessorKey: "code", header: "Kode", width: "w-32", enableSorting: true },
    {
      accessorKey: "fromBranchId",
      header: "Dari",
      enableSorting: true,
      cell: ({ row }) =>
        branchById.get(row.original.fromBranchId)?.name ??
        row.original.fromBranchId.slice(0, 8) + "...",
    },
    {
      accessorKey: "toBranchId",
      header: "Ke",
      enableSorting: true,
      cell: ({ row }) =>
        branchById.get(row.original.toBranchId)?.name ??
        row.original.toBranchId.slice(0, 8) + "...",
    },
    {
      accessorKey: "status",
      header: "Status",
      enableSorting: true,
      cell: ({ row }) => (
        <Badge variant={badgeVariant(lookupLabel(statusColors, row.original.status))}>
          {lookupLabel(statusLabels, row.original.status) ?? row.original.status}
        </Badge>
      ),
    },
    {
      accessorKey: "createdAt",
      header: "Tgl Dibuat",
      enableSorting: true,
      cell: ({ row }) => new Date(row.original.createdAt).toLocaleDateString("id-ID"),
    },
    {
      accessorKey: "id",
      header: "",
      width: "w-44",
      cell: ({ row }) => {
        const isAm = user?.role === "area_manager";
        const isCrossJurisdiction =
          isAm &&
          user.assignedBranches &&
          !canAmAct(
            { assignedBranches: user.assignedBranches },
            { fromBranchId: row.original.fromBranchId, toBranchId: row.original.toBranchId },
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
              params={{ transferId: row.original.id }}
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
        {/* ── Toolbar: search + primary action (mobile-first) ── */}
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
          <div className="relative flex-1 sm:max-w-[380px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              inputMode="search"
              autoComplete="off"
              aria-label="Cari mutasi"
              placeholder="Cari kode, cabang, status…"
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
          {(user?.role === "branch_admin" || user?.role === "super_admin") && (
            <Link to="/scm-transfers/new" className="sm:ml-auto shrink-0 w-full sm:w-auto">
              <Button className="w-full sm:w-auto h-11 sm:h-9 rounded-xl sm:rounded-md shadow-sm">
                <Plus className="h-4 w-4" />
                Buat Mutasi
              </Button>
            </Link>
          )}
        </div>

        {/* Status filter — pills scroller (mobile-friendly) */}
        <div className="space-y-2">
          <div
            className="flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden -mx-4 px-4 sm:mx-0 sm:px-0 pb-1 snap-x snap-mandatory"
            role="tablist"
            aria-label="Filter status mutasi"
          >
            {FILTER_TABS.map((tab) => {
              const isActive = activeTab === tab.accessorKey;
              const count = actionableCounts[tab.accessorKey] ?? 0;
              return (
                <button
                  key={tab.accessorKey}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setFilter(tab.accessorKey)}
                  className={`shrink-0 snap-start inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full text-xs font-medium border transition-all whitespace-nowrap ${isActive ? "bg-foreground text-background border-foreground shadow-sm" : "bg-background border-border hover:bg-muted text-foreground"}`}
                >
                  <span className="whitespace-nowrap">{tab.label}</span>
                  {count > 0 ? (
                    <span
                      className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-semibold ${isActive ? "bg-background text-foreground" : "bg-destructive text-destructive-foreground"}`}
                      aria-label={`${count} aksi tertunda`}
                    >
                      {count > 99 ? "99+" : count}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="hidden sm:inline text-muted-foreground">
              {FILTER_TABS.find((t) => t.accessorKey === activeTab)?.annotation ?? "—"} •{" "}
              {displayRows.length} dokumen
            </span>
            <span className="sm:hidden text-muted-foreground tabular-nums">
              {displayRows.length} mutasi • Hal {page + 1}/{totalPages}
            </span>
            {hasActiveFilters && (
              <button
                onClick={() => {
                  void navigate({ search: () => ({}), replace: true });
                  setSearch("");
                  setPage(0);
                }}
                className="font-medium text-primary hover:underline underline-offset-4 shrink-0"
              >
                Reset filter
              </button>
            )}
          </div>
        </div>

        {displayRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed bg-muted/20 py-10 sm:py-12 text-center px-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
              <ArrowUpRight className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="mt-3 text-sm font-medium">
              {statusFilter || search ? "Tidak ada hasil" : "Belum ada mutasi"}
            </p>
            <p className="text-sm text-muted-foreground mt-1 max-w-[32ch]">
              {statusFilter
                ? "Tidak ada mutasi dengan status ini. Coba status lain atau reset filter."
                : search
                  ? `Tidak ada mutasi untuk "${search}".`
                  : "Buat mutasi pertama antar cabang untuk memulai."}
            </p>
            <div className="mt-4 flex gap-2">
              {hasActiveFilters && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void navigate({ search: () => ({}), replace: true });
                    setSearch("");
                    setPage(0);
                  }}
                >
                  Reset filter
                </Button>
              )}
              <Link to="/scm-transfers/new">
                <Button size="sm">Buat mutasi</Button>
              </Link>
            </div>
          </div>
        ) : (
          <>
            {/* Mobile: cards */}
            <div className="md:hidden space-y-2.5 -mx-4 px-4">
              {pagedRows.map((row) => {
                const fromName =
                  branchById.get(row.fromBranchId)?.name ?? row.fromBranchId.slice(0, 8);
                const toName = branchById.get(row.toBranchId)?.name ?? row.toBranchId.slice(0, 8);
                const isAm = user?.role === "area_manager";
                const isCross =
                  isAm &&
                  user.assignedBranches &&
                  !canAmAct(
                    { assignedBranches: user.assignedBranches },
                    { fromBranchId: row.fromBranchId, toBranchId: row.toBranchId },
                  );
                const hasAction = (row.availableEvents ?? []).some((e) => FORWARD_EVENTS.has(e));
                return (
                  <Link
                    key={row.id}
                    to="/scm-transfers/$transferId"
                    params={{ transferId: row.id }}
                    className="block rounded-xl border bg-card p-3.5 shadow-xs active:scale-[0.99] transition-transform"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-mono text-sm font-semibold tracking-tight truncate">
                          {row.code}
                        </div>
                        <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                          <Badge
                            variant={badgeVariant(lookupLabel(statusColors, row.status))}
                            className="text-[11px] px-2 py-0 h-5"
                          >
                            {lookupLabel(statusLabels, row.status) ?? row.status}
                          </Badge>
                          {hasAction && (
                            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[11px] font-semibold text-destructive-foreground">
                              !
                            </span>
                          )}
                          {isCross && (
                            <Badge variant="outline" className="text-[11px] px-1.5 py-0 h-5">
                              <Lock className="h-3 w-3 mr-1" />
                              Lintas
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="shrink-0 inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <CalendarDays className="h-3.5 w-3.5" />
                        {new Date(row.createdAt).toLocaleDateString("id-ID", {
                          day: "2-digit",
                          month: "short",
                        })}
                      </div>
                    </div>
                    <div className="mt-2.5 flex items-center gap-1.5 text-xs rounded-lg bg-muted/40 px-2.5 py-2">
                      <span className="flex items-center gap-1 font-medium truncate">
                        <Building2 className="h-3 w-3 text-muted-foreground" />
                        {fromName}
                      </span>
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="flex items-center gap-1 font-medium truncate">
                        <Building2 className="h-3 w-3 text-muted-foreground" />
                        {toName}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-end">
                      <span className="inline-flex items-center gap-1 text-primary text-xs font-medium">
                        Detail <ArrowRight className="h-3.5 w-3.5" />
                      </span>
                    </div>
                  </Link>
                );
              })}
              {totalPages > 1 && (
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
            {/* Desktop: table */}
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
          </>
        )}
      </div>
    </RoleGuard>
  );
}
