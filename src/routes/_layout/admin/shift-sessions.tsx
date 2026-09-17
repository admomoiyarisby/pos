import { createFileRoute } from "@tanstack/react-router";
import { useTableSearch } from "#/hooks/useTableSearch";
import { useTableUrlState } from "#/hooks/useTableUrlState";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "#/lib/auth-context";
import RoleGuard from "#/components/RoleGuard";
import { usePageTitle } from "#/hooks/usePageTitle";
import DataTable, { type Column } from "#/components/ui/DataTable";
import { ShiftCashDetail } from "#/components/pos/ShiftCashDetail";
import { getShiftSessions, softDeleteShiftSession } from "#/lib/server/pos";
import { getBranches } from "#/lib/server/branches";
import { Badge } from "#/components/ui/badge";
import { Clock, Trash2, ChevronDown } from "lucide-react";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Modal from "#/components/ui/Modal";
import { toast } from "sonner";

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
  shiftCashFloat: number;
  shiftActualCash: number | null;
  shiftExpectedCash: number | null;
  /** Net drawer movement: Cash sales (always in) + float adjustments (±). */
  shiftCashSales: number;
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

function formatRupiah(n: number) {
  return `Rp ${n.toLocaleString("id-ID")}`;
}

// Selisih kas = physical cash counted − expected (float + cash sales).
// Only meaningful once the shift is closed and expectedCash exists.
function ShiftVarianceBadge({ r }: { r: ShiftSessionRow }) {
  if (r.shiftStatus !== "Closed" || r.shiftActualCash === null || r.shiftExpectedCash === null) {
    return <span className="text-xs text-muted-foreground">-</span>;
  }
  const diff = r.shiftActualCash - r.shiftExpectedCash;
  if (diff === 0) {
    return (
      <Badge variant="success" className="shrink-0 rounded-full text-[11px] h-5">
        Cocok
      </Badge>
    );
  }
  return (
    <Badge
      variant={diff > 0 ? "warning" : "destructive"}
      className="shrink-0 rounded-full text-[11px] h-5 tabular-nums"
    >
      {diff > 0 ? "+" : ""}
      {formatRupiah(diff)}
    </Badge>
  );
}

// A shift row can only expand into the cash detail once the shift is closed —
// open shifts have no expected/actual cash to reconcile against.
function shiftHasCashDetail(
  r: ShiftSessionRow,
): r is ShiftSessionRow & { shiftActualCash: number; shiftExpectedCash: number } {
  return r.shiftStatus === "Closed" && r.shiftActualCash !== null && r.shiftExpectedCash !== null;
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
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<ShiftSessionRow | null>(null);
  // Expandable per-shift cash detail (Rincian Kas), like /finance's Selisih Kas.
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const deleteMutation = useMutation({
    mutationFn: softDeleteShiftSession,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["shift-sessions"] });
      setDeleteTarget(null);
      toast.success("Sesi shift dihapus dari riwayat");
    },
    onError: (error: Error) => {
      toast.error("Gagal menghapus sesi shift", { description: error.message });
    },
  });
  // Only the super_admin sees the delete action; admin keepers of the history
  // (branch admins, AMs) get no destructive control here.
  const canDelete = user?.role === "super_admin";
  const [search, setSearch] = useTableSearch();
  const { branches: allBranches, sessions: initial } = Route.useLoaderData();
  const { page, setPage, filters, setFilter } = useTableUrlState<{
    branchId?: string;
    dateFrom?: string;
    dateTo?: string;
  }>(["branchId", "dateFrom", "dateTo"]);

  const { data: sessions, isFetching } = useQuery({
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
    {
      accessorKey: "shiftCashFloat",
      header: "Uang Kas",
      width: "w-32",
      cell: ({ row }) => formatRupiah(row.original.shiftCashFloat),
    },
    {
      // Net drawer movement: cash sales (always in) + mid-shift adjustments (±).
      accessorKey: "shiftCashSales",
      header: "Mutasi Kas",
      width: "w-32",
      cell: ({ row }) =>
        row.original.shiftCashSales > 0
          ? `+${formatRupiah(row.original.shiftCashSales)}`
          : formatRupiah(row.original.shiftCashSales),
    },
    {
      // Kas akhir = the nominal the kasir physically counted at close.
      accessorKey: "shiftActualCashRaw",
      header: "Kas Akhir",
      width: "w-32",
      cell: ({ row }) =>
        row.original.shiftStatus === "Closed" && row.original.shiftActualCash !== null ? (
          formatRupiah(row.original.shiftActualCash)
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      // Selisih = physical cash counted − expected (float + mutasi kas).
      // Only meaningful once the shift is closed and expectedCash exists.
      accessorKey: "shiftVariance",
      header: "Selisih Kas",
      width: "w-32",
      cell: ({ row }) => {
        const { shiftStatus, shiftActualCash, shiftExpectedCash } = row.original;
        if (shiftStatus !== "Closed" || shiftActualCash === null || shiftExpectedCash === null) {
          return <span className="text-muted-foreground">-</span>;
        }
        const diff = shiftActualCash - shiftExpectedCash;
        if (diff === 0) {
          return <Badge variant="success">Cocok</Badge>;
        }
        return (
          <Badge variant={diff > 0 ? "warning" : "destructive"}>
            {diff > 0 ? "+" : ""}
            {formatRupiah(diff)}
          </Badge>
        );
      },
    },
    ...(canDelete
      ? [
          {
            id: "actions",
            header: "",
            width: "w-12",
            cell: ({ row }: { row: { original: ShiftSessionRow } }) => (
              <button
                onClick={() => setDeleteTarget(row.original)}
                title="Hapus dari riwayat"
                aria-label="Hapus sesi shift"
                className="h-7 w-7 inline-flex items-center justify-center rounded border text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            ),
          } satisfies Column<ShiftSessionRow>,
        ]
      : []),
  ];

  const ownBranch = allBranches.find((b) => b.id === user?.branchId);
  // Area managers may only filter among the branches assigned to them.
  const filterableBranches = isAreaManager
    ? allBranches.filter((b) => user?.assignedBranches?.includes(b.id))
    : allBranches;

  return (
    <RoleGuard allowedRoles={["super_admin", "branch_admin", "area_manager"]}>
      <div className="space-y-4">
        {/* Filters — stack on mobile, inline on desktop */}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
          {!isBranchAdmin ? (
            <select
              value={filters.branchId ?? ""}
              onChange={(e) => setFilter("branchId", e.target.value)}
              aria-label="Filter cabang"
              className="h-11 sm:h-9 w-full sm:w-auto rounded-lg sm:rounded-md border border-input bg-background px-3 text-[16px] sm:text-sm"
            >
              <option value="">Semua Cabang</option>
              {filterableBranches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code} — {b.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="inline-flex items-center h-11 sm:h-9 rounded-lg sm:rounded-md border border-input bg-muted px-3 text-sm font-medium">
              {ownBranch ? `${ownBranch.code} — ${ownBranch.name}` : "Cabang saya"}
            </span>
          )}
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={filters.dateFrom ?? ""}
              onChange={(e) => setFilter("dateFrom", e.target.value)}
              aria-label="Tanggal mulai"
              className="h-11 sm:h-9 flex-1 sm:flex-none rounded-lg sm:rounded-md border border-input bg-background px-3 text-[16px] sm:text-sm"
            />
            <span className="text-sm text-muted-foreground">sampai</span>
            <input
              type="date"
              value={filters.dateTo ?? ""}
              onChange={(e) => setFilter("dateTo", e.target.value)}
              aria-label="Tanggal akhir"
              className="h-11 sm:h-9 flex-1 sm:flex-none rounded-lg sm:rounded-md border border-input bg-background px-3 text-[16px] sm:text-sm"
            />
          </div>
          {(filters.branchId || filters.dateFrom || filters.dateTo) && (
            <button
              onClick={() => {
                setFilter("branchId", undefined);
                setFilter("dateFrom", undefined);
                setFilter("dateTo", undefined);
                setPage(0);
              }}
              className="self-start sm:ml-auto text-xs font-medium text-primary hover:underline underline-offset-4"
            >
              Reset filter
            </button>
          )}
        </div>

        {isFetching && !sessions ? (
          <div className="space-y-2.5">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="rounded-xl border bg-card p-3.5 animate-pulse"
                style={{ animationDelay: `${i * 120}ms` }}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="h-4 w-28 rounded bg-muted" />
                  <div className="h-5 w-20 rounded-full bg-muted" />
                </div>
                <div className="mt-2.5 h-3 w-40 rounded bg-muted" />
                <div className="mt-3 grid grid-cols-3 gap-1.5">
                  <div className="h-12 rounded-lg bg-muted" />
                  <div className="h-12 rounded-lg bg-muted" />
                  <div className="h-12 rounded-lg bg-muted" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <>
            {/* Mobile cards */}
            <div className="md:hidden space-y-2.5 -mx-4 px-4">
              {sessions.length === 0 ? (
                <div className="rounded-xl border border-dashed bg-muted/20 p-8 text-center">
                  <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                    <Clock className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <p className="mt-3 text-sm font-medium">Belum ada sesi shift</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Sesi shift pegawai akan muncul di sini.
                  </p>
                </div>
              ) : (
                sessions.map((r) => {
                  const a = actionLabels[r.action];
                  const isOpen = r.shiftStatus === "Open";
                  const cashOpen = expandedIds.includes(r.id) && shiftHasCashDetail(r);
                  const toggleCash = () =>
                    setExpandedIds((ids) =>
                      ids.includes(r.id) ? ids.filter((id) => id !== r.id) : [...ids, r.id],
                    );
                  return (
                    <div
                      key={r.id}
                      className={`rounded-xl border bg-card p-3.5 shadow-xs ${isOpen ? "border-success/40" : ""}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold truncate">
                            {r.userName ?? r.userId.slice(0, 8)}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5 truncate">
                            {r.branchCode} · {r.branchName}
                          </div>
                        </div>
                        <Badge
                          variant={a.variant}
                          className="shrink-0 rounded-full text-[11px] h-5"
                        >
                          {a.label}
                        </Badge>
                      </div>
                      <div className="mt-2.5 grid grid-cols-3 gap-1.5 text-xs">
                        <div className="rounded-lg bg-muted/40 px-2 py-2 text-center">
                          <div className="text-[10px] tracking-widest uppercase text-muted-foreground font-medium">
                            Login
                          </div>
                          <div className="tabular-nums mt-0.5">{formatDateTime(r.loggedInAt)}</div>
                        </div>
                        <div className="rounded-lg bg-muted/40 px-2 py-2 text-center">
                          <div className="text-[10px] tracking-widest uppercase text-muted-foreground font-medium">
                            Logout
                          </div>
                          <div className="tabular-nums mt-0.5">
                            {r.loggedOutAt ? formatDateTime(r.loggedOutAt) : "—"}
                          </div>
                        </div>
                        <div className="rounded-lg bg-muted/40 px-2 py-2 text-center">
                          <div className="text-[10px] tracking-widest uppercase text-muted-foreground font-medium">
                            Durasi
                          </div>
                          <div className="tabular-nums mt-0.5">
                            {formatDuration(r.loggedInAt, r.loggedOutAt)}
                          </div>
                        </div>
                      </div>
                      {shiftHasCashDetail(r) ? (
                        <button
                          type="button"
                          onClick={toggleCash}
                          aria-expanded={cashOpen}
                          className="mt-2 flex w-full items-center justify-between gap-2 text-left"
                        >
                          <span className="flex items-center gap-1.5 min-w-0">
                            <Badge
                              variant={isOpen ? "success" : "secondary"}
                              className="shrink-0 rounded-full text-[11px] h-5"
                            >
                              {isOpen ? "Terbuka" : "Ditutup"}
                            </Badge>
                            <span className="text-xs text-muted-foreground tabular-nums truncate">
                              Kas {formatRupiah(r.shiftCashFloat)} · Mutasi +
                              {formatRupiah(r.shiftCashSales)} · Akhir{" "}
                              {r.shiftActualCash !== null ? formatRupiah(r.shiftActualCash) : "-"}
                            </span>
                          </span>
                          <span className="flex shrink-0 items-center gap-1">
                            <ShiftVarianceBadge r={r} />
                            <ChevronDown
                              className={`h-4 w-4 text-muted-foreground transition-transform ${
                                cashOpen ? "rotate-180" : ""
                              }`}
                            />
                          </span>
                        </button>
                      ) : (
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <Badge
                              variant={isOpen ? "success" : "secondary"}
                              className="shrink-0 rounded-full text-[11px] h-5"
                            >
                              {isOpen ? "Terbuka" : "Ditutup"}
                            </Badge>
                            <span className="text-xs text-muted-foreground tabular-nums truncate">
                              Kas {formatRupiah(r.shiftCashFloat)} · Mutasi +
                              {formatRupiah(r.shiftCashSales)} · Akhir{" "}
                              {r.shiftActualCash !== null ? formatRupiah(r.shiftActualCash) : "-"}
                            </span>
                          </div>
                          <ShiftVarianceBadge r={r} />
                        </div>
                      )}
                      {cashOpen && (
                        <div className="mt-2 border-t pt-2.5 bg-muted/30 -mx-3.5 -mb-3.5 px-3.5 pb-3.5 rounded-b-xl">
                          <ShiftCashDetail
                            shiftId={r.shiftId}
                            cashFloat={r.shiftCashFloat}
                            expectedCash={r.shiftExpectedCash}
                            actualCash={r.shiftActualCash}
                          />
                        </div>
                      )}
                      {canDelete && (
                        <div className="mt-2 flex justify-end">
                          <button
                            onClick={() => setDeleteTarget(r)}
                            className="inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          >
                            <Trash2 className="h-3 w-3" />
                            Hapus
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Desktop table */}
            <div className="hidden md:block">
              <DataTable
                columns={columns}
                data={sessions}
                keyExtractor={(r) => r.id}
                renderExpanded={(r) =>
                  shiftHasCashDetail(r) ? (
                    <ShiftCashDetail
                      shiftId={r.shiftId}
                      cashFloat={r.shiftCashFloat}
                      expectedCash={r.shiftExpectedCash}
                      actualCash={r.shiftActualCash}
                    />
                  ) : null
                }
                getRowExpandable={shiftHasCashDetail}
                expandedIds={expandedIds}
                onExpandedChange={setExpandedIds}
                pageSize={20}
                pagination={false}
                search={search}
                onSearchChange={setSearch}
              />
            </div>
          </>
        )}

        <div className="flex items-center justify-between">
          <button
            onClick={() => setPage(Math.max(0, page - 1))}
            disabled={page === 0}
            className="h-10 sm:h-9 px-4 rounded-lg sm:rounded-md border bg-background text-sm font-medium disabled:opacity-30 min-w-[96px]"
          >
            Sebelumnya
          </button>
          <span className="text-xs sm:text-sm text-muted-foreground tabular-nums">
            Halaman {page + 1}
          </span>
          <button
            onClick={() => setPage(page + 1)}
            className="h-10 sm:h-9 px-4 rounded-lg sm:rounded-md border bg-background text-sm font-medium min-w-[96px]"
          >
            Berikutnya
          </button>
        </div>
      </div>

      {/* ── Soft Delete Confirm Modal ── */}
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Hapus dari Riwayat"
        size="sm"
      >
        {deleteTarget && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Sesi shift {deleteTarget.userName} ({deleteTarget.branchCode}) akan disembunyikan dari
              riwayat (soft delete). Rekap kas shift tetap utuh.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="h-9 px-4 rounded-md border text-sm"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => deleteMutation.mutate({ data: { sessionId: deleteTarget.id } })}
                disabled={deleteMutation.isPending}
                className="h-9 px-4 rounded-md bg-destructive text-destructive-foreground text-sm disabled:opacity-50"
              >
                {deleteMutation.isPending ? "Memproses..." : "Hapus"}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </RoleGuard>
  );
}
