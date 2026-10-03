import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "#/lib/auth-context";
import { usePageTitle } from "#/hooks/usePageTitle";
import { useTableSearch } from "#/hooks/useTableSearch";
import { useTableUrlState } from "#/hooks/useTableUrlState";
import RoleGuard from "#/components/RoleGuard";
import DataTable, { type Column } from "#/components/ui/DataTable";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { ArrowUpRight, Building2, PackageCheck, Search, Truck, X } from "lucide-react";
import { toast } from "sonner";
import {
  confirmScmReturnPickup,
  getScmReturnSummary,
  getScmReturns,
  reopenScmReturn,
  type ScmReturnStatus,
} from "#/lib/server/scm-returns";
import { getBranches } from "#/lib/server/branches";
import type { UnknownRecord } from "#/lib/unknown-record";

/**
 * Retur Barang (ADR 0018) — rejected-at-receiving goods on their way home.
 *
 * When a receiver rejects stock and picks "Return ke Pusat", the quantity is
 * credited straight back to the source's inventory — but the box is still on
 * the receiver's shelf. This page is that gap made visible: what each branch
 * still owes its source, what it is worth, and one button for the source to
 * close the loop once the goods are physically back.
 *
 * Deliberately NOT part of the Waste report. Only "Scrap" (goods destroyed) is
 * a loss; see the Waste page for that.
 */

const RETURN_STATUS_VALUES = ["Pending", "PickedUp"] as const;

/** Must match DataTable's `pageSize` so the mobile cards page identically. */
const PAGE_SIZE = 15;

export const Route = createFileRoute("/_layout/scm-returns/")({
  component: ReturnsListPage,
  validateSearch: (search: UnknownRecord) => ({
    status: z.enum(RETURN_STATUS_VALUES).optional().catch(undefined).parse(search.status),
    branchId: z.string().optional().catch(undefined).parse(search.branchId),
    search: z.string().optional().catch(undefined).parse(search.search),
    page: z.coerce.number().int().min(1).optional().catch(undefined).parse(search.page),
  }),
  loader: async () => {
    const [rows, branches, summary] = await Promise.all([
      getScmReturns({ data: {} }),
      getBranches({ data: {} }),
      getScmReturnSummary({ data: {} }),
    ]);
    return { initialRows: rows, initialBranches: branches, initialSummary: summary };
  },
});

interface ReturnRow {
  id: string;
  branchId: string;
  branchName: string | null;
  ingredientId: string;
  ingredientName: string | null;
  quantity: number;
  valuation: number;
  disposition: "Return to Source" | "Scrap" | "Quarantine";
  reason: string | null;
  status: ScmReturnStatus;
  createdAt: Date | string;
  pickedUpAt: Date | string | null;
  pickedUpByName: string | null;
  scmProcurementId: string | null;
  scmTransferId: string | null;
  procurementCode: string | null;
  transferCode: string | null;
}

const statusLabels = {
  Pending: "Menunggu Pickup",
  PickedUp: "Sudah Kembali",
} satisfies Record<ScmReturnStatus, string>;

const dispositionLabels = {
  "Return to Source": "Kembali ke Sumber",
  Scrap: "Scrap",
  Quarantine: "Karantina",
} satisfies Record<ReturnRow["disposition"], string>;

function formatRupiah(value: number): string {
  return `Rp${Math.round(value).toLocaleString("id-ID")}`;
}

function ReturnsListPage() {
  const [search, setSearch] = useTableSearch();
  const { page, setPage } = useTableUrlState();
  const { user } = useAuth();
  const { status: statusFilter, branchId: branchFilter } = Route.useSearch();
  const { initialRows, initialBranches, initialSummary } = Route.useLoaderData();
  const queryClient = useQueryClient();
  const navigate = useNavigate({ from: Route.fullPath });

  const isBranchAdmin = user?.role === "branch_admin";
  const canConfirm = user?.role === "admin_pusat" || user?.role === "super_admin";

  // Fetched WITHOUT the status filter so the status pills can show real
  // per-status counts; the active tab is applied client-side below. Passing
  // statusFilter here would collapse the other tabs' counts to zero.
  const { data: rows } = useQuery({
    queryKey: ["scm-returns", branchFilter ?? null],
    queryFn: () => getScmReturns({ data: { branchId: branchFilter } }),
    initialData: initialRows,
  });

  const { data: summary } = useQuery({
    queryKey: ["scm-return-summary", branchFilter ?? null],
    queryFn: () => getScmReturnSummary({ data: { branchId: branchFilter } }),
    initialData: initialSummary,
  });

  const { data: branches } = useQuery({
    queryKey: ["branches"],
    queryFn: () => getBranches({ data: {} }),
    initialData: initialBranches,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["scm-returns"] });
    void queryClient.invalidateQueries({ queryKey: ["scm-return-summary"] });
  };

  const confirmMutation = useMutation({
    mutationFn: confirmScmReturnPickup,
    onSuccess: (result) => {
      if (result.success) {
        toast.success("Retur ditandai sudah kembali ke gudang sumber");
      } else {
        toast.error(result.error);
      }
      invalidate();
    },
    onError: (error: Error) =>
      toast.error("Gagal mengonfirmasi retur", { description: error.message }),
  });

  const reopenMutation = useMutation({
    mutationFn: reopenScmReturn,
    onSuccess: (result) => {
      if (result.success) {
        toast.success("Retur dibuka kembali — cabang wajib mengirim ulang");
      } else {
        toast.error(result.error);
      }
      invalidate();
    },
    onError: (error: Error) => toast.error("Gagal membuka retur", { description: error.message }),
  });

  const counts = useMemo(() => {
    const c = {
      all: rows.length,
      Pending: 0,
      PickedUp: 0,
    } satisfies Record<"all" | ScmReturnStatus, number>;
    for (const r of rows) c[r.status] += 1;
    return c;
  }, [rows]);

  const displayRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    let result = rows;
    if (statusFilter) result = result.filter((r) => r.status === statusFilter);
    if (branchFilter) result = result.filter((r) => r.branchId === branchFilter);
    if (!term) return result;
    return result.filter(
      (r) =>
        (r.ingredientName ?? "").toLowerCase().includes(term) ||
        (r.procurementCode ?? "").toLowerCase().includes(term) ||
        (r.transferCode ?? "").toLowerCase().includes(term) ||
        (r.branchName ?? "").toLowerCase().includes(term) ||
        (r.reason ?? "").toLowerCase().includes(term),
    );
  }, [rows, search, statusFilter, branchFilter]);

  // DataTable slices internally from `page`, so the mobile cards replicate that
  // slice exactly rather than drifting from the table's own pagination.
  const totalPages = Math.ceil(displayRows.length / PAGE_SIZE) || 1;
  const pagedRows = useMemo(
    () => displayRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [displayRows, page],
  );

  const statusBadgeVariant = (status: ScmReturnStatus) =>
    status === "Pending" ? ("warning" as const) : ("success" as const);

  usePageTitle("Retur Barang", "Barang ditolak yang sedang dikirim kembali ke gudang sumber");

  const columns: Column<ReturnRow>[] = [
    {
      accessorKey: "ingredientName",
      header: "Bahan",
      enableSorting: true,
      cell: ({ row }) => (
        <div className="min-w-0">
          <div className="truncate font-medium">
            {row.original.ingredientName ?? row.original.ingredientId.slice(0, 8)}
          </div>
          {row.original.reason ? (
            <div className="truncate text-xs text-muted-foreground">{row.original.reason}</div>
          ) : null}
        </div>
      ),
    },
    {
      accessorKey: "quantity",
      header: "Qty",
      width: "w-24",
      align: "right" as const,
      enableSorting: true,
      cell: ({ row }) => row.original.quantity.toLocaleString("id-ID"),
    },
    {
      accessorKey: "branchName",
      header: "Cabang Pemegang",
      width: "w-44",
      enableSorting: true,
      cell: ({ row }) => row.original.branchName ?? "—",
    },
    {
      accessorKey: "procurementCode",
      header: "Asal",
      width: "w-48",
      cell: ({ row }) => {
        const { procurementCode, transferCode, scmProcurementId, scmTransferId } = row.original;
        if (procurementCode && scmProcurementId) {
          return (
            <Link
              to="/scm-procurements/$procurementId"
              params={{ procurementId: scmProcurementId }}
              className="inline-flex items-center gap-1 text-sm hover:underline"
            >
              <PackageCheck className="h-3.5 w-3.5 text-muted-foreground" />
              {procurementCode}
            </Link>
          );
        }
        if (transferCode && scmTransferId) {
          return (
            <Link
              to="/scm-transfers/$transferId"
              params={{ transferId: scmTransferId }}
              className="inline-flex items-center gap-1 text-sm hover:underline"
            >
              <Truck className="h-3.5 w-3.5 text-muted-foreground" />
              {transferCode}
            </Link>
          );
        }
        return "—";
      },
    },
    {
      accessorKey: "disposition",
      header: "Disposisi",
      width: "w-40",
      cell: ({ row }) => (
        <Badge variant="outline" className="text-[11px]">
          {dispositionLabels[row.original.disposition]}
        </Badge>
      ),
    },
    ...(isBranchAdmin
      ? []
      : [
          {
            accessorKey: "valuation",
            header: "Nilai",
            width: "w-32",
            align: "right" as const,
            enableSorting: true,
            cell: ({ row }: { row: { original: ReturnRow } }) =>
              formatRupiah(row.original.valuation),
          },
        ]),
    {
      accessorKey: "createdAt",
      header: "Ditolak",
      width: "w-32",
      enableSorting: true,
      cell: ({ row }) => new Date(row.original.createdAt).toLocaleDateString("id-ID"),
    },
    {
      accessorKey: "status",
      header: "Status",
      width: "w-40",
      cell: ({ row }) => (
        <div className="flex flex-col gap-0.5">
          <Badge variant={row.original.status === "Pending" ? "warning" : "success"}>
            {statusLabels[row.original.status]}
          </Badge>
          {row.original.status === "PickedUp" && row.original.pickedUpAt ? (
            <span className="text-[11px] text-muted-foreground">
              {new Date(row.original.pickedUpAt).toLocaleDateString("id-ID")}
              {row.original.pickedUpByName ? ` · ${row.original.pickedUpByName}` : ""}
            </span>
          ) : null}
        </div>
      ),
    },
    ...(canConfirm
      ? [
          {
            accessorKey: "id",
            header: "Aksi",
            width: "w-40",
            cell: ({ row }: { row: { original: ReturnRow } }) =>
              row.original.status === "Pending" ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs pointer-coarse:h-9 pointer-coarse:px-3"
                  disabled={confirmMutation.isPending}
                  onClick={() => confirmMutation.mutate({ data: { returnId: row.original.id } })}
                >
                  Sudah kembali
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs pointer-coarse:h-9 pointer-coarse:px-3 text-muted-foreground"
                  disabled={reopenMutation.isPending}
                  title="Barang ternyata belum sampai — buka kembali"
                  onClick={() =>
                    reopenMutation.mutate({
                      data: {
                        returnId: row.original.id,
                        reason: "Barang belum sampai di gudang sumber",
                      },
                    })
                  }
                >
                  Buka lagi
                </Button>
              ),
          },
        ]
      : []),
  ];

  return (
    <RoleGuard allowedRoles={["super_admin", "admin_pusat", "area_manager", "branch_admin"]}>
      <div className="space-y-4">
        {/* ── What is still out there ──
            Figures sit inline rather than stacked under a label: a big number
            with a small caption above it is the hero-metric shape this product
            explicitly rejects. This reads as a ledger line. */}
        <div className="rounded-xl sm:rounded-lg border bg-card px-3.5 py-3 shadow-xs sm:px-4">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-sm text-muted-foreground">Menunggu pickup</span>
            <span className="text-lg font-semibold tabular-nums leading-none">
              {summary.pendingCount}
            </span>
            <span className="text-sm text-muted-foreground">
              {summary.pendingCount === 1 ? "baris" : "baris"}
            </span>
            {!isBranchAdmin && summary.pendingCount > 0 && (
              <>
                <span aria-hidden className="text-muted-foreground/40">
                  ·
                </span>
                <span className="text-sm tabular-nums">
                  {formatRupiah(summary.pendingValuation)}
                </span>
                <span className="text-sm text-muted-foreground">masih di cabang</span>
              </>
            )}
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Stok sudah tercatat kembali di gudang sumber. Yang tersisa di sini adalah fisiknya —
            kirimkan, lalu konfirmasi.
          </p>
        </div>

        {/* ── Toolbar ── */}
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
          <div className="relative flex-1 sm:max-w-[380px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              inputMode="search"
              autoComplete="off"
              aria-label="Cari retur"
              placeholder="Cari bahan, kode dokumen, alasan…"
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
        </div>

        {/* ── Status pills ── */}
        <div
          className="flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden -mx-4 px-4 sm:mx-0 sm:px-0 pb-1 snap-x snap-mandatory"
          role="tablist"
          aria-label="Filter status retur"
        >
          {[
            { key: "all" as const, label: "Semua" },
            { key: "Pending" as const, label: statusLabels.Pending },
            { key: "PickedUp" as const, label: statusLabels.PickedUp },
          ].map((tab) => {
            const isActive = (statusFilter ?? "all") === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() =>
                  navigate({
                    search: (prev) => ({
                      ...prev,
                      status: tab.key === "all" ? undefined : tab.key,
                      page: undefined,
                    }),
                    replace: true,
                  })
                }
                className={`shrink-0 snap-start inline-flex items-center gap-1.5 h-11 sm:h-8 px-4 sm:px-3.5 rounded-full text-xs font-medium border transition-colors whitespace-nowrap ${isActive ? "bg-foreground text-background border-foreground shadow-sm" : "bg-background border-border hover:bg-muted active:bg-muted text-foreground"}`}
              >
                {tab.label}
                <span
                  className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-semibold ${isActive ? "bg-background text-foreground" : "bg-muted text-muted-foreground"}`}
                >
                  {counts[tab.key]}
                </span>
              </button>
            );
          })}
        </div>

        {/* ── Branch filter (central roles only; branch admins are scoped) ── */}
        {!isBranchAdmin && (
          <div className="flex items-center gap-2 text-sm">
            <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
            <select
              aria-label="Filter cabang"
              value={branchFilter ?? ""}
              onChange={(e) =>
                navigate({
                  search: (prev) => ({
                    ...prev,
                    branchId: e.target.value || undefined,
                    page: undefined,
                  }),
                  replace: true,
                })
              }
              className="h-11 sm:h-9 min-w-0 flex-1 sm:flex-none rounded-lg border border-input bg-background px-2 text-sm"
            >
              <option value="">Semua cabang</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* ── Mobile: cards. The table is 9 columns and scrolls sideways, which
            hides the confirm action behind a horizontal swipe — so the phone
            layout leads with the same information as cards and gives the page's
            one real task a full-width target at the bottom of each card. ── */}
        <div className="md:hidden space-y-2.5 -mx-4 px-4">
          {pagedRows.length === 0 ? (
            <div className="rounded-xl border border-dashed bg-muted/20 p-8 text-center">
              <p className="text-sm font-medium">Tidak ada barang yang sedang dikembalikan</p>
              <p className="text-xs text-muted-foreground mt-1">
                Ubah filter status atau cabang untuk melihat riwayat lain
              </p>
            </div>
          ) : (
            pagedRows.map((row) => {
              const isPending = row.status === "Pending";
              const docLabel = row.procurementCode ?? row.transferCode;
              return (
                <div key={row.id} className="rounded-xl border bg-card p-3.5 shadow-xs">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm truncate">
                        {row.ingredientName ?? row.ingredientId.slice(0, 8)}
                      </div>
                      {row.reason ? (
                        <div className="text-xs text-muted-foreground truncate mt-0.5">
                          {row.reason}
                        </div>
                      ) : null}
                      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                        <Badge
                          variant={statusBadgeVariant(row.status)}
                          className="text-[11px] px-2 h-5"
                        >
                          {statusLabels[row.status]}
                        </Badge>
                        <Badge variant="outline" className="text-[11px] px-2 h-5">
                          {dispositionLabels[row.disposition]}
                        </Badge>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-semibold tabular-nums">
                        {row.quantity.toLocaleString("id-ID")}
                      </div>
                      {!isBranchAdmin && (
                        <div className="text-xs tabular-nums text-muted-foreground">
                          {formatRupiah(row.valuation)}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                    <div className="min-w-0">
                      <div className="text-[11px] tracking-widest uppercase text-muted-foreground font-medium">
                        Cabang
                      </div>
                      <div className="truncate">{row.branchName ?? "—"}</div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-[11px] tracking-widest uppercase text-muted-foreground font-medium">
                        Ditolak
                      </div>
                      <div>{new Date(row.createdAt).toLocaleDateString("id-ID")}</div>
                    </div>
                    <div className="col-span-2 min-w-0">
                      <div className="text-[11px] tracking-widest uppercase text-muted-foreground font-medium">
                        Asal
                      </div>
                      <div className="truncate">{docLabel ?? "—"}</div>
                    </div>
                  </div>

                  {canConfirm && (
                    <div className="mt-3">
                      {isPending ? (
                        <Button
                          variant="outline"
                          className="w-full h-12"
                          disabled={confirmMutation.isPending}
                          onClick={() => confirmMutation.mutate({ data: { returnId: row.id } })}
                        >
                          Sudah kembali
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          className="w-full h-12 text-muted-foreground"
                          disabled={reopenMutation.isPending}
                          onClick={() =>
                            reopenMutation.mutate({
                              data: {
                                returnId: row.id,
                                reason: "Barang belum sampai di gudang sumber",
                              },
                            })
                          }
                        >
                          Buka lagi
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <button
                onClick={() => setPage(Math.max(0, page - 1))}
                disabled={page === 0}
                className="inline-flex items-center justify-center h-11 px-3 rounded-lg border bg-background text-sm font-medium disabled:opacity-30 hover:bg-muted min-w-[96px]"
              >
                Sebelumnya
              </button>
              <span className="text-xs tabular-nums text-muted-foreground">
                Hal {page + 1} / {totalPages}
              </span>
              <button
                onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
                disabled={page >= totalPages - 1}
                className="inline-flex items-center justify-center h-11 px-3 rounded-lg border bg-background text-sm font-medium disabled:opacity-30 hover:bg-muted min-w-[96px]"
              >
                Selanjutnya
              </button>
            </div>
          )}
        </div>

        {/* ── Desktop: the table ── */}
        <div className="hidden md:block -mx-4 md:mx-0">
          <DataTable
            // The page owns its own search field above; without this the table
            // renders a second, redundant "Cari..." box.
            searchable={false}
            columns={columns}
            data={displayRows}
            keyExtractor={(row) => row.id}
            page={page}
            onPageChange={setPage}
            pageSize={PAGE_SIZE}
            emptyMessage="Tidak ada barang yang sedang dalam proses kembali ke gudang sumber."
          />
        </div>

        <p className="text-xs text-muted-foreground flex items-start gap-1.5">
          <ArrowUpRight className="h-3 w-3 mt-0.5 shrink-0" />
          Barang yang benar-benar dibuang (Scrap) dicatat di halaman Waste, bukan di sini.
        </p>
      </div>
    </RoleGuard>
  );
}
