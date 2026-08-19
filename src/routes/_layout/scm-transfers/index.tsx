import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { badgeVariant } from "#/lib/utils";
import { z } from "zod";
import { lookupLabel } from "#/lib/label-lookup";
import { useTableSearch } from "#/hooks/useTableSearch";
import { useMemo } from "react";
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
import { SCM_TRANSFER_STATUS_VALUES, type ScmTransferStatus } from "#/lib/server/scm-transfer-fsm";
import type { UnknownRecord } from "#/lib/unknown-record";
import { getBranches } from "#/lib/server/branches";

export const Route = createFileRoute("/_layout/scm-transfers/")({
  component: TransfersListPage,
  validateSearch: (search: UnknownRecord) => ({
    status: z.enum(SCM_TRANSFER_STATUS_VALUES).optional().catch(undefined).parse(search.status),
    search: z.string().optional().catch(undefined).parse(search.search),
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

const FILTER_TABS: { key: FilterKey; label: string; annotation?: string }[] = [
  { key: "all", label: "Semua" },
  { key: "SuratJalanDraft", label: "Draft SJ", annotation: "cabang pengirim: edit & kirim" },
  { key: "PendingAMReview", label: "Menunggu AM", annotation: "area manager: review & setujui" },
  { key: "Approved", label: "Disetujui", annotation: "cabang pengirim: kirim barang" },
  { key: "InTransit", label: "Dalam Pengiriman", annotation: "cabang penerima: tandai diterima" },
  { key: "Delivered", label: "Diterima", annotation: "cabang penerima: periksa barang" },
  {
    key: "ReviewingSJ",
    label: "Review Penerima",
    annotation: "cabang penerima: konfirmasi jumlah",
  },
  {
    key: "WaitingForPayment",
    label: "Menunggu Bayar",
    annotation: "cabang penerima: tandai bayar",
  },
  { key: "Finished", label: "Lunas", annotation: "selesai" },
  { key: "Rejected", label: "Ditolak", annotation: "ditolak" },
  { key: "Cancelled", label: "Dibatalkan", annotation: "batal" },
];

function TransfersListPage() {
  const [search, setSearch] = useTableSearch();
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
      search: { status: next === "all" ? undefined : next, search: undefined },
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
        const key: FilterKey = row.status;
        counts[key] = (counts[key] ?? 0) + 1;
        total++;
      }
    }
    counts.all = total;
    return counts;
  }, [allRows, rows]);

  usePageTitle("Mutasi Stok", "Surat Jalan antar cabang");

  const columns: Column<TransferRow>[] = [
    { key: "code", header: "Kode", width: "w-32", sortable: true },
    {
      key: "fromBranchId",
      header: "Dari",
      sortable: true,
      render: (r) => branchById.get(r.fromBranchId)?.name ?? r.fromBranchId.slice(0, 8) + "...",
    },
    {
      key: "toBranchId",
      header: "Ke",
      sortable: true,
      render: (r) => branchById.get(r.toBranchId)?.name ?? r.toBranchId.slice(0, 8) + "...",
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      render: (r) => (
        <Badge variant={badgeVariant(lookupLabel(statusColors, r.status))}>
          {lookupLabel(statusLabels, r.status) ?? r.status}
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
          <p className="text-sm text-muted-foreground">Total: {(allRows ?? rows).length} mutasi</p>
          {(user?.role === "branch_admin" || user?.role === "super_admin") && (
            <Link to="/scm-transfers/new">
              <Button>
                <Plus className="h-4 w-4 mr-1" />
                Buat Mutasi
              </Button>
            </Link>
          )}
        </div>

        {/* Status filter tabs. URL-driven so the filter is shareable and
            deep-linkable. */}
        <div
          className="flex overflow-x-auto border-b"
          role="tablist"
          aria-label="Filter status mutasi"
        >
          {FILTER_TABS.map((tab) => {
            const isActive = activeTab === tab.key;
            const count = actionableCounts[tab.key] ?? 0;
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setFilter(tab.key)}
                className={
                  "group flex shrink-0 flex-col items-start gap-0.5 border-r border-border px-3 py-2 text-sm font-medium transition-colors " +
                  (isActive
                    ? "border-b-2 border-b-primary text-foreground"
                    : "border-b-2 border-b-transparent text-muted-foreground hover:text-foreground")
                }
              >
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  {tab.label}
                  {count > 0 ? (
                    <span
                      className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-xs font-semibold text-destructive-foreground"
                      aria-label={`${count} aksi tertunda`}
                    >
                      {count > 99 ? "99+" : count}
                    </span>
                  ) : null}
                </span>
                {tab.annotation ? (
                  <span
                    className={
                      "whitespace-nowrap text-xs leading-tight " +
                      (isActive ? "text-foreground/70" : "text-muted-foreground")
                    }
                  >
                    {tab.annotation}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        <DataTable
          columns={columns}
          // SAFETY: server transfer rows carry every TransferRow field (status
          // enum widens to string; the index signature absorbs extras).
          data={rows}
          keyExtractor={(r) => r.id}
          search={search}
          onSearchChange={setSearch}
        />
      </div>
    </RoleGuard>
  );
}
