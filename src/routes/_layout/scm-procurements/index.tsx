import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { useTableSearch } from "#/hooks/useTableSearch";
import { useTableUrlState } from "#/hooks/useTableUrlState";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useAuth } from "#/lib/auth-context";
import { usePageTitle } from "#/hooks/usePageTitle";
import RoleGuard from "#/components/RoleGuard";
import DataTable from "#/components/ui/DataTable";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Plus, Eye, FileText, Search, X, Building2, User, CalendarDays } from "lucide-react";
import { listProcurements } from "#/lib/server/scm-queries";
import type { ColumnDef } from "@tanstack/react-table";
import { SCM_PROCUREMENT_STATUS_VALUES, type ScmProcurementStatus } from "#/lib/server/scm-fsm";
import type { UnknownRecord } from "#/lib/unknown-record";

export const Route = createFileRoute("/_layout/scm-procurements/")({
  component: ProcurementsListPage,
  validateSearch: (search: UnknownRecord) => ({
    status: z.enum(SCM_PROCUREMENT_STATUS_VALUES).optional().catch(undefined).parse(search.status),
    search: z.string().optional().catch(undefined).parse(search.search),
    // URL-persisted table state (see useTableUrlState).
    page: z.coerce.number().int().min(0).optional().catch(undefined).parse(search.page),
    sortKey: z.string().optional().catch(undefined).parse(search.sortKey),
    sortDir: z.enum(["asc", "desc"]).optional().catch(undefined).parse(search.sortDir),
  }),
  loaderDeps: ({ search: { status } }) => ({ status }),
  loader: async ({ deps: { status } }) => {
    const rows = await listProcurements({
      data: status ? { status } : {},
    });
    return { initialRows: rows, status };
  },
});

interface ProcurementRow extends UnknownRecord {
  id: string;
  code: string;
  branchId: string;
  status: ScmProcurementStatus;
  createdAt: Date | string;
  submittedAt: Date | string | null;
  branchName: string | null;
  requestedByName: string | null;
  requestSource: string | null;
  availableEvents?: string[];
}

const statusLabels = {
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
} satisfies Record<ScmProcurementStatus, string>;

const statusColors = {
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
} satisfies Record<
  ScmProcurementStatus,
  "default" | "warning" | "success" | "destructive" | "secondary"
>;

// Events that count as "actionable" for badge counts.
// Excludes escape-hatch / destructive-only events (cancel, withdraw)
// so the badge reflects genuine forward-progress work.
const FORWARD_EVENTS = new Set([
  "submit",
  "open-review",
  "reject",
  "accept-and-ship",
  "mark-delivered",
  "open-receive",
  "finish-receive",
  "mark-paid",
]);

// Tab definitions. "all" is the default; per-status tabs deep-link via
// ?status=. (ADR 0004 §2)
type FilterKey = "all" | ScmProcurementStatus;

const FILTER_TABS: { accessorKey: FilterKey; label: string; annotation?: string }[] = [
  { accessorKey: "all", label: "Semua" },
  { accessorKey: "Draft", label: "Draft", annotation: "cabang: edit & kirim" },
  { accessorKey: "Pending", label: "Menunggu Review", annotation: "admin pusat: buka review" },
  { accessorKey: "UnderReview", label: "Sedang Direview", annotation: "admin pusat: review item" },
  { accessorKey: "InTransit", label: "Dalam Pengiriman", annotation: "cabang: terima barang" },
  { accessorKey: "Delivered", label: "Sudah Dikirim", annotation: "cabang: periksa barang" },
  { accessorKey: "ReviewingSJ", label: "Review Cabang", annotation: "cabang: konfirmasi jumlah" },
  {
    accessorKey: "WaitingForPayment",
    label: "Pembayaran",
    annotation: "admin pusat: tandai bayar",
  },
  { accessorKey: "Finished", label: "Lunas", annotation: "selesai" },
  { accessorKey: "Cancelled", label: "Dibatalkan", annotation: "batal" },
  { accessorKey: "Rejected", label: "Ditolak", annotation: "batal" },
];

function ProcurementsListPage() {
  const [search, setSearch] = useTableSearch();
  const { page, setPage, sort, setSort } = useTableUrlState();
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
        data: statusFilter ? { status: statusFilter } : {},
      }),
    initialData: initialRows,
  });

  // Unfiltered query for badge counts. We need ALL procurements to compute
  // per-status actionable counts, regardless of which tab is active.
  const { data: allRows } = useQuery({
    queryKey: ["scm-procurements"],
    queryFn: () => listProcurements({ data: {} }),
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

  const columns: ColumnDef<ProcurementRow>[] = [
    {
      accessorKey: "code",
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
      accessorKey: "branchName",
      header: "Cabang",
      render: (row) => row.branchName ?? "-",
    },
    {
      accessorKey: "requestedByName",
      header: "Pemohon",
      render: (row) => row.requestedByName ?? "-",
    },
    {
      accessorKey: "requestSource",
      header: "Sumber",
      render: (row) => (
        <span className="text-xs text-muted-foreground">{row.requestSource ?? "System"}</span>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      render: (row) => <Badge variant={statusColors[row.status]}>{statusLabels[row.status]}</Badge>,
    },
    {
      accessorKey: "createdAt",
      header: "Tanggal",
      render: (row) => new Date(row.createdAt).toLocaleDateString("id-ID"),
    },
    {
      accessorKey: "actions",
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

  const activeTab: FilterKey = statusFilter ?? "all";

  // Compute per-status actionable counts from ALL rows (unfiltered).
  // Each row includes `availableEvents` from the server (filtered by role);
  // we count a row as actionable if it has at least one forward-progress event.
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
        (r.branchName ?? "").toLowerCase().includes(q) ||
        (r.requestedByName ?? "").toLowerCase().includes(q),
    );
  }, [rows, search]);

  const totalPages = Math.ceil(displayRows.length / 15) || 1;
  const pagedRows = useMemo(
    () => displayRows.slice(page * 15, (page + 1) * 15),
    [displayRows, page],
  );

  const hasActiveFilters = !!(statusFilter || search.trim());

  usePageTitle(
    "Pengadaan",
    "Restock dari Central ke Cabang. Satu dokumen mengikuti seluruh siklus dari Draft sampai Lunas.",
  );

  return (
    <RoleGuard allowedRoles={["branch_admin", "admin_pusat", "super_admin", "area_manager"]}>
      <div className="space-y-4">
        {/* ── Toolbar: search + primary action (mobile-first) ── */}
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
          <div className="relative flex-1 sm:max-w-[380px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              inputMode="search"
              autoComplete="off"
              aria-label="Cari pengadaan"
              placeholder="Cari kode, cabang, pemohon…"
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
          {user?.role === "branch_admin" || user?.role === "super_admin" ? (
            <Link to="/scm-procurements/new" className="sm:ml-auto shrink-0 w-full sm:w-auto">
              <Button className="w-full sm:w-auto h-11 sm:h-9 rounded-xl sm:rounded-md shadow-sm">
                <Plus className="h-4 w-4" />
                Buat Pengadaan
              </Button>
            </Link>
          ) : null}
        </div>

        {/* Status filter — pills scroller (mobile-friendly) */}
        <div className="space-y-2">
          <div
            className="flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden -mx-4 px-4 sm:mx-0 sm:px-0 pb-1 snap-x snap-mandatory"
            role="tablist"
            aria-label="Filter status pengadaan"
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
          {/* Active tab annotation + meta — hidden on mobile pills, shown as subtle hint */}
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="hidden sm:inline text-muted-foreground">
              {FILTER_TABS.find((t) => t.accessorKey === activeTab)?.annotation ?? "—"} •{" "}
              {displayRows.length} dokumen
            </span>
            <span className="sm:hidden text-muted-foreground tabular-nums">
              {displayRows.length} dokumen • Hal {page + 1}/{totalPages}
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
            <FileText className="mb-3 h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">
              {statusFilter || search ? "Tidak ada hasil" : "Belum ada pengadaan"}
            </p>
            <p className="text-sm text-muted-foreground mt-1 max-w-[32ch]">
              {statusFilter
                ? "Tidak ada pengadaan dengan status ini. Coba status lain atau reset filter."
                : search
                  ? `Tidak ada pengadaan untuk "${search}".`
                  : "Buat pengadaan pertama untuk branch ini."}
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
              <Link to="/scm-procurements/new" search={() => ({ status: undefined })}>
                <Button size="sm">Buat pengadaan baru</Button>
              </Link>
            </div>
          </div>
        ) : (
          <>
            {/* Mobile: cards */}
            <div className="md:hidden space-y-2.5 -mx-4 px-4">
              {pagedRows.map((row) => (
                <Link
                  key={row.id}
                  to="/scm-procurements/$procurementId"
                  params={{ procurementId: row.id }}
                  className="block rounded-xl border bg-card p-3.5 shadow-xs active:scale-[0.99] transition-transform"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-sm font-semibold tracking-tight truncate">
                        {row.code}
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                        <Badge
                          variant={statusColors[row.status]}
                          className="text-[11px] px-2 py-0 h-5"
                        >
                          {statusLabels[row.status]}
                        </Badge>
                        {(row.availableEvents?.some((e) => FORWARD_EVENTS.has(e)) ?? false) && (
                          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[11px] font-semibold text-destructive-foreground">
                            !
                          </span>
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
                  <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    <div className="min-w-0">
                      <div className="text-[11px] tracking-widest uppercase text-muted-foreground font-medium flex items-center gap-1">
                        <Building2 className="h-3 w-3" />
                        Cabang
                      </div>
                      <div className="truncate font-medium">{row.branchName ?? "—"}</div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-[11px] tracking-widest uppercase text-muted-foreground font-medium flex items-center gap-1">
                        <User className="h-3 w-3" />
                        Pemohon
                      </div>
                      <div className="truncate">{row.requestedByName ?? "—"}</div>
                    </div>
                    <div className="col-span-2 flex items-center justify-between pt-2 mt-1 border-t">
                      <span className="text-[11px] text-muted-foreground">
                        {row.requestSource ?? "System"}
                      </span>
                      <span className="inline-flex items-center gap-1 text-primary text-xs font-medium">
                        Detail <Eye className="h-3.5 w-3.5" />
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
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
                data={displayRows}
                columns={columns}
                keyExtractor={(row) => row.id}
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
