import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "#/lib/auth-context";
import RoleGuard from "#/components/RoleGuard";
import PageHeader from "#/components/ui/PageHeader";
import { usePageTitle } from "#/hooks/usePageTitle";
import DataTable from "#/components/ui/DataTable";
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
import type { Column } from "#/components/ui/DataTable";
import { Badge } from "#/components/ui/badge";
import { Link } from "@tanstack/react-router";
import { AlertCircle, ArrowRight, Check, Truck, PackageCheck, XCircle, Ban } from "lucide-react";

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

const statusColors: Record<
  string,
  "default" | "warning" | "success" | "destructive" | "secondary"
> = {
  "Pending Approval": "warning",
  Approved: "default",
  Rejected: "destructive",
  "In Transit": "warning",
  Completed: "success",
  Cancelled: "destructive",
};

export const Route = createFileRoute("/_layout/stock-transfers/")({
  component: TransferPage,
  loader: async () => {
    const transfers = await getStockTransfers({ data: {} });
    const branches = await getBranches({ data: {} });
    const ingredients = await getIngredients({ data: {} });
    return { transfers, branches, ingredients };
  },
});

function TransferPage() {
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

  const { status: statusFilter } = Route.useSearch() as { status?: string };
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
        code: fd.get("code") as string,
        fromBranchId: fd.get("fromBranchId") as string,
        toBranchId: fd.get("toBranchId") as string,
        ingredientId: fd.get("ingredientId") as string,
        quantity: Number(fd.get("quantity")),
      },
    });
  };

  const columns: Column<TRRow>[] = [
    { key: "code", header: "Kode", width: "w-28", sortable: true },
    {
      key: "fromBranchId",
      header: "Dari",
      sortable: true,
      render: (r) =>
        branches.find((b) => b.id === r.fromBranchId)?.name ?? r.fromBranchId.slice(0, 8),
    },
    {
      key: "toBranchId",
      header: "Ke",
      sortable: true,
      render: (r) => branches.find((b) => b.id === r.toBranchId)?.name ?? r.toBranchId.slice(0, 8),
    },
    {
      key: "ingredientId",
      header: "Bahan",
      sortable: true,
      render: (r) =>
        ingredients.find((i) => i.id === r.ingredientId)?.name ?? r.ingredientId.slice(0, 8),
    },
    {
      key: "quantity",
      header: "Qty",
      align: "right",
      width: "w-20",
      sortable: true,
      render: (r) => r.quantity.toLocaleString("id-ID"),
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      render: (r) => (
        <Badge
          variant={
            (statusColors[r.status] ?? "default") as
              | "default"
              | "success"
              | "warning"
              | "destructive"
              | "secondary"
          }
        >
          {r.status}
        </Badge>
      ),
    },
    {
      key: "id",
      header: "",
      width: "w-48",
      render: (r) => {
        const canApprove =
          r.status === "Pending Approval" &&
          ["super_admin", "area_manager"].includes(user?.role ?? "");
        const canReject =
          r.status === "Pending Approval" &&
          ["super_admin", "area_manager"].includes(user?.role ?? "");
        const canShip =
          r.status === "Approved" &&
          (["super_admin", "admin_pusat"].includes(user?.role ?? "") ||
            (user?.role === "branch_admin" && user?.branchId === r.fromBranchId));
        const canReceive =
          r.status === "In Transit" &&
          (["super_admin"].includes(user?.role ?? "") ||
            (user?.role === "branch_admin" && user?.branchId === r.toBranchId));
        const canCancel =
          ["Approved", "In Transit"].includes(r.status) &&
          ["super_admin", "admin_pusat"].includes(user?.role ?? "");

        return (
          <div className="flex items-center justify-end gap-1">
            {canApprove && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void approveMutation.mutateAsync({ data: { transferId: r.id } });
                }}
                className="h-7 px-2 rounded-md bg-emerald-600 text-white text-[10px] font-medium"
              >
                <Check className="h-3 w-3 inline mr-1" />
                Approve
              </button>
            )}
            {canReject && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setRejectModal({ id: r.id, code: r.code });
                }}
                className="h-7 px-2 rounded-md bg-red-600 text-white text-[10px] font-medium"
              >
                <XCircle className="h-3 w-3 inline mr-1" />
                Tolak
              </button>
            )}
            {canShip && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void shipMutation.mutateAsync({ data: { transferId: r.id } });
                }}
                className="h-7 px-2 rounded-md bg-blue-600 text-white text-[10px] font-medium"
              >
                <Truck className="h-3 w-3 inline mr-1" />
                Kirim
              </button>
            )}
            {canReceive && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void receiveMutation.mutateAsync({ data: { transferId: r.id } });
                }}
                className="h-7 px-2 rounded-md bg-emerald-600 text-white text-[10px] font-medium"
              >
                <PackageCheck className="h-3 w-3 inline mr-1" />
                Terima
              </button>
            )}
            {canCancel && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setCancelModal({ id: r.id, code: r.code });
                }}
                className="h-7 px-2 rounded-md bg-slate-500 text-white text-[10px] font-medium"
              >
                <Ban className="h-3 w-3 inline mr-1" />
                Batal
              </button>
            )}
            <Link
              to="/stock-transfers/$trId"
              params={{ trId: r.id }}
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
      <PageHeader action={{ label: "Ajukan Mutasi", onClick: () => setModalOpen(true) }} />

      {submitError && (
        <div className="flex items-start gap-2 rounded-md bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span className="flex-1">{submitError}</span>
          <button onClick={() => setSubmitError(null)} className="text-destructive/70 hover:text-destructive">✕</button>
        </div>
      )}

      <DataTable columns={columns} data={filteredTransfers} keyExtractor={(r) => r.id} />

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
        <Modal open onClose={() => { setRejectModal(null); setSubmitError(null); }} title="Tolak Mutasi Stok">
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
                onClick={() => { setRejectModal(null); setSubmitError(null); }}
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
                className="h-9 px-4 rounded-md bg-red-600 text-white text-sm disabled:opacity-50"
              >
                {rejectMutation.isPending ? "Memproses..." : "Tolak"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Cancel Modal */}
      {cancelModal && (
        <Modal open onClose={() => { setCancelModal(null); setSubmitError(null); }} title="Batalkan Mutasi Stok">
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
                onClick={() => { setCancelModal(null); setSubmitError(null); }}
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
                className="h-9 px-4 rounded-md bg-red-600 text-white text-sm disabled:opacity-50"
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
