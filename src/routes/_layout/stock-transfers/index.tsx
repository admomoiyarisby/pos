import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { badgeVariant } from "#/lib/utils";
import { lookupLabel } from "#/lib/label-lookup";
import { formText } from "#/lib/utils";
import { useTableSearch } from "#/hooks/useTableSearch";
import { useTableUrlState } from "#/hooks/useTableUrlState";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "#/lib/auth-context";
import type { UnknownRecord } from "#/lib/unknown-record";
import RoleGuard from "#/components/RoleGuard";
import PageHeader from "#/components/ui/PageHeader";
import { usePageTitle } from "#/hooks/usePageTitle";
import DataTable, { type Column } from "#/components/ui/DataTable";
import Modal from "#/components/ui/Modal";
import {
  getStockTransfers,
  createStockTransfer,
  approveStockTransfer,
  rejectStockTransfer,
  shipStockTransfer,
  receiveStockTransfer,
  cancelStockTransfer,
} from "#/lib/server/scm";
import { getBranches } from "#/lib/server/branches";
import { getIngredients } from "#/lib/server/ingredients";
import { Badge } from "#/components/ui/badge";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Check,
  Truck,
  PackageCheck,
  XCircle,
  Ban,
} from "lucide-react";

interface TRRow {
  id: string;
  code: string;
  fromBranchId: string;
  toBranchId: string;
  ingredientId: string;
  quantity: number;
  status: string;
  createdAt: Date;
}

const statusColors = {
  "Pending Approval": "warning",
  Approved: "default",
  Rejected: "destructive",
  "In Transit": "warning",
  Completed: "success",
  Cancelled: "destructive",
} satisfies Record<string, "default" | "warning" | "success" | "destructive" | "secondary">;

export const Route = createFileRoute("/_layout/stock-transfers/")({
  validateSearch: (search: UnknownRecord) => ({
    status: z.string().optional().catch(undefined).parse(search.status),
    search: z.string().optional().catch(undefined).parse(search.search),
    // URL-persisted table state (see useTableUrlState).
    page: z.coerce.number().int().min(0).optional().catch(undefined).parse(search.page),
    sortKey: z.string().optional().catch(undefined).parse(search.sortKey),
    sortDir: z.enum(["asc", "desc"]).optional().catch(undefined).parse(search.sortDir),
  }),
  component: TransferPage,
  loader: async () => {
    const transfers = await getStockTransfers({ data: {} });
    const branches = await getBranches({ data: {} });
    const ingredients = await getIngredients({ data: { excludeNasi: true } });
    return { transfers, branches, ingredients };
  },
});

function TransferPage() {
  const [search, setSearch] = useTableSearch();
  const { page, setPage, sort, setSort, filters } = useTableUrlState<{
    status?: string;
  }>(["status"]);
  const { user } = useAuth();
  const { transfers: initial, branches, ingredients } = Route.useLoaderData();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [rejectModal, setRejectModal] = useState<{ id: string; code: string } | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [cancelModal, setCancelModal] = useState<{ id: string; code: string } | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { data: transfers } = useQuery({
    queryKey: ["stock-transfers"],
    queryFn: () => getStockTransfers({ data: {} }),
    initialData: initial,
  });

  const statusFilter = filters.status;
  const filteredTransfers = statusFilter
    ? transfers.filter((t) => t.status === statusFilter)
    : transfers;

  const createMutation = useMutation({
    mutationFn: createStockTransfer,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["stock-transfers"] });
      setModalOpen(false);
      setSubmitError(null);
    },
    onError: (err) => {
      setSubmitError(err instanceof Error ? err.message : "Gagal membuat mutasi stok");
    },
  });

  const approveMutation = useMutation({
    mutationFn: approveStockTransfer,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["stock-transfers"] });
      setSubmitError(null);
    },
    onError: (err) => {
      setSubmitError(err instanceof Error ? err.message : "Gagal approve mutasi");
    },
  });

  const rejectMutation = useMutation({
    mutationFn: rejectStockTransfer,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["stock-transfers"] });
      setRejectModal(null);
      setRejectReason("");
      setSubmitError(null);
    },
    onError: (err) => {
      setSubmitError(err instanceof Error ? err.message : "Gagal menolak mutasi");
    },
  });

  const shipMutation = useMutation({
    mutationFn: shipStockTransfer,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["stock-transfers"] });
      setSubmitError(null);
    },
    onError: (err) => {
      setSubmitError(err instanceof Error ? err.message : "Gagal mengirim mutasi");
    },
  });

  const receiveMutation = useMutation({
    mutationFn: receiveStockTransfer,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["stock-transfers"] });
      setSubmitError(null);
    },
    onError: (err) => {
      setSubmitError(err instanceof Error ? err.message : "Gagal menerima mutasi");
    },
  });

  const cancelMutation = useMutation({
    mutationFn: cancelStockTransfer,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["stock-transfers"] });
      setCancelModal(null);
      setCancelReason("");
      setSubmitError(null);
    },
    onError: (err) => {
      setSubmitError(err instanceof Error ? err.message : "Gagal membatalkan mutasi");
    },
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    void createMutation.mutateAsync({
      data: {
        code: formText(fd, "code"),
        fromBranchId: formText(fd, "fromBranchId"),
        toBranchId: formText(fd, "toBranchId"),
        ingredientId: formText(fd, "ingredientId"),
        quantity: Number(fd.get("quantity")),
      },
    });
  };

  const columns: Column<TRRow>[] = [
    { accessorKey: "code", header: "Kode", width: "w-28", enableSorting: true },
    {
      accessorKey: "fromBranchId",
      header: "Dari",
      enableSorting: true,
      cell: ({ row }) =>
        branches.find((b) => b.id === row.original.fromBranchId)?.name ??
        row.original.fromBranchId.slice(0, 8),
    },
    {
      accessorKey: "toBranchId",
      header: "Ke",
      enableSorting: true,
      cell: ({ row }) =>
        branches.find((b) => b.id === row.original.toBranchId)?.name ??
        row.original.toBranchId.slice(0, 8),
    },
    {
      accessorKey: "ingredientId",
      header: "Bahan",
      enableSorting: true,
      cell: ({ row }) =>
        ingredients.find((i) => i.id === row.original.ingredientId)?.name ??
        row.original.ingredientId.slice(0, 8),
    },
    {
      accessorKey: "quantity",
      header: "Qty",
      align: "right",
      width: "w-20",
      enableSorting: true,
      cell: ({ row }) => row.original.quantity.toLocaleString("id-ID"),
    },
    {
      accessorKey: "status",
      header: "Status",
      enableSorting: true,
      cell: ({ row }) => (
        <Badge variant={badgeVariant(lookupLabel(statusColors, row.original.status))}>
          {row.original.status}
        </Badge>
      ),
    },
    {
      accessorKey: "id",
      header: "",
      width: "w-48",
      cell: ({ row }) => {
        const canApprove =
          row.original.status === "Pending Approval" &&
          ["super_admin", "area_manager"].includes(user?.role ?? "");
        const canReject =
          row.original.status === "Pending Approval" &&
          ["super_admin", "area_manager"].includes(user?.role ?? "");
        const canShip =
          row.original.status === "Approved" &&
          (["super_admin", "admin_pusat"].includes(user?.role ?? "") ||
            (user?.role === "branch_admin" && user?.branchId === row.original.fromBranchId));
        const canReceive =
          row.original.status === "In Transit" &&
          (["super_admin"].includes(user?.role ?? "") ||
            (user?.role === "branch_admin" && user?.branchId === row.original.toBranchId));
        const canCancel =
          ["Approved", "In Transit"].includes(row.original.status) &&
          ["super_admin", "admin_pusat"].includes(user?.role ?? "");

        return (
          <div className="flex items-center justify-end gap-1">
            {canApprove && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void approveMutation.mutateAsync({ data: { transferId: row.original.id } });
                }}
                className="h-7 px-2 rounded-md bg-success text-success-foreground text-[10px] font-medium"
              >
                <Check className="h-3 w-3 inline mr-1" />
                Approve
              </button>
            )}
            {canReject && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setRejectModal({ id: row.original.id, code: row.original.code });
                }}
                className="h-7 px-2 rounded-md bg-destructive text-destructive-foreground text-[10px] font-medium"
              >
                <XCircle className="h-3 w-3 inline mr-1" />
                Tolak
              </button>
            )}
            {canShip && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void shipMutation.mutateAsync({ data: { transferId: row.original.id } });
                }}
                className="h-7 px-2 rounded-md bg-info text-info-foreground text-[10px] font-medium"
              >
                <Truck className="h-3 w-3 inline mr-1" />
                Kirim
              </button>
            )}
            {canReceive && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void receiveMutation.mutateAsync({ data: { transferId: row.original.id } });
                }}
                className="h-7 px-2 rounded-md bg-success text-success-foreground text-[10px] font-medium"
              >
                <PackageCheck className="h-3 w-3 inline mr-1" />
                Terima
              </button>
            )}
            {canCancel && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setCancelModal({ id: row.original.id, code: row.original.code });
                }}
                className="h-7 px-2 rounded-md bg-secondary text-secondary-foreground text-[10px] font-medium"
              >
                <Ban className="h-3 w-3 inline mr-1" />
                Batal
              </button>
            )}
            <Link
              to="/stock-transfers/$trId"
              params={{ trId: row.original.id }}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent"
            >
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        );
      },
    },
  ];
  usePageTitle("Mutasi Stok", "Transfer antar cabang dengan approval");

  return (
    <RoleGuard allowedRoles={["super_admin", "admin_pusat", "area_manager", "branch_admin"]}>
      <div className="mb-4 flex items-start gap-2 rounded-md bg-warning/10 border border-warning/30 px-4 py-3 text-sm">
        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-warning" />
        <div className="flex-1">
          <p className="font-medium text-warning">Alur Mutasi Stok lawas</p>
          <p className="text-warning/80 mt-1">
            Halaman ini sudah dibekukan. Alur baru menggunakan model Surat Jalan dengan 10-state FSM
            (mirip Pengadaan). Buat mutasi baru di{" "}
            <Link
              to="/scm-transfers"
              search={(prev) => ({
                ...prev,
                status: undefined,
                search: undefined,
                page: prev.page,
                sortKey: prev.sortKey,
                sortDir: prev.sortDir,
              })}
              className="underline font-medium"
            >
              /scm-transfers
            </Link>
            . Data lawas tetap dapat dibaca di sini untuk referensi historis. Lihat ADR 0006 untuk
            detailnya.
          </p>
        </div>
      </div>
      <PageHeader action={{ label: "Ajukan Mutasi (lawas)", onClick: () => setModalOpen(true) }} />

      {submitError && (
        <div className="flex items-start gap-2 rounded-md bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span className="flex-1">{submitError}</span>
          <button
            onClick={() => setSubmitError(null)}
            className="text-destructive/70 hover:text-destructive"
          >
            ✕
          </button>
        </div>
      )}

      <DataTable
        columns={columns}
        data={filteredTransfers}
        keyExtractor={(r) => r.id}
        search={search}
        onSearchChange={setSearch}
        page={page}
        onPageChange={setPage}
        sort={sort}
        onSortChange={setSort}
      />

      <Modal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setSubmitError(null);
        }}
        title="Ajukan Mutasi Stok"
        size="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Kode</label>
              <input
                name="code"
                required
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Bahan</label>
              <select
                name="ingredientId"
                required
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {ingredients.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Dari Cabang</label>
              <select
                name="fromBranchId"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Ke Cabang</label>
              <select
                name="toBranchId"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Jumlah</label>
            <input
              name="quantity"
              type="number"
              min={1}
              required
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          {submitError && (
            <div className="flex items-start gap-2 rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span className="flex-1">{submitError}</span>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => {
                setModalOpen(false);
                setSubmitError(null);
              }}
              className="h-9 px-4 rounded-md border text-sm"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50"
            >
              {createMutation.isPending ? "Memproses..." : "Ajukan"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Reject Modal */}
      {rejectModal && (
        <Modal
          open
          onClose={() => {
            setRejectModal(null);
            setSubmitError(null);
          }}
          title="Tolak Mutasi Stok"
        >
          <div className="space-y-4">
            {submitError && (
              <div className="flex items-start gap-2 rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{submitError}</span>
              </div>
            )}
            <p className="text-sm">
              Tolak mutasi <strong>{rejectModal.code}</strong>?
            </p>
            <div className="space-y-2">
              <label className="text-sm font-medium">Alasan Penolakan</label>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                required
                rows={3}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setRejectModal(null);
                  setSubmitError(null);
                }}
                className="h-9 px-4 rounded-md border text-sm"
              >
                Batal
              </button>
              <button
                onClick={() =>
                  void rejectMutation.mutateAsync({
                    data: { transferId: rejectModal.id, reason: rejectReason },
                  })
                }
                disabled={rejectMutation.isPending || !rejectReason.trim()}
                className="h-9 px-4 rounded-md bg-destructive text-destructive-foreground text-sm disabled:opacity-50"
              >
                {rejectMutation.isPending ? "Memproses..." : "Tolak"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Cancel Modal */}
      {cancelModal && (
        <Modal
          open
          onClose={() => {
            setCancelModal(null);
            setSubmitError(null);
          }}
          title="Batalkan Mutasi Stok"
        >
          <div className="space-y-4">
            {submitError && (
              <div className="flex items-start gap-2 rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{submitError}</span>
              </div>
            )}
            <p className="text-sm">
              Batalkan mutasi <strong>{cancelModal.code}</strong>?
            </p>
            <p className="text-xs text-muted-foreground">
              Stok akan dikembalikan ke cabang asal jika sedang dalam perjalanan.
            </p>
            <div className="space-y-2">
              <label className="text-sm font-medium">Alasan Pembatalan</label>
              <textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                required
                rows={3}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setCancelModal(null);
                  setSubmitError(null);
                }}
                className="h-9 px-4 rounded-md border text-sm"
              >
                Tutup
              </button>
              <button
                onClick={() =>
                  void cancelMutation.mutateAsync({
                    data: { transferId: cancelModal.id, reason: cancelReason },
                  })
                }
                disabled={cancelMutation.isPending || !cancelReason.trim()}
                className="h-9 px-4 rounded-md bg-destructive text-destructive-foreground text-sm disabled:opacity-50"
              >
                {cancelMutation.isPending ? "Memproses..." : "Batalkan"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </RoleGuard>
  );
}
